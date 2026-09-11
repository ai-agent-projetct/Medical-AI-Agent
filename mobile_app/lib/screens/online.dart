import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../db.dart';
import '../ui.dart';
import '../video_call.dart';
import 'bookings.dart';
import 'home.dart';

/// Marks the visit in consultation, opens the ZegoCloud room and, on mobile, asks for notes when it ends.
Future<void> startVideoConsultation(BuildContext context, Appt a) async {
  final me = (await Db.doctor().get()).data() ?? {};
  if (!context.mounted) return;
  final started = DateTime.now();
  final ok = await guard(context, () async {
    if (a.status != 'In Consultation') await Db.setStatus(a.id, 'In Consultation');
    if (!context.mounted) return;
    await openVideoRoom(context, roomId: a.id, userId: uid, userName: me['name'] as String? ?? 'Doctor');
  });
  // On web the room opens in a new tab; the doctor completes the visit from the details screen.
  if (!ok || kIsWeb || !context.mounted) return;
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (_) => _EndConsultationSheet(a, DateTime.now().difference(started)),
  );
}

/// Sends the patient their join link on WhatsApp (falls back to copying it).
Future<void> shareCallLink(BuildContext context, Appt a) async {
  final link = callLink(a.id);
  final text = 'Hello ${a.patient}, your video consultation (Token #${a.token}) is on ${Db.shortLabel(a.date)} at ${a.time}. '
      'Join here: $link';
  final digits = a.phone.replaceAll(RegExp(r'\D'), '');
  if (digits.length >= 10 && await launchUrl(Uri.parse('https://wa.me/$digits?text=${Uri.encodeComponent(text)}'), mode: LaunchMode.externalApplication)) {
    return;
  }
  await Clipboard.setData(ClipboardData(text: text));
  if (context.mounted) snack(context, 'Video link copied — paste it to the patient.');
}

class _EndConsultationSheet extends StatefulWidget {
  const _EndConsultationSheet(this.a, this.duration);
  final Appt a;
  final Duration duration;

  @override
  State<_EndConsultationSheet> createState() => _EndConsultationSheetState();
}

class _EndConsultationSheetState extends State<_EndConsultationSheet> {
  final _notes = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final d = widget.duration;
    final mmss = '${d.inMinutes.toString().padLeft(2, '0')}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.check_circle_outline, color: kGreen),
          const SizedBox(width: 8),
          const Text('End Consultation?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const Spacer(),
          IconButton(tooltip: 'Close', onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
        ]),
        Text('Consultation duration: $mmss with ${widget.a.patient}.', style: const TextStyle(color: kMuted)),
        const SizedBox(height: 12),
        TextField(controller: _notes, maxLines: 3, decoration: const InputDecoration(hintText: 'Add consultation summary or prescription notes...')),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('End Call Only'))),
          const SizedBox(width: 10),
          Expanded(
            child: FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: () {
                Navigator.pop(context);
                Navigator.push(context, MaterialPageRoute(builder: (_) => CompleteConsultationScreen(widget.a, notes: _notes.text)));
              },
              child: const Text('Save & Finish'),
            ),
          ),
        ]),
      ]),
    );
  }
}

class OnlineTab extends StatefulWidget {
  const OnlineTab({super.key});

  @override
  State<OnlineTab> createState() => _OnlineTabState();
}

class _OnlineTabState extends State<OnlineTab> {
  DateTime _date = today();

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Online Booking'), actions: [
          IconButton(
            tooltip: 'Book video consultation',
            icon: const Icon(Icons.add_circle_outline),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => BookAppointmentScreen(online: true, date: _date))),
          ),
          ...homeActions(context),
        ]),
        body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
          OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month),
            label: Text(prettyDate(_date)),
            onPressed: () async {
              final d = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2024), lastDate: DateTime.now().add(const Duration(days: 365)));
              if (d != null) setState(() => _date = d);
            },
          ),
          StreamBuilder<List<Appt>>(
            stream: Db.myDay(ymd(_date)),
            builder: (context, snap) {
              if (snap.hasError) return Text('${snap.error}');
              final list = (snap.data ?? []).where((a) => a.online).toList();
              return Column(children: [
                SectionHeader('Online Bookings', trailing: Text('${list.length} total', style: const TextStyle(color: kMuted, fontSize: 12))),
                if (list.isEmpty) const EmptyState('No video consultations', icon: Icons.videocam_off_outlined),
                for (final a in list)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: ApptTile(
                      a,
                      onTap: () => openAppointment(context, a.id),
                      trailing: a.isOpen
                          ? IconButton.filled(tooltip: 'Start video', onPressed: () => startVideoConsultation(context, a), icon: const Icon(Icons.videocam))
                          : null,
                    ),
                  ),
              ]);
            },
          ),
        ]),
      );
}
