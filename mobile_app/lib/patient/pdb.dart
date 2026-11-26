import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';

import '../config.dart';
import '../db.dart';
import '../ui.dart';

/// Patient-side data access. Same Firestore schema as the doctor app and portal, plus:
///   patients/{id}.ownerUid        the signed-in patient owns their own profile (id = uid) and family members
///   appointments/{id}.ownerUid    bookings made from the patient app
///   bookedSlots/{doctorId}_{date} {times}: taken slots, readable without seeing other patients' bookings
///   appointments/{id}/messages    consultation chat
///   doctors/{id}/reviews/{apptId} verified reviews (one per completed appointment)
///   medicines, labTests, articles catalogs;  orders/{id} {ownerUid, hospitalId, kind: medicine|lab, items, status}
///   patients/{id}.hospitalIds     hospitals the patient has booked with (added by the booking function); each
///                                 hospital sees the profile but only its own records and bills
final _fs = FirebaseFirestore.instance;

/// Symptom → specialty guidance shown on the home screen (names match the doctor app's specialization list).
const symptomSpecialty = {
  'Fever': 'General Physician',
  'Cold & cough': 'General Physician',
  'Headache': 'General Physician',
  'Irregular periods': 'Gynecology',
  'Pregnancy': 'Gynecology',
  'Toothache': 'Dentistry',
  'Child not well': 'Pediatrics',
  'Acne / skin rash': 'Dermatology',
  'Hair fall': 'Dermatology',
  'Knee / back pain': 'Orthopedics',
  'Anxiety / stress': 'Psychiatry',
  'Chest pain / BP': 'Cardiology',
  'High sugar': 'Diabetology',
  'Ear / throat pain': 'ENT',
  'Eye problem': 'Ophthalmology',
  'Stomach pain': 'Gastroenterology',
};

const orderStatuses = ['Placed', 'Confirmed', 'Sample Collected', 'Dispatched', 'Delivered', 'Completed', 'Cancelled'];

class PDb {
  static CollectionReference<Json> get doctors => _fs.collection('doctors');
  static CollectionReference<Json> get patients => _fs.collection('patients');
  static CollectionReference<Json> get appointments => _fs.collection('appointments');
  static CollectionReference<Json> get orders => _fs.collection('orders');
  static DocumentReference<Json> get me => patients.doc(uid);

  /// Sign-up as a patient: role doc + own patient profile (id = uid).
  static Future<void> createAccount({required String name, required String email, required String phone}) async {
    final batch = _fs.batch()
      ..set(_fs.doc('users/$uid'), {'role': 'patient', 'email': email, ...consentRecord()}, SetOptions(merge: true))
      ..set(me, {'name': name, 'email': email, 'phone': phone, 'ownerUid': uid, 'relation': 'Self', 'status': 'Active'},
          SetOptions(merge: true));
    await batch.commit();
  }

  /// Self + family members, self first.
  static Stream<List<QueryDocumentSnapshot<Json>>> family() => patients.where('ownerUid', isEqualTo: uid).snapshots().map(
      (s) => s.docs.toList()..sort((a, b) => (a.id == uid ? 0 : 1).compareTo(b.id == uid ? 0 : 1)));

  static Future<void> saveMember(String? id, Json data) => id == null
      ? patients.add({...data, 'ownerUid': uid, 'status': 'Active'})
      : patients.doc(id).set({...data, 'ownerUid': uid}, SetOptions(merge: true));

  // ---- Doctors ----
  static Stream<List<QueryDocumentSnapshot<Json>>> allDoctors() => doctors
      .where('profileComplete', isEqualTo: true)
      .snapshots()
      .map((s) => s.docs.where((d) => d.data()['status'] != 'Inactive').toList());

  static bool matches(Json d, {String query = '', String? specialty, bool onlineOnly = false}) {
    final specs = [...List<String>.from(d['specializations'] ?? []), d['department'] ?? '', d['specialization'] ?? ''];
    if (specialty != null && !specs.any((s) => s.toString().toLowerCase().contains(specialty.toLowerCase()))) return false;
    if (onlineOnly && d['onlineConsultation'] == false) return false;
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return [d['name'], d['hospital'], ...specs].any((v) => '${v ?? ''}'.toLowerCase().contains(q));
  }

  static Stream<List<Json>> reviews(String doctorId) => doctors
      .doc(doctorId)
      .collection('reviews')
      .orderBy('createdAt', descending: true)
      .snapshots()
      .map((s) => s.docs.map((d) => d.data()).toList());

  /// Free slots for a patient: the doctor's sessions minus bookedSlots (no access to other bookings).
  static Future<List<String>> freeSlots(String doctorId, String date) async {
    final d = await Db.day(date, doctorId: doctorId);
    if (d['available'] == false) return [];
    final taken = await _fs.doc('bookedSlots/${doctorId}_$date').get();
    var slots = generateSlots(List<Map>.from(d['sessions'] ?? []), List<String>.from(taken.data()?['times'] ?? []));
    final now = DateTime.now();
    if (date == ymd(now)) slots = slots.where((s) => DateFormat('yyyy-MM-dd hh:mm a').parse('$date $s').isAfter(now)).toList();
    return slots;
  }

  /// Books [time] with [doctor] for family member [patient]; fails if someone took the slot meanwhile.
  /// Books [time] with [doctor] for family member [patient] through the `bookAppointment` Cloud Function,
  /// which locks the slot and takes the doctor's next daily token on the server (safe under heavy load).
  static Future<Appt> book({
    required String doctorId,
    required Json doctor,
    required String patientId,
    required Json patient,
    required String date,
    required String time,
    required bool online,
    String reason = '',
  }) async {
    try {
      final r = await functions.httpsCallable('bookAppointment').call<Map<String, dynamic>>({
        'doctorId': doctorId, 'date': date, 'time': time, 'patientId': patientId, 'online': online, 'reason': reason,
      });
      return Appt(r.data['appointmentId'] as String, {'token': r.data['token'], 'doctor': doctor['name'], 'date': date, 'time': time});
    } on FirebaseFunctionsException catch (e) {
      throw Exception(e.message ?? 'Booking failed');
    }
  }

  static Stream<List<Appt>> myAppointments() => appointments
      .where('ownerUid', isEqualTo: uid)
      .snapshots()
      .map((s) => s.docs.map(Appt.of).toList()..sort((a, b) => b.start.compareTo(a.start)));

  static Future<void> cancel(String id) => appointments.doc(id).update({'status': 'Cancelled', 'updatedBy': uid});

  static Future<void> review(Appt a, int rating, String text, String name) =>
      doctors.doc(a.data['doctorId'] as String).collection('reviews').doc(a.id).set({
        'uid': uid,
        'rating': rating,
        'text': text,
        'name': name,
        'createdAt': FieldValue.serverTimestamp(),
      });

  // ---- Chat ----
  static Stream<List<Json>> messages(String apptId) => appointments
      .doc(apptId)
      .collection('messages')
      .orderBy('at')
      .snapshots()
      .map((s) => s.docs.map((d) => d.data()).toList());

  static Future<void> send(String apptId, String text, String name) => appointments.doc(apptId).collection('messages').add({
        'uid': uid,
        'name': name,
        'text': text,
        'at': FieldValue.serverTimestamp(),
      });

  // ---- Records ----
  static Stream<List<Json>> records(String patientId) => patients
      .doc(patientId)
      .collection('records')
      .orderBy('createdAt', descending: true)
      .snapshots()
      .map((s) => s.docs.map((d) => d.data()).toList());

  /// Hospitals this family member has visited, as id → name (to share an uploaded report with one of them).
  static Future<Map<String, String>> hospitalsOf(String patientId) async {
    final ids = List<String>.from((await patients.doc(patientId).get()).data()?['hospitalIds'] ?? []);
    final docs = await Future.wait(ids.map((id) => _fs.doc('hospitals/$id').get()));
    return {for (final d in docs) d.id: d.data()?['name'] as String? ?? d.id};
  }

  /// [hospitalId] '' keeps the upload private to the family; a hospital id shares it with that hospital's doctors.
  static Future<void> uploadRecord(String patientId,
      {required String type, required String title, String notes = '', Uint8List? bytes, String? fileName, String hospitalId = ''}) async {
    var attachment = <String, dynamic>{};
    if (bytes != null) {
      final ref = FirebaseStorage.instance.ref('records/$patientId/${DateTime.now().millisecondsSinceEpoch}_$fileName');
      await ref.putData(bytes);
      attachment = {'fileUrl': await ref.getDownloadURL(), 'fileName': fileName};
    }
    await patients.doc(patientId).collection('records').add({
      'type': type,
      'title': title,
      'notes': notes,
      ...attachment,
      'uploadedBy': uid,
      'doctor': 'Uploaded by patient',
      'hospitalId': hospitalId,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  // ---- Catalogs & orders ----
  static Stream<List<Json>> catalog(String name) =>
      _fs.collection(name).snapshots().map((s) => s.docs.map((d) => {...d.data(), 'id': d.id}).toList());

  static Future<String?> uploadPrescription(Uint8List bytes, String fileName) async {
    final ref = FirebaseStorage.instance.ref('prescriptions/$uid/${DateTime.now().millisecondsSinceEpoch}_$fileName');
    await ref.putData(bytes);
    return ref.getDownloadURL();
  }

  /// Hospital that fulfils a medicine / lab order: the latest hospital the patient booked with, else the first active one.
  /// ponytail: no chooser; add one when patients regularly use several hospitals' pharmacies.
  static Future<String> orderHospital() async {
    final mine = List<String>.from((await me.get()).data()?['hospitalIds'] ?? []);
    if (mine.isNotEmpty) return mine.last;
    final any = await _fs.collection('hospitals').where('status', isEqualTo: 'Active').limit(1).get();
    if (any.docs.isEmpty) throw Exception('No pharmacy is available yet');
    return any.docs.first.id;
  }

  static Future<void> placeOrder({required String kind, required List<Json> items, required String patientName,
      required String phone, required String address, String? date, String? slot, String? prescriptionUrl}) async {
    final total = items.fold<num>(0, (t, i) => t + (i['price'] as num) * ((i['qty'] as num?) ?? 1));
    final hospitalId = await orderHospital();
    await orders.add({
      'ownerUid': uid,
      'hospitalId': hospitalId,
      'email': FirebaseAuth.instance.currentUser?.email,
      'kind': kind,
      'items': items,
      'total': total,
      'patient': patientName,
      'phone': phone,
      'address': address,
      'date': ?date,
      'slot': ?slot,
      'prescriptionUrl': ?prescriptionUrl,
      'payment': 'Cash on delivery',
      'status': 'Placed',
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  static Stream<List<QueryDocumentSnapshot<Json>>> myOrders() => orders.where('ownerUid', isEqualTo: uid).snapshots().map((s) =>
      s.docs.toList()..sort((a, b) => ((b.data()['createdAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 1 << 53)
          .compareTo((a.data()['createdAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 1 << 53)));
}
