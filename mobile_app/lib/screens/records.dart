import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:file_picker/file_picker.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../db.dart';
import '../ui.dart';
import 'bookings.dart';
import 'home.dart';

const recordTypes = ['Consultation', 'Vitals', 'Prescription', 'Lab Report', 'Note'];

String ageOf(Json p) {
  final dob = DateTime.tryParse('${p['dob'] ?? ''}');
  if (dob != null) return '${(DateTime.now().difference(dob).inDays / 365.25).floor()} y';
  return p['age'] == null ? '' : '${p['age']} y';
}

IconData recordIcon(String? type) => switch (type) {
      'Vitals' => Icons.monitor_heart_outlined,
      'Prescription' => Icons.medication_outlined,
      'Lab Report' => Icons.biotech_outlined,
      'Note' => Icons.sticky_note_2_outlined,
      _ => Icons.medical_services_outlined,
    };

class RecordsTab extends StatefulWidget {
  const RecordsTab({super.key});

  @override
  State<RecordsTab> createState() => _RecordsTabState();
}

class _RecordsTabState extends State<RecordsTab> {
  String _q = '';

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Patient Records'), actions: [
          IconButton(
            tooltip: 'Add patient',
            icon: const Icon(Icons.person_add_alt),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PatientFormScreen())),
          ),
          ...homeActions(context),
        ]),
        body: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search by name or phone'),
              onChanged: (v) => setState(() => _q = v.toLowerCase()),
            ),
          ),
          Expanded(
            // ponytail: streams all patients and filters locally; add a name-prefix query past ~2k patients.
            child: StreamBuilder<QuerySnapshot<Json>>(
              stream: Db.patients.orderBy('name').snapshots(),
              builder: (context, snap) {
                if (snap.hasError) return Center(child: Text('${snap.error}'));
                if (!snap.hasData) return const Center(child: CircularProgressIndicator());
                final docs = snap.data!.docs.where((d) => '${d['name']} ${d.data()['phone'] ?? ''}'.toLowerCase().contains(_q)).toList();
                if (docs.isEmpty) return const EmptyState('No patients found', icon: Icons.person_search);
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: docs.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final p = docs[i].data();
                    return Card(
                      child: ListTile(
                        leading: Avatar(p['name'] ?? ''),
                        title: Text(p['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text([p['phone'], p['gender'], ageOf(p)].where((x) => x != null && '$x'.isNotEmpty).join(' · ')),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PatientDetailScreen(docs[i].id))),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ]),
      );
}

class PatientDetailScreen extends StatelessWidget {
  const PatientDetailScreen(this.id, {super.key});
  final String id;

  @override
  Widget build(BuildContext context) => StreamBuilder<DocumentSnapshot<Json>>(
        stream: Db.patients.doc(id).snapshots(),
        builder: (context, snap) {
          final p = snap.data?.data();
          if (p == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
          final allergies = '${p['allergies'] ?? ''}'.trim();
          final conditions = '${p['conditions'] ?? ''}'.trim();
          return DefaultTabController(
            length: 2,
            child: Scaffold(
              appBar: AppBar(
                title: Text(p['name'] ?? 'Patient'),
                actions: [
                  IconButton(
                    tooltip: 'Edit patient',
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PatientFormScreen(id: id, initial: p))),
                  ),
                ],
              ),
              floatingActionButton: FloatingActionButton.extended(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => AddRecordScreen(patientId: id))),
                icon: const Icon(Icons.note_add_outlined),
                label: const Text('Add Record'),
              ),
              body: NestedScrollView(
                headerSliverBuilder: (context, _) => [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Avatar(p['name'] ?? '', size: 56),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(p['name'] ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                                  Text([p['gender'], ageOf(p), if (p['bloodGroup'] != null && '${p['bloodGroup']}'.isNotEmpty) 'Blood ${p['bloodGroup']}']
                                      .where((x) => x != null && '$x'.isNotEmpty)
                                      .join(' · ')),
                                  Text(p['phone'] ?? '', style: const TextStyle(color: kMuted)),
                                ]),
                              ),
                            ]),
                            if (allergies.isNotEmpty || conditions.isNotEmpty) const SizedBox(height: 10),
                            if (allergies.isNotEmpty)
                              Text('⚠ Allergies: $allergies', style: const TextStyle(color: kRed, fontWeight: FontWeight.w600)),
                            if (conditions.isNotEmpty) Text('Conditions: $conditions'),
                            const SizedBox(height: 12),
                            Row(children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () => callPatient(context, p['phone'] ?? ''),
                                  icon: const Icon(Icons.call_outlined),
                                  label: const Text('Call'),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(builder: (_) => BookAppointmentScreen(patient: {'id': id, 'name': p['name'], 'phone': p['phone'] ?? ''}, visitType: 'General')),
                                  ),
                                  icon: const Icon(Icons.event_available),
                                  label: const Text('Book'),
                                ),
                              ),
                            ]),
                          ]),
                        ),
                      ),
                    ),
                  ),
                  const SliverToBoxAdapter(child: TabBar(tabs: [Tab(text: 'Medical Records'), Tab(text: 'Visits')])),
                ],
                body: TabBarView(children: [_RecordsList(id), _VisitsList(id)]),
              ),
            ),
          );
        },
      );
}

class _RecordsList extends StatelessWidget {
  const _RecordsList(this.patientId);
  final String patientId;

  @override
  Widget build(BuildContext context) => StreamBuilder<QuerySnapshot<Json>>(
        stream: Db.records(patientId).orderBy('createdAt', descending: true).snapshots(),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final docs = snap.data!.docs;
          if (docs.isEmpty) return const EmptyState('No records yet — add the first one', icon: Icons.folder_open);
          return ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
            for (final d in docs) Padding(padding: const EdgeInsets.only(bottom: 8), child: RecordCard(d.data())),
          ]);
        },
      );
}

class RecordCard extends StatelessWidget {
  const RecordCard(this.r, {super.key});
  final Json r;

  @override
  Widget build(BuildContext context) {
    final at = (r['createdAt'] as Timestamp?)?.toDate();
    final vitals = (r['vitals'] as Map?) ?? {};
    final meds = (r['medications'] as List?) ?? [];
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        leading: Icon(recordIcon(r['type']), color: kPrimary),
        title: Text(r['title'] ?? r['type'] ?? 'Record', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('${r['type'] ?? ''} · ${at == null ? 'Saving…' : DateFormat('MMM d, y · h:mm a').format(at)}${r['doctor'] != null ? ' · ${r['doctor']}' : ''}',
            style: const TextStyle(fontSize: 12)),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
        children: [
          if ('${r['diagnosis'] ?? ''}'.isNotEmpty) Text('Diagnosis: ${r['diagnosis']}', style: const TextStyle(fontWeight: FontWeight.w600)),
          if (vitals.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final e in vitals.entries) Chip(label: Text('${'${e.key}'.toUpperCase()} ${e.value}', style: const TextStyle(fontSize: 12))),
            ]),
          ],
          if (meds.isNotEmpty) ...[
            const SizedBox(height: 6),
            for (final m in meds)
              Text('💊 ${[m['name'], m['dosage'], m['duration']].where((x) => x != null && '$x'.isNotEmpty).join(' · ')}'),
          ],
          if ('${r['notes'] ?? ''}'.isNotEmpty) ...[const SizedBox(height: 6), Text('${r['notes']}')],
          if (r['fileUrl'] != null)
            TextButton.icon(
              onPressed: () => launchUrl(Uri.parse(r['fileUrl']), mode: LaunchMode.externalApplication),
              icon: const Icon(Icons.attach_file),
              label: Text(r['fileName'] ?? 'Attachment'),
            ),
        ],
      ),
    );
  }
}

class _VisitsList extends StatelessWidget {
  const _VisitsList(this.patientId);
  final String patientId;

  @override
  Widget build(BuildContext context) => StreamBuilder<List<Appt>>(
        stream: Db.forPatient(patientId),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final list = (snap.data ?? []).reversed.toList();
          if (list.isEmpty) return const EmptyState('No visits yet', icon: Icons.event_busy);
          return ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
            for (final a in list)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Card(
                  child: ListTile(
                    leading: Icon(a.online ? Icons.videocam_outlined : Icons.local_hospital_outlined, color: kPrimary),
                    title: Text('${Db.shortLabel(a.date)} · ${a.time}'),
                    subtitle: Text('${a.visitType} · ${a.doctor}'),
                    trailing: StatusChip(a.status),
                    onTap: () => openAppointment(context, a.id),
                  ),
                ),
              ),
          ]);
        },
      );
}

/// Register or edit a patient. Field names match the web portal's Patients page.
class PatientFormScreen extends StatefulWidget {
  const PatientFormScreen({super.key, this.id, this.initial = const {}});
  final String? id;
  final Json initial;

  @override
  State<PatientFormScreen> createState() => _PatientFormScreenState();
}

class _PatientFormScreenState extends State<PatientFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _c = {
    for (final k in ['name', 'phone', 'email', 'dob', 'bloodGroup', 'allergies', 'conditions', 'emergencyContactName', 'emergencyContactPhone'])
      k: TextEditingController(text: '${widget.initial[k] ?? ''}'),
  };
  late String _gender = widget.initial['gender'] ?? 'Male';
  bool _saving = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final data = {for (final e in _c.entries) e.key: e.value.text.trim(), 'gender': _gender, 'status': widget.initial['status'] ?? 'Active'};
    final ok = await guard(context, () => widget.id == null ? Db.patients.add(data) : Db.patients.doc(widget.id).set(data, SetOptions(merge: true)),
        ok: widget.id == null ? 'Patient registered.' : 'Patient updated.');
    if (!mounted) return;
    setState(() => _saving = false);
    if (ok) Navigator.pop(context);
  }

  Widget _field(String key, String label, {TextInputType? type, bool required = false, String? hint}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          controller: _c[key],
          keyboardType: type,
          decoration: InputDecoration(labelText: label, hintText: hint),
          validator: required ? (v) => v!.trim().isEmpty ? 'Required' : null : null,
        ),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.id == null ? 'Register Patient' : 'Edit Patient')),
        body: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            _field('name', 'Full name', required: true),
            _field('phone', 'Phone', type: TextInputType.phone, required: true, hint: '+91 98765 43210'),
            _field('email', 'Email', type: TextInputType.emailAddress),
            Row(children: [
              Expanded(child: _field('dob', 'Date of birth', hint: 'YYYY-MM-DD')),
              const SizedBox(width: 10),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: DropdownButtonFormField<String>(
                    initialValue: _gender,
                    decoration: const InputDecoration(labelText: 'Gender'),
                    items: [for (final g in ['Male', 'Female', 'Other']) DropdownMenuItem(value: g, child: Text(g))],
                    onChanged: (g) => setState(() => _gender = g!),
                  ),
                ),
              ),
            ]),
            _field('bloodGroup', 'Blood group', hint: 'B+'),
            _field('allergies', 'Allergies', hint: 'Penicillin, peanuts'),
            _field('conditions', 'Chronic conditions', hint: 'Diabetes, hypertension'),
            const SectionHeader('Emergency contact'),
            _field('emergencyContactName', 'Name (relation)'),
            _field('emergencyContactPhone', 'Phone', type: TextInputType.phone),
            const SizedBox(height: 12),
            FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save Patient')),
          ]),
        ),
      );
}

class AddRecordScreen extends StatefulWidget {
  const AddRecordScreen({super.key, required this.patientId});
  final String patientId;

  @override
  State<AddRecordScreen> createState() => _AddRecordScreenState();
}

class _AddRecordScreenState extends State<AddRecordScreen> {
  String _type = 'Consultation';
  final _c = {for (final k in ['title', 'diagnosis', 'notes', 'meds', 'bp', 'pulse', 'temp', 'spo2', 'weight']) k: TextEditingController()};
  PlatformFile? _file;
  bool _saving = false;

  Future<void> _pick() async {
    final res = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png'], withData: true);
    final f = res?.files.single;
    if (f == null || !mounted) return;
    if (f.size > 20 * 1024 * 1024) return snack(context, 'Attachment must be under 20 MB.');
    setState(() => _file = f);
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final ok = await guard(context, () async {
      final me = (await Db.doctor().get()).data() ?? {};
      Json attachment = {};
      if (_file?.bytes != null) {
        final ext = (_file!.extension ?? '').toLowerCase();
        final ref = FirebaseStorage.instance.ref('records/${widget.patientId}/${DateTime.now().millisecondsSinceEpoch}_${_file!.name}');
        await ref.putData(_file!.bytes!, SettableMetadata(contentType: ext == 'pdf' ? 'application/pdf' : 'image/${ext == 'jpg' ? 'jpeg' : ext}'));
        attachment = {'fileUrl': await ref.getDownloadURL(), 'fileName': _file!.name};
      }
      final meds = _c['meds']!.text.split('\n').map((l) => l.trim()).where((l) => l.isNotEmpty).map((l) {
        final p = l.split('|').map((x) => x.trim()).toList();
        return {'name': p[0], 'dosage': p.length > 1 ? p[1] : '', 'duration': p.length > 2 ? p[2] : ''};
      }).toList();
      await Db.records(widget.patientId).add({
        'type': _type,
        'title': _c['title']!.text.trim().isEmpty ? _type : _c['title']!.text.trim(),
        'diagnosis': _c['diagnosis']!.text.trim(),
        'notes': _c['notes']!.text.trim(),
        'medications': meds,
        'vitals': {for (final k in ['bp', 'pulse', 'temp', 'spo2', 'weight']) if (_c[k]!.text.trim().isNotEmpty) k: _c[k]!.text.trim()},
        'doctor': me['name'] ?? '',
        'doctorId': uid,
        ...attachment,
        'createdAt': FieldValue.serverTimestamp(),
      });
    }, ok: 'Record saved.');
    if (!mounted) return;
    setState(() => _saving = false);
    if (ok) Navigator.pop(context);
  }

  Widget _box(String k, String label, {int lines = 1, String? hint}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(controller: _c[k], maxLines: lines, decoration: InputDecoration(labelText: label, hintText: hint, alignLabelWithHint: lines > 1)),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Add Medical Record')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final t in recordTypes)
              ChoiceChip(avatar: Icon(recordIcon(t), size: 16), label: Text(t), selected: _type == t, onSelected: (_) => setState(() => _type = t)),
          ]),
          const SizedBox(height: 16),
          _box('title', 'Title', hint: 'e.g. Fever review, CBC report'),
          _box('diagnosis', 'Diagnosis'),
          const SectionHeader('Vitals'),
          Row(children: [
            Expanded(child: _box('bp', 'BP', hint: '120/80')),
            const SizedBox(width: 8),
            Expanded(child: _box('pulse', 'Pulse', hint: '72')),
            const SizedBox(width: 8),
            Expanded(child: _box('temp', 'Temp °F', hint: '98.6')),
          ]),
          Row(children: [
            Expanded(child: _box('spo2', 'SpO₂ %', hint: '98')),
            const SizedBox(width: 8),
            Expanded(child: _box('weight', 'Weight kg', hint: '70')),
          ]),
          const SectionHeader('Prescription & notes'),
          _box('meds', 'Medicines (one per line: name | dosage | duration)', lines: 3, hint: 'Paracetamol 650 | 1-0-1 | 3 days'),
          _box('notes', 'Clinical notes', lines: 4),
          OutlinedButton.icon(
            onPressed: _pick,
            icon: const Icon(Icons.attach_file),
            label: Text(_file?.name ?? 'Attach lab report / scan (PDF, image)'),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save Record'),
          ),
        ]),
      );
}
