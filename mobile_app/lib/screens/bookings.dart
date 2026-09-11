import 'package:flutter/material.dart';

import '../db.dart';
import '../ui.dart';
import 'home.dart';
import 'online.dart';
import 'summary.dart';

void openAppointment(BuildContext context, String id) =>
    Navigator.push(context, MaterialPageRoute(builder: (_) => AppointmentDetailsScreen(id)));

class BookingsTab extends StatefulWidget {
  const BookingsTab({super.key});

  @override
  State<BookingsTab> createState() => _BookingsTabState();
}

class _BookingsTabState extends State<BookingsTab> {
  bool _online = false;
  String _q = '', _filter = 'All';
  DateTime _date = today();

  bool _keep(Appt a) {
    if (a.online != _online) return false;
    if (_q.isNotEmpty && !'${a.patient} ${a.phone} ${a.token}'.toLowerCase().contains(_q.toLowerCase())) return false;
    return switch (_filter) { 'Upcoming' => a.isOpen, 'Completed' => a.status == 'Completed', _ => true };
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Bookings'), actions: [
          IconButton(
            tooltip: 'Book appointment',
            icon: const Icon(Icons.add_circle_outline),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => BookAppointmentScreen(online: _online, date: _date))),
          ),
          ...homeActions(context),
        ]),
        body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, icon: Icon(Icons.local_hospital_outlined), label: Text('In-Person')),
              ButtonSegment(value: true, icon: Icon(Icons.videocam_outlined), label: Text('Online')),
            ],
            selected: {_online},
            onSelectionChanged: (s) => setState(() => _online = s.first),
          ),
          const SizedBox(height: 12),
          TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search patients'),
            onChanged: (v) => setState(() => _q = v),
          ),
          const SizedBox(height: 10),
          Row(children: [
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
              icon: const Icon(Icons.calendar_month, size: 18),
              label: Text(prettyDate(_date)),
              onPressed: () async {
                final d = await showDatePicker(
                  context: context,
                  initialDate: _date,
                  firstDate: DateTime(2024),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                );
                if (d != null) setState(() => _date = d);
              },
            ),
            const Spacer(),
            for (final f in ['All', 'Upcoming', 'Completed'])
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: ChoiceChip(label: Text(f), selected: _filter == f, onSelected: (_) => setState(() => _filter = f)),
              ),
          ]),
          StreamBuilder<List<Appt>>(
            stream: Db.myDay(ymd(_date)),
            builder: (context, snap) {
              if (snap.hasError) return Text('${snap.error}');
              if (!snap.hasData) return const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
              final list = snap.data!.where(_keep).toList();
              return Column(children: [
                SectionHeader(_date == today() ? "Today's Appointments" : 'Appointments',
                    trailing: Text('${list.length} total', style: const TextStyle(color: kMuted, fontSize: 12))),
                if (list.isEmpty) const EmptyState('No appointments found', icon: Icons.event_busy),
                for (final a in list)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: ApptTile(a, onTap: () => openAppointment(context, a.id)),
                  ),
              ]);
            },
          ),
        ]),
      );
}

class AppointmentDetailsScreen extends StatelessWidget {
  const AppointmentDetailsScreen(this.id, {super.key});
  final String id;

  Future<void> _reschedule(BuildContext context, Appt a) async {
    final d = await showDatePicker(context: context, initialDate: today(), firstDate: today(), lastDate: today().add(const Duration(days: 60)));
    if (d == null || !context.mounted) return;
    final slot = await pickSlot(context, d);
    if (slot == null || !context.mounted) return;
    await guard(context, () => Db.reschedule(a, ymd(d), slot), ok: 'Rescheduled to ${prettyDate(d)}, $slot.');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Appointment Details')),
        body: StreamBuilder<Appt>(
          stream: Db.watch(id),
          builder: (context, snap) {
            if (snap.hasError) return Center(child: Text('${snap.error}'));
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final a = snap.data!;
            final canStart = a.status == 'Waiting' || DateTime.now().isAfter(a.start.subtract(const Duration(minutes: 15)));
            return ListView(padding: const EdgeInsets.all(16), children: [
              Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.all(14),
                  leading: Avatar(a.patient, size: 52),
                  title: Text(a.patient, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(children: [Text('Token #${a.token}   '), StatusChip(a.status)]),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  child: Column(children: [
                    InfoRow(Icons.calendar_today_outlined, 'Date', prettyDate(a.start)),
                    InfoRow(Icons.schedule, 'Time', a.time),
                    InfoRow(Icons.medical_information_outlined, 'Visit type', a.visitType),
                    InfoRow(a.online ? Icons.videocam_outlined : Icons.local_hospital_outlined, 'Mode', a.online ? 'Video consultation' : 'In-person'),
                    InfoRow(Icons.phone_outlined, 'Phone', a.phone.isEmpty ? '—' : a.phone),
                    InfoRow(Icons.flag_outlined, 'Status', statusLabel(a.status)),
                  ]),
                ),
              ),
              const SizedBox(height: 16),
              if (a.status == 'Completed')
                FilledButton.icon(
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SummaryScreen(a))),
                  icon: const Icon(Icons.description_outlined),
                  label: const Text('View Summary'),
                ),
              if (a.status == 'In Consultation') ...[
                FilledButton.icon(
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CompleteConsultationScreen(a))),
                  icon: const Icon(Icons.check_circle_outline),
                  label: const Text('Mark as Complete'),
                ),
                if (a.online) ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(onPressed: () => startVideoConsultation(context, a), icon: const Icon(Icons.videocam), label: const Text('Rejoin Video Call')),
                ],
              ],
              if (a.isOpen && a.status != 'In Consultation') ...[
                FilledButton.icon(
                  onPressed: !canStart
                      ? null
                      : a.online
                          ? () => startVideoConsultation(context, a)
                          : () => guard(context, () => Db.setStatus(a.id, 'In Consultation'), ok: 'Marked as In Consultation.'),
                  icon: Icon(a.online ? Icons.videocam : Icons.play_circle_outline),
                  label: Text(a.online ? 'Start Video Consultation' : 'Start Consultation'),
                ),
                if (!canStart)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text('Can be started at ${a.time}.', textAlign: TextAlign.center, style: const TextStyle(color: kMuted, fontSize: 12)),
                  ),
                if (!a.online && a.status != 'Waiting') ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: () => guard(context, () => Db.setStatus(a.id, 'Waiting'), ok: 'Patient checked in.'),
                    icon: const Icon(Icons.how_to_reg_outlined),
                    label: const Text('Patient Arrived (Check in)'),
                  ),
                ],
                if (a.online) ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(onPressed: () => shareCallLink(context, a), icon: const Icon(Icons.share_outlined), label: const Text('Send Video Link to Patient')),
                ],
              ],
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: OutlinedButton.icon(onPressed: () => callPatient(context, a.phone), icon: const Icon(Icons.call_outlined), label: const Text('Call'))),
                if (a.isOpen) ...[
                  const SizedBox(width: 10),
                  Expanded(child: OutlinedButton.icon(onPressed: () => _reschedule(context, a), icon: const Icon(Icons.refresh), label: const Text('Reschedule'))),
                ],
              ]),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => BookAppointmentScreen(patient: {'id': a.patientId, 'name': a.patient, 'phone': a.phone}, visitType: 'Follow-up', online: a.online)),
                ),
                icon: const Icon(Icons.event_repeat),
                label: const Text('Book Follow-up'),
              ),
              if (a.isOpen) ...[
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: kRed, side: const BorderSide(color: kRed)),
                  onPressed: () async {
                    if (await confirm(context, 'Cancel appointment?', 'Token #${a.token} for ${a.patient} will be cancelled.', ok: 'Cancel appointment', danger: true) &&
                        context.mounted) {
                      await guard(context, () => Db.setStatus(a.id, 'Cancelled'), ok: 'Appointment cancelled.');
                    }
                  },
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('Cancel Appointment'),
                ),
              ],
            ]);
          },
        ),
      );
}

/// Books a new visit. Pass [patient] ({id, name, phone}) for follow-ups; otherwise pick or register one.
class BookAppointmentScreen extends StatefulWidget {
  const BookAppointmentScreen({super.key, this.patient, this.visitType = 'New visit', this.online = false, this.date});
  final Json? patient;
  final String visitType;
  final bool online;
  final DateTime? date;

  @override
  State<BookAppointmentScreen> createState() => _BookAppointmentScreenState();
}

class _BookAppointmentScreenState extends State<BookAppointmentScreen> {
  late Json? _patient = widget.patient;
  late bool _online = widget.online;
  late String _visitType = widget.visitType;
  late DateTime _date = widget.date != null && !widget.date!.isBefore(today()) ? widget.date! : today();
  String? _slot;
  bool _newPatient = false, _saving = false;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _age = TextEditingController();
  String _gender = 'Male';
  late Future<List<String>> _slots = Db.freeSlots(ymd(_date));
  // ponytail: loads every patient once for local search; switch to a prefix query when the list gets large.
  late final Future<List<Json>> _patients =
      Db.patients.get().then((s) => s.docs.map((d) => {...d.data(), 'id': d.id}).toList());

  void _setDate(DateTime d) => setState(() {
        _date = d;
        _slot = null;
        _slots = Db.freeSlots(ymd(d));
      });

  Future<void> _book() async {
    final name = _newPatient ? _name.text.trim() : (_patient?['name'] as String? ?? '');
    final phone = _newPatient ? _phone.text.trim() : (_patient?['phone'] as String? ?? '');
    if (name.isEmpty) return snack(context, 'Select or add a patient.');
    if (_newPatient && phone.length < 10) return snack(context, 'Enter the patient\'s phone number.');
    if (_slot == null) return snack(context, 'Choose a time slot.');
    setState(() => _saving = true);
    Appt? booked;
    final ok = await guard(context, () async {
      booked = await Db.book(
        patientId: _newPatient ? null : _patient?['id'] as String?,
        patientName: name,
        phone: phone,
        extraPatient: _newPatient ? {'gender': _gender, 'age': int.tryParse(_age.text)} : const {},
        date: ymd(_date),
        time: _slot!,
        online: _online,
        visitType: _visitType,
      );
    });
    if (!mounted) return;
    setState(() => _saving = false);
    if (!ok) return;
    snack(context, 'Booked · Token #${booked!.token}. ${_online ? 'Share the video link with the patient.' : ''}');
    if (_online) await shareCallLink(context, booked!);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(_visitType == 'Follow-up' ? 'Book Follow-up' : 'Book Appointment')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          if (widget.patient != null)
            Card(child: ListTile(leading: Avatar(widget.patient!['name'] ?? ''), title: Text(widget.patient!['name'] ?? ''), subtitle: Text('$_visitType visit')))
          else ...[
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Existing patient')),
                ButtonSegment(value: true, label: Text('New patient')),
              ],
              selected: {_newPatient},
              onSelectionChanged: (s) => setState(() => _newPatient = s.first),
            ),
            const SizedBox(height: 12),
            if (_newPatient) ...[
              TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Patient name')),
              const SizedBox(height: 10),
              TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (+91 …)')),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: _age, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Age'))),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _gender,
                    decoration: const InputDecoration(labelText: 'Gender'),
                    items: [for (final g in ['Male', 'Female', 'Other']) DropdownMenuItem(value: g, child: Text(g))],
                    onChanged: (g) => setState(() => _gender = g!),
                  ),
                ),
              ]),
            ] else
              FutureBuilder<List<Json>>(
                future: _patients,
                builder: (context, snap) => Autocomplete<Json>(
                  displayStringForOption: (p) => '${p['name']} · ${p['phone'] ?? ''}',
                  optionsBuilder: (v) => (snap.data ?? []).where((p) => '${p['name']} ${p['phone']}'.toLowerCase().contains(v.text.toLowerCase())).take(20),
                  onSelected: (p) => setState(() => _patient = p),
                  fieldViewBuilder: (context, c, focus, _) => TextField(
                    controller: c,
                    focusNode: focus,
                    decoration: InputDecoration(prefixIcon: const Icon(Icons.search), labelText: snap.hasData ? 'Search patient by name or phone' : 'Loading patients…'),
                  ),
                ),
              ),
          ],
          const SectionHeader('Consultation'),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, icon: Icon(Icons.local_hospital_outlined), label: Text('In-person')),
              ButtonSegment(value: true, icon: Icon(Icons.videocam_outlined), label: Text('Video')),
            ],
            selected: {_online},
            onSelectionChanged: (s) => setState(() => _online = s.first),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _visitType,
            decoration: const InputDecoration(labelText: 'Visit type'),
            items: [for (final v in ['New visit', 'General', 'Follow-up', 'Consultation']) DropdownMenuItem(value: v, child: Text(v))],
            onChanged: (v) => setState(() => _visitType = v!),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month),
            label: Text(prettyDate(_date)),
            onPressed: () async {
              final d = await showDatePicker(context: context, initialDate: _date, firstDate: today(), lastDate: today().add(const Duration(days: 60)));
              if (d != null) _setDate(d);
            },
          ),
          SectionHeader('Slots on ${Db.shortLabel(ymd(_date))}'),
          FutureBuilder<List<String>>(
            future: _slots,
            builder: (context, snap) {
              if (snap.hasError) return Text('${snap.error}');
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              if (snap.data!.isEmpty) return const EmptyState('No free slots — pick another day', icon: Icons.event_busy);
              return Wrap(spacing: 8, runSpacing: 8, children: [
                for (final s in snap.data!) ChoiceChip(label: Text(s), selected: _slot == s, onSelected: (_) => setState(() => _slot = s)),
              ]);
            },
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _book,
            child: _saving ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Book Appointment'),
          ),
        ]),
      );
}

/// Diagnosis, notes and prescription for a consultation; saves to the appointment and the patient's records.
class CompleteConsultationScreen extends StatefulWidget {
  const CompleteConsultationScreen(this.appt, {super.key, this.notes = ''});
  final Appt appt;
  final String notes;

  @override
  State<CompleteConsultationScreen> createState() => _CompleteConsultationScreenState();
}

class _CompleteConsultationScreenState extends State<CompleteConsultationScreen> {
  final _diagnosis = TextEditingController();
  late final _notes = TextEditingController(text: widget.notes);
  final _meds = <List<TextEditingController>>[];
  bool _saving = false;

  void _addMed() => setState(() => _meds.add([TextEditingController(), TextEditingController(), TextEditingController()]));

  Future<void> _save() async {
    setState(() => _saving = true);
    final meds = [
      for (final m in _meds)
        if (m[0].text.trim().isNotEmpty) {'name': m[0].text.trim(), 'dosage': m[1].text.trim(), 'duration': m[2].text.trim()}
    ];
    final ok = await guard(
      context,
      () => Db.complete(widget.appt, diagnosis: _diagnosis.text.trim(), notes: _notes.text.trim(), medications: meds),
      ok: 'Marked as Completed.',
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (ok) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text('Complete · ${widget.appt.patient}')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          TextField(controller: _diagnosis, decoration: const InputDecoration(labelText: 'Diagnosis')),
          const SizedBox(height: 12),
          TextField(controller: _notes, maxLines: 4, decoration: const InputDecoration(labelText: 'Consultation notes / advice', alignLabelWithHint: true)),
          SectionHeader('Prescribed Medications', trailing: TextButton.icon(onPressed: _addMed, icon: const Icon(Icons.add), label: const Text('Add'))),
          if (_meds.isEmpty) const Text('No medicines added.', style: TextStyle(color: kMuted)),
          for (final (i, m) in _meds.indexed)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(children: [
                  Row(children: [
                    Expanded(child: TextField(controller: m[0], decoration: const InputDecoration(labelText: 'Medicine (e.g. Atorvastatin 20mg)'))),
                    IconButton(tooltip: 'Remove', onPressed: () => setState(() => _meds.removeAt(i)), icon: const Icon(Icons.delete_outline)),
                  ]),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(child: TextField(controller: m[1], decoration: const InputDecoration(labelText: 'Dosage (1-0-1)'))),
                    const SizedBox(width: 8),
                    Expanded(child: TextField(controller: m[2], decoration: const InputDecoration(labelText: 'Duration (5 days)'))),
                  ]),
                ]),
              ),
            ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save & Finish'),
          ),
        ]),
      );
}
