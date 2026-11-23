import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../db.dart';
import '../ui.dart';
import 'appointments.dart';
import 'pdb.dart';

typedef DoctorDoc = QueryDocumentSnapshot<Json>;

/// Doctor finder: search by name / speciality / hospital, filter to video consults.
class DoctorSearchScreen extends StatefulWidget {
  const DoctorSearchScreen({super.key, this.embedded = false, this.onlineOnly = false, this.specialty, this.hospital, this.title});
  final bool embedded, onlineOnly;
  final String? specialty, hospital, title;

  @override
  State<DoctorSearchScreen> createState() => _DoctorSearchScreenState();
}

class _DoctorSearchScreenState extends State<DoctorSearchScreen> {
  final _q = TextEditingController();
  late bool _online = widget.onlineOnly;
  late final _stream = PDb.allDoctors();

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: !widget.embedded,
          title: Text(widget.title ?? widget.hospital ?? widget.specialty ?? (widget.onlineOnly ? 'Video consultation' : 'Find doctors')),
        ),
        body: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: TextField(
              controller: _q,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(hintText: 'Doctor, speciality or hospital', prefixIcon: Icon(Icons.search)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(children: [
              FilterChip(
                label: const Text('Video consult'),
                avatar: const Icon(Icons.videocam_outlined, size: 18),
                selected: _online,
                onSelected: (v) => setState(() => _online = v),
              ),
            ]),
          ),
          Expanded(
            child: StreamBuilder<List<DoctorDoc>>(
              stream: _stream,
              builder: (context, snap) {
                if (snap.hasError) return Center(child: Text('${snap.error}'));
                if (!snap.hasData) return const Center(child: CircularProgressIndicator());
                final list = snap.data!
                    .where((d) => PDb.matches(d.data(), query: _q.text, specialty: widget.specialty, onlineOnly: _online))
                    .where((d) => widget.hospital == null || d.data()['hospital'] == widget.hospital)
                    .toList();
                if (list.isEmpty) return const EmptyState('No doctors match', icon: Icons.person_search);
                return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
                  Text('${list.length} doctor${list.length == 1 ? '' : 's'} available', style: const TextStyle(color: kMuted)),
                  const SizedBox(height: 8),
                  for (final d in list) DoctorCard(d),
                ]);
              },
            ),
          ),
        ]),
      );
}

String specialtyOf(Json d) => d['specialization']?.toString().isNotEmpty == true ? d['specialization'] : d['department'] ?? 'Doctor';

class DoctorCard extends StatelessWidget {
  const DoctorCard(this.d, {super.key});
  final DoctorDoc d;

  @override
  Widget build(BuildContext context) {
    final x = d.data();
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => DoctorProfileScreen(d.id, x))),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Avatar(x['name'] ?? '', size: 56, photoUrl: x['photoUrl']),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(x['name'] ?? '', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                Text(specialtyOf(x), style: const TextStyle(color: kPrimary)),
                Text('${x['experience'] ?? ''} · ${x['qualification'] ?? ''}', style: const TextStyle(color: kMuted, fontSize: 12)),
                if ((x['hospital'] ?? '').toString().isNotEmpty) Text(x['hospital'], style: const TextStyle(fontSize: 12)),
                const SizedBox(height: 6),
                Row(children: [
                  Text('₹${x['fee'] ?? 0}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  const Text(' consultation fee', style: TextStyle(color: kMuted, fontSize: 12)),
                  const Spacer(),
                  if (x['onlineConsultation'] != false) const Icon(Icons.videocam, color: kBlue, size: 18),
                ]),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class DoctorProfileScreen extends StatelessWidget {
  const DoctorProfileScreen(this.id, this.d, {super.key});
  final String id;
  final Json d;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Doctor profile')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                Avatar(d['name'] ?? '', size: 84, photoUrl: d['photoUrl']),
                const SizedBox(height: 10),
                Text(d['name'] ?? '', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                Text(specialtyOf(d), style: const TextStyle(color: kPrimary)),
                const SizedBox(height: 4),
                StreamBuilder<List<Json>>(
                  stream: PDb.reviews(id),
                  builder: (context, s) {
                    final r = s.data ?? [];
                    if (r.isEmpty) return const Text('No reviews yet', style: TextStyle(color: kMuted));
                    final avg = r.fold<num>(0, (a, x) => a + (x['rating'] as num)) / r.length;
                    return Text('★ ${avg.toStringAsFixed(1)} · ${r.length} verified review${r.length == 1 ? '' : 's'}',
                        style: const TextStyle(color: kOrange, fontWeight: FontWeight.w600));
                  },
                ),
              ]),
            ),
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Column(children: [
                InfoRow(Icons.workspace_premium_outlined, 'Experience', '${d['experience'] ?? '—'}'),
                InfoRow(Icons.school_outlined, 'Qualification', '${d['qualification'] ?? '—'}'),
                InfoRow(Icons.local_hospital_outlined, 'Hospital', '${d['hospital'] ?? '—'}'),
                InfoRow(Icons.translate, 'Languages', List<String>.from(d['languages'] ?? []).join(', ')),
                InfoRow(Icons.currency_rupee, 'Consultation fee', '₹${d['fee'] ?? 0}'),
              ]),
            ),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: () => _book(context, false),
                icon: const Icon(Icons.local_hospital_outlined),
                label: const Text('Book clinic visit'),
              ),
            ),
            if (d['onlineConsultation'] != false) ...[
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _book(context, true),
                  icon: const Icon(Icons.videocam_outlined),
                  label: const Text('Video consult'),
                ),
              ),
            ],
          ]),
          const SectionHeader('Patient reviews'),
          StreamBuilder<List<Json>>(
            stream: PDb.reviews(id),
            builder: (context, s) => Column(children: [
              for (final r in s.data ?? const <Json>[])
                Card(
                  child: ListTile(
                    title: Text('${'★' * (r['rating'] as num).toInt()}  ${r['name'] ?? 'Patient'}', style: const TextStyle(color: kOrange)),
                    subtitle: Text(r['text'] ?? ''),
                  ),
                ),
            ]),
          ),
        ]),
      );

  void _book(BuildContext context, bool online) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => PatientBookingScreen(doctorId: id, doctor: d, online: online)));
}

/// Pick who (self / family), the day and a free slot, then confirm.
class PatientBookingScreen extends StatefulWidget {
  const PatientBookingScreen({super.key, required this.doctorId, required this.doctor, required this.online});
  final String doctorId;
  final Json doctor;
  final bool online;

  @override
  State<PatientBookingScreen> createState() => _PatientBookingScreenState();
}

class _PatientBookingScreenState extends State<PatientBookingScreen> {
  DateTime _date = today();
  String? _slot, _patientId;
  final _reason = TextEditingController();
  late Future<List<String>> _slots = _load();
  bool _busy = false;

  Future<List<String>> _load() => PDb.freeSlots(widget.doctorId, ymd(_date));

  void _pickDate(DateTime d) => setState(() {
        _date = d;
        _slot = null;
        _slots = _load();
      });

  Future<void> _confirm(List<QueryDocumentSnapshot<Json>> family) async {
    final p = family.firstWhere((m) => m.id == _patientId);
    setState(() => _busy = true);
    try {
      final a = await PDb.book(
        doctorId: widget.doctorId,
        doctor: widget.doctor,
        patientId: p.id,
        patient: p.data(),
        date: ymd(_date),
        time: _slot!,
        online: widget.online,
        reason: _reason.text.trim(),
      );
      if (!mounted) return;
      Navigator.of(context).popUntil((r) => r.isFirst);
      Navigator.push(context, MaterialPageRoute(builder: (_) => PatientAppointmentScreen(a.id)));
      snack(context, 'Booked · Token #${a.token}');
    } catch (e) {
      if (mounted) snack(context, '$e'.replaceFirst('Exception: ', ''));
      setState(() => _slots = _load());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.online ? 'Book video consultation' : 'Book clinic visit')),
        body: StreamBuilder<List<QueryDocumentSnapshot<Json>>>(
          stream: PDb.family(),
          builder: (context, fam) {
            final family = fam.data ?? [];
            if (family.isNotEmpty && !family.any((m) => m.id == _patientId)) _patientId = family.first.id;
            return ListView(padding: const EdgeInsets.all(16), children: [
              Card(
                child: ListTile(
                  leading: Avatar(widget.doctor['name'] ?? ''),
                  title: Text(widget.doctor['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${specialtyOf(widget.doctor)} · ₹${widget.doctor['fee'] ?? 0}'),
                ),
              ),
              const SectionHeader('Patient'),
              Wrap(spacing: 8, children: [
                for (final m in family)
                  ChoiceChip(
                    label: Text('${m.data()['name']} (${m.data()['relation'] ?? 'Family'})'),
                    selected: _patientId == m.id,
                    onSelected: (_) => setState(() => _patientId = m.id),
                  ),
              ]),
              const SectionHeader('Date'),
              SizedBox(
                height: 72,
                child: ListView(scrollDirection: Axis.horizontal, children: [
                  for (var i = 0; i < 14; i++)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(DateFormat('EEE\nMMM d').format(today().add(Duration(days: i))), textAlign: TextAlign.center),
                        selected: ymd(_date) == ymd(today().add(Duration(days: i))),
                        onSelected: (_) => _pickDate(today().add(Duration(days: i))),
                      ),
                    ),
                ]),
              ),
              const SectionHeader('Available slots'),
              FutureBuilder<List<String>>(
                future: _slots,
                builder: (context, s) {
                  if (s.hasError) return Text('${s.error}');
                  if (!s.hasData) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
                  if (s.data!.isEmpty) return const EmptyState('No free slots on this day', icon: Icons.event_busy);
                  return Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final t in s.data!) ChoiceChip(label: Text(t), selected: _slot == t, onSelected: (_) => setState(() => _slot = t)),
                  ]);
                },
              ),
              const SizedBox(height: 16),
              TextField(controller: _reason, decoration: const InputDecoration(labelText: 'Reason for visit (optional)')),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy || _slot == null || _patientId == null ? null : () => _confirm(family),
                child: Text(_slot == null ? 'Select a slot' : 'Confirm · ${prettyDate(_date)}, $_slot'),
              ),
              const SizedBox(height: 8),
              const Text('Pay at the clinic or before the video call.', textAlign: TextAlign.center, style: TextStyle(color: kMuted, fontSize: 12)),
            ]);
          },
        ),
      );
}

/// Hospitals and clinics, derived from where doctors practise.
class HospitalsScreen extends StatelessWidget {
  const HospitalsScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Hospitals & clinics')),
        body: StreamBuilder<List<DoctorDoc>>(
          stream: PDb.allDoctors(),
          builder: (context, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final byHospital = <String, List<Json>>{};
            for (final d in snap.data!) {
              final h = '${d.data()['hospital'] ?? ''}'.trim();
              if (h.isNotEmpty) byHospital.putIfAbsent(h, () => []).add(d.data());
            }
            if (byHospital.isEmpty) return const EmptyState('No hospitals listed yet', icon: Icons.apartment);
            return ListView(padding: const EdgeInsets.all(16), children: [
              for (final e in byHospital.entries)
                Card(
                  child: ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.apartment)),
                    title: Text(e.key, style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${e.value.length} doctor${e.value.length == 1 ? '' : 's'} · '
                        '${e.value.map(specialtyOf).toSet().take(3).join(', ')}'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => DoctorSearchScreen(hospital: e.key))),
                  ),
                ),
            ]);
          },
        ),
      );
}
