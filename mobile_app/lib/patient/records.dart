import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../db.dart';
import '../screens/records.dart' show RecordCard;
import '../ui.dart';
import 'pdb.dart';

/// Health records for self and family: doctor notes, prescriptions and the patient's own uploads.
class MyRecordsTab extends StatefulWidget {
  const MyRecordsTab({super.key});

  @override
  State<MyRecordsTab> createState() => _MyRecordsTabState();
}

class _MyRecordsTabState extends State<MyRecordsTab> {
  String? _member;
  late final _family = PDb.family();

  @override
  Widget build(BuildContext context) => StreamBuilder<List<QueryDocumentSnapshot<Json>>>(
        stream: _family,
        builder: (context, fam) {
          final family = fam.data ?? [];
          final selected = family.where((m) => m.id == _member).firstOrNull ?? family.firstOrNull;
          return Scaffold(
            appBar: AppBar(title: const Text('Health records')),
            floatingActionButton: selected == null
                ? null
                : FloatingActionButton.extended(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(
                        builder: (_) => UploadRecordScreen(patientId: selected.id, name: selected.data()['name'] ?? ''))),
                    icon: const Icon(Icons.upload_file),
                    label: const Text('Upload'),
                  ),
            body: selected == null
                ? const Center(child: CircularProgressIndicator())
                : Column(children: [
                    SizedBox(
                      height: 52,
                      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
                        for (final m in family)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text('${m.data()['name']}'),
                              selected: m.id == selected.id,
                              onSelected: (_) => setState(() => _member = m.id),
                            ),
                          ),
                      ]),
                    ),
                    Expanded(
                      child: StreamBuilder<List<Json>>(
                        key: ValueKey(selected.id),
                        stream: PDb.records(selected.id),
                        builder: (context, snap) {
                          if (snap.hasError) return Center(child: Text('${snap.error}'));
                          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
                          if (snap.data!.isEmpty) {
                            return const EmptyState('No records yet. Prescriptions from your visits appear here.', icon: Icons.folder_open);
                          }
                          return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
                            for (final r in snap.data!) Padding(padding: const EdgeInsets.only(bottom: 8), child: RecordCard(r)),
                          ]);
                        },
                      ),
                    ),
                  ]),
          );
        },
      );
}

class UploadRecordScreen extends StatefulWidget {
  const UploadRecordScreen({super.key, required this.patientId, required this.name});
  final String patientId, name;

  @override
  State<UploadRecordScreen> createState() => _UploadRecordScreenState();
}

class _UploadRecordScreenState extends State<UploadRecordScreen> {
  String _type = 'Lab Report';
  final _title = TextEditingController(), _notes = TextEditingController();
  PlatformFile? _file;
  bool _busy = false;
  String _share = ''; // '' = only the family; else a hospital the patient visits
  late final _hospitals = PDb.hospitalsOf(widget.patientId);

  Future<void> _pick() async {
    final f = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png']);
    if (f != null) setState(() => _file = f);
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) return snack(context, 'Give the record a title');
    if (_file != null && (await _file!.length() ?? 0) > 20 * 1024 * 1024) {
      if (mounted) snack(context, 'File must be under 20 MB');
      return;
    }
    final bytes = await _file?.readAsBytes();
    if (!mounted) return;
    setState(() => _busy = true);
    final ok = await guard(
      context,
      () => PDb.uploadRecord(widget.patientId,
          type: _type, title: _title.text.trim(), notes: _notes.text.trim(), bytes: bytes, fileName: _file?.name, hospitalId: _share),
      ok: 'Record saved',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text('Add record · ${widget.name}')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Wrap(spacing: 8, children: [
            for (final t in ['Lab Report', 'Prescription', 'Scan', 'Vaccination', 'Note'])
              ChoiceChip(label: Text(t), selected: _type == t, onSelected: (_) => setState(() => _type = t)),
          ]),
          const SizedBox(height: 16),
          TextField(controller: _title, decoration: const InputDecoration(labelText: 'Title')),
          const SizedBox(height: 12),
          TextField(controller: _notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Notes (optional)')),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _pick,
            icon: const Icon(Icons.attach_file),
            label: Text(_file?.name ?? 'Attach PDF or photo (optional)'),
          ),
          const SizedBox(height: 12),
          FutureBuilder<Map<String, String>>(
            future: _hospitals,
            builder: (context, snap) => DropdownButtonFormField<String>(
              initialValue: _share,
              decoration: const InputDecoration(labelText: 'Share with', prefixIcon: Icon(Icons.lock_outline)),
              items: [
                const DropdownMenuItem(value: '', child: Text('Only my family (private)')),
                for (final h in (snap.data ?? {}).entries) DropdownMenuItem(value: h.key, child: Text('Doctors at ${h.value}')),
              ],
              onChanged: (v) => setState(() => _share = v ?? ''),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: _busy ? null : _save, child: const Text('Save Record')),
        ]),
      );
}
