import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../db.dart';
import '../ui.dart';
import 'bookings.dart';

/// Visit summary or digital prescription as a PDF (built-in Helvetica: keep text Latin-1, "Rs." not "₹").
Future<Uint8List> visitPdf(Appt a, Json doctor, {bool prescription = false}) async {
  final s = a.summary;
  final meds = List<Map>.from(s['medications'] ?? []);
  final doc = pw.Document();
  final label = pw.TextStyle(color: PdfColors.grey700, fontSize: 10);
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4,
    margin: const pw.EdgeInsets.all(36),
    build: (_) => [
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Expanded(
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Text('${doctor['name'] ?? ''}', style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold, color: PdfColor.fromInt(0xFF3B1FA3))),
            pw.Text('${doctor['qualification'] ?? ''} · ${doctor['specialization'] ?? ''}'),
            pw.Text('Reg. No: ${doctor['doctorCode'] ?? '-'}', style: label),
          ]),
        ),
        pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
          pw.Text('${doctor['hospital'] ?? ''}', style: pw.TextStyle(fontWeight: pw.FontWeight.bold)),
          pw.Text('${doctor['phone'] ?? ''}', style: label),
        ]),
      ]),
      pw.Divider(),
      pw.Text(prescription ? 'PRESCRIPTION' : 'VISIT SUMMARY', style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold, letterSpacing: 1)),
      pw.SizedBox(height: 8),
      pw.Row(children: [
        pw.Expanded(child: pw.Text('Patient: ${a.patient}')),
        pw.Text('Token #${a.token}'),
      ]),
      pw.Row(children: [
        pw.Expanded(child: pw.Text('Date: ${DateFormat('d MMM y').format(a.start)}, ${a.time}')),
        pw.Text('${a.visitType} · ${a.online ? 'Video' : 'In-person'}'),
      ]),
      pw.SizedBox(height: 14),
      if ('${s['diagnosis'] ?? ''}'.isNotEmpty) ...[
        pw.Text('Diagnosis', style: label),
        pw.Text('${s['diagnosis']}', style: pw.TextStyle(fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 12),
      ],
      pw.Text(prescription ? 'Rx' : 'Prescribed Medications', style: prescription ? pw.TextStyle(fontSize: 22, fontWeight: pw.FontWeight.bold) : label),
      if (meds.isEmpty) pw.Text('None'),
      if (meds.isNotEmpty)
        pw.TableHelper.fromTextArray(
          headers: ['#', 'Medicine', 'Dosage', 'Duration'],
          data: [for (final (i, m) in meds.indexed) ['${i + 1}', '${m['name'] ?? ''}', '${m['dosage'] ?? ''}', '${m['duration'] ?? ''}']],
          headerStyle: pw.TextStyle(fontWeight: pw.FontWeight.bold),
          cellAlignment: pw.Alignment.centerLeft,
        ),
      if ('${s['notes'] ?? ''}'.isNotEmpty) ...[
        pw.SizedBox(height: 14),
        pw.Text('Advice / Notes', style: label),
        pw.Text('${s['notes']}'),
      ],
      pw.SizedBox(height: 40),
      pw.Align(
        alignment: pw.Alignment.centerRight,
        child: pw.Column(children: [
          pw.Container(width: 160, height: 1, color: PdfColors.grey600),
          pw.Text('${doctor['name'] ?? ''}', style: label),
        ]),
      ),
    ],
  ));
  return doc.save();
}

Future<void> sharePdf(BuildContext context, Future<Uint8List> Function() build, String filename) =>
    guard(context, () async => Printing.sharePdf(bytes: await build(), filename: filename));

class SummaryScreen extends StatelessWidget {
  const SummaryScreen(this.initial, {super.key});
  final Appt initial;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Visit Summary')),
        body: StreamBuilder<Appt>(
          stream: Db.watch(initial.id),
          initialData: initial,
          builder: (context, snap) {
            final a = snap.data!;
            final s = a.summary;
            final meds = List<Map>.from(s['medications'] ?? []);
            final file = a.patient.replaceAll(RegExp(r'\W+'), '_');
            Future<Uint8List> pdf({bool rx = false}) async => visitPdf(a, (await Db.doctor().get()).data() ?? {}, prescription: rx);
            return ListView(padding: const EdgeInsets.all(16), children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Avatar(a.patient),
                      const SizedBox(width: 12),
                      Expanded(child: Text(a.patient, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
                      StatusChip(a.status),
                    ]),
                    const Divider(height: 24),
                    InfoRow(Icons.calendar_today_outlined, 'Date & time', '${Db.shortLabel(a.date)} · ${a.time}'),
                    InfoRow(Icons.medical_information_outlined, 'Visit type', a.visitType),
                    InfoRow(Icons.confirmation_number_outlined, 'Token', '#${a.token}'),
                    if ('${s['diagnosis'] ?? ''}'.isNotEmpty) InfoRow(Icons.healing_outlined, 'Diagnosis', '${s['diagnosis']}'),
                  ]),
                ),
              ),
              const SectionHeader('Prescribed Medications'),
              if (meds.isEmpty) const Text('No medicines prescribed.', style: TextStyle(color: kMuted)),
              for (final m in meds)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: const Icon(Icons.medication, color: kPrimary),
                    title: Text('${m['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text([m['dosage'], m['duration']].where((x) => x != null && '$x'.isNotEmpty).join(' • ')),
                  ),
                ),
              if ('${s['notes'] ?? ''}'.isNotEmpty) ...[
                const SectionHeader('Notes'),
                Card(child: Padding(padding: const EdgeInsets.all(14), child: Text('${s['notes']}'))),
              ],
              const SectionHeader('Follow-up Plan'),
              if (a.patientId != null) _FollowUp(a),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () => sharePdf(context, pdf, 'Visit_Summary_$file.pdf'),
                icon: const Icon(Icons.download),
                label: const Text('Download PDF Summary'),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: () => sharePdf(context, () => pdf(rx: true), 'Prescription_$file.pdf'),
                icon: const Icon(Icons.description_outlined),
                label: const Text('Generate Digital Prescription'),
              ),
            ]);
          },
        ),
      );
}

class _FollowUp extends StatelessWidget {
  const _FollowUp(this.a);
  final Appt a;

  @override
  Widget build(BuildContext context) => StreamBuilder<List<Appt>>(
        stream: Db.forPatient(a.patientId!),
        builder: (context, snap) {
          final next = (snap.data ?? []).where((x) => x.id != a.id && x.isOpen && x.start.isAfter(a.start)).firstOrNull;
          return Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(gradient: const LinearGradient(colors: [kPrimaryDark, kPrimary]), borderRadius: BorderRadius.circular(16)),
            child: Column(children: [
              const Icon(Icons.event, color: Colors.white),
              const SizedBox(height: 6),
              const Text('Next Scheduled Visit', style: TextStyle(color: Colors.white70, fontSize: 12)),
              Text(next == null ? 'Not scheduled yet' : '${Db.shortLabel(next.date)} · ${next.time}',
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
              if (next == null) ...[
                const SizedBox(height: 12),
                FilledButton.tonalIcon(
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 42)),
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => BookAppointmentScreen(patient: {'id': a.patientId, 'name': a.patient, 'phone': a.phone}, visitType: 'Follow-up', online: a.online)),
                  ),
                  icon: const Icon(Icons.event_available),
                  label: const Text('Book Follow-up'),
                ),
              ],
            ]),
          );
        },
      );
}
