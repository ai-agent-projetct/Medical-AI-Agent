import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../db.dart';
import '../ui.dart';
import 'pdb.dart';

/// Pharmacy: search, cart, prescription upload for Rx items, cash-on-delivery order.
class MedicinesScreen extends StatefulWidget {
  const MedicinesScreen({super.key});

  @override
  State<MedicinesScreen> createState() => _MedicinesScreenState();
}

class _MedicinesScreenState extends State<MedicinesScreen> {
  final _q = TextEditingController();
  final _cart = <String, int>{};
  late final _stream = PDb.catalog('medicines');

  @override
  Widget build(BuildContext context) => StreamBuilder<List<Json>>(
        stream: _stream,
        builder: (context, snap) {
          final all = snap.data ?? [];
          final q = _q.text.trim().toLowerCase();
          final list = all.where((m) => '${m['name']} ${m['category']}'.toLowerCase().contains(q)).toList();
          final items = [for (final m in all) if ((_cart[m['id']] ?? 0) > 0) {...m, 'qty': _cart[m['id']]}];
          final total = items.fold<num>(0, (s, i) => s + (i['price'] as num) * (i['qty'] as int));
          return Scaffold(
            appBar: AppBar(title: const Text('Order medicines'), actions: [
              IconButton(
                tooltip: 'My orders',
                icon: const Icon(Icons.receipt_long_outlined),
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const OrdersScreen())),
              ),
            ]),
            bottomNavigationBar: items.isEmpty
                ? null
                : SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: FilledButton(
                        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CheckoutScreen(kind: 'medicine', items: items)))
                            .then((placed) => placed == true ? setState(_cart.clear) : null),
                        child: Text('Checkout · ${items.length} item${items.length == 1 ? '' : 's'} · ₹$total'),
                      ),
                    ),
                  ),
            body: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: TextField(
                  controller: _q,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(hintText: 'Search medicines & health products', prefixIcon: Icon(Icons.search)),
                ),
              ),
              Expanded(
                child: !snap.hasData
                    ? const Center(child: CircularProgressIndicator())
                    : list.isEmpty
                        ? const EmptyState('No products found', icon: Icons.medication_outlined)
                        : ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [
                            for (final m in list)
                              Card(
                                child: ListTile(
                                  leading: const CircleAvatar(child: Icon(Icons.medication_outlined)),
                                  title: Text(m['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                                  subtitle: Text('${m['pack'] ?? ''}\n₹${m['price']}${m['rx'] == true ? '  ·  Rx required' : ''}'),
                                  isThreeLine: true,
                                  trailing: (_cart[m['id']] ?? 0) == 0
                                      ? OutlinedButton(onPressed: () => setState(() => _cart[m['id']] = 1), child: const Text('Add'))
                                      : Row(mainAxisSize: MainAxisSize.min, children: [
                                          IconButton(
                                              tooltip: 'Remove one',
                                              onPressed: () => setState(() => _cart[m['id']] = _cart[m['id']]! - 1),
                                              icon: const Icon(Icons.remove_circle_outline)),
                                          Text('${_cart[m['id']]}'),
                                          IconButton(
                                              tooltip: 'Add one',
                                              onPressed: () => setState(() => _cart[m['id']] = _cart[m['id']]! + 1),
                                              icon: const Icon(Icons.add_circle_outline)),
                                        ]),
                                ),
                              ),
                          ]),
              ),
            ]),
          );
        },
      );
}

/// Lab tests with home sample collection.
class LabTestsScreen extends StatelessWidget {
  const LabTestsScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Lab tests at home'), actions: [
          IconButton(
            tooltip: 'My orders',
            icon: const Icon(Icons.receipt_long_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const OrdersScreen())),
          ),
        ]),
        body: StreamBuilder<List<Json>>(
          stream: PDb.catalog('labTests'),
          builder: (context, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            if (snap.data!.isEmpty) return const EmptyState('No tests listed yet', icon: Icons.biotech_outlined);
            return ListView(padding: const EdgeInsets.all(16), children: [
              for (final t in snap.data!)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(t['name'] ?? '', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      Text('${t['includes'] ?? ''}', style: const TextStyle(color: kMuted)),
                      const SizedBox(height: 4),
                      Text('${t['prep'] ?? ''} · Report in ${t['tat'] ?? '24 hours'}', style: const TextStyle(fontSize: 12)),
                      const SizedBox(height: 8),
                      Row(children: [
                        Text('₹${t['price']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        const Spacer(),
                        FilledButton(
                          onPressed: () => Navigator.push(context, MaterialPageRoute(
                              builder: (_) => CheckoutScreen(kind: 'lab', items: [{...t, 'qty': 1}]))),
                          child: const Text('Book'),
                        ),
                      ]),
                    ]),
                  ),
                ),
            ]);
          },
        ),
      );
}

/// Address (+ collection slot for lab tests, prescription for Rx medicines), then place the order.
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key, required this.kind, required this.items});
  final String kind;
  final List<Json> items;

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _address = TextEditingController();
  String? _patientId;
  DateTime _date = today().add(const Duration(days: 1));
  String _slot = '07:00 AM - 09:00 AM';
  PlatformFile? _rx;
  bool _busy = false;

  bool get _lab => widget.kind == 'lab';
  bool get _needsRx => widget.items.any((i) => i['rx'] == true);

  Future<void> _place(List<QueryDocumentSnapshot<Json>> family) async {
    if (_address.text.trim().length < 10) return snack(context, 'Enter the full delivery address');
    if (_needsRx && _rx == null) return snack(context, 'Upload a prescription for the Rx medicines');
    final p = family.firstWhere((m) => m.id == _patientId).data();
    setState(() => _busy = true);
    final ok = await guard(context, () async {
      final rxUrl = _rx == null ? null : await PDb.uploadPrescription(_rx!.bytes!, _rx!.name);
      await PDb.placeOrder(
        kind: widget.kind,
        items: [for (final i in widget.items) {'id': i['id'], 'name': i['name'], 'price': i['price'], 'qty': i['qty'] ?? 1}],
        patientName: p['name'] ?? '',
        phone: p['phone'] ?? '',
        address: _address.text.trim(),
        date: _lab ? ymd(_date) : null,
        slot: _lab ? _slot : null,
        prescriptionUrl: rxUrl,
      );
    }, ok: _lab ? 'Test booked. A phlebotomist will visit on ${prettyDate(_date)}.' : 'Order placed');
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.items.fold<num>(0, (s, i) => s + (i['price'] as num) * ((i['qty'] as num?) ?? 1));
    return Scaffold(
      appBar: AppBar(title: Text(_lab ? 'Book lab test' : 'Checkout')),
      body: StreamBuilder<List<QueryDocumentSnapshot<Json>>>(
        stream: PDb.family(),
        builder: (context, fam) {
          final family = fam.data ?? [];
          if (family.isNotEmpty && !family.any((m) => m.id == _patientId)) _patientId = family.first.id;
          return ListView(padding: const EdgeInsets.all(16), children: [
            Card(
              child: Column(children: [
                for (final i in widget.items)
                  ListTile(dense: true, title: Text('${i['name']}'), trailing: Text('${i['qty'] ?? 1} × ₹${i['price']}')),
                ListTile(title: const Text('Total', style: TextStyle(fontWeight: FontWeight.w700)), trailing: Text('₹$total', style: const TextStyle(fontWeight: FontWeight.w700))),
              ]),
            ),
            SectionHeader(_lab ? 'Test for' : 'Order for'),
            Wrap(spacing: 8, children: [
              for (final m in family)
                ChoiceChip(label: Text('${m.data()['name']}'), selected: _patientId == m.id, onSelected: (_) => setState(() => _patientId = m.id)),
            ]),
            const SizedBox(height: 12),
            TextField(controller: _address, maxLines: 2, decoration: InputDecoration(labelText: _lab ? 'Sample collection address' : 'Delivery address')),
            if (_lab) ...[
              const SectionHeader('Collection slot'),
              OutlinedButton.icon(
                icon: const Icon(Icons.calendar_month),
                label: Text(prettyDate(_date)),
                onPressed: () async {
                  final d = await showDatePicker(context: context, initialDate: _date, firstDate: today(), lastDate: today().add(const Duration(days: 30)));
                  if (d != null) setState(() => _date = d);
                },
              ),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                for (final s in ['07:00 AM - 09:00 AM', '09:00 AM - 11:00 AM', '11:00 AM - 01:00 PM', '04:00 PM - 06:00 PM'])
                  ChoiceChip(label: Text(s), selected: _slot == s, onSelected: (_) => setState(() => _slot = s)),
              ]),
            ],
            if (_needsRx) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.upload_file),
                label: Text(_rx?.name ?? 'Upload prescription (required)'),
                onPressed: () async {
                  final r = await FilePicker.platform.pickFiles(withData: true, type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png']);
                  if (r != null) setState(() => _rx = r.files.single);
                },
              ),
            ],
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy || _patientId == null ? null : () => _place(family),
              child: Text('Place order · ₹$total (pay on ${_lab ? 'collection' : 'delivery'})'),
            ),
          ]);
        },
      ),
    );
  }
}

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('My orders')),
        body: StreamBuilder<List<QueryDocumentSnapshot<Json>>>(
          stream: PDb.myOrders(),
          builder: (context, snap) {
            if (snap.hasError) return Center(child: Text('${snap.error}'));
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            if (snap.data!.isEmpty) return const EmptyState('No orders yet', icon: Icons.receipt_long_outlined);
            return ListView(padding: const EdgeInsets.all(16), children: [
              for (final d in snap.data!)
                Card(
                  child: ListTile(
                    leading: CircleAvatar(child: Icon(d.data()['kind'] == 'lab' ? Icons.biotech_outlined : Icons.medication_outlined)),
                    title: Row(children: [
                      Expanded(child: Text(List<Map>.from(d.data()['items'] ?? []).map((i) => i['name']).join(', '), overflow: TextOverflow.ellipsis)),
                      StatusChip(d.data()['status'] ?? 'Placed'),
                    ]),
                    subtitle: Text('₹${d.data()['total']} · ${d.data()['patient']}'
                        '${d.data()['date'] != null ? ' · ${shortDate(d.data()['date'])} ${d.data()['slot']}' : ''}'),
                    trailing: d.data()['status'] == 'Placed'
                        ? TextButton(
                            onPressed: () async {
                              if (await confirm(context, 'Cancel order?', 'This order will be cancelled.', ok: 'Cancel order', danger: true) && context.mounted) {
                                await guard(context, () => d.reference.update({'status': 'Cancelled'}), ok: 'Order cancelled');
                              }
                            },
                            child: const Text('Cancel'),
                          )
                        : null,
                  ),
                ),
            ]);
          },
        ),
      );
}
