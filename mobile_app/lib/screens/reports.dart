import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../db.dart';
import '../ui.dart';
import 'bookings.dart';
import 'home.dart';
import 'summary.dart';

class ReportsTab extends StatefulWidget {
  const ReportsTab({super.key});

  @override
  State<ReportsTab> createState() => _ReportsTabState();
}

class _ReportsTabState extends State<ReportsTab> {
  String _range = 'Today';

  (DateTime, DateTime) get _bounds {
    final t = today();
    return switch (_range) {
      'This Week' => (t.subtract(Duration(days: t.weekday - 1)), t.add(Duration(days: 7 - t.weekday))),
      'This Month' => (DateTime(t.year, t.month), DateTime(t.year, t.month + 1, 0)),
      _ => (t, t),
    };
  }

  Future<void> _export(List<Appt> list) {
    final (from, to) = _bounds;
    return sharePdf(context, () {
      final doc = pw.Document()
        ..addPage(pw.MultiPage(
          build: (_) => [
            pw.Text('Appointments report · ${DateFormat('d MMM y').format(from)} – ${DateFormat('d MMM y').format(to)}',
                style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 12),
            pw.TableHelper.fromTextArray(
              headers: ['Date', 'Time', 'Token', 'Patient', 'Visit', 'Mode', 'Status'],
              data: [for (final a in list) [a.date, a.time, '${a.token}', a.patient, a.visitType, a.online ? 'Video' : 'In-person', statusLabel(a.status)]],
              headerStyle: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 9),
              cellStyle: const pw.TextStyle(fontSize: 9),
              headerDecoration: const pw.BoxDecoration(color: PdfColors.grey300),
            ),
          ],
        ));
      return doc.save();
    }, 'Report_${ymd(from)}_${ymd(to)}.pdf');
  }

  @override
  Widget build(BuildContext context) {
    final (from, to) = _bounds;
    return StreamBuilder<List<Appt>>(
      stream: Db.myRange(ymd(from), ymd(to)),
      builder: (context, snap) {
        final list = snap.data ?? [];
        int count(bool Function(Appt) f) => list.where(f).length;
        final done = list.where((a) => a.status == 'Completed').toList();
        final revenue = done.fold<num>(0, (sum, a) => sum + ((a.data['fee'] as num?) ?? 0));
        return Scaffold(
          appBar: AppBar(title: const Text('Reports'), actions: [
            IconButton(tooltip: 'Export PDF', onPressed: list.isEmpty ? null : () => _export(list), icon: const Icon(Icons.ios_share)),
            ...homeActions(context),
          ]),
          body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
            SegmentedButton<String>(
              segments: [for (final r in ['Today', 'This Week', 'This Month']) ButtonSegment(value: r, label: Text(r))],
              selected: {_range},
              onSelectionChanged: (s) => setState(() => _range = s.first),
            ),
            if (snap.hasError) Padding(padding: const EdgeInsets.all(16), child: Text('${snap.error}')),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: MediaQuery.of(context).size.width > 700 ? 3 : 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.45,
              children: [
                StatCard(icon: Icons.event_note, value: '${list.length}', label: 'Appointments', badge: 'Total', badgeColor: kMuted),
                StatCard(icon: Icons.check_circle_outline, value: '${done.length}', label: 'Completed', badge: 'Done'),
                StatCard(icon: Icons.cancel_outlined, value: '${count((a) => a.status == 'Cancelled' || a.status == 'No-Show')}', label: 'Cancelled / missed', badge: 'Missed', badgeColor: kRed),
                StatCard(icon: Icons.refresh, value: '${count((a) => a.status == 'Rescheduled')}', label: 'Rescheduled', badge: 'Moved', badgeColor: kOrange),
                StatCard(icon: Icons.videocam_outlined, value: '${count((a) => a.online)}', label: 'Video consults'),
                StatCard(icon: Icons.currency_rupee, value: NumberFormat.compact(locale: 'en_IN').format(revenue), label: 'Fees (completed)'),
              ],
            ),
            const SectionHeader('Recent Activities'),
            if (list.isEmpty) const EmptyState('No appointments in this period', icon: Icons.insights),
            for (final a in list.reversed.take(30))
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Card(
                  child: ListTile(
                    onTap: () => openAppointment(context, a.id),
                    leading: Container(
                      width: 44,
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      decoration: BoxDecoration(color: kBg, borderRadius: BorderRadius.circular(10)),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text(DateFormat('MMM').format(a.start).toUpperCase(), style: const TextStyle(fontSize: 9, color: kMuted)),
                        Text('${a.start.day}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      ]),
                    ),
                    title: Text(a.patient, style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('#${a.token} · ${a.visitType}'),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      StatusChip(a.status),
                      const SizedBox(height: 4),
                      Text(a.time, style: const TextStyle(fontSize: 11, color: kMuted)),
                    ]),
                  ),
                ),
              ),
          ]),
        );
      },
    );
  }
}
