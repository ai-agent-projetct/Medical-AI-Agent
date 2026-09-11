import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../db.dart';
import '../ui.dart';

final _auth = FirebaseAuth.instance;

String _authMessage(Object e) => switch (e) {
      FirebaseAuthException(code: 'invalid-credential' || 'wrong-password' || 'user-not-found') => 'Wrong email or password.',
      FirebaseAuthException(code: 'email-already-in-use') => 'An account already exists for this email.',
      FirebaseAuthException(code: 'weak-password') => 'Password must be at least 6 characters.',
      FirebaseAuthException(code: 'invalid-email') => 'Enter a valid email address.',
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
    final cred = kIsWeb ? await _auth.signInWithPopup(provider) : await _auth.signInWithProvider(provider);
    await Db.ensureAccount(cred.user!);
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
  bool _agree = false, _busy = false;

  Future<void> _create() async {
    if (!_form.currentState!.validate()) return;
    if (!_agree) return snack(context, 'Please accept the Terms & Conditions.');
    setState(() => _busy = true);
    try {
      final cred = await _auth.createUserWithEmailAndPassword(email: _email.text.trim(), password: _password.text);
      await cred.user!.updateDisplayName(_name.text.trim());
      await Db.createAccount(name: _name.text.trim(), email: _email.text.trim(), phone: '+91 ${_phone.text.trim()}');
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
