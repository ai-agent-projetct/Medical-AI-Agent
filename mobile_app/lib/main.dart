import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import 'config.dart';
import 'db.dart';
import 'firebase_options.dart';
import 'patient/home.dart';
import 'patient/pdb.dart';
import 'screens/auth.dart';
import 'screens/home.dart';
import 'screens/profile.dart';
import 'ui.dart';

const _emulatorOptions = FirebaseOptions(
  apiKey: 'demo-key',
  appId: '1:1:web:1',
  messagingSenderId: '1',
  projectId: 'demo-medical-ai',
  storageBucket: 'demo-medical-ai.appspot.com',
);
// ignore: unused_element
SemanticsHandle? _semantics;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp(options: useEmulators ? _emulatorOptions : DefaultFirebaseOptions.currentPlatform);
    if (useEmulators) {
      // Android emulator reaches the host machine at 10.0.2.2.
      final host = !kIsWeb && defaultTargetPlatform == TargetPlatform.android ? '10.0.2.2' : '127.0.0.1';
      await FirebaseAuth.instance.useAuthEmulator(host, 9099);
      FirebaseFirestore.instance.useFirestoreEmulator(host, 8181);
      await FirebaseStorage.instance.useStorageEmulator(host, 9199);
      functions.useFunctionsEmulator(host, 5001);
      _semantics = SemanticsBinding.instance.ensureSemantics(); // exposes widgets to browser test tooling
    }
  } catch (e) {
    runApp(MaterialApp(home: Scaffold(body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('$e'))))));
    return;
  }
  runApp(const App());
}

/// Root navigator, so signing out can close any screens left open on top of the old session.
final navigatorKey = GlobalKey<NavigatorState>();

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        navigatorKey: navigatorKey,
        title: 'AI Hospital Agent',
        debugShowCheckedModeBanner: false,
        theme: appTheme,
        home: StreamBuilder<User?>(
          stream: FirebaseAuth.instance.authStateChanges(),
          builder: (context, auth) {
            if (auth.connectionState == ConnectionState.waiting) return const SplashScreen();
            if (auth.data == null) {
              // Logged out (or session expired): drop screens pushed during the old session.
              WidgetsBinding.instance.addPostFrameCallback((_) => navigatorKey.currentState?.popUntil((r) => r.isFirst));
              return const LoginScreen();
            }
            return _RoleGate(key: ValueKey(auth.data!.uid));
          },
        ),
      );
}

/// One app, two sides: users/{uid}.role decides between the patient app and the doctor app.
/// No role doc yet (first Google sign-in) → ask which side the user is on.
class _RoleGate extends StatelessWidget {
  const _RoleGate({super.key});

  @override
  Widget build(BuildContext context) => StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: FirebaseFirestore.instance.doc('users/${FirebaseAuth.instance.currentUser!.uid}').snapshots(),
        builder: (context, snap) {
          if (snap.hasError) return _ErrorScreen('${snap.error}');
          if (!snap.hasData) return const SplashScreen();
          if (!snap.data!.exists) return const _ChooseRoleScreen();
          return switch (snap.data!.data()?['role']) {
            'patient' => const PatientShell(),
            'doctor' => const _DoctorGate(),
            _ => const _ErrorScreen('This account is for hospital staff. Please use the web portal.'),
          };
        },
      );
}

class _ChooseRoleScreen extends StatefulWidget {
  const _ChooseRoleScreen();

  @override
  State<_ChooseRoleScreen> createState() => _ChooseRoleScreenState();
}

/// First sign-in via Google or mobile OTP: name (if the provider gave none), role and consent.
class _ChooseRoleScreenState extends State<_ChooseRoleScreen> {
  final _user = FirebaseAuth.instance.currentUser!;
  late final _name = TextEditingController(text: _user.displayName ?? '');
  bool _agree = false;

  Future<void> _pick(bool doctor) async {
    if (_name.text.trim().length < 2) return snack(context, 'Enter your name');
    if (!_agree) return snack(context, 'Please accept the Terms & Privacy Policy.');
    final (name, email, phone) = (_name.text.trim(), _user.email ?? '', _user.phoneNumber ?? '');
    await guard(context, () => doctor
        ? Db.createAccount(name: name, email: email, phone: phone)
        : PDb.createAccount(name: name, email: email, phone: phone));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: ListView(padding: const EdgeInsets.all(24), shrinkWrap: true, children: [
              const Text('How will you use the app?', textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 16),
              TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full Name')),
              CheckboxListTile(
                value: _agree,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text('I agree to the Terms & Conditions and consent to my health data being processed as described in the Privacy Policy.',
                    style: TextStyle(fontSize: 13)),
                onChanged: (v) => setState(() => _agree = v!),
              ),
              FilledButton.icon(onPressed: () => _pick(false), icon: const Icon(Icons.favorite_border), label: const Text("I'm a patient")),
              const SizedBox(height: 10),
              OutlinedButton.icon(onPressed: () => _pick(true), icon: const Icon(Icons.medical_services_outlined), label: const Text("I'm a doctor")),
              TextButton(onPressed: () => FirebaseAuth.instance.signOut(), child: const Text('Log out')),
            ]),
          ),
        ),
      );
}

class _ErrorScreen extends StatelessWidget {
  const _ErrorScreen(this.message);
  final String message;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(message, textAlign: TextAlign.center),
              TextButton(onPressed: () => FirebaseAuth.instance.signOut(), child: const Text('Log out')),
            ]),
          ),
        ),
      );
}

/// Routes a signed-in doctor to profile setup or home. A failed profile read shows a retry
/// instead of an endless splash screen.
class _DoctorGate extends StatefulWidget {
  const _DoctorGate();

  @override
  State<_DoctorGate> createState() => _DoctorGateState();
}

class _DoctorGateState extends State<_DoctorGate> {
  late var _stream = Db.doctor().snapshots();

  @override
  Widget build(BuildContext context) => StreamBuilder(
        stream: _stream,
        builder: (context, doc) {
          if (doc.hasError) {
            return Scaffold(
              body: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.cloud_off, size: 48, color: kMuted),
                    const SizedBox(height: 12),
                    Text('Could not load your profile.\n${doc.error}', textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    FilledButton(onPressed: () => setState(() => _stream = Db.doctor().snapshots()), child: const Text('Retry')),
                    TextButton(onPressed: () => FirebaseAuth.instance.signOut(), child: const Text('Log out')),
                  ]),
                ),
              ),
            );
          }
          if (!doc.hasData) return const SplashScreen();
          if (doc.data!.data()?['profileComplete'] != true) return const EditProfileScreen(firstTime: true);
          return const HomeShell();
        },
      );
}
