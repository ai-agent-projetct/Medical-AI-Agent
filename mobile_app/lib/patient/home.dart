import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../db.dart';
import '../screens/home.dart' show homeActions;
import '../ui.dart';
import 'account.dart';
import 'appointments.dart';
import 'doctors.dart';
import 'pdb.dart';
import 'records.dart';
import 'reminders.dart';
import 'shop.dart';

/// Patient side of the app: Home · Doctors · Appointments · Records · Account.
class PatientShell extends StatefulWidget {
  const PatientShell({super.key});

  @override
  State<PatientShell> createState() => _PatientShellState();
}

class _PatientShellState extends State<PatientShell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    rescheduleReminders().catchError((Object e) => debugPrint('reminders: $e')); // re-arm after install/restore
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: IndexedStack(index: _tab, children: [
          PatientHomeTab(onTab: (i) => setState(() => _tab = i)),
          const DoctorSearchScreen(embedded: true),
          const MyAppointmentsTab(),
          const MyRecordsTab(),
          const AccountTab(),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.medical_services_outlined), selectedIcon: Icon(Icons.medical_services), label: 'Doctors'),
            NavigationDestination(icon: Icon(Icons.event_note_outlined), selectedIcon: Icon(Icons.event_note), label: 'Appointments'),
            NavigationDestination(icon: Icon(Icons.folder_shared_outlined), selectedIcon: Icon(Icons.folder_shared), label: 'Records'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Account'),
          ],
        ),
      );
}

const _specialtyIcons = {
  'General Physician': Icons.medical_services_outlined,
  'Gynecology': Icons.pregnant_woman,
  'Dermatology': Icons.face_retouching_natural,
  'Pediatrics': Icons.child_care,
  'Dentistry': Icons.mood,
  'Orthopedics': Icons.accessibility_new,
  'Psychiatry': Icons.psychology_outlined,
  'Cardiology': Icons.favorite_border,
  'ENT': Icons.hearing,
  'Ophthalmology': Icons.visibility_outlined,
  'Diabetology': Icons.bloodtype_outlined,
  'Gastroenterology': Icons.restaurant,
};

class PatientHomeTab extends StatelessWidget {
  const PatientHomeTab({super.key, required this.onTab});
  final ValueChanged<int> onTab;

  void _go(BuildContext context, Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: StreamBuilder<DocumentSnapshot<Json>>(
            stream: PDb.me.snapshots(),
            builder: (context, s) => Text('Hi, ${('${s.data?.data()?['name'] ?? ''}').split(' ').first} 👋'),
          ),
          actions: homeActions(context),
        ),
        body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
          // Search box opens the doctor finder.
          Card(
            child: ListTile(
              leading: const Icon(Icons.search, color: kPrimary),
              title: const Text('Search doctors, specialities, hospitals', style: TextStyle(color: kMuted)),
              onTap: () => _go(context, const DoctorSearchScreen()),
            ),
          ),
          const SizedBox(height: 8),
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 1.05,
            children: [
              _Action(Icons.local_hospital_outlined, 'Book clinic visit', kPrimary, () => onTab(1)),
              _Action(Icons.videocam_outlined, 'Video consult', kBlue, () => _go(context, const DoctorSearchScreen(onlineOnly: true))),
              _Action(Icons.medication_outlined, 'Order medicines', kGreen, () => _go(context, const MedicinesScreen())),
              _Action(Icons.biotech_outlined, 'Lab tests', kOrange, () => _go(context, const LabTestsScreen())),
              _Action(Icons.folder_shared_outlined, 'Health records', const Color(0xFF9333EA), () => onTab(3)),
              _Action(Icons.apartment_outlined, 'Hospitals', kRed, () => _go(context, const HospitalsScreen())),
              _Action(Icons.alarm, 'Medicine reminders', kGreen, () => _go(context, const RemindersScreen())),
              _Action(Icons.receipt_long_outlined, 'My orders', kBlue, () => _go(context, const OrdersScreen())),
              _Action(Icons.family_restroom, 'Family', kOrange, () => onTab(4)),
            ],
          ),
          const SectionHeader('Not feeling well? Pick a symptom'),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final e in symptomSpecialty.entries)
              ActionChip(
                label: Text(e.key),
                onPressed: () => _go(context, DoctorSearchScreen(specialty: e.value, title: '${e.key} · ${e.value}')),
              ),
          ]),
          const SectionHeader('Find doctors by speciality'),
          GridView.count(
            crossAxisCount: 4,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 0.85,
            children: [
              for (final e in _specialtyIcons.entries)
                InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => _go(context, DoctorSearchScreen(specialty: e.key)),
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    CircleAvatar(radius: 24, backgroundColor: const Color(0xFFE9E3FF), child: Icon(e.value, color: kPrimary)),
                    const SizedBox(height: 6),
                    Text(e.key, textAlign: TextAlign.center, maxLines: 2, style: const TextStyle(fontSize: 11)),
                  ]),
                ),
            ],
          ),
          SectionHeader('Upcoming', trailing: TextButton(onPressed: () => onTab(2), child: const Text('See all'))),
          StreamBuilder<List<Appt>>(
            stream: PDb.myAppointments(),
            builder: (context, snap) {
              final next = (snap.data ?? []).where((a) => a.isOpen).toList()..sort((a, b) => a.start.compareTo(b.start));
              if (next.isEmpty) return const Card(child: ListTile(leading: Icon(Icons.event_available), title: Text('No upcoming appointments')));
              return PatientApptTile(next.first);
            },
          ),
          const SectionHeader('Health articles'),
          StreamBuilder<List<Json>>(
            stream: PDb.catalog('articles'),
            builder: (context, snap) => Column(children: [
              for (final a in snap.data ?? const <Json>[])
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.article_outlined, color: kPrimary),
                    title: Text(a['title'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${a['category'] ?? ''} · ${a['minutes'] ?? 3} min read'),
                    onTap: () => _go(context, ArticleScreen(a)),
                  ),
                ),
            ]),
          ),
        ]),
      );
}

class _Action extends StatelessWidget {
  const _Action(this.icon, this.label, this.color, this.onTap);
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
        margin: EdgeInsets.zero,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, color: color, size: 30),
            const SizedBox(height: 8),
            Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
}

class ArticleScreen extends StatelessWidget {
  const ArticleScreen(this.a, {super.key});
  final Json a;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(a['category'] ?? 'Article')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          Text(a['title'] ?? '', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text('${a['minutes'] ?? 3} min read', style: const TextStyle(color: kMuted)),
          const SizedBox(height: 16),
          Text(a['body'] ?? '', style: const TextStyle(fontSize: 16, height: 1.5)),
          const SizedBox(height: 24),
          const Text('For information only. It does not replace advice from your doctor.', style: TextStyle(color: kMuted, fontSize: 12)),
        ]),
      );
}
