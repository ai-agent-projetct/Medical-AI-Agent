import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../db.dart';
import '../patient/pdb.dart';
import '../ui.dart';

final _auth = FirebaseAuth.instance;

String _authMessage(Object e) => switch (e) {
      FirebaseAuthException(code: 'invalid-credential' || 'wrong-password' || 'user-not-found') => 'Wrong email or password.',
      FirebaseAuthException(code: 'email-already-in-use') => 'An account already exists for this email.',
      FirebaseAuthException(code: 'weak-password') => 'Password must be at least 6 characters.',
      FirebaseAuthException(code: 'invalid-email') => 'Enter a valid email address.',
      FirebaseAuthException(code: 'invalid-verification-code') => 'Wrong OTP. Check the SMS and try again.',
      FirebaseAuthException(code: 'too-many-requests') => 'Too many attempts. Please wait a few minutes.',
      FirebaseAuthException(code: 'invalid-phone-number') => 'Enter a valid mobile number.',
      FirebaseAuthException(:final message) => message ?? 'Sign-in failed.',
      _ => '$e',
    };

class Logo extends StatelessWidget {
  const Logo({super.key, this.size = 72});
  final double size;

  @override
  Widget build(BuildContext context) => Column(children: [
        Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [kPrimary, Color(0xFF5B3FD9)]),
            borderRadius: BorderRadius.circular(size * 0.28),
          ),
          child: Icon(Icons.health_and_safety, color: Colors.white, size: size * 0.55),
        ),
        const SizedBox(height: 10),
        const Text('AI Hospital Agent', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: kPrimary)),
      ]);
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: Colors.white,
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Logo(size: 84),
            SizedBox(height: 6),
            Text('— 24 | 7 —', style: TextStyle(color: kMuted)),
            SizedBox(height: 24),
            Text('Your Health. Simplified.', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
            SizedBox(height: 28),
            SizedBox(width: 140, child: LinearProgressIndicator()),
          ]),
        ),
      );
}

Future<void> _google(BuildContext context) async {
  await guard(context, () async {
    final provider = GoogleAuthProvider();
    // First-time users pick patient/doctor on the role screen (main.dart) once signed in.
    kIsWeb ? await _auth.signInWithPopup(provider) : await _auth.signInWithProvider(provider);
  });
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false, _hide = true;

  Future<void> _login() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await _auth.signInWithEmailAndPassword(email: _email.text.trim(), password: _password.text);
    } catch (e) {
      if (mounted) snack(context, _authMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _forgot() async {
    if (_email.text.trim().isEmpty) return snack(context, 'Enter your email first.');
    await guard(context, () => _auth.sendPasswordResetEmail(email: _email.text.trim()), ok: 'Password reset email sent.');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _form,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const Logo(),
                    const SizedBox(height: 28),
                    const Text('Welcome Back!', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
                    const Text('Login to access your healthcare dashboard and manage your appointments.', style: TextStyle(color: kMuted)),
                    const SizedBox(height: 24),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.person_outline)),
                      validator: (v) => v!.contains('@') ? null : 'Enter your email',
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: _hide,
                      autofillHints: const [AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: _hide ? 'Show password' : 'Hide password',
                          icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          onPressed: () => setState(() => _hide = !_hide),
                        ),
                      ),
                      validator: (v) => v!.isEmpty ? 'Enter your password' : null,
                      onFieldSubmitted: (_) => _login(),
                    ),
                    Align(alignment: Alignment.centerRight, child: TextButton(onPressed: _forgot, child: const Text('Forgot Password?'))),
                    FilledButton(
                      onPressed: _busy ? null : _login,
                      child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Login  →'),
                    ),
                    const SizedBox(height: 20),
                    const Row(children: [
                      Expanded(child: Divider()),
                      Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Text('OR CONTINUE WITH', style: TextStyle(color: kMuted, fontSize: 11))),
                      Expanded(child: Divider()),
                    ]),
                    const SizedBox(height: 16),
                    OutlinedButton.icon(
                      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PhoneLoginScreen())),
                      icon: const Icon(Icons.sms_outlined),
                      label: const Text('Login with mobile OTP'),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: () => _google(context),
                      icon: const Text('G', style: TextStyle(color: Colors.red, fontWeight: FontWeight.w800, fontSize: 18)),
                      label: const Text('Continue with Google'),
                    ),
                    const SizedBox(height: 18),
                    Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Text("Don't have an account?", style: TextStyle(color: kMuted)),
                      TextButton(
                        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SignupScreen())),
                        child: const Text('Sign Up'),
                      ),
                    ]),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );
}

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _agree = false, _busy = false, _doctor = false;

  Future<void> _create() async {
    if (!_form.currentState!.validate()) return;
    if (!_agree) return snack(context, 'Please accept the Terms & Conditions.');
    setState(() => _busy = true);
    try {
      final cred = await _auth.createUserWithEmailAndPassword(email: _email.text.trim(), password: _password.text);
      final (name, email, phone) = (_name.text.trim(), _email.text.trim(), '+91 ${_phone.text.trim()}');
      await (_doctor ? Db.createAccount(name: name, email: email, phone: phone) : PDb.createAccount(name: name, email: email, phone: phone));
      await cred.user!.updateDisplayName(name);
      await cred.user!.sendEmailVerification();
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      if (mounted) snack(context, _authMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(backgroundColor: Colors.white),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _form,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const Logo(size: 60),
                    const SizedBox(height: 24),
                    SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(value: false, label: Text("I'm a patient"), icon: Icon(Icons.favorite_border)),
                        ButtonSegment(value: true, label: Text("I'm a doctor"), icon: Icon(Icons.medical_services_outlined)),
                      ],
                      selected: {_doctor},
                      onSelectionChanged: (v) => setState(() => _doctor = v.first),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _name,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'Full Name', prefixIcon: Icon(Icons.person_outline)),
                      validator: (v) => v!.trim().length < 2 ? 'Enter your name' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _phone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Mobile Number', prefixText: '🇮🇳 +91  '),
                      validator: (v) => RegExp(r'^\d{10}$').hasMatch(v!.trim()) ? null : 'Enter a 10-digit mobile number',
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
                      validator: (v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v!.trim()) ? null : 'Enter a valid email',
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      decoration: const InputDecoration(labelText: 'Create a password', prefixIcon: Icon(Icons.lock_outline)),
                      validator: (v) => v!.length < 8 ? 'Use at least 8 characters' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _confirm,
                      obscureText: true,
                      decoration: const InputDecoration(labelText: 'Confirm Password', prefixIcon: Icon(Icons.lock_outline)),
                      validator: (v) => v != _password.text ? 'Passwords do not match' : null,
                    ),
                    CheckboxListTile(
                      value: _agree,
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: const Text('I agree to the Terms & Conditions and Privacy Policy of AI Hospital Agent.', style: TextStyle(fontSize: 13)),
                      onChanged: (v) => setState(() => _agree = v!),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: _busy ? null : _create,
                      child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Create Account  →'),
                    ),
                    const SizedBox(height: 8),
                    const Text('We will email you a verification link.', textAlign: TextAlign.center, style: TextStyle(color: kMuted, fontSize: 12)),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );
}

/// Mobile-number login with a one-time SMS code (Firebase Phone Auth). New numbers then pick
/// patient/doctor and give consent on the role screen.
class PhoneLoginScreen extends StatefulWidget {
  const PhoneLoginScreen({super.key});

  @override
  State<PhoneLoginScreen> createState() => _PhoneLoginScreenState();
}

class _PhoneLoginScreenState extends State<PhoneLoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String? _verificationId;
  ConfirmationResult? _webConfirm;
  bool _busy = false;

  String get _e164 => '+91${_phone.text.replaceAll(RegExp(r'\D'), '')}';

  Future<void> _send() async {
    if (!RegExp(r'^\d{10}$').hasMatch(_phone.text.trim())) return snack(context, 'Enter a 10-digit mobile number');
    setState(() => _busy = true);
    try {
      if (kIsWeb) {
        _webConfirm = await _auth.signInWithPhoneNumber(_e164); // invisible reCAPTCHA
        setState(() {});
      } else {
        await _auth.verifyPhoneNumber(
          phoneNumber: _e164,
          verificationCompleted: (cred) => _auth.signInWithCredential(cred), // Android auto-read
          verificationFailed: (e) { if (mounted) snack(context, _authMessage(e)); },
          codeSent: (id, _) { if (mounted) setState(() => _verificationId = id); },
          codeAutoRetrievalTimeout: (_) {},
        );
      }
    } catch (e) {
      if (mounted) snack(context, _authMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (_code.text.trim().length != 6) return snack(context, 'Enter the 6-digit code');
    setState(() => _busy = true);
    try {
      if (_webConfirm != null) {
        await _webConfirm!.confirm(_code.text.trim());
      } else {
        await _auth.signInWithCredential(PhoneAuthProvider.credential(verificationId: _verificationId!, smsCode: _code.text.trim()));
      }
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      if (mounted) snack(context, _authMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sent = _verificationId != null || _webConfirm != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Login with mobile number')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: ListView(padding: const EdgeInsets.all(24), shrinkWrap: true, children: [
            TextField(
              controller: _phone,
              enabled: !sent,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Mobile Number', prefixText: '🇮🇳 +91  '),
            ),
            const SizedBox(height: 14),
            if (sent)
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(labelText: 'OTP code', prefixIcon: Icon(Icons.sms_outlined)),
              ),
            FilledButton(
              onPressed: _busy ? null : (sent ? _verify : _send),
              child: Text(sent ? 'Verify & continue' : 'Send OTP'),
            ),
            if (sent) TextButton(onPressed: _busy ? null : () => setState(() { _verificationId = null; _webConfirm = null; }), child: const Text('Change number')),
          ]),
        ),
      ),
    );
  }
}
