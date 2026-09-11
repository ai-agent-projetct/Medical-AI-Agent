import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:file_picker/file_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';

import '../db.dart';
import '../ui.dart';

const educationOptions = ['MBBS', 'BDS', 'BAMS', 'BHMS', 'BUMS', 'BPT', 'MD', 'MS', 'DNB', 'DM', 'MCh', 'MDS', 'MPT'];
const specializationOptions = [
  'General Physician', 'General Medicine', 'Family Medicine', 'Cardiology', 'Dermatology', 'Orthopedics',
  'Pediatrics', 'Gynecology', 'ENT', 'Ophthalmology', 'Neurology', 'Psychiatry', 'Dentistry', 'Diabetology',
  'Pulmonology', 'Gastroenterology', 'Nephrology', 'Oncology',
];
const languageOptions = ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Urdu'];

class _ChipsField extends StatelessWidget {
  const _ChipsField({required this.label, required this.icon, required this.values, required this.onTap});
  final String label;
  final IconData icon;
  final List<String> values;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon), suffixIcon: const Icon(Icons.keyboard_arrow_down)),
          isEmpty: values.isEmpty,
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final v in values)
              Chip(label: Text(v, style: const TextStyle(fontSize: 12)), visualDensity: VisualDensity.compact, padding: EdgeInsets.zero),
          ]),
        ),
      );
}

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key, this.firstTime = false});
  final bool firstTime;

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _hospital = TextEditingController();
  final _code = TextEditingController();
  final _years = TextEditingController();
  final _fee = TextEditingController();
  List<String> _education = [], _specs = [], _languages = [];
  String? _photoUrl, _email;
  bool _loading = true, _saving = false;

  @override
  void initState() {
    super.initState();
    Db.doctor().get().then((s) {
      final d = s.data() ?? {};
      setState(() {
        _name.text = d['name'] ?? '';
        _phone.text = d['phone'] ?? '';
        _hospital.text = d['hospital'] ?? '';
        _code.text = d['doctorCode'] ?? '';
        _years.text = '${d['practiceYears'] ?? ''}';
        _fee.text = '${d['fee'] ?? ''}';
        _education = List<String>.from(d['education'] ?? []);
        _specs = List<String>.from(d['specializations'] ?? []);
        _languages = List<String>.from(d['languages'] ?? []);
        _photoUrl = d['photoUrl'];
        _email = d['email'] ?? FirebaseAuth.instance.currentUser?.email;
        _loading = false;
      });
    });
  }

  Future<void> _pickPhoto() async {
    final res = await FilePicker.platform.pickFiles(type: FileType.image, withData: true);
    final file = res?.files.single;
    if (file?.bytes == null || !mounted) return;
    if (file!.size > 5 * 1024 * 1024) return snack(context, 'Photo must be under 5 MB.');
    await guard(context, () async {
      final ref = FirebaseStorage.instance.ref('doctors/$uid/avatar_${DateTime.now().millisecondsSinceEpoch}.${file.extension ?? 'jpg'}');
      await ref.putData(file.bytes!, SettableMetadata(contentType: 'image/${file.extension ?? 'jpeg'}'));
      final url = await ref.getDownloadURL();
      setState(() => _photoUrl = url);
    });
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_education.isEmpty || _specs.isEmpty) return snack(context, 'Select your education and specialization.');
    setState(() => _saving = true);
    final ok = await guard(context, () => Db.saveProfile({
          'name': _name.text.trim(),
          'phone': _phone.text.trim(),
          'hospital': _hospital.text.trim(),
          'doctorCode': _code.text.trim(),
          'practiceYears': int.tryParse(_years.text) ?? 0,
          'fee': int.tryParse(_fee.text) ?? 0,
          'education': _education,
          'specializations': _specs,
          'languages': _languages,
          'photoUrl': _photoUrl,
        }));
    if (!mounted) return;
    setState(() => _saving = false);
    if (ok && !widget.firstTime) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    const gap = SizedBox(height: 14);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Edit Profile'),
        automaticallyImplyLeading: !widget.firstTime,
        actions: [
          if (widget.firstTime)
            IconButton(tooltip: 'Log out', icon: const Icon(Icons.logout), onPressed: () => FirebaseAuth.instance.signOut()),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (widget.firstTime)
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: const Color(0xFFE9E6F8), borderRadius: BorderRadius.circular(10)),
              child: const Text('Complete your profile to continue.', textAlign: TextAlign.center, style: TextStyle(color: kPrimary)),
            ),
          const SizedBox(height: 16),
          Center(
            child: Stack(children: [
              Avatar(_name.text.isEmpty ? '?' : _name.text, size: 96, photoUrl: _photoUrl),
              Positioned(
                right: 0,
                bottom: 0,
                child: IconButton.filled(tooltip: 'Change photo', icon: const Icon(Icons.photo_camera, size: 18), onPressed: _pickPhoto),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Full Name', prefixIcon: Icon(Icons.person_outline)),
            validator: (v) => v!.trim().isEmpty ? 'Required' : null,
          ),
          gap,
          _ChipsField(label: 'Education', icon: Icons.school_outlined, values: _education, onTap: () async {
            final r = await pickMany(context, 'Select Education', educationOptions, _education);
            if (r != null) setState(() => _education = r);
          }),
          gap,
          _ChipsField(label: 'Specialization', icon: Icons.medical_services_outlined, values: _specs, onTap: () async {
            final r = await pickMany(context, 'Select Specialization', specializationOptions, _specs);
            if (r != null) setState(() => _specs = r);
          }),
          const SectionHeader('Personal Information'),
          TextFormField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Phone', prefixIcon: Icon(Icons.phone_outlined)),
          ),
          gap,
          TextFormField(
            initialValue: _email,
            enabled: false,
            decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
          ),
          const SectionHeader('Hospital Details'),
          TextFormField(
            controller: _hospital,
            decoration: const InputDecoration(labelText: 'Hospital Name', prefixIcon: Icon(Icons.local_hospital_outlined)),
            validator: (v) => v!.trim().isEmpty ? 'Required' : null,
          ),
          gap,
          TextFormField(
            controller: _code,
            decoration: const InputDecoration(labelText: 'Doctor ID / Registration No.', prefixIcon: Icon(Icons.badge_outlined)),
            validator: (v) => v!.trim().isEmpty ? 'Required' : null,
          ),
          gap,
          _ChipsField(label: 'Languages', icon: Icons.translate, values: _languages, onTap: () async {
            final r = await pickMany(context, 'Select Languages', languageOptions, _languages);
            if (r != null) setState(() => _languages = r);
          }),
          const SectionHeader('Experience & Fees'),
          Row(children: [
            Expanded(
              child: TextFormField(
                controller: _years,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Practice (years)', prefixIcon: Icon(Icons.calendar_today_outlined)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: _fee,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Fee (₹)', prefixIcon: Icon(Icons.currency_rupee)),
              ),
            ),
          ]),
          if (!widget.firstTime) ...[
            const SectionHeader('Advanced'),
            Card(
              child: ListTile(
                leading: const Icon(Icons.lock_outline),
                title: const Text('Change Password'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => guard(context, () => FirebaseAuth.instance.sendPasswordResetEmail(email: _email!), ok: 'Password reset link sent to $_email'),
              ),
            ),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Update Profile'),
          ),
        ]),
      ),
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _deleteAccount(BuildContext context) async {
    if (!await confirm(context, 'Delete account?', 'Your doctor profile and login will be removed. Appointment history stays with the hospital.',
        ok: 'Delete', danger: true)) {
      return;
    }
    if (!context.mounted) return;
    await guard(context, () async {
      final user = FirebaseAuth.instance.currentUser!;
      await Db.doctor().delete();
      await FirebaseFirestore.instance.doc('users/${user.uid}').delete();
      try {
        await user.delete();
      } on FirebaseAuthException catch (e) {
        if (e.code == 'requires-recent-login') {
          await FirebaseAuth.instance.signOut();
          throw Exception('Profile removed. Sign in again and repeat to delete the login itself.');
        }
        rethrow;
      }
    });
    if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Profile')),
        body: StreamBuilder(
          stream: Db.doctor().snapshots(),
          builder: (context, snap) {
            final d = snap.data?.data();
            if (d == null) return const Center(child: CircularProgressIndicator());
            Widget chips(List l) => Wrap(spacing: 6, children: [for (final x in l) Chip(label: Text('$x', style: const TextStyle(fontSize: 12)))]);
            return ListView(padding: const EdgeInsets.all(16), children: [
              Card(
                clipBehavior: Clip.antiAlias,
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: const BoxDecoration(gradient: LinearGradient(colors: [kPrimaryDark, kPrimary])),
                  child: Row(children: [
                    Avatar(d['name'] ?? '', size: 72, photoUrl: d['photoUrl']),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(d['name'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
                        Text('${d['qualification'] ?? ''} · ${d['specialization'] ?? ''}', style: const TextStyle(color: Colors.white70)),
                      ]),
                    ),
                  ]),
                ),
              ),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: StatCard(icon: Icons.work_history_outlined, value: '${d['practiceYears'] ?? 0}', label: 'Years practice')),
                const SizedBox(width: 10),
                Expanded(child: StatCard(icon: Icons.currency_rupee, value: '${d['fee'] ?? 0}', label: 'Consultation fee')),
              ]),
              const SectionHeader('Personal Information'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  child: Column(children: [
                    InfoRow(Icons.phone_outlined, 'Mobile', d['phone'] ?? '—'),
                    InfoRow(Icons.mail_outline, 'Email', d['email'] ?? '—'),
                    InfoRow(Icons.local_hospital_outlined, 'Hospital', d['hospital'] ?? '—'),
                    InfoRow(Icons.badge_outlined, 'Doctor ID', d['doctorCode'] ?? '—'),
                    Align(alignment: Alignment.centerLeft, child: chips(d['languages'] ?? [])),
                  ]),
                ),
              ),
              const SectionHeader('Account Settings'),
              Card(
                child: Column(children: [
                  ListTile(
                    leading: const Icon(Icons.person_outline),
                    title: const Text('Edit Profile'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const EditProfileScreen())),
                  ),
                  ListTile(
                    leading: const Icon(Icons.shield_outlined),
                    title: const Text('Privacy'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => showDialog(
                      context: context,
                      builder: (_) => const AlertDialog(
                        title: Text('Privacy'),
                        content: Text('Patient records are visible only to clinical staff of your hospital. '
                            'Video consultations are peer-to-peer rooms and are not recorded by this app.'),
                      ),
                    ),
                  ),
                  ListTile(
                    leading: const Icon(Icons.delete_outline, color: kRed),
                    title: const Text('Delete Account', style: TextStyle(color: kRed)),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _deleteAccount(context),
                  ),
                ]),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: kRed),
                onPressed: () async {
                  await FirebaseAuth.instance.signOut();
                  if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
                },
                icon: const Icon(Icons.logout),
                label: const Text('Log Out'),
              ),
            ]);
          },
        ),
      );
}
