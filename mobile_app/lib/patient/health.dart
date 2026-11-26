import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../db.dart';
import '../ui.dart';

/// A patient's results from every hospital they visited: verified lab reports with flags and trends, vitals,
/// vaccinations (due / given) and bills. Reads are limited by firestore.rules to the patient's own records.
final _fs = FirebaseFirestore.instance;
const _flagText = {'L': 'Low', 'H': 'High', 'LL': 'Critical low', 'HH': 'Critical high'};
final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);

Stream<List<Json>> _q(String col, String patientId, {bool verified = false}) {
  Query<Json> q = _fs.collection(col).where('patientId', isEqualTo: patientId);
  if (verified) q = q.where('status', isEqualTo: 'Verified');
  return q.limit(300).snapshots().map((s) => s.docs.map((d) => {...d.data(), 'id': d.id}).toList());
}

/// Values of each lab test over time: code → [(date, value)], oldest first.
Map<String, List<(String, double)>> labSeries(List<Json> orders) {
  final out = <String, List<(String, double)>>{};
  final sorted = [...orders]..sort((a, b) => '${a['date']}'.compareTo('${b['date']}'));
  for (final o in sorted) {
    for (final t in (o['tests'] as List? ?? []).cast<Map>()) {
      final v = double.tryParse('${t['value']}');
      if (v != null && t['qualitative'] != true) out.putIfAbsent('${t['code']}', () => []).add(('${o['date']}', v));
    }
  }
  return out;
}

class HealthScreen extends StatelessWidget {
  const HealthScreen({super.key, required this.patientId, required this.name});
  final String patientId, name;

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 4,
        child: Scaffold(
          appBar: AppBar(
            title: Text('$name · Health'),
            bottom: const TabBar(isScrollable: true, tabs: [Tab(text: 'Lab reports'), Tab(text: 'Vitals'), Tab(text: 'Vaccines'), Tab(text: 'Bills')]),
          ),
          body: TabBarView(children: [
            _LabTab(patientId),
            _VitalsTab(patientId),
            _Stream(_q('vaccinations', patientId), empty: 'No vaccinations recorded.', item: (v) => ListTile(
                  leading: Icon(Icons.vaccines, color: v['status'] == 'Given' ? kGreen : v['status'] == 'Missed' ? kRed : kOrange),
                  title: Text('${v['vaccine'] ?? ''} ${v['dose'] ?? ''}'),
                  subtitle: Text(v['status'] == 'Given' ? 'Given ${v['givenDate'] ?? ''}' : 'Due ${v['dueDate'] ?? ''}'),
                  trailing: Text('${v['status'] ?? ''}'),
                )),
            _BillsTab(patientId),
          ]),
        ),
      );
}

class _Stream extends StatelessWidget {
  const _Stream(this.stream, {required this.item, required this.empty, this.header});
  final Stream<List<Json>> stream;
  final Widget Function(Json) item;
  final String empty;
  final Widget Function(List<Json>)? header;

  @override
  Widget build(BuildContext context) => StreamBuilder<List<Json>>(
        stream: stream,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('${snap.error}')));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final rows = [...snap.data!]..sort((a, b) => '${b['date'] ?? b['dueDate'] ?? ''}'.compareTo('${a['date'] ?? a['dueDate'] ?? ''}'));
          if (rows.isEmpty) return EmptyState(empty, icon: Icons.inbox_outlined);
          return ListView(padding: const EdgeInsets.all(12), children: [
            if (header != null) header!(rows),
            for (final r in rows) Card(child: item(r)),
          ]);
        },
      );
}

class _LabTab extends StatelessWidget {
  const _LabTab(this.patientId);
  final String patientId;

  @override
  Widget build(BuildContext context) => _Stream(
        _q('labOrders', patientId, verified: true),
        empty: 'Verified lab reports from your hospitals appear here.',
        header: (rows) {
          final series = labSeries(rows).entries.where((e) => e.value.length >= 2).toList();
          if (series.isEmpty) return const SizedBox.shrink();
          final names = {for (final o in rows) for (final t in (o['tests'] as List).cast<Map>()) '${t['code']}': t};
          return Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Trends', style: TextStyle(fontWeight: FontWeight.w700)),
                for (final e in series)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Row(children: [
                      Expanded(child: Text('${names[e.key]?['name'] ?? e.key}\n${e.value.map((p) => p.$2).join(' → ')} ${names[e.key]?['unit'] ?? ''}', style: const TextStyle(fontSize: 12))),
                      SizedBox(width: 120, height: 36, child: Sparkline(e.value.map((p) => p.$2).toList(),
                          low: (names[e.key]?['low'] as num?)?.toDouble(), high: (names[e.key]?['high'] as num?)?.toDouble())),
                    ]),
                  ),
              ]),
            ),
          );
        },
        item: (o) => ExpansionTile(
          leading: Icon(Icons.science_outlined, color: o['critical'] == true ? kRed : kPrimary),
          title: Text((o['tests'] as List).map((t) => t['name']).join(', '), maxLines: 2, overflow: TextOverflow.ellipsis),
          subtitle: Text('${o['date']} · ${o['doctor'] ?? ''}'),
          children: [
            for (final t in (o['tests'] as List).cast<Map>())
              ListTile(
                dense: true,
                title: Text('${t['name']}'),
                subtitle: t['qualitative'] == true ? null : Text('Normal ${t['low'] ?? ''}–${t['high'] ?? ''} ${t['unit'] ?? ''}'),
                trailing: Text('${t['value']} ${t['qualitative'] == true ? '' : t['unit'] ?? ''}${(t['flag'] ?? '') != '' ? '\n${_flagText[t['flag']]}' : ''}',
                    textAlign: TextAlign.end,
                    style: TextStyle(color: (t['flag'] ?? '') != '' ? kRed : null, fontWeight: (t['flag'] ?? '') != '' ? FontWeight.w700 : null)),
              ),
            const Padding(padding: EdgeInsets.all(12), child: Text('Discuss results with your doctor.', style: TextStyle(color: kMuted, fontSize: 12))),
          ],
        ),
      );
}

class _VitalsTab extends StatelessWidget {
  const _VitalsTab(this.patientId);
  final String patientId;
  static const _rows = [('hr', 'Pulse', '/min', 51.0, 90.0), ('sbp', 'Systolic BP', 'mmHg', 100.0, 140.0), ('spo2', 'SpO₂', '%', 95.0, 100.0),
    ('temp', 'Temperature', '°C', 36.1, 38.0), ('glucose', 'Glucose', 'mg/dL', 70.0, 180.0)];

  @override
  Widget build(BuildContext context) => StreamBuilder<List<Json>>(
        stream: _q('vitals', patientId),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final v = [...snap.data!]..sort((a, b) => '${a['date']} ${a['time']}'.compareTo('${b['date']} ${b['time']}'));
          if (v.isEmpty) return const EmptyState('Vitals recorded during hospital stays appear here.', icon: Icons.monitor_heart_outlined);
          return ListView(padding: const EdgeInsets.all(12), children: [
            for (final (k, label, unit, lo, hi) in _rows)
              if (v.any((x) => double.tryParse('${x[k]}') != null))
                Card(
                  child: ListTile(
                    title: Text(label),
                    subtitle: Text('Latest ${v.lastWhere((x) => double.tryParse('${x[k]}') != null)[k]} $unit'),
                    trailing: SizedBox(width: 130, height: 40, child: Sparkline(v.map((x) => double.tryParse('${x[k]}')).whereType<double>().toList(), low: lo, high: hi)),
                  ),
                ),
          ]);
        },
      );
}

class _BillsTab extends StatelessWidget {
  const _BillsTab(this.patientId);
  final String patientId;

  @override
  Widget build(BuildContext context) => _Stream(
        _q('invoices', patientId),
        empty: 'Bills from your hospitals appear here.',
        header: (rows) {
          final live = rows.where((i) => i['status'] != 'Cancelled');
          num sum(String k) => live.fold<num>(0, (s, i) => s + ((i[k] as num?) ?? 0));
          return Row(children: [
            Expanded(child: StatCard(icon: Icons.receipt_long, value: _inr.format(sum('total')), label: 'Total billed')),
            Expanded(child: StatCard(icon: Icons.pending_actions, value: _inr.format(sum('due')), label: 'Outstanding', badge: sum('due') > 0 ? 'Due' : null, badgeColor: kOrange)),
          ]);
        },
        item: (i) => ListTile(
          leading: const Icon(Icons.receipt_long_outlined),
          title: Text('${i['number']} · ${i['kind']}'),
          subtitle: Text('${i['date']} · paid ${_inr.format(i['paid'] ?? 0)}'),
          trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(_inr.format(i['total'] ?? 0), style: const TextStyle(fontWeight: FontWeight.w700)),
            Text('${i['status']}', style: TextStyle(fontSize: 11, color: i['status'] == 'Paid' ? kGreen : i['status'] == 'Cancelled' ? kMuted : kOrange)),
          ]),
        ),
      );
}

/// Small trend line; points outside [low, high] are red, the normal band is shaded.
class Sparkline extends StatelessWidget {
  const Sparkline(this.values, {super.key, this.low, this.high});
  final List<double> values;
  final double? low, high;

  @override
  Widget build(BuildContext context) => CustomPaint(painter: _SparkPainter(values, low, high));
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.v, this.low, this.high);
  final List<double> v;
  final double? low, high;

  @override
  void paint(Canvas canvas, Size size) {
    if (v.isEmpty) return;
    final all = [...v, ?low, ?high];
    final mn = all.reduce((a, b) => a < b ? a : b), mx = all.reduce((a, b) => a > b ? a : b);
    final span = (mx - mn) == 0 ? 1 : mx - mn;
    double y(double x) => size.height - 3 - (x - mn) * (size.height - 6) / span;
    double x(int i) => v.length == 1 ? size.width / 2 : 3 + i * (size.width - 6) / (v.length - 1);
    if (low != null && high != null) {
      canvas.drawRect(Rect.fromLTRB(0, y(high!), size.width, y(low!)), Paint()..color = kGreen.withValues(alpha: 0.12));
    }
    final path = Path()..moveTo(x(0), y(v[0]));
    for (var i = 1; i < v.length; i++) {
      path.lineTo(x(i), y(v[i]));
    }
    canvas.drawPath(path, Paint()..color = kPrimary..strokeWidth = 2..style = PaintingStyle.stroke);
    for (var i = 0; i < v.length; i++) {
      final out = (high != null && v[i] > high!) || (low != null && v[i] < low!);
      canvas.drawCircle(Offset(x(i), y(v[i])), 3, Paint()..color = out ? kRed : kPrimary);
    }
  }

  @override
  bool shouldRepaint(covariant _SparkPainter old) => old.v != v;
}
