import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../chat.dart';
import '../db.dart';
import '../ui.dart';
import '../video_call.dart';
import 'pdb.dart';
import 'reminders.dart';

class MyAppointmentsTab extends StatelessWidget {
  const MyAppointmentsTab({super.key});

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('My appointments'),
            bottom: const TabBar(tabs: [Tab(text: 'Upcoming'), Tab(text: 'Past')]),
          ),
          body: StreamBuilder<List<Appt>>(
            stream: PDb.myAppointments(),
            builder: (context, snap) {
              if (snap.hasError) return Center(child: Text('${snap.error}'));
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              final upcoming = snap.data!.where((a) => a.isOpen).toList()..sort((a, b) => a.start.compareTo(b.start));
              final past = snap.data!.where((a) => !a.isOpen).toList();
              Widget list(List<Appt> l, String empty) => l.isEmpty
                  ? EmptyState(empty, icon: Icons.event_available)
                  : ListView(padding: const EdgeInsets.all(16), children: [for (final a in l) PatientApptTile(a)]);
              return TabBarView(children: [list(upcoming, 'No upcoming appointments'), list(past, 'No past appointments')]);
            },
          ),
        ),
      );
}

class PatientApptTile extends StatelessWidget {
  const PatientApptTile(this.a, {super.key});
  final Appt a;

  @override
  Widget build(BuildContext context) => Card(
        child: ListTile(
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PatientAppointmentScreen(a.id))),
          leading: CircleAvatar(child: Icon(a.online ? Icons.videocam_outlined : Icons.local_hospital_outlined)),
          title: Row(children: [
            Flexible(child: Text(a.doctor, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600))),
            const SizedBox(width: 8),
            StatusChip(a.status),
          ]),
          subtitle: Text('${shortDate(a.date)} · ${a.time} · ${a.patient} · #${a.token}', style: const TextStyle(fontSize: 12)),
          trailing: const Icon(Icons.chevron_right),
        ),
      );
}

class PatientAppointmentScreen extends StatelessWidget {
  const PatientAppointmentScreen(this.id, {super.key});
  final String id;

  Future<void> _join(BuildContext context, Appt a) async {
    await guard(context, () => openVideoRoom(context, roomId: a.id, userId: uid, userName: a.patient, callKey: a.data['callKey'] as String?));
  }

  Future<void> _rate(BuildContext context, Appt a) async {
    var rating = 5;
    final text = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text('Rate ${a.doctor}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 1; i <= 5; i++)
                IconButton(
                  tooltip: '$i star${i == 1 ? '' : 's'}',
                  onPressed: () => set(() => rating = i),
                  icon: Icon(i <= rating ? Icons.star : Icons.star_border, color: kOrange),
                ),
            ]),
            TextField(controller: text, maxLines: 3, decoration: const InputDecoration(labelText: 'Your experience (optional)')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Submit')),
          ],
        ),
      ),
    );
    if (ok == true && context.mounted) {
      await guard(context, () => PDb.review(a, rating, text.text.trim(), a.patient), ok: 'Thanks for your review!');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Appointment')),
        body: StreamBuilder<DocumentSnapshot<Json>>(
          stream: PDb.appointments.doc(id).snapshots(),
          builder: (context, snap) {
            if (snap.hasError) return Center(child: Text('${snap.error}'));
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final a = Appt.of(snap.data!);
            final s = a.summary;
            final meds = List<Map>.from(s['medications'] ?? []);
            return ListView(padding: const EdgeInsets.all(16), children: [
              Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.all(14),
                  leading: Avatar(a.doctor, size: 52),
                  title: Text(a.doctor, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(children: [Text('Token #${a.token}   '), StatusChip(a.status)]),
                  ),
                ),
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  child: Column(children: [
                    InfoRow(Icons.person_outline, 'Patient', a.patient),
                    InfoRow(Icons.event, 'When', '${prettyDate(a.start)}, ${a.time}'),
                    InfoRow(a.online ? Icons.videocam_outlined : Icons.local_hospital_outlined, 'Type', a.online ? 'Video consultation' : 'Clinic visit'),
                    if ('${a.data['hospital'] ?? ''}'.isNotEmpty) InfoRow(Icons.apartment, 'Hospital', a.data['hospital']),
                    InfoRow(Icons.currency_rupee, 'Fee', '₹${a.data['fee'] ?? 0}'),
                  ]),
                ),
              ),
              const SizedBox(height: 8),
              if (a.online && a.isOpen)
                FilledButton.icon(onPressed: () => _join(context, a), icon: const Icon(Icons.videocam), label: const Text('Join video consultation')),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () => Navigator.push(context, MaterialPageRoute(
                    builder: (_) => ChatScreen(appointmentId: a.id, title: 'Chat · ${a.doctor}', myName: a.patient))),
                icon: const Icon(Icons.chat_bubble_outline),
                label: Text(a.isOpen ? 'Chat with clinic' : 'Free follow-up chat'),
              ),
              if (a.status == 'Completed') ...[
                const SectionHeader('Prescription & summary'),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('Diagnosis: ${s['diagnosis'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      if ('${s['notes'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(s['notes'])),
                      for (final m in meds)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text('💊 ${m['name']}  ${m['dosage'] ?? ''}  ${m['frequency'] ?? ''}  ${m['duration'] ?? ''}'),
                        ),
                    ]),
                  ),
                ),
                if (meds.isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () async {
                      var n = 0;
                      await guard(context, () async => n = await addRemindersFromPrescription(meds, a.patient));
                      if (context.mounted && n > 0) snack(context, '$n medicine reminder${n == 1 ? '' : 's'} added');
                    },
                    icon: const Icon(Icons.alarm_add),
                    label: const Text('Add medicine reminders'),
                  ),
                const SizedBox(height: 8),
                StreamBuilder<DocumentSnapshot<Json>>(
                  stream: PDb.doctors.doc(a.data['doctorId'] as String).collection('reviews').doc(a.id).snapshots(),
                  builder: (context, r) => r.data?.exists == true
                      ? const Text('You reviewed this visit. Thank you!', textAlign: TextAlign.center, style: TextStyle(color: kMuted))
                      : OutlinedButton.icon(onPressed: () => _rate(context, a), icon: const Icon(Icons.star_border), label: const Text('Rate your doctor')),
                ),
              ],
              if (a.isOpen) ...[
                const SizedBox(height: 8),
                TextButton(
                  style: TextButton.styleFrom(foregroundColor: kRed),
                  onPressed: () async {
                    if (await confirm(context, 'Cancel appointment?', 'Your ${a.time} booking with ${a.doctor} will be cancelled.', ok: 'Cancel appointment', danger: true) &&
                        context.mounted) {
                      await guard(context, () => PDb.cancel(a.id), ok: 'Appointment cancelled');
                    }
                  },
                  child: const Text('Cancel appointment'),
                ),
              ],
            ]);
          },
        ),
      );
}
