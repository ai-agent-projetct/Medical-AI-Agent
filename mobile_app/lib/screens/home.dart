import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../db.dart';
import '../ui.dart';
import 'bookings.dart';
import 'online.dart';
import 'profile.dart';
import 'records.dart';
import 'reports.dart';
import 'schedule.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  static const _tabs = [DashboardTab(), BookingsTab(), RecordsTab(), OnlineTab(), ScheduleTab(), ReportsTab()];

  @override
  Widget build(BuildContext context) => Scaffold(
        body: IndexedStack(index: _tab, children: _tabs),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.grid_view_outlined), selectedIcon: Icon(Icons.grid_view_rounded), label: 'Dashboard'),
            NavigationDestination(icon: Icon(Icons.event_note_outlined), selectedIcon: Icon(Icons.event_note), label: 'Bookings'),
            NavigationDestination(icon: Icon(Icons.folder_shared_outlined), selectedIcon: Icon(Icons.folder_shared), label: 'Records'),
            NavigationDestination(icon: Icon(Icons.videocam_outlined), selectedIcon: Icon(Icons.videocam), label: 'Online'),
            NavigationDestination(icon: Icon(Icons.schedule_outlined), selectedIcon: Icon(Icons.schedule), label: 'Schedule'),
            NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: 'Reports'),
          ],
        ),
      );
}

/// Bell (with unread dot) shown on every tab's app bar.
List<Widget> homeActions(BuildContext context) => [
      StreamBuilder<QuerySnapshot<Json>>(
        stream: Db.notifications.where('userId', isEqualTo: uid).where('read', isEqualTo: false).limit(1).snapshots(),
        builder: (context, snap) => IconButton(
          tooltip: 'Notifications',
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen())),
          icon: Badge(isLabelVisible: snap.data?.docs.isNotEmpty ?? false, smallSize: 8, child: const Icon(Icons.notifications_none)),
        ),
      ),
    ];

Future<void> callPatient(BuildContext context, String phone) async {
  if (phone.isEmpty) return snack(context, 'No phone number on file.');
  if (!await launchUrl(Uri.parse('tel:${phone.replaceAll(' ', '')}')) && context.mounted) snack(context, 'Could not start a call.');
}

class DashboardTab extends StatelessWidget {
  const DashboardTab({super.key});

  @override
  Widget build(BuildContext context) => StreamBuilder(
        stream: Db.doctor().snapshots(),
        builder: (context, docSnap) {
          final me = docSnap.data?.data() ?? {};
          return Scaffold(
            appBar: AppBar(
              titleSpacing: 12,
              title: Row(children: [
                InkWell(
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfileScreen())),
                  customBorder: const CircleBorder(),
                  child: Avatar(me['name'] ?? '', size: 36, photoUrl: me['photoUrl']),
                ),
                const SizedBox(width: 10),
                const Text('Dashboard'),
              ]),
              actions: homeActions(context),
            ),
            body: StreamBuilder<List<Appt>>(
              stream: Db.myDay(ymd(DateTime.now())),
              builder: (context, snap) {
                if (snap.hasError) return Center(child: Text('${snap.error}'));
                final all = (snap.data ?? []).where((a) => a.status != 'Cancelled').toList();
                final done = all.where((a) => a.status == 'Completed').length;
                final open = all.where((a) => a.isOpen).toList();
                final next = open.isEmpty ? null : open.first;
                final serving = all.where((a) => a.status == 'In Consultation').map((a) => a.token).firstOrNull;
                final pct = all.isEmpty ? 0 : (done * 100 / all.length).round();
                return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
                  _WelcomeCard(me: me, done: done, total: all.length),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: MediaQuery.of(context).size.width > 700 ? 4 : 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 1.45,
                    children: [
                      StatCard(icon: Icons.calendar_today_outlined, value: '${all.length}', label: 'Appointments', badge: 'Today', badgeColor: kMuted),
                      StatCard(icon: Icons.videocam_outlined, value: '${all.where((a) => a.online).length}', label: 'Online consults'),
                      StatCard(
                        icon: Icons.schedule,
                        value: next?.time ?? '—',
                        label: 'Next appointment',
                        badge: next == null ? null : untilLabel(next.start),
                        badgeColor: kOrange,
                      ),
                      StatCard(icon: Icons.check_circle_outline, value: '$done', label: 'Completed', badge: '$pct%'),
                    ],
                  ),
                  SectionHeader('Upcoming Appointment',
                      trailing: TextButton(onPressed: () => _openBookings(context), child: const Text('View all ›'))),
                  if (next == null)
                    const Card(child: EmptyState('No more appointments today', icon: Icons.event_available))
                  else
                    _NextCard(next),
                  SectionHeader('Today\'s Queue',
                      trailing: serving == null ? null : Text('Now serving #$serving', style: const TextStyle(color: kMuted, fontSize: 12))),
                  if (open.isEmpty) const Card(child: EmptyState('Queue is empty')),
                  for (final a in open)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ApptTile(a, onTap: () => openAppointment(context, a.id)),
                    ),
                ]);
              },
            ),
          );
        },
      );

  void _openBookings(BuildContext context) => Navigator.push(context, MaterialPageRoute(builder: (_) => const BookingsTab()));
}

class _WelcomeCard extends StatelessWidget {
  const _WelcomeCard({required this.me, required this.done, required this.total});
  final Json me;
  final int done, total;

  @override
  Widget build(BuildContext context) {
    final available = me['available'] != false;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [kPrimaryDark, kPrimary, Color(0xFF5B3FD9)]),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(DateFormat('EEEE · MMM d, y').format(DateTime.now()).toUpperCase(),
              style: const TextStyle(color: Colors.white70, fontSize: 11, letterSpacing: 0.5)),
          const Spacer(),
          ActionChip(
            tooltip: 'Toggle availability',
            onPressed: () => guard(context, () => Db.doctor().update({'available': !available})),
            avatar: Icon(Icons.circle, size: 10, color: available ? Colors.greenAccent : Colors.white54),
            label: Text(available ? 'Available' : 'Away', style: const TextStyle(color: Colors.white, fontSize: 12)),
            backgroundColor: Colors.white.withValues(alpha: 0.15),
            side: BorderSide.none,
          ),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Avatar(me['name'] ?? '', size: 52, photoUrl: me['photoUrl']),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Welcome back,', style: TextStyle(color: Colors.white70)),
              Text(me['name'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
              Text(me['specialization'] ?? '', style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ]),
          ),
        ]),
        const SizedBox(height: 16),
        Row(children: [
          const Text("Today's progress", style: TextStyle(color: Colors.white70, fontSize: 12)),
          const Spacer(),
          Text('$done of $total done', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12)),
        ]),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: total == 0 ? 0 : done / total,
            minHeight: 6,
            backgroundColor: Colors.white24,
            color: Colors.white,
          ),
        ),
      ]),
    );
  }
}

class _NextCard extends StatelessWidget {
  const _NextCard(this.a);
  final Appt a;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(children: [
            Row(children: [
              Avatar(a.patient),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${a.patient}   Token #${a.token}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text('${a.time} · ${a.visitType}${a.online ? ' · Video' : ''}', style: const TextStyle(color: kMuted, fontSize: 12)),
                ]),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: const Color(0xFFFFEDD5), borderRadius: BorderRadius.circular(8)),
                child: Text(untilLabel(a.start), style: const TextStyle(color: kOrange, fontSize: 11, fontWeight: FontWeight.w600)),
              ),
            ]),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(42)),
                  onPressed: () => openAppointment(context, a.id),
                  child: const Text('View Details'),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.outlined(tooltip: 'Call patient', onPressed: () => callPatient(context, a.phone), icon: const Icon(Icons.call_outlined)),
              if (a.online) ...[
                const SizedBox(width: 4),
                IconButton.outlined(tooltip: 'Start video', onPressed: () => startVideoConsultation(context, a), icon: const Icon(Icons.videocam_outlined)),
              ],
            ]),
          ]),
        ),
      );
}

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final q = Db.notifications.where('userId', isEqualTo: uid).orderBy('createdAt', descending: true).limit(50);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: StreamBuilder<QuerySnapshot<Json>>(
        stream: q.snapshots(),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final docs = snap.data?.docs ?? [];
          return ListView(padding: const EdgeInsets.all(16), children: [
            const Text('Stay in the loop', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
            const Text('Updates on your clinical activity', style: TextStyle(color: kMuted)),
            Row(children: [
              const Text('SYSTEM UPDATES', style: TextStyle(color: kMuted, fontSize: 11)),
              const Spacer(),
              TextButton(
                onPressed: () => guard(context, () async {
                  final batch = FirebaseFirestore.instance.batch();
                  for (final d in docs.where((d) => d['read'] != true)) {
                    batch.update(d.reference, {'read': true});
                  }
                  await batch.commit();
                }),
                child: const Text('Mark all read'),
              ),
            ]),
            if (docs.isEmpty) const EmptyState('No notifications yet', icon: Icons.notifications_none),
            for (final d in docs)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: d['read'] == true ? BorderSide.none : const BorderSide(color: kOrange, width: 1),
                ),
                child: ListTile(
                  leading: const Icon(Icons.event_note, color: kOrange),
                  title: Text(d['title'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(d['body'] ?? ''),
                  trailing: Text(
                    d['createdAt'] == null ? 'Just now' : DateFormat('MMM d, h:mm a').format((d['createdAt'] as Timestamp).toDate()),
                    style: const TextStyle(fontSize: 11, color: kMuted),
                  ),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
