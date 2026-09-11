import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../db.dart';
import '../ui.dart';
import 'bookings.dart';
import 'home.dart';

TimeOfDay _tod(String hhmm) {
  final p = hhmm.split(':').map(int.parse).toList();
  return TimeOfDay(hour: p[0], minute: p[1]);
}

String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

class ScheduleTab extends StatelessWidget {
  const ScheduleTab({super.key});

  @override
  Widget build(BuildContext context) {
    final todayKey = ymd(DateTime.now());
    return Scaffold(
      appBar: AppBar(title: const Text('Schedule'), actions: homeActions(context)),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
        StreamBuilder<DocumentSnapshot<Json>>(
          stream: Db.schedule().snapshots(),
          builder: (context, snap) {
            final day = (snap.data?.data()?['days'] as Map?)?[todayKey] as Map? ?? {'available': true, 'sessions': defaultSessions};
            final sessions = List<Map>.from(day['sessions'] ?? []);
            return Card(
              color: const Color(0xFFEDEBFA),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('Availability Slots', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                        Text('Set your consultation hours', style: TextStyle(color: kMuted, fontSize: 12)),
                      ]),
                    ),
                    IconButton.filled(
                      tooltip: 'Edit schedule',
                      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const EditScheduleScreen())),
                      icon: const Icon(Icons.add),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  if (day['available'] == false)
                    const Text('Day off today', style: TextStyle(color: kRed, fontWeight: FontWeight.w600))
                  else
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final s in sessions)
                        Chip(
                          avatar: const Icon(Icons.check_circle, color: kGreen, size: 16),
                          label: Text('${s['from']} – ${s['to']}'),
                          backgroundColor: Colors.white,
                          side: const BorderSide(color: kGreen),
                        ),
                    ]),
                ]),
              ),
            );
          },
        ),
        StreamBuilder<List<Appt>>(
          stream: Db.myDay(todayKey),
          builder: (context, snap) {
            final list = snap.data ?? [];
            return Column(children: [
              SectionHeader("Today's Schedule", trailing: Text('${list.length} appointments', style: const TextStyle(color: kMuted, fontSize: 12))),
              if (list.isEmpty) const EmptyState('Nothing booked today', icon: Icons.free_breakfast_outlined),
              for (final a in list)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Card(
                    child: ListTile(
                      leading: SizedBox(width: 64, child: Text(a.time, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
                      title: Text(a.patient, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('#${a.token} · ${a.visitType}${a.online ? ' · Video' : ''}'),
                      trailing: StatusChip(a.status),
                      onTap: () => openAppointment(context, a.id),
                    ),
                  ),
                ),
            ]);
          },
        ),
      ]),
    );
  }
}

class EditScheduleScreen extends StatefulWidget {
  const EditScheduleScreen({super.key});

  @override
  State<EditScheduleScreen> createState() => _EditScheduleScreenState();
}

class _EditScheduleScreenState extends State<EditScheduleScreen> {
  final _days = List.generate(21, (i) => today().add(Duration(days: i)));
  DateTime _day = today();
  bool _available = true, _loading = true, _saving = false;
  List<Map<String, String>> _sessions = [];
  Set<String> _scheduled = {};

  @override
  void initState() {
    super.initState();
    Db.schedule().get().then((s) {
      _scheduled = ((s.data()?['days'] as Map?) ?? {}).keys.cast<String>().toSet();
      _load(_day);
    });
  }

  Future<void> _load(DateTime d) async {
    setState(() {
      _day = d;
      _loading = true;
    });
    final day = await Db.day(ymd(d));
    if (!mounted) return;
    setState(() {
      _available = day['available'] != false;
      _sessions = [for (final s in List<Map>.from(day['sessions'] ?? [])) {'from': '${s['from']}', 'to': '${s['to']}'}];
      _loading = false;
    });
  }

  Future<void> _pickTime(int i, String key) async {
    final t = await showTimePicker(context: context, initialTime: _tod(_sessions[i][key]!));
    if (t != null) setState(() => _sessions[i][key] = _hhmm(t));
  }

  Future<void> _save() async {
    final sorted = [..._sessions]..sort((a, b) => a['from']!.compareTo(b['from']!));
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i]['from']!.compareTo(sorted[i]['to']!) >= 0) return snack(context, 'Each session must end after it starts.');
      if (i > 0 && sorted[i]['from']!.compareTo(sorted[i - 1]['to']!) < 0) return snack(context, 'Sessions overlap.');
    }
    if (_available && sorted.isEmpty) return snack(context, 'Add at least one session or mark the day off.');
    setState(() => _saving = true);
    final ok = await guard(context, () => Db.saveDay(ymd(_day), _available, sorted), ok: 'Schedule saved for ${DateFormat('EEE, MMM d').format(_day)}');
    if (!mounted) return;
    setState(() {
      _saving = false;
      if (ok) _scheduled.add(ymd(_day));
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Edit Schedule')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Row(children: [
            const Text('Pick a day', style: TextStyle(color: kMuted)),
            const Spacer(),
            Text(DateFormat('MMM y').format(_day).toUpperCase(), style: const TextStyle(fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 8),
          SizedBox(
            height: 84,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _days.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final d = _days[i];
                final sel = d == _day;
                return InkWell(
                  onTap: () => _load(d),
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    width: 58,
                    decoration: BoxDecoration(color: sel ? kPrimary : Colors.white, borderRadius: BorderRadius.circular(14)),
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Text(i == 0 ? 'TODAY' : i == 1 ? 'TMRW' : DateFormat('EEE').format(d).toUpperCase(),
                          style: TextStyle(fontSize: 10, color: sel ? Colors.white70 : kMuted)),
                      Text('${d.day}', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: sel ? Colors.white : Colors.black87)),
                      Icon(Icons.circle, size: 6, color: _scheduled.contains(ymd(d)) ? kGreen : (sel ? Colors.white38 : Colors.black12)),
                    ]),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 4),
          const Row(children: [
            Icon(Icons.circle, size: 8, color: kGreen),
            Text(' Custom hours   ', style: TextStyle(fontSize: 11, color: kMuted)),
            Icon(Icons.circle, size: 8, color: Colors.black12),
            Text(' Default hours', style: TextStyle(fontSize: 11, color: kMuted)),
          ]),
          const SizedBox(height: 12),
          if (_loading)
            const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
          else ...[
            Card(
              child: SwitchListTile(
                secondary: const Icon(Icons.event_available),
                title: const Text('Available for work'),
                subtitle: const Text('Patients can book on this day'),
                value: _available,
                onChanged: (v) => setState(() => _available = v),
              ),
            ),
            if (_available) ...[
              for (final (i, s) in _sessions.indexed) ...[
                SectionHeader('Clinical Hours - Session ${i + 1}',
                    trailing: IconButton(tooltip: 'Remove session', onPressed: () => setState(() => _sessions.removeAt(i)), icon: const Icon(Icons.delete_outline))),
                Row(children: [
                  for (final key in ['from', 'to']) ...[
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _pickTime(i, key),
                        icon: const Icon(Icons.schedule, size: 18),
                        label: Text('${key.toUpperCase()}  ${to12h(s[key]!)}'),
                      ),
                    ),
                    if (key == 'from') const SizedBox(width: 10),
                  ],
                ]),
              ],
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () => setState(() => _sessions.add({'from': '18:00', 'to': '20:00'})),
                icon: const Icon(Icons.add),
                label: const Text('Add session'),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(onPressed: _saving ? null : _save, icon: const Icon(Icons.save_outlined), label: const Text('Save')),
          ],
        ]),
      );
}
