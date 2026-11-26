import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../db.dart';
import '../ui.dart';
import 'bookings.dart';

/// One doctor's practice in a period (all = full history, for new vs returning). Same rules as the portal's
/// Doctor Insights page (src/pages/suite/DoctorInsights.jsx).
class Metrics {
  Metrics(List<Appt> all, String from) {
    String key(Appt a) => a.patientId ?? a.patient;
    final first = <String, String>{};
    for (final a in [...all]..sort((x, y) => x.date.compareTo(y.date))) {
      first.putIfAbsent(key(a), () => a.date);
    }
    final inP = all.where((a) => a.date.compareTo(from) >= 0).toList();
    total = inP.length;
    completed = inP.where((a) => a.status == 'Completed').length;
    noShow = inP.where((a) => a.status == 'No-Show').length;
    cancelled = inP.where((a) => a.status == 'Cancelled').length;
    online = inP.where((a) => a.online).length;
    revenue = inP.where((a) => a.status == 'Completed').fold<num>(0, (s, a) => s + ((a.data['fee'] as num?) ?? 0));
    final ps = inP.map(key).toSet();
    patients = ps.length;
    newPatients = ps.where((p) => first[p]!.compareTo(from) >= 0).length;
    for (final a in all) {
      visits.putIfAbsent(key(a), () => []).add(a);
    }
    returningPct = visits.isEmpty ? 0 : (visits.values.where((v) => v.length >= 2).length * 100 ~/ visits.length);
    for (final a in inP) {
      perDay[a.date] = (perDay[a.date] ?? 0) + 1;
      final dx = '${a.summary['diagnosis'] ?? ''}'.trim();
      if (dx.isNotEmpty) diagnoses[dx] = (diagnoses[dx] ?? 0) + 1;
      for (final m in (a.summary['medications'] as List? ?? []).cast<Map>()) {
        final n = '${m['name'] ?? ''}'.trim();
        if (n.isNotEmpty) medicines[n] = (medicines[n] ?? 0) + 1;
      }
    }
  }
  late final int total, completed, noShow, cancelled, online, patients, newPatients, returningPct;
  late final num revenue;
  final visits = <String, List<Appt>>{};
  final perDay = <String, int>{};
  final diagnoses = <String, int>{};
  final medicines = <String, int>{};

  List<MapEntry<String, int>> top(Map<String, int> m, [int n = 6]) => (m.entries.toList()..sort((a, b) => b.value.compareTo(a.value))).take(n).toList();
}

class InsightsScreen extends StatefulWidget {
  const InsightsScreen({super.key});

  @override
  State<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends State<InsightsScreen> {
  int _days = 30;
  // ponytail: full history (capped at 5000 visits) loaded once; add monthly rollups if a doctor exceeds that.
  late final _all = Db.ours.where('doctorId', isEqualTo: uid).where('date', isGreaterThanOrEqualTo: '2000-01-01').orderBy('date', descending: true).limit(5000).get()
      .then((s) => s.docs.map(Appt.of).toList());

  @override
  Widget build(BuildContext context) {
    final from = ymd(DateTime.now().subtract(Duration(days: _days)));
    final inr = NumberFormat.compactCurrency(locale: 'en_IN', symbol: '₹');
    return Scaffold(
      appBar: AppBar(title: const Text('My practice insights'), actions: [
        PopupMenuButton<int>(
          initialValue: _days,
          onSelected: (d) => setState(() => _days = d),
          itemBuilder: (_) => [for (final d in [7, 30, 90, 365]) PopupMenuItem(value: d, child: Text(d == 365 ? 'Last 12 months' : 'Last $d days'))],
          child: Padding(padding: const EdgeInsets.all(12), child: Row(children: [Text(_days == 365 ? '12 months' : '$_days days'), const Icon(Icons.arrow_drop_down)])),
        ),
      ]),
      body: FutureBuilder<List<Appt>>(
        future: _all,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('${snap.error}')));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final m = Metrics(snap.data!, from);
          final patients = m.visits.entries.map((e) => (e.key, [...e.value]..sort((a, b) => b.date.compareTo(a.date)))).toList()
            ..sort((a, b) => b.$2.first.date.compareTo(a.$2.first.date));
          return ListView(padding: const EdgeInsets.all(12), children: [
            GridView.count(crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), childAspectRatio: 1.5, children: [
              StatCard(icon: Icons.event_available, value: '${m.total}', label: 'Consultations'),
              StatCard(icon: Icons.people_alt_outlined, value: '${m.patients}', label: 'Patients · ${m.newPatients} new'),
              StatCard(icon: Icons.check_circle_outline, value: '${m.completed} / ${m.noShow}', label: 'Completed / no-show',
                  badge: m.total > 0 && m.noShow * 100 / m.total > 15 ? 'High no-show' : null, badgeColor: kOrange),
              StatCard(icon: Icons.currency_rupee, value: inr.format(m.revenue), label: 'Consultation fees'),
              StatCard(icon: Icons.replay, value: '${m.returningPct}%', label: 'Patients who came back'),
              StatCard(icon: Icons.videocam_outlined, value: '${m.online}', label: 'Online consults'),
            ]),
            const SectionHeader('Consultations per day'),
            Card(child: Padding(padding: const EdgeInsets.all(12), child: SizedBox(height: 90, child: _Bars(m.perDay, _days > 90 ? 90 : _days)))),
            const SectionHeader('Top diagnoses'),
            Card(child: Column(children: [
              for (final e in m.top(m.diagnoses)) ListTile(dense: true, title: Text(e.key), trailing: Text('${e.value}')),
              if (m.diagnoses.isEmpty) const ListTile(title: Text('No diagnoses recorded in this period.')),
            ])),
            const SectionHeader('Most prescribed'),
            Card(child: Column(children: [
              for (final e in m.top(m.medicines)) ListTile(dense: true, title: Text(e.key), trailing: Text('${e.value}')),
              if (m.medicines.isEmpty) const ListTile(title: Text('No prescriptions in this period.')),
            ])),
            const SectionHeader('My patients'),
            for (final (_, v) in patients.take(100))
              Card(
                child: ListTile(
                  onTap: v.first.patientId == null ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => AppointmentDetailsScreen(v.first.id))),
                  title: Text(v.first.patient),
                  subtitle: Text([
                    '${v.length} visit${v.length == 1 ? '' : 's'} since ${shortDate(v.last.date)}',
                    v.map((a) => '${a.summary['diagnosis'] ?? ''}'.trim()).where((d) => d.isNotEmpty).toSet().join(' → '),
                  ].where((s) => s.isNotEmpty).join('\n')),
                  trailing: Text(shortDate(v.first.date), style: const TextStyle(color: kMuted)),
                ),
              ),
          ]);
        },
      ),
    );
  }
}

class _Bars extends StatelessWidget {
  const _Bars(this.perDay, this.days);
  final Map<String, int> perDay;
  final int days;

  @override
  Widget build(BuildContext context) {
    final t = DateTime.now();
    final counts = [for (var i = days; i >= 0; i--) perDay[ymd(t.subtract(Duration(days: i)))] ?? 0];
    final max = counts.fold<int>(1, (a, b) => b > a ? b : a);
    return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
      for (final c in counts)
        Expanded(child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 0.5),
          child: Tooltip(message: '$c', child: Container(height: 4 + 80 * c / max, color: c == 0 ? kBg : kPrimary)),
        )),
    ]);
  }
}
