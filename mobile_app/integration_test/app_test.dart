// End-to-end test of the doctor app against the local Firebase emulators.
//
//   1. In the portal folder:  npm run emulators
//   2. chromedriver --port=4444
//   3. In mobile_app/:
//      flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_test.dart \
//        -d web-server --dart-define=USE_EMULATORS=true
import 'package:ai_hospital_agent/main.dart' as app;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:integration_test/integration_test.dart';

// Assert on what the emulator stored, not the client cache (queued offline writes would pass otherwise).
const server = GetOptions(source: Source.server);

/// Raw emulator REST read (admin bypass), independent of the Firestore SDK.
Future<String> emulatorDoc(String path) async =>
    (await http.get(Uri.parse('http://127.0.0.1:8181/v1/projects/demo-medical-ai/databases/(default)/documents/$path'),
            headers: {'Authorization': 'Bearer owner'}))
        .body;

/// flutter drive (web) reports a test that exceeds its timeout as PASSED, so every await that could
/// hang gets its own deadline and fails loudly with what it was waiting for.
Future<T> within<T>(String what, Future<T> f, {int seconds = 45}) =>
    f.timeout(Duration(seconds: seconds), onTimeout: () async {
      await mark('FAIL hung ${seconds}s: $what. Errors: $errorLog');
      throw TestFailure('Hung for ${seconds}s: $what. Errors: $errorLog');
    });

/// pumpAndSettle never settles here (live Firestore streams, spinners), so poll instead.
String lastPicker = '';
List<String> errorLog = [];

Future<void> pumpUntil(WidgetTester t, Finder f, {int seconds = 20}) async {
  final end = DateTime.now().add(Duration(seconds: seconds));
  while (DateTime.now().isBefore(end)) {
    await within('a frame while waiting for $f', t.pump(const Duration(milliseconds: 200)), seconds: 30);
    if (f.evaluate().isNotEmpty) return;
  }
  final onScreen = find.byType(Text).hitTestable().evaluate().map((e) => (e.widget as Text).data).whereType<String>().toSet();
  final fields = find.byType(EditableText).evaluate().map((e) => (e.widget as EditableText).controller.text).toList();
  final msg = 'Timed out waiting for $f. On screen: $onScreen. Fields: $fields. Picker: $lastPicker. Errors: $errorLog';
  await mark('FAIL $msg');
  throw TestFailure(msg);
}

Future<void> tap(WidgetTester t, Finder f) async {
  await mark('tap $f');
  await pumpUntil(t, f);
  await within('ensureVisible $f', t.ensureVisible(f.first), seconds: 30);
  await within('pump before tap $f', t.pump(), seconds: 30);
  await within('tap $f', t.tap(f.first), seconds: 30);
  await within('pump after tap $f', t.pump(const Duration(milliseconds: 400)), seconds: 30);
}

Future<void> type(WidgetTester t, String label, String text) async {
  await mark('type $label');
  final f = find.widgetWithText(TextField, label).hitTestable();
  await scrollTo(t, find.widgetWithText(TextField, label));
  await within('enterText $label', t.enterText(f.first, text), seconds: 30);
  await within('pump after typing $label', t.pump(), seconds: 30);
}

/// Progress breadcrumb written straight to the emulator (readable from outside the browser), so a
/// hang or crash shows the last step reached: GET e2eProgress/last.
int _step = 0;
Future<void> mark(String what) async {
  _step++;
  try {
    await http.patch(
      Uri.parse('http://127.0.0.1:8181/v1/projects/demo-medical-ai/databases/(default)/documents/e2eProgress/last'),
      headers: {'Authorization': 'Bearer owner', 'Content-Type': 'application/json'},
      body: '{"fields":{"step":{"integerValue":"$_step"},"what":{"stringValue":${jsonEncode(what)}},"at":{"stringValue":"${DateTime.now()}"}}}',
    ).timeout(const Duration(seconds: 5));
  } catch (_) {/* breadcrumbs are best-effort */}
}

/// Scrolls the visible list until [f] is built and on screen.
Future<void> scrollTo(WidgetTester t, Finder f) async {
  await mark('scrollTo $f');
  for (var i = 0; i < 30 && f.hitTestable().evaluate().isEmpty; i++) {
    final list = find.byType(Scrollable).hitTestable();
    if (list.evaluate().isEmpty) break;
    await mark('drag $i for $f');
    await within('drag towards $f', t.drag(list.first, const Offset(0, -150)), seconds: 30);
    await within('pump after drag towards $f', t.pump(const Duration(milliseconds: 150)), seconds: 30);
  }
  await pumpUntil(t, f.hitTestable());
}

Future<void> pickFromSheet(WidgetTester t, String field, String option) async {
  await scrollTo(t, find.text(field));
  await tap(t, find.text(field).hitTestable());
  await tap(t, find.widgetWithText(CheckboxListTile, option));
  await tap(t, find.widgetWithText(FilledButton, 'Done'));
}

/// Opens the Material date picker from [button] and chooses tomorrow.
Future<DateTime> pickTomorrow(WidgetTester t, Finder button) async {
  final now = DateTime.now();
  final tomorrow = DateTime(now.year, now.month, now.day + 1);
  await tap(t, button);
  await within('pump after opening date picker', t.pump(const Duration(seconds: 1)), seconds: 30);
  lastPicker = find.byType(Text).hitTestable().evaluate().map((e) => (e.widget as Text).data).toList().toString();
  // Type the date in the picker's text mode: tapping a calendar cell proved unreliable.
  await tap(t, find.byTooltip('Switch to input'));
  final mmddyyyy = '${tomorrow.month.toString().padLeft(2, '0')}/${tomorrow.day.toString().padLeft(2, '0')}/${tomorrow.year}';
  await within('enter date', t.enterText(find.byType(TextField).hitTestable().last, mmddyyyy), seconds: 30);
  await tap(t, find.text('OK'));
  await mark('picked $mmddyyyy');
  return tomorrow;
}

String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('doctor: sign up → profile → book → consult → complete → record → schedule', (t) async {
    final email = 'dr${DateTime.now().millisecondsSinceEpoch}@demo.test';
    // Phone-sized logical screen (360x800); the default headless window is a small landscape one.
    t.view.physicalSize = const Size(1080, 2400);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    // Collect framework errors (e.g. layout overflow) so the failure says exactly what broke.
    final errors = <String>[];
    final frameworkOnError = FlutterError.onError;
    FlutterError.onError = (d) {
      // Keep the message plus the widget / source line that caused it (e.g. which Row overflowed).
      final where = d.toString().split('\n').where((l) => l.contains('error-causing widget') || RegExp(r'lib/.+\.dart:\d+').hasMatch(l)).take(2);
      errors.add('${d.exceptionAsString().split('\n').first} ${where.join(' ')}');
    };
    errorLog = errors;
    // flutter drive (web) hangs instead of reporting a thrown failure, so record it as a breadcrumb first.
    try {
    app.main();
    await pumpUntil(t, find.text('Welcome Back!'), seconds: 40);

    // --- Sign up (validation first) ---
    await tap(t, find.text('Sign Up'));
    await tap(t, find.textContaining('Create Account'));
    expect(find.text('Enter your name'), findsOneWidget);
    await tap(t, find.text("I'm a doctor"));
    await type(t, 'Full Name', 'Dr Akal Test');
    await type(t, 'Mobile Number', '9786453269');
    await type(t, 'Email', email);
    await type(t, 'Create a password', 'demo-doctor-123');
    await type(t, 'Confirm Password', 'demo-doctor-123');
    await tap(t, find.byType(CheckboxListTile));
    await tap(t, find.textContaining('Create Account'));

    // --- First-time profile ---
    await pumpUntil(t, find.text('Complete your profile to continue.'), seconds: 30);
    final uid = FirebaseAuth.instance.currentUser!.uid;
    await pickFromSheet(t, 'Education', 'MBBS');
    await pickFromSheet(t, 'Specialization', 'General Physician');
    await type(t, 'Hospital Name', 'Apollo Hospitals, Greams Road');
    await type(t, 'Doctor ID / Registration No.', '12AP98');
    await type(t, 'Practice (years)', '8');
    await type(t, 'Fee (₹)', '500');
    await scrollTo(t, find.text('Update Profile'));
    await tap(t, find.text('Update Profile').hitTestable());
    await pumpUntil(t, find.text('Welcome back,'), seconds: 30);

    final doctor = (await within('FirebaseFirestore.instance.doc(doctors/uid).get(server)', FirebaseFirestore.instance.doc('doctors/$uid').get(server))).data()!;
    expect(doctor['profileComplete'], true);
    expect(doctor['department'], 'General Physician'); // field the web portal reads
    final role = (await within('FirebaseFirestore.instance.doc(users/uid).get(server)', FirebaseFirestore.instance.doc('users/$uid').get(server))).data()!['role'];
    expect(role, 'doctor');

    // --- Book a walk-in for tomorrow 09:00 ---
    await tap(t, find.text('Bookings').hitTestable());
    await tap(t, find.byIcon(Icons.add_circle_outline).hitTestable());
    await tap(t, find.text('New patient'));
    await type(t, 'Patient name', 'Meena Iyer');
    await type(t, 'Phone (+91 …)', '+91 93456 22111');
    final day = await pickTomorrow(t, find.byIcon(Icons.calendar_month).hitTestable());
    await scrollTo(t, find.widgetWithText(ChoiceChip, '09:00 AM'));
    await tap(t, find.widgetWithText(ChoiceChip, '09:00 AM').hitTestable());
    await scrollTo(t, find.widgetWithText(FilledButton, 'Book Appointment'));
    await tap(t, find.widgetWithText(FilledButton, 'Book Appointment').hitTestable());
    await pumpUntil(t, find.textContaining('Booked · Token #'));

    final appts = await within('FirebaseFirestore.instance.collection(appointments).where(doctorId, isEqualTo: uid).ge', FirebaseFirestore.instance.collection('appointments').where('doctorId', isEqualTo: uid).get(server));
    expect(appts.docs, hasLength(1));
    final appt = appts.docs.single;
    expect(appt['date'], ymd(day));
    expect(appt['time'], '09:00 AM');
    expect(appt['status'], 'Confirmed');
    expect(appt['token'], 1, reason: 'first booking of the day for this doctor');
    final patientId = appt['patientId'] as String;
    expect((await within('FirebaseFirestore.instance.doc(patients/patientId).get(server)', FirebaseFirestore.instance.doc('patients/$patientId').get(server))).exists, true);
    expect(await within('emulatorDoc(appointments/{appt.id})', emulatorDoc('appointments/${appt.id}')), contains('"Confirmed"'), reason: 'appointment missing on the emulator');

    // --- Same slot must no longer be offered ---
    final slots = await within('FirebaseFirestore.instance.collection(appointments).where(doctorId, isEqualTo: uid).wh', FirebaseFirestore.instance.collection('appointments').where('doctorId', isEqualTo: uid).where('date', isEqualTo: ymd(day)).get(server));
    expect(slots.docs.map((d) => d['time']), contains('09:00 AM'));

    // --- Check in → start → complete with a prescription ---
    await pumpUntil(t, find.text('Bookings').hitTestable());
    await pickTomorrow(t, find.byIcon(Icons.calendar_month).hitTestable());
    await tap(t, find.text('Meena Iyer').hitTestable());
    await tap(t, find.text('Patient Arrived (Check in)'));
    await pumpUntil(t, find.text('Waiting')); // status chip; snackbars queue behind the booking one
    await tap(t, find.text('Start Consultation'));
    await pumpUntil(t, find.text('Mark as Complete'));
    await tap(t, find.text('Mark as Complete'));
    await type(t, 'Diagnosis', 'Hypertension stage 1');
    await type(t, 'Consultation notes / advice', 'Low-salt diet. Review in 2 weeks.');
    await tap(t, find.text('Add'));
    await type(t, 'Medicine (e.g. Atorvastatin 20mg)', 'Amlodipine 5mg');
    await type(t, 'Dosage (1-0-1)', '1-0-0');
    await type(t, 'Duration (5 days)', '30 days');
    await scrollTo(t, find.text('Save & Finish'));
    await tap(t, find.text('Save & Finish').hitTestable());
    await pumpUntil(t, find.text('View Summary'), seconds: 30);

    final done = (await within('appt.reference.get(server)', appt.reference.get(server))).data()!;
    expect(done['status'], 'Completed');
    expect((done['summary'] as Map)['diagnosis'], 'Hypertension stage 1');
    expect(((done['summary'] as Map)['medications'] as List).single['name'], 'Amlodipine 5mg');

    await tap(t, find.text('View Summary'));
    await pumpUntil(t, find.text('Amlodipine 5mg'));
    await scrollTo(t, find.text('Generate Digital Prescription'));

    // --- Medical records: the consultation landed in the patient's records; add a vitals record ---
    var records = await within('FirebaseFirestore.instance.collection(patients/patientId/records).get(server)', FirebaseFirestore.instance.collection('patients/$patientId/records').get(server));
    expect(records.docs.single['type'], 'Consultation');
    expect(records.docs.single['doctorId'], uid);

    Navigator.of(t.element(find.text('Visit Summary'))).popUntil((r) => r.isFirst);
    await within('pump 500ms', t.pump(const Duration(milliseconds: 500)), seconds: 30);
    await tap(t, find.text('Records').hitTestable());
    await tap(t, find.text('Meena Iyer').hitTestable());
    await tap(t, find.text('Add Record'));
    await tap(t, find.text('Vitals'));
    await type(t, 'Title', 'BP check');
    await type(t, 'BP', '138/88');
    await type(t, 'Pulse', '76');
    await scrollTo(t, find.text('Save Record'));
    await tap(t, find.text('Save Record').hitTestable());
    await pumpUntil(t, find.text('BP check'), seconds: 30);

    records = await within('FirebaseFirestore.instance.collection(patients/patientId/records).get(server)', FirebaseFirestore.instance.collection('patients/$patientId/records').get(server));
    expect(records.docs, hasLength(2));
    final vitals = records.docs.firstWhere((d) => d['type'] == 'Vitals');
    expect((vitals['vitals'] as Map)['bp'], '138/88');

    // --- Schedule: save default hours for today ---
    Navigator.of(t.element(find.text('BP check'))).popUntil((r) => r.isFirst);
    await within('pump 500ms', t.pump(const Duration(milliseconds: 500)), seconds: 30);
    await tap(t, find.text('Schedule').hitTestable());
    await tap(t, find.byTooltip('Edit schedule'));
    await scrollTo(t, find.text('Save'));
    await tap(t, find.text('Save').hitTestable());
    await pumpUntil(t, find.textContaining('Schedule saved for'));
    final sched = (await within('FirebaseFirestore.instance.doc(schedules/uid).get(server)', FirebaseFirestore.instance.doc('schedules/$uid').get(server))).data()!;
    expect((sched['days'] as Map).keys, isNotEmpty);
    expect(await within('emulatorDoc(schedules/uid)', emulatorDoc('schedules/$uid')), contains('"days"'), reason: 'schedule missing on the emulator');

    // ===== Patient side of the same app: sign up, find this doctor, book, chat, order medicine =====
    await within('signOut', FirebaseAuth.instance.signOut());
    await tap(t, find.text('Sign Up'));
    await type(t, 'Full Name', 'Asha Patient');
    await type(t, 'Mobile Number', '9876501234');
    await type(t, 'Email', 'pt${DateTime.now().millisecondsSinceEpoch}@demo.test');
    await type(t, 'Create a password', 'demo-patient-123');
    await type(t, 'Confirm Password', 'demo-patient-123');
    await tap(t, find.byType(CheckboxListTile));
    await tap(t, find.textContaining('Create Account'));
    await pumpUntil(t, find.textContaining('Hi, Asha'), seconds: 30);
    final puid = FirebaseAuth.instance.currentUser!.uid;
    expect((await within('FirebaseFirestore.instance.doc(users/puid).get(server)', FirebaseFirestore.instance.doc('users/$puid').get(server))).data()!['role'], 'patient');

    // Find the doctor and book tomorrow: 09:00 is taken by the doctor's own booking above.
    await tap(t, find.text('Doctors').hitTestable());
    await within('enterText Akal', t.enterText(find.byType(TextField).hitTestable().first, 'Akal'), seconds: 30);
    await tap(t, find.text('Dr Akal Test').hitTestable());
    await tap(t, find.text('Book clinic visit').hitTestable());
    await tap(t, find.text(DateFormat('EEE\nMMM d').format(day)).hitTestable());
    await pumpUntil(t, find.widgetWithText(ChoiceChip, '09:30 AM'));
    expect(find.widgetWithText(ChoiceChip, '09:00 AM'), findsNothing, reason: 'slot booked by the doctor must be hidden');
    await tap(t, find.widgetWithText(ChoiceChip, '09:30 AM'));
    await scrollTo(t, find.textContaining('Confirm ·'));
    await tap(t, find.textContaining('Confirm ·').hitTestable());
    await pumpUntil(t, find.text('Chat with clinic'), seconds: 30);

    final mine = await within('FirebaseFirestore.instance.collection(appointments).where(ownerUid, isEqualTo: puid).g', FirebaseFirestore.instance.collection('appointments').where('ownerUid', isEqualTo: puid).get(server));
    expect(mine.docs, hasLength(1));
    expect(mine.docs.single['doctorId'], uid);
    expect(mine.docs.single['patientId'], puid);
    expect(mine.docs.single['time'], '09:30 AM');
    expect(mine.docs.single['token'], 2, reason: "per-doctor daily token: the doctor's own booking that day was #1");
    expect(await within('emulatorDoc(bookedSlots/{uid}_{ymd(day)})', emulatorDoc('bookedSlots/${uid}_${ymd(day)}')), allOf(contains('09:00 AM'), contains('09:30 AM')));

    // Chat with the clinic.
    await tap(t, find.text('Chat with clinic'));
    await within('enterText Hello doctor', t.enterText(find.byType(TextField).hitTestable().last, 'Hello doctor'), seconds: 30);
    await tap(t, find.byTooltip('Send'));
    await pumpUntil(t, find.text('Hello doctor'));
    expect(await within('emulatorDoc(appointments/{mine.docs.single.id}/messages)', emulatorDoc('appointments/${mine.docs.single.id}/messages')), contains('Hello doctor'));
    Navigator.of(t.element(find.text('Hello doctor'))).popUntil((r) => r.isFirst);
    await within('pump 500ms', t.pump(const Duration(milliseconds: 500)), seconds: 30);

    // Order a non-prescription medicine (catalog comes from scripts/seed-emulator.mjs).
    await tap(t, find.text('Home').hitTestable());
    await tap(t, find.text('Order medicines').hitTestable());
    await pumpUntil(t, find.text('Paracetamol 650 mg'));
    await tap(t, find.widgetWithText(OutlinedButton, 'Add').hitTestable());
    await tap(t, find.textContaining('Checkout ·'));
    await type(t, 'Delivery address', '12 MG Road, Bengaluru 560001');
    await scrollTo(t, find.textContaining('Place order'));
    await tap(t, find.textContaining('Place order').hitTestable());
    await pumpUntil(t, find.text('Order medicines'));
    final orders = await within('FirebaseFirestore.instance.collection(orders).where(ownerUid, isEqualTo: puid).get(ser', FirebaseFirestore.instance.collection('orders').where('ownerUid', isEqualTo: puid).get(server));
    expect(orders.docs, hasLength(1));
    expect(orders.docs.single['status'], 'Placed');
    expect(await within('emulatorDoc(orders/{orders.docs.single.id})', emulatorDoc('orders/${orders.docs.single.id}')), contains('Paracetamol'));

    FlutterError.onError = frameworkOnError;
    expect(errors, isEmpty, reason: 'Flutter framework errors during the run');
    app.emulatorSemantics?.dispose(); // the framework requires every SemanticsHandle disposed by the end
    app.emulatorSemantics = null;
    await mark('PASS all steps');
    } catch (e, st) {
      final where = st.toString().split('\n').where((l) => !l.contains('dart-sdk') && (l.contains('lib/') || l.contains('integration_test/'))).take(8).join(' <- ');
      await mark('FAIL ${e.toString().split('\n').take(6).join(' ')} | at: $where | errors: $errors');
      rethrow;
    }
  }, timeout: const Timeout(Duration(minutes: 20)));
}
