import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'db.dart';

const kPrimary = Color(0xFF3B1FA3);
const kPrimaryDark = Color(0xFF2A1478);
const kBg = Color(0xFFF4F5FA);
const kMuted = Color(0xFF6B7280);
const kGreen = Color(0xFF16A34A);
const kOrange = Color(0xFFEA8A1A);
const kRed = Color(0xFFDC2626);
const kBlue = Color(0xFF2563EB);

final appTheme = ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(seedColor: kPrimary, primary: kPrimary, surface: Colors.white),
  scaffoldBackgroundColor: kBg,
  appBarTheme: const AppBarTheme(
    backgroundColor: kBg,
    surfaceTintColor: Colors.transparent,
    titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.black87),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE3E4EC))),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE3E4EC))),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size.fromHeight(50),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
  ),
  cardTheme: CardThemeData(
    color: Colors.white,
    elevation: 0,
    margin: EdgeInsets.zero,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
  ),
);

// ---- formatting ----
String ymd(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
String prettyDate(DateTime d) => DateFormat('EEE, MMM d, y').format(d);
String shortDate(String ymdStr) => DateFormat('MMM d').format(DateTime.parse(ymdStr));
DateTime today() {
  final n = DateTime.now();
  return DateTime(n.year, n.month, n.day);
}

String untilLabel(DateTime t) {
  final m = t.difference(DateTime.now()).inMinutes;
  if (m <= 0) return 'Now';
  if (m < 60) return 'In $m min';
  return 'In ${m ~/ 60}h ${m % 60}m';
}

void snack(BuildContext context, String msg) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating));

/// Runs a write and reports failures instead of silently losing the change.
Future<bool> guard(BuildContext context, Future<void> Function() action, {String? ok}) async {
  try {
    await action();
    if (ok != null && context.mounted) snack(context, ok);
    return true;
  } catch (e) {
    if (context.mounted) snack(context, 'Failed: ${e is Exception ? e.toString().replaceFirst('Exception: ', '') : e}');
    return false;
  }
}

// ---- widgets ----
class Avatar extends StatelessWidget {
  const Avatar(this.name, {super.key, this.size = 44, this.photoUrl});
  final String name;
  final double size;
  final String? photoUrl;

  static const _palette = [Color(0xFFE9E3FF), Color(0xFFE0F2FE), Color(0xFFDCFCE7), Color(0xFFFFEDD5), Color(0xFFFCE7F3)];

  @override
  Widget build(BuildContext context) {
    final initials = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2).map((w) => w[0].toUpperCase()).join();
    final bg = _palette[name.hashCode.abs() % _palette.length];
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: bg,
      backgroundImage: photoUrl != null && photoUrl!.isNotEmpty ? NetworkImage(photoUrl!) : null,
      child: photoUrl != null && photoUrl!.isNotEmpty
          ? null
          : Text(initials.isEmpty ? '?' : initials, style: TextStyle(color: kPrimary, fontWeight: FontWeight.w700, fontSize: size * 0.32)),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (status) {
      'Completed' => (kGreen, const Color(0xFFDCFCE7)),
      'In Consultation' => (kGreen, const Color(0xFFDCFCE7)),
      'Waiting' => (kMuted, const Color(0xFFF1F2F6)),
      'Cancelled' || 'No-Show' => (kRed, const Color(0xFFFEE2E2)),
      'Rescheduled' => (kOrange, const Color(0xFFFFEDD5)),
      _ => (kBlue, const Color(0xFFDBEAFE)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Text(statusLabel(status), style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

class StatCard extends StatelessWidget {
  const StatCard({super.key, required this.icon, required this.value, required this.label, this.badge, this.badgeColor = kGreen});
  final IconData icon;
  final String value;
  final String label;
  final String? badge;
  final Color badgeColor;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(color: kBg, borderRadius: BorderRadius.circular(8)),
                child: Icon(icon, size: 18, color: kPrimary),
              ),
              const Spacer(),
              if (badge != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: badgeColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: Text(badge!, style: TextStyle(color: badgeColor, fontSize: 11, fontWeight: FontWeight.w600)),
                ),
            ]),
            const SizedBox(height: 14),
            Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            Text(label, style: const TextStyle(color: kMuted, fontSize: 12)),
          ]),
        ),
      );
}

class ApptTile extends StatelessWidget {
  const ApptTile(this.a, {super.key, this.onTap, this.trailing});
  final Appt a;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Card(
        child: ListTile(
          onTap: onTap,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          leading: Avatar(a.patient),
          title: Row(children: [
            Flexible(child: Text(a.patient, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600))),
            const SizedBox(width: 8),
            StatusChip(a.status),
          ]),
          subtitle: Text('#${a.token} · ${a.time} · ${a.visitType}', style: const TextStyle(fontSize: 12, color: kMuted)),
          trailing: trailing ?? const Icon(Icons.chevron_right),
        ),
      );
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(2, 20, 2, 10),
        child: Row(children: [
          Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          const Spacer(),
          ?trailing,
        ]),
      );
}

class InfoRow extends StatelessWidget {
  const InfoRow(this.icon, this.label, this.value, {super.key});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(children: [
          Icon(icon, size: 18, color: kMuted),
          const SizedBox(width: 12),
          Text(label, style: const TextStyle(color: kMuted)),
          const SizedBox(width: 12),
          Expanded(child: Text(value, textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w600))),
        ]),
      );
}

class EmptyState extends StatelessWidget {
  const EmptyState(this.text, {super.key, this.icon = Icons.inbox_outlined});
  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Column(children: [
          Icon(icon, size: 40, color: kMuted),
          const SizedBox(height: 8),
          Text(text, style: const TextStyle(color: kMuted)),
        ]),
      );
}

/// Bottom sheet with search + checkboxes (education, specialization, languages).
Future<List<String>?> pickMany(BuildContext context, String title, List<String> options, List<String> selected) {
  final chosen = {...selected};
  var q = '';
  return showModalBottomSheet<List<String>>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => StatefulBuilder(builder: (ctx, setState) {
      final shown = options.where((o) => o.toLowerCase().contains(q.toLowerCase())).toList();
      return Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const Spacer(),
            Text('${chosen.length} selected', style: const TextStyle(color: kMuted)),
          ]),
          const SizedBox(height: 12),
          TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search...'),
            onChanged: (v) => setState(() => q = v),
          ),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.4),
            child: ListView(shrinkWrap: true, children: [
              for (final o in shown)
                CheckboxListTile(
                  value: chosen.contains(o),
                  title: Text(o),
                  controlAffinity: ListTileControlAffinity.leading,
                  onChanged: (v) => setState(() => v! ? chosen.add(o) : chosen.remove(o)),
                ),
            ]),
          ),
          const SizedBox(height: 8),
          FilledButton(onPressed: () => Navigator.pop(ctx, chosen.toList()), child: const Text('Done')),
        ]),
      );
    }),
  );
}

/// "Choose a time" sheet listing the doctor's free slots on [date].
Future<String?> pickSlot(BuildContext context, DateTime date, {String? doctorId}) => showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => FutureBuilder<List<String>>(
        future: Db.freeSlots(ymd(date), doctorId: doctorId),
        builder: (ctx, snap) {
          if (!snap.hasData) return const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()));
          final slots = snap.data!;
          return Column(mainAxisSize: MainAxisSize.min, children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(children: [
                const Text('Choose a time', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const Spacer(),
                Text(prettyDate(date), style: const TextStyle(color: kMuted)),
              ]),
            ),
            if (slots.isEmpty) const EmptyState('No free slots on this day', icon: Icons.event_busy),
            Flexible(
              child: ListView(shrinkWrap: true, children: [
                for (final s in slots)
                  ListTile(
                    leading: const Icon(Icons.event_available, color: kGreen),
                    title: Text(s),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.pop(ctx, s),
                  ),
              ]),
            ),
          ]);
        },
      ),
    );

Future<bool> confirm(BuildContext context, String title, String body, {String ok = 'Confirm', bool danger = false}) async =>
    await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: danger ? FilledButton.styleFrom(backgroundColor: kRed, minimumSize: const Size(0, 40)) : FilledButton.styleFrom(minimumSize: const Size(0, 40)),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(ok),
          ),
        ],
      ),
    ) ??
    false;
