import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'db.dart';
import 'patient/pdb.dart';
import 'ui.dart';

/// Consultation chat on appointments/{id}/messages, used by both the patient and the doctor.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.appointmentId, required this.title, required this.myName});
  final String appointmentId, title, myName;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _text = TextEditingController();
  late final _stream = PDb.messages(widget.appointmentId);

  @override
  void initState() {
    super.initState();
    // A floating message from the previous screen (e.g. "Booked · Token #2") would cover the input box.
    WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) ScaffoldMessenger.of(context).hideCurrentSnackBar(); });
  }

  Future<void> _send() async {
    final t = _text.text.trim();
    if (t.isEmpty) return;
    _text.clear();
    await guard(context, () => PDb.send(widget.appointmentId, t, widget.myName));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.title)),
        body: Column(children: [
          Expanded(
            child: StreamBuilder<List<Json>>(
              stream: _stream,
              builder: (context, snap) {
                if (snap.hasError) return Center(child: Text('${snap.error}'));
                final msgs = snap.data ?? [];
                if (msgs.isEmpty) return const EmptyState('No messages yet. Say hello!', icon: Icons.chat_bubble_outline);
                return ListView(reverse: true, padding: const EdgeInsets.all(12), children: [
                  for (final m in msgs.reversed)
                    Align(
                      alignment: m['uid'] == uid ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.symmetric(vertical: 4),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        constraints: const BoxConstraints(maxWidth: 300),
                        decoration: BoxDecoration(
                          color: m['uid'] == uid ? kPrimary : Colors.white,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          if (m['uid'] != uid) Text(m['name'] ?? '', style: const TextStyle(fontSize: 11, color: kMuted)),
                          Text(m['text'] ?? '', style: TextStyle(color: m['uid'] == uid ? Colors.white : Colors.black87)),
                          Text(
                            m['at'] is Timestamp ? DateFormat('h:mm a').format((m['at'] as Timestamp).toDate()) : 'Sending…',
                            style: TextStyle(fontSize: 10, color: m['uid'] == uid ? Colors.white70 : kMuted),
                          ),
                        ]),
                      ),
                    ),
                ]);
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    decoration: const InputDecoration(hintText: 'Type a message'),
                  ),
                ),
                IconButton.filled(tooltip: 'Send', onPressed: _send, icon: const Icon(Icons.send)),
              ]),
            ),
          ),
        ]),
      );
}
