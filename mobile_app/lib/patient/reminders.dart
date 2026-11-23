import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../db.dart';
import '../ui.dart';

/// Medicine reminders: reminders/{id} {ownerUid, patientName, medicine, dose, times: ["08:00", …],
/// startDate, days, active}. Daily local notifications on Android/iOS; the list works everywhere.
final _fs = FirebaseFirestore.instance;
final _notifications = FlutterLocalNotificationsPlugin();
bool _ready = false;

CollectionReference<Json> get reminders => _fs.collection('reminders');

/// Dosage like "1-0-1" (morning-afternoon-night) → times; anything else → once in the morning.
List<String> timesFromDosage(String dosage) {
  final m = RegExp(r'^\s*([01½])\s*-\s*([01½])\s*-\s*([01½])').firstMatch(dosage);
  if (m == null) return ['08:00'];
  return [for (final (i, t) in ['08:00', '14:00', '20:00'].indexed) if (m.group(i + 1) != '0') t];
}

/// "5 days", "2 weeks", "1 month" → days (default 5).
int daysFromDuration(String duration) {
  final m = RegExp(r'(\d+)\s*(day|week|month)', caseSensitive: false).firstMatch(duration);
  if (m == null) return 5;
  final n = int.parse(m.group(1)!);
  return switch (m.group(2)!.toLowerCase()) { 'week' => n * 7, 'month' => n * 30, _ => n };
}

/// Stable notification id per reminder + time.
int notificationId(String reminderId, String time) => Object.hash(reminderId, time) & 0x7fffffff;

Future<void> _init() async {
  if (_ready || kIsWeb) return;
  tzdata.initializeTimeZones();
  // ponytail: India-first app, so reminders run on IST; read the device zone (flutter_timezone) if
  // patients abroad need it.
  tz.setLocalLocation(tz.getLocation('Asia/Kolkata'));
  await _notifications.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(),
    ),
  );
  await _notifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
  _ready = true;
}

/// Re-creates the device's daily notifications from the signed-in patient's active reminders.
Future<void> rescheduleReminders() async {
  if (kIsWeb) return;
  await _init();
  await _notifications.cancelAll();
  final snap = await reminders.where('ownerUid', isEqualTo: uid).where('active', isEqualTo: true).get();
  final today = DateTime.now();
  for (final d in snap.docs) {
    final r = d.data();
    final start = DateTime.parse(r['startDate'] as String);
    if (today.isAfter(start.add(Duration(days: (r['days'] as num).toInt())))) continue; // course finished
    for (final t in List<String>.from(r['times'] ?? [])) {
      final [h, m] = t.split(':').map(int.parse).toList();
      final now = tz.TZDateTime.now(tz.local);
      var at = tz.TZDateTime(tz.local, now.year, now.month, now.day, h, m);
      if (!at.isAfter(now)) at = at.add(const Duration(days: 1));
      await _notifications.zonedSchedule(
        id: notificationId(d.id, t),
        title: 'Time for ${r['medicine']}',
        body: '${r['dose'] ?? ''} · ${r['patientName'] ?? ''}'.trim(),
        scheduledDate: at,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails('reminders', 'Medicine reminders', channelDescription: 'Daily medicine reminders', importance: Importance.high, priority: Priority.high),
          iOS: DarwinNotificationDetails(),
        ),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle, // no exact-alarm permission needed
        matchDateTimeComponents: DateTimeComponents.time, // repeat daily
      );
    }
  }
}

Future<void> addReminder({required String medicine, required String dose, required List<String> times, required int days, required String patientName}) async {
  await reminders.add({
    'ownerUid': uid, 'patientName': patientName, 'medicine': medicine, 'dose': dose, 'times': times,
    'startDate': ymd(DateTime.now()), 'days': days, 'active': true, 'createdAt': FieldValue.serverTimestamp(),
  });
  await rescheduleReminders();
}

/// One reminder per prescribed medicine of a completed visit.
Future<int> addRemindersFromPrescription(List<Map> meds, String patientName) async {
  var n = 0;
  for (final m in meds) {
    final name = '${m['name'] ?? ''}'.trim();
    if (name.isEmpty) continue;
    await reminders.add({
      'ownerUid': uid, 'patientName': patientName, 'medicine': name, 'dose': '${m['dosage'] ?? ''}',
      'times': timesFromDosage('${m['dosage'] ?? ''}'), 'startDate': ymd(DateTime.now()),
      'days': daysFromDuration('${m['duration'] ?? ''}'), 'active': true, 'createdAt': FieldValue.serverTimestamp(),
    });
    n++;
  }
  await rescheduleReminders();
  return n;
}

class RemindersScreen extends StatelessWidget {
  const RemindersScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Medicine reminders')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const _ReminderForm())),
          icon: const Icon(Icons.alarm_add),
          label: const Text('Add reminder'),
        ),
        body: StreamBuilder<QuerySnapshot<Json>>(
          stream: reminders.where('ownerUid', isEqualTo: uid).snapshots(),
          builder: (context, snap) {
            if (snap.hasError) return Center(child: Text('${snap.error}'));
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final docs = snap.data!.docs.toList()..sort((a, b) => '${a.data()['medicine']}'.compareTo('${b.data()['medicine']}'));
            if (docs.isEmpty) {
              return const EmptyState('No reminders yet. Add one, or add them from a prescription after your visit.', icon: Icons.alarm);
            }
            return ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
              if (kIsWeb) const Padding(padding: EdgeInsets.only(bottom: 8), child: Text('Notifications ring on the Android and iPhone app.', style: TextStyle(color: kMuted))),
              for (final d in docs)
                Card(
                  child: SwitchListTile(
                    value: d.data()['active'] == true,
                    onChanged: (v) => guard(context, () async {
                      await d.reference.update({'active': v});
                      await rescheduleReminders();
                    }),
                    secondary: const Icon(Icons.medication_outlined, color: kPrimary),
                    title: Text('${d.data()['medicine']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${List<String>.from(d.data()['times'] ?? []).join(', ')} · ${d.data()['dose'] ?? ''} · '
                        '${d.data()['days']} days from ${d.data()['startDate']} · ${d.data()['patientName'] ?? ''}'),
                  ),
                ),
            ]);
          },
        ),
      );
}

class _ReminderForm extends StatefulWidget {
  const _ReminderForm();

  @override
  State<_ReminderForm> createState() => _ReminderFormState();
}

class _ReminderFormState extends State<_ReminderForm> {
  final _medicine = TextEditingController(), _dose = TextEditingController(), _patient = TextEditingController();
  final _times = <String>{'08:00', '20:00'};
  int _days = 5;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('New reminder')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          TextField(controller: _medicine, decoration: const InputDecoration(labelText: 'Medicine')),
          const SizedBox(height: 12),
          TextField(controller: _dose, decoration: const InputDecoration(labelText: 'Dose (e.g. 1 tablet after food)')),
          const SizedBox(height: 12),
          TextField(controller: _patient, decoration: const InputDecoration(labelText: 'For (name)')),
          const SectionHeader('Times'),
          Wrap(spacing: 8, children: [
            for (final t in ['06:00', '08:00', '13:00', '14:00', '18:00', '20:00', '22:00'])
              FilterChip(label: Text(t), selected: _times.contains(t), onSelected: (v) => setState(() => v ? _times.add(t) : _times.remove(t))),
          ]),
          const SectionHeader('For how many days'),
          Wrap(spacing: 8, children: [
            for (final d in [3, 5, 7, 14, 30, 90]) ChoiceChip(label: Text('$d'), selected: _days == d, onSelected: (_) => setState(() => _days = d)),
          ]),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () async {
              if (_medicine.text.trim().isEmpty || _times.isEmpty) return snack(context, 'Enter the medicine and pick at least one time');
              final ok = await guard(context, () => addReminder(medicine: _medicine.text.trim(), dose: _dose.text.trim(),
                  times: _times.toList()..sort(), days: _days, patientName: _patient.text.trim()), ok: 'Reminder saved');
              if (ok && context.mounted) Navigator.pop(context);
            },
            child: const Text('Save reminder'),
          ),
        ]),
      );
}
