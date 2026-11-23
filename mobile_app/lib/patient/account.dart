import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../db.dart';
import '../ui.dart';
import 'pdb.dart';
import 'reminders.dart';
import 'shop.dart';

class AccountTab extends StatelessWidget {
  const AccountTab({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Account')),
        body: StreamBuilder<List<QueryDocumentSnapshot<Json>>>(
          stream: PDb.family(),
          builder: (context, snap) {
            final family = snap.data ?? [];
            return ListView(padding: const EdgeInsets.all(16), children: [
              const SectionHeader('Family profiles'),
              for (final m in family)
                Card(
                  child: ListTile(
                    leading: Avatar(m.data()['name'] ?? ''),
                    title: Text(m.data()['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text([m.data()['relation'], m.data()['gender'], m.data()['dob'], m.data()['bloodGroup']]
                        .where((x) => '${x ?? ''}'.isNotEmpty)
                        .join(' · ')),
                    trailing: const Icon(Icons.edit_outlined),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => MemberScreen(id: m.id, initial: m.data()))),
                  ),
                ),
              OutlinedButton.icon(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MemberScreen())),
                icon: const Icon(Icons.person_add_alt),
                label: const Text('Add family member'),
              ),
              const SectionHeader('More'),
              Card(
                child: Column(children: [
                  ListTile(
                    leading: const Icon(Icons.alarm),
                    title: const Text('Medicine reminders'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RemindersScreen())),
                  ),
                  ListTile(
                    leading: const Icon(Icons.receipt_long_outlined),
                    title: const Text('Medicine & lab orders'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const OrdersScreen())),
                  ),
                  ListTile(
                    leading: const Icon(Icons.delete_outline),
                    title: const Text('Request deletion of my data'),
                    subtitle: const Text('The hospital reviews it; medical records may need to be kept for the legal retention period.'),
                    onTap: () async {
                      if (!await confirm(context, 'Request data deletion?',
                          'The hospital will review your request and contact you. You can keep using the app meanwhile.', ok: 'Send request')) {
                        return;
                      }
                      if (!context.mounted) return;
                      await guard(context, () => FirebaseFirestore.instance.doc('deletionRequests/$uid').set({
                            'uid': uid,
                            'email': FirebaseAuth.instance.currentUser?.email,
                            'phone': FirebaseAuth.instance.currentUser?.phoneNumber,
                            'status': 'Pending',
                            'at': FieldValue.serverTimestamp(),
                          }), ok: 'Request sent');
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.logout, color: kRed),
                    title: const Text('Log out', style: TextStyle(color: kRed)),
                    onTap: () => FirebaseAuth.instance.signOut(),
                  ),
                ]),
              ),
            ]);
          },
        ),
      );
}

/// Add or edit a profile (self or a family member).
class MemberScreen extends StatefulWidget {
  const MemberScreen({super.key, this.id, this.initial = const {}});
  final String? id;
  final Json initial;

  @override
  State<MemberScreen> createState() => _MemberScreenState();
}

class _MemberScreenState extends State<MemberScreen> {
  late final _name = TextEditingController(text: widget.initial['name']);
  late final _phone = TextEditingController(text: widget.initial['phone']);
  late final _dob = TextEditingController(text: widget.initial['dob']);
  late final _allergies = TextEditingController(text: widget.initial['allergies']);
  late final _conditions = TextEditingController(text: widget.initial['conditions']);
  late String _relation = widget.initial['relation'] ?? 'Spouse';
  late String? _gender = widget.initial['gender'];
  late String? _blood = widget.initial['bloodGroup'];
  bool get _self => widget.id == uid;

  Future<void> _save() async {
    if (_name.text.trim().length < 2) return snack(context, 'Enter a name');
    final ok = await guard(context, () => PDb.saveMember(widget.id, {
          'name': _name.text.trim(),
          'phone': _phone.text.trim(),
          'dob': _dob.text.trim(),
          'gender': _gender,
          'bloodGroup': _blood,
          'allergies': _allergies.text.trim(),
          'conditions': _conditions.text.trim(),
          'relation': _self ? 'Self' : _relation,
        }), ok: 'Saved');
    if (ok && mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.id == null ? 'Add family member' : 'Edit profile')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name')),
          const SizedBox(height: 12),
          if (!_self) ...[
            DropdownButtonFormField<String>(
              initialValue: _relation,
              decoration: const InputDecoration(labelText: 'Relation'),
              items: [for (final r in ['Spouse', 'Child', 'Parent', 'Sibling', 'Other']) DropdownMenuItem(value: r, child: Text(r))],
              onChanged: (v) => setState(() => _relation = v!),
            ),
            const SizedBox(height: 12),
          ],
          TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Mobile number')),
          const SizedBox(height: 12),
          TextField(controller: _dob, decoration: const InputDecoration(labelText: 'Date of birth (YYYY-MM-DD)')),
          const SizedBox(height: 12),
          Wrap(spacing: 8, children: [
            for (final g in ['Male', 'Female', 'Other'])
              ChoiceChip(label: Text(g), selected: _gender == g, onSelected: (_) => setState(() => _gender = g)),
          ]),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _blood,
            decoration: const InputDecoration(labelText: 'Blood group'),
            items: [for (final b in ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) DropdownMenuItem(value: b, child: Text(b))],
            onChanged: (v) => setState(() => _blood = v),
          ),
          const SizedBox(height: 12),
          TextField(controller: _allergies, decoration: const InputDecoration(labelText: 'Allergies')),
          const SizedBox(height: 12),
          TextField(controller: _conditions, decoration: const InputDecoration(labelText: 'Ongoing conditions')),
          const SizedBox(height: 20),
          FilledButton(onPressed: _save, child: const Text('Save')),
        ]),
      );
}
