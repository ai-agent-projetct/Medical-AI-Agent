import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:intl/intl.dart';

import 'config.dart';

/// Firestore schema shared with the React portal (see ../firestore.rules):
///   users/{uid}                 {role, hospitalId, active}  (doctors belong to one hospital)
///   doctors/{uid}               profile (+ web fields: department, specialization, qualification…)
///   patients/{id}               demographics;  patients/{id}/records/{rid}  medical records
///   appointments/{id}           {patient, patientId, patientPhone, doctor, doctorId, date: yyyy-MM-dd,
///                                time: "hh:mm AM", type: Offline|Online, visitType, status, token, summary}
///   schedules/{doctorId}        {days: {yyyy-MM-dd: {available, sessions: [{from, to}]}}}
///   notifications/{id}          {userId, title, body, read, createdAt}
///   counters/{doctorId}_{date}  {next}  per-doctor daily OPD token
///   bookedSlots/{doctorId}_{date} {times}  taken slots, read by the patient app (see patient/pdb.dart)
final _fs = FirebaseFirestore.instance;
String get uid => FirebaseAuth.instance.currentUser!.uid;

/// The signed-in doctor's hospital (users/{uid}.hospitalId), set by the role gate before the doctor app opens.
/// Every hospital-owned read is filtered by it and every write carries it (see firestore.rules).
String hospitalId = '';

/// Fields every audited staff write carries: the writer, for the hospital's change history.
Json get by => {'updatedBy': uid};

typedef Json = Map<String, dynamic>;

/// Appointment statuses (same strings as the portal). "Confirmed" is shown as "Upcoming".
const openStatuses = ['Confirmed', 'Rescheduled', 'Waiting', 'In Consultation'];
String statusLabel(String s) => s == 'Confirmed' ? 'Upcoming' : s;

class Appt {
  Appt(this.id, this.data);
  factory Appt.of(DocumentSnapshot<Json> d) => Appt(d.id, d.data() ?? {});
  final String id;
  final Json data;

  String get patient => data['patient'] as String? ?? 'Patient';
  String? get patientId => data['patientId'] as String?;
  String get phone => data['patientPhone'] as String? ?? '';
  String get doctor => data['doctor'] as String? ?? '';
  String get date => data['date'] as String? ?? '';
  String get time => data['time'] as String? ?? '';
  bool get online => data['type'] == 'Online';
  String get visitType => data['visitType'] as String? ?? 'General';
  String get status => data['status'] as String? ?? 'Confirmed';
  int get token => (data['token'] as num?)?.toInt() ?? 0;
  bool get isOpen => openStatuses.contains(status);
  Json get summary => (data['summary'] as Map?)?.cast<String, dynamic>() ?? {};

  DateTime get start {
    try {
      return DateFormat('yyyy-MM-dd hh:mm a').parse('$date $time');
    } catch (_) {
      return DateTime.tryParse(date) ?? DateTime.now();
    }
  }
}

// ---- Slots (keep in sync with src/slots.js in the portal) ----
const defaultSessions = [
  {'from': '09:00', 'to': '12:00'},
  {'from': '14:00', 'to': '17:00'},
];

String to12h(String hhmm) {
  final p = hhmm.split(':').map(int.parse).toList();
  final h = p[0], m = p[1];
  return '${(h % 12 == 0 ? 12 : h % 12).toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')} ${h >= 12 ? 'PM' : 'AM'}';
}

/// 30-minute slots inside each session, minus [booked] labels ("09:30 AM").
List<String> generateSlots(List<Map> sessions, Iterable<String> booked, {int stepMin = 30}) {
  final taken = booked.toSet();
  final out = <String>[];
  for (final s in sessions) {
    final f = (s['from'] as String).split(':').map(int.parse).toList();
    final t = (s['to'] as String).split(':').map(int.parse).toList();
    for (var m = f[0] * 60 + f[1]; m + stepMin <= t[0] * 60 + t[1]; m += stepMin) {
      final label = to12h('${m ~/ 60}:${m % 60}');
      if (!taken.contains(label)) out.add(label);
    }
  }
  return out;
}

/// Proof of consent stored on users/{uid} at sign-up.
Map<String, dynamic> consentRecord() => {'consent': {'version': consentVersion, 'at': FieldValue.serverTimestamp()}};

class Db {
  static DocumentReference<Json> doctor([String? id]) => _fs.doc('doctors/${id ?? uid}');
  static CollectionReference<Json> get appointments => _fs.collection('appointments');
  static CollectionReference<Json> get patients => _fs.collection('patients');
  static CollectionReference<Json> records(String patientId) => patients.doc(patientId).collection('records');
  static DocumentReference<Json> schedule([String? id]) => _fs.doc('schedules/${id ?? uid}');
  static CollectionReference<Json> get notifications => _fs.collection('notifications');

  /// Self sign-up: a locked doctor account; the doctor then names their hospital ([joinHospital]) and its admin approves.
  static Future<void> createAccount({required String name, required String email, required String phone}) async {
    final batch = _fs.batch()
      ..set(_fs.doc('users/$uid'), {'role': 'doctor', 'email': email, 'name': name, 'active': false, ...consentRecord()}, SetOptions(merge: true))
      ..set(doctor(), {'name': name, 'email': email, 'phone': phone, 'profileComplete': false, 'status': 'Active'}, SetOptions(merge: true));
    await batch.commit();
  }

  /// Asks to join the hospital with code [code] (its id, given by the hospital admin). Returns its name.
  static Future<String> joinHospital(String code) async {
    final h = await _fs.doc('hospitals/${code.trim()}').get();
    if (!h.exists) throw Exception('No hospital with code "${code.trim()}". Ask your hospital admin for the code.');
    final name = h.data()?['name'] as String? ?? code;
    // users first: the doctors write is checked against the hospital on users/{uid}.
    await _fs.doc('users/$uid').update({'hospitalId': h.id});
    await doctor().set({'hospitalId': h.id, 'hospital': name}, SetOptions(merge: true));
    return name;
  }

  static Future<void> saveProfile(Json p) {
    final specs = List<String>.from(p['specializations'] ?? []);
    final edu = List<String>.from(p['education'] ?? []);
    return doctor().set({
      ...p,
      'profileComplete': true,
      // fields the web portal's Doctors page reads
      'department': specs.isEmpty ? 'General' : specs.first,
      'specialization': specs.join(', '),
      'qualification': edu.join(' '),
      'experience': '${p['practiceYears'] ?? 0} Years',
      'onlineConsultation': true,
      'status': 'Active',
    }, SetOptions(merge: true));
  }

  /// Patients by name prefix (names are stored capitalised) or exact phone; at most 20, from the server.
  static Future<List<Json>> searchPatients(String term) async {
    final t = term.trim();
    if (t.length < 2) return [];
    final q = RegExp(r'^[+\d\s-]{6,}$').hasMatch(t)
        ? patients.where('hospitalIds', arrayContains: hospitalId).where('phone', isEqualTo: t)
        : () {
            final cap = t.split(' ').map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1)).join(' ');
            return patients.where('hospitalIds', arrayContains: hospitalId).orderBy('name').startAt([cap]).endAt(['$cap']);
          }();
    final snap = await q.limit(20).get();
    return snap.docs.map((d) => {...d.data(), 'id': d.id}).toList();
  }

  static Stream<List<Appt>> _list(Query<Json> q) =>
      q.snapshots().map((s) => s.docs.map(Appt.of).toList()..sort((a, b) => a.start.compareTo(b.start)));

  /// This hospital's appointments (the rules only allow queries filtered by hospitalId).
  static Query<Json> get ours => appointments.where('hospitalId', isEqualTo: hospitalId);

  static Stream<List<Appt>> myDay(String date) =>
      _list(ours.where('doctorId', isEqualTo: uid).where('date', isEqualTo: date));

  static Stream<List<Appt>> myRange(String from, String to) => _list(ours
      .where('doctorId', isEqualTo: uid)
      .where('date', isGreaterThanOrEqualTo: from)
      .where('date', isLessThanOrEqualTo: to));

  static Stream<List<Appt>> forPatient(String patientId) => _list(ours.where('patientId', isEqualTo: patientId));

  static Stream<Appt> watch(String id) => appointments.doc(id).snapshots().map(Appt.of);

  static Future<Json> day(String date, {String? doctorId}) async {
    final s = await schedule(doctorId).get();
    final d = (s.data()?['days'] as Map?)?[date] as Map?;
    return d?.cast<String, dynamic>() ?? {'available': true, 'sessions': defaultSessions};
  }

  static Future<void> saveDay(String date, bool available, List<Map<String, String>> sessions) async {
    await schedule().set({
      'days': {date: {'available': available, 'sessions': sessions}}
    }, SetOptions(merge: true));
    await notify('Schedule Updated', 'Working hours for ${DateFormat('EEEE, MMM d').format(DateTime.parse(date))} updated '
        '(${available ? '${sessions.length} active shift(s)' : 'day off'}).');
  }

  static Future<List<String>> freeSlots(String date, {String? doctorId}) async {
    final d = await day(date, doctorId: doctorId);
    if (d['available'] == false) return [];
    final taken = await ours.where('doctorId', isEqualTo: doctorId ?? uid).where('date', isEqualTo: date).get();
    final booked = taken.docs.map(Appt.of).where((a) => a.status != 'Cancelled' && a.status != 'No-Show').map((a) => a.time);
    var slots = generateSlots(List<Map>.from(d['sessions'] ?? []), booked);
    final now = DateTime.now();
    if (date == DateFormat('yyyy-MM-dd').format(now)) {
      slots = slots.where((s) => DateFormat('yyyy-MM-dd hh:mm a').parse('$date $s').isAfter(now)).toList();
    }
    return slots;
  }

  /// Books an appointment with the next hospital-wide token. Creates the patient if [patientId] is null.
  static Future<Appt> book({
    String? patientId,
    required String patientName,
    required String phone,
    Json extraPatient = const {},
    required String date,
    required String time,
    required bool online,
    required String visitType,
  }) async {
    final me = (await doctor().get()).data() ?? {};
    final pid = patientId ?? (await patients.add({'name': patientName, 'phone': phone, 'status': 'Active', ...extraPatient, 'hospitalIds': [hospitalId], ...by})).id;
    final ref = appointments.doc();
    final data = await _fs.runTransaction((tx) async {
      // Per-doctor daily OPD token (#1, #2 …) + slot lock, shared with the portal and the patient app.
      final counter = _fs.doc('counters/${uid}_$date');
      final slotRef = _fs.doc('bookedSlots/${uid}_$date');
      final slot = await tx.get(slotRef);
      final c = await tx.get(counter);
      if (List<String>.from(slot.data()?['times'] ?? []).contains(time)) {
        throw Exception('$time is already booked. Please pick another slot.');
      }
      final token = (c.data()?['next'] as num?)?.toInt() ?? 1;
      final data = <String, dynamic>{
        'patient': patientName,
        'patientId': pid,
        'patientPhone': phone,
        'doctor': me['name'] ?? '',
        'doctorId': uid,
        'department': me['department'] ?? 'General',
        'fee': me['fee'] ?? 0,
        'date': date,
        'time': time,
        'type': online ? 'Online' : 'Offline',
        'visitType': visitType,
        'status': 'Confirmed',
        'token': token,
        'createdAt': FieldValue.serverTimestamp(),
        'hospitalId': hospitalId,
        'hospital': me['hospital'] ?? '',
        ...by,
      };
      tx.set(counter, {'next': token + 1}, SetOptions(merge: true));
      tx.set(slotRef, {'times': FieldValue.arrayUnion([time])}, SetOptions(merge: true));
      tx.set(ref, data);
      return data;
    });
    await notify('Appointment booked', '$patientName · Token #${data['token']} · ${shortLabel(date)} $time');
    return Appt(ref.id, data);
  }

  static Future<void> setStatus(String id, String status) => appointments.doc(id).update({'status': status, ...by});

  static Future<void> reschedule(Appt a, String date, String time) async {
    await appointments.doc(a.id).update({'date': date, 'time': time, 'status': 'Rescheduled', ...by});
    // ponytail: the old slot stays blocked for patient self-booking; free it here if clinics complain.
    await _fs.doc('bookedSlots/${uid}_$date').set({'times': FieldValue.arrayUnion([time])}, SetOptions(merge: true));
    await notify('Appointment rescheduled', '${a.patient} moved to ${shortLabel(date)} $time');
  }

  /// Completes a consultation: stores the summary on the appointment and in the patient's records.
  static Future<void> complete(Appt a, {required String diagnosis, required String notes, required List<Json> medications}) async {
    final me = (await doctor().get()).data() ?? {};
    final summary = {'diagnosis': diagnosis, 'notes': notes, 'medications': medications};
    final batch = _fs.batch()..update(appointments.doc(a.id), {'status': 'Completed', 'summary': summary, 'completedAt': FieldValue.serverTimestamp(), ...by});
    if (a.patientId != null) {
      batch.set(records(a.patientId!).doc(), {
        'type': 'Consultation',
        'title': '${a.visitType} · ${a.online ? 'Video' : 'In-person'}',
        ...summary,
        'vitals': {},
        'doctor': me['name'] ?? '',
        'doctorId': uid,
        'appointmentId': a.id,
        'createdAt': FieldValue.serverTimestamp(),
        'hospitalId': hospitalId,
        ...by,
      });
    }
    await batch.commit();
  }

  static Future<void> notify(String title, String body) =>
      notifications.add({'userId': uid, 'title': title, 'body': body, 'read': false, 'createdAt': FieldValue.serverTimestamp()});

  /// Append-only audit trail shared with the portal (auditLogs; admins read it there).
  static Future<void> audit(String action, String module, String details) => _fs.collection('auditLogs').add({
        'at': FieldValue.serverTimestamp(),
        'uid': uid,
        'email': FirebaseAuth.instance.currentUser?.email,
        'user': 'Doctor (app)',
        'action': action,
        'module': module,
        'details': details,
        'hospitalId': hospitalId,
      }).then((_) {}, onError: (Object e) => debugPrint('audit log: $e'));

  static String shortLabel(String date) => DateFormat('EEE, MMM d').format(DateTime.parse(date));
}
