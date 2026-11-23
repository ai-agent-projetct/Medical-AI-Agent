// Security-rules tests for firestore.rules + storage.rules. Run: npm run test:rules
// (starts the Firestore + Storage emulators, runs this file, shuts them down).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';

let env;
const ROLES = { admin: 'admin', doc1: 'doctor', doc2: 'doctor', recep: 'receptionist', bill: 'billing', pat: 'patient', pat2: 'patient' };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-medical-ai',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8181 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of Object.entries(ROLES)) await setDoc(doc(db, 'users', uid), { role });
    await setDoc(doc(db, 'doctors', 'doc1'), { name: 'Dr A' });
    await setDoc(doc(db, 'patients', 'p1'), { name: 'Ravi' });
    await setDoc(doc(db, 'patients', 'p1', 'records', 'r1'), { type: 'Note', doctorId: 'doc1' });
    await setDoc(doc(db, 'appointments', 'a1'), { patient: 'Ravi', doctorId: 'doc1', status: 'Confirmed' });
    await setDoc(doc(db, 'notifications', 'n1'), { userId: 'doc1', read: false });
    await setDoc(doc(db, 'auditLogs', 'l1'), { uid: 'recep', action: 'Viewed Medical Records' });
    await setDoc(doc(db, 'patients', 'pat'), { name: 'Asha', ownerUid: 'pat' });
    await setDoc(doc(db, 'patients', 'pat', 'records', 'r9'), { type: 'Consultation', doctorId: 'doc1' });
    await setDoc(doc(db, 'appointments', 'a2'), { patientId: 'pat', ownerUid: 'pat', doctorId: 'doc1', status: 'Completed' });
    await setDoc(doc(db, 'appointments', 'a3'), { patientId: 'pat', ownerUid: 'pat', doctorId: 'doc1', status: 'Confirmed' });
    await setDoc(doc(db, 'counters', 'appointments'), { next: 10 });
    await setDoc(doc(db, 'bookedSlots', 'doc1_2026-12-01'), { times: ['09:00 AM'] });
    await setDoc(doc(db, 'orders', 'o1'), { ownerUid: 'pat', status: 'Placed', kind: 'medicine' });
  });
});

const fs = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();

describe('access without a role', () => {
  test('signed-out users read nothing', async () => {
    await assertFails(getDoc(doc(fs(null), 'patients/p1')));
    await assertFails(getDoc(doc(fs(null), 'appointments/a1')));
  });
  test('signed-in user without a users doc reads nothing', async () => {
    await assertFails(getDoc(doc(fs('stranger'), 'patients/p1')));
    await assertFails(getDoc(doc(fs('stranger'), 'patients/p1/records/r1')));
  });
});

describe('roles', () => {
  test('self-signup may only claim doctor', async () => {
    await assertSucceeds(setDoc(doc(fs('newdoc'), 'users/newdoc'), { role: 'doctor' }));
    await assertFails(setDoc(doc(fs('evil'), 'users/evil'), { role: 'admin' }));
  });
  test('nobody escalates their own role; admin can', async () => {
    await assertFails(updateDoc(doc(fs('doc1'), 'users/doc1'), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'users/recep'), { role: 'hospital_admin' }));
  });
  test('doctor directory is visible to signed-in users only', async () => {
    await assertSucceeds(getDoc(doc(fs('brandnew'), 'doctors/brandnew')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'doctors/doc1')));
    await assertFails(getDoc(doc(fs(null), 'doctors/doc1')));
  });
  test('patient sign-up writes role + own profile in one batch', async () => {
    const db = fs('fresh');
    const ok = writeBatch(db);
    ok.set(doc(db, 'users/fresh'), { role: 'patient' });
    ok.set(doc(db, 'patients/fresh'), { name: 'New', ownerUid: 'fresh' });
    await assertSucceeds(ok.commit());
    const db2 = fs('fresh2');
    const bad = writeBatch(db2);
    bad.set(doc(db2, 'users/fresh2'), { role: 'patient' });
    bad.set(doc(db2, 'patients/someoneelse'), { name: 'X', ownerUid: 'fresh2' });
    await assertFails(bad.commit());
  });
  test('self-signup may claim patient; patients cannot edit doctors', async () => {
    await assertSucceeds(setDoc(doc(fs('newpat'), 'users/newpat'), { role: 'patient' }));
    await assertFails(setDoc(doc(fs('pat'), 'doctors/doc1'), { fee: 1 }, { merge: true }));
  });
  test('doctors edit only their own profile', async () => {
    await assertSucceeds(setDoc(doc(fs('doc1'), 'doctors/doc1'), { name: 'Dr A2' }, { merge: true }));
    await assertFails(setDoc(doc(fs('doc2'), 'doctors/doc1'), { name: 'hacked' }, { merge: true }));
  });
});

describe('medical records', () => {
  test('clinical staff read records; billing does not', async () => {
    await assertSucceeds(getDoc(doc(fs('doc2'), 'patients/p1/records/r1')));
    await assertSucceeds(getDoc(doc(fs('recep'), 'patients/p1/records/r1')));
    await assertFails(getDoc(doc(fs('bill'), 'patients/p1/records/r1')));
  });
  test('billing can see the patient but not write it', async () => {
    await assertSucceeds(getDoc(doc(fs('bill'), 'patients/p1')));
    await assertFails(updateDoc(doc(fs('bill'), 'patients/p1'), { name: 'x' }));
  });
  test('only the authoring doctor or an admin edits a record', async () => {
    await assertFails(updateDoc(doc(fs('doc2'), 'patients/p1/records/r1'), { notes: 'x' }));
    await assertSucceeds(updateDoc(doc(fs('doc1'), 'patients/p1/records/r1'), { notes: 'x' }));
    await assertSucceeds(deleteDoc(doc(fs('admin'), 'patients/p1/records/r1')));
  });
});

describe('appointments', () => {
  test('reception books; billing cannot', async () => {
    await assertSucceeds(addDoc(collection(fs('recep'), 'appointments'), { patient: 'X' }));
    await assertFails(addDoc(collection(fs('bill'), 'appointments'), { patient: 'X' }));
  });
  test('only admins delete', async () => {
    await assertFails(deleteDoc(doc(fs('doc1'), 'appointments/a1')));
    await assertSucceeds(deleteDoc(doc(fs('admin'), 'appointments/a1')));
  });
});

describe('notifications', () => {
  test('only the owner reads them', async () => {
    await assertSucceeds(getDoc(doc(fs('doc1'), 'notifications/n1')));
    await assertFails(getDoc(doc(fs('doc2'), 'notifications/n1')));
  });
});

describe('portal collections', () => {
  test('only admins edit departments and staff', async () => {
    await assertSucceeds(setDoc(doc(fs('admin'), 'departments/d1'), { name: 'ENT' }));
    await assertFails(setDoc(doc(fs('recep'), 'departments/d1'), { name: 'ENT' }));
    await assertFails(setDoc(doc(fs('doc1'), 'staff/s1'), { name: 'X', role: 'Hospital Admin' }));
  });
  test('billing updates payments; nobody but admins deletes them', async () => {
    await assertSucceeds(setDoc(doc(fs('bill'), 'payments/p1'), { status: 'Paid' }));
    await assertFails(deleteDoc(doc(fs('bill'), 'payments/p1')));
    await assertFails(setDoc(doc(fs(null), 'payments/p2'), { status: 'Paid' }));
  });
  test('audit log is append-only, written as yourself, read by admins', async () => {
    const entry = (uid) => ({ uid, at: serverTimestamp(), action: 'Viewed Medical Records' });
    await assertSucceeds(addDoc(collection(fs('recep'), 'auditLogs'), entry('recep')));
    await assertFails(addDoc(collection(fs('recep'), 'auditLogs'), entry('admin')));
    await assertFails(addDoc(collection(fs('recep'), 'auditLogs'), { uid: 'recep', at: new Date(0) }));
    await assertFails(getDoc(doc(fs('recep'), 'auditLogs/l1')));
    await assertSucceeds(getDoc(doc(fs('admin'), 'auditLogs/l1')));
    await assertFails(updateDoc(doc(fs('admin'), 'auditLogs/l1'), { action: 'nothing to see' }));
    await assertFails(deleteDoc(doc(fs('admin'), 'auditLogs/l1')));
  });
});

describe('patient app', () => {
  const booking = (over = {}) => ({ patientId: 'pat', ownerUid: 'pat', doctorId: 'doc1', status: 'Confirmed', ...over });
  test('patients see only their own family, records and appointments', async () => {
    await assertSucceeds(getDoc(doc(fs('pat'), 'patients/pat')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'patients/pat/records/r9')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'appointments/a2')));
    await assertFails(getDoc(doc(fs('pat2'), 'patients/pat')));
    await assertFails(getDoc(doc(fs('pat2'), 'patients/pat/records/r9')));
    await assertFails(getDoc(doc(fs('pat'), 'patients/p1')));
    await assertFails(getDoc(doc(fs('pat'), 'appointments/a1')));
  });
  test('patients add family members they own and upload their own reports only', async () => {
    await assertSucceeds(setDoc(doc(fs('pat'), 'patients/kid'), { name: 'Kid', ownerUid: 'pat' }));
    await assertFails(setDoc(doc(fs('pat'), 'patients/x'), { name: 'X', ownerUid: 'pat2' }));
    await assertSucceeds(addDoc(collection(fs('pat'), 'patients/pat/records'), { type: 'Lab Report', uploadedBy: 'pat' }));
    await assertFails(addDoc(collection(fs('pat'), 'patients/pat/records'), { type: 'Consultation', doctorId: 'doc1' }));
    await assertFails(updateDoc(doc(fs('pat'), 'patients/pat/records/r9'), { diagnosis: 'none' }));
  });
  test('patients cannot create appointments directly (bookAppointment function does it)', async () => {
    await assertFails(setDoc(doc(fs('pat'), 'appointments/n1'), booking()));
    await assertSucceeds(setDoc(doc(fs('recep'), 'appointments/n2'), booking()));
  });
  test('patients may only cancel their bookings', async () => {
    await assertFails(updateDoc(doc(fs('pat'), 'appointments/a3'), { status: 'Completed' }));
    await assertFails(updateDoc(doc(fs('pat'), 'appointments/a3'), { status: 'Cancelled', doctorId: 'doc2' }));
    await assertSucceeds(updateDoc(doc(fs('pat'), 'appointments/a3'), { status: 'Cancelled' }));
  });
  test('patients read free slots but cannot touch token counters or booked slots', async () => {
    await assertSucceeds(getDoc(doc(fs('pat'), 'bookedSlots/doc1_2026-12-01')));
    await assertFails(setDoc(doc(fs('pat'), 'counters/appointments'), { next: 11 }));
    await assertFails(setDoc(doc(fs('pat'), 'bookedSlots/doc1_2026-12-01'), { times: ['09:00 AM', '09:30 AM'] }));
    await assertSucceeds(setDoc(doc(fs('doc1'), 'counters/appointments'), { next: 11 }));
  });
  test('chat is limited to the appointment owner and clinical staff', async () => {
    await assertSucceeds(addDoc(collection(fs('pat'), 'appointments/a2/messages'), { uid: 'pat', text: 'hi' }));
    await assertSucceeds(addDoc(collection(fs('doc1'), 'appointments/a2/messages'), { uid: 'doc1', text: 'hello' }));
    await assertFails(addDoc(collection(fs('pat2'), 'appointments/a2/messages'), { uid: 'pat2', text: 'hi' }));
    await assertFails(addDoc(collection(fs('pat'), 'appointments/a2/messages'), { uid: 'doc1', text: 'spoof' }));
  });
  test('reviews only for your own completed visit', async () => {
    await assertSucceeds(setDoc(doc(fs('pat'), 'doctors/doc1/reviews/a2'), { uid: 'pat', rating: 5 }));
    await assertFails(setDoc(doc(fs('pat'), 'doctors/doc1/reviews/a3'), { uid: 'pat', rating: 5 }));
    await assertFails(setDoc(doc(fs('pat2'), 'doctors/doc1/reviews/a2'), { uid: 'pat2', rating: 5 }));
    await assertFails(setDoc(doc(fs('pat'), 'doctors/doc2/reviews/a2'), { uid: 'pat', rating: 5 }));
    await assertFails(setDoc(doc(fs('pat'), 'doctors/doc1/reviews/a2'), { uid: 'pat', rating: 9 }));
  });
  test('orders: patients place and cancel their own; staff fulfil; catalog is admin-only', async () => {
    await assertSucceeds(addDoc(collection(fs('pat'), 'orders'), { ownerUid: 'pat', status: 'Placed' }));
    await assertFails(addDoc(collection(fs('pat'), 'orders'), { ownerUid: 'pat', status: 'Delivered' }));
    await assertFails(getDoc(doc(fs('pat2'), 'orders/o1')));
    await assertFails(updateDoc(doc(fs('pat'), 'orders/o1'), { status: 'Delivered' }));
    await assertSucceeds(updateDoc(doc(fs('recep'), 'orders/o1'), { status: 'Confirmed' }));
    await assertFails(setDoc(doc(fs('pat'), 'medicines/m1'), { name: 'x', price: 0 }));
    await assertSucceeds(setDoc(doc(fs('admin'), 'medicines/m1'), { name: 'x', price: 1 }));
  });
  test('patients cannot reach staff-only data', async () => {
    await assertFails(getDoc(doc(fs('pat'), 'payments/p1')));
    await assertFails(addDoc(collection(fs('pat'), 'auditLogs'), { uid: 'pat', at: serverTimestamp() }));
  });
});

describe('hospital billing, pharmacy, IPD', () => {
  const seed = async () => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'pharm'), { role: 'pharmacist' });
    await setDoc(doc(db, 'invoices', 'i1'), { status: 'Partial', total: 100, paid: 40, due: 60, lines: [] });
    await setDoc(doc(db, 'drugs', 'd1'), { name: 'Para', stock: 10, mrp: 30 });
    await setDoc(doc(db, 'stockBatches', 'sb1'), { drugId: 'd1', qty: 10, expiry: '2027-01' });
    await setDoc(doc(db, 'beds', 'b1'), { status: 'Free', label: 'GW-01' });
  });
  const rcpt = (uid, amount) => ({ uid, amount, at: serverTimestamp(), mode: 'Cash' });

  test('billing desk creates invoices and records payments; nobody deletes invoices', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(fs('bill'), 'invoices/i2'), { status: 'Unpaid', total: 10, paid: 0, due: 10 }));
    await assertFails(setDoc(doc(fs('doc1'), 'invoices/i3'), { status: 'Unpaid' }));
    await assertSucceeds(updateDoc(doc(fs('bill'), 'invoices/i1'), { paid: 100, due: 0, status: 'Paid' }));
    await assertFails(updateDoc(doc(fs('bill'), 'invoices/i1'), { total: 1 }));
    await assertFails(deleteDoc(doc(fs('admin'), 'invoices/i1')));
  });
  test('only admins cancel invoices', async () => {
    await seed();
    await assertFails(updateDoc(doc(fs('bill'), 'invoices/i1'), { status: 'Cancelled', due: 0 }));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'invoices/i1'), { status: 'Cancelled', due: 0, cancelReason: 'dup' }));
  });
  test('receipts are append-only, signed by the writer; refunds need an admin', async () => {
    await seed();
    await assertSucceeds(addDoc(collection(fs('bill'), 'receipts'), rcpt('bill', 50)));
    await assertFails(addDoc(collection(fs('bill'), 'receipts'), rcpt('admin', 50)));
    await assertFails(addDoc(collection(fs('bill'), 'receipts'), rcpt('bill', -50)));
    await assertSucceeds(addDoc(collection(fs('admin'), 'receipts'), rcpt('admin', -50)));
    await assertFails(addDoc(collection(fs('doc1'), 'receipts'), rcpt('doc1', 50)));
    await assertFails(addDoc(collection(fs('pat'), 'receipts'), rcpt('pat', 50)));
  });
  test('pharmacists manage items and stock; billing may only change stock counts', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(fs('pharm'), 'drugs/d2'), { name: 'New', mrp: 10, stock: 0 }));
    await assertSucceeds(updateDoc(doc(fs('bill'), 'stockBatches/sb1'), { qty: 8 }));
    await assertSucceeds(updateDoc(doc(fs('bill'), 'drugs/d1'), { stock: 8 }));
    await assertFails(updateDoc(doc(fs('bill'), 'drugs/d1'), { mrp: 1 }));
    await assertFails(setDoc(doc(fs('doc1'), 'stockBatches/sb9'), { drugId: 'd1', qty: 999 }));
    await assertFails(getDoc(doc(fs('pat'), 'drugs/d1')));
  });
  test('beds and admissions: clinical or billing staff admit; patients see nothing', async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(fs('recep'), 'beds/b1'), { status: 'Occupied' }));
    await assertSucceeds(setDoc(doc(fs('recep'), 'admissions/ad1'), { status: 'Admitted' }));
    await assertSucceeds(addDoc(collection(fs('doc1'), 'admissions/ad1/charges'), { name: 'Dressing', qty: 1, rate: 200 }));
    await assertFails(setDoc(doc(fs('recep'), 'wards/w1'), { name: 'GW' }));
    await assertFails(getDoc(doc(fs('pat'), 'beds/b1')));
  });
});

describe('claims, voice calls, reminders, deletion requests', () => {
  test('insurance claims: billing desks create and update; doctors read only; patients nothing', async () => {
    await assertSucceeds(setDoc(doc(fs('bill'), 'claims/c1'), { patientName: 'Ravi', stage: 'Pre-auth Requested' }));
    await assertSucceeds(updateDoc(doc(fs('recep'), 'claims/c1'), { stage: 'Pre-auth Approved' }));
    await assertSucceeds(getDoc(doc(fs('doc1'), 'claims/c1')));
    await assertFails(updateDoc(doc(fs('doc1'), 'claims/c1'), { stage: 'Settled' }));
    await assertFails(getDoc(doc(fs('pat'), 'claims/c1')));
    await assertFails(deleteDoc(doc(fs('admin'), 'claims/c1')));
  });
  test('voice-call log: staff read, nobody writes from the client', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'voiceCalls/CA1'), { status: 'Booked' }));
    await assertSucceeds(getDoc(doc(fs('recep'), 'voiceCalls/CA1')));
    await assertFails(getDoc(doc(fs('pat'), 'voiceCalls/CA1')));
    await assertFails(setDoc(doc(fs('admin'), 'voiceCalls/CA2'), { status: 'Booked' }));
  });
  test('medicine reminders belong to their owner', async () => {
    await assertSucceeds(setDoc(doc(fs('pat'), 'reminders/r1'), { ownerUid: 'pat', medicine: 'Para' }));
    await assertFails(setDoc(doc(fs('pat'), 'reminders/r2'), { ownerUid: 'pat2', medicine: 'Para' }));
    await assertFails(getDoc(doc(fs('pat2'), 'reminders/r1')));
    await assertSucceeds(deleteDoc(doc(fs('pat'), 'reminders/r1')));
  });
  test('data-deletion requests: only for yourself; admins review', async () => {
    await assertSucceeds(setDoc(doc(fs('pat'), 'deletionRequests/pat'), { uid: 'pat', status: 'Pending' }));
    await assertFails(setDoc(doc(fs('pat'), 'deletionRequests/pat2'), { uid: 'pat2', status: 'Pending' }));
    await assertFails(updateDoc(doc(fs('pat'), 'deletionRequests/pat'), { status: 'Done' }));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'deletionRequests/pat'), { status: 'Done' }));
  });
});

describe('storage', () => {
  test('patients upload to their own family records and prescriptions only', async () => {
    await assertSucceeds(uploadString(ref(st('pat'), 'records/pat/cbc.txt'), 'ok'));
    await assertFails(uploadString(ref(st('pat2'), 'records/pat/cbc.txt'), 'no'));
    await assertSucceeds(uploadString(ref(st('pat'), 'prescriptions/pat/rx.txt'), 'ok'));
    await assertFails(uploadString(ref(st('pat'), 'prescriptions/pat2/rx.txt'), 'no'));
  });
  test('clinical staff upload lab reports; billing and strangers cannot', async () => {
    await assertSucceeds(uploadString(ref(st('doc1'), 'records/p1/cbc.txt'), 'ok'));
    await assertFails(uploadString(ref(st('bill'), 'records/p1/cbc.txt'), 'no'));
    await assertFails(uploadString(ref(st(null), 'records/p1/cbc.txt'), 'no'));
  });
  test('doctors upload only their own avatar image', async () => {
    await assertSucceeds(uploadString(ref(st('doc1'), 'doctors/doc1/a.png'), 'x', 'raw', { contentType: 'image/png' }));
    await assertFails(uploadString(ref(st('doc2'), 'doctors/doc1/a.png'), 'x', 'raw', { contentType: 'image/png' }));
    await assertFails(uploadString(ref(st('doc1'), 'doctors/doc1/a.exe'), 'x', 'raw', { contentType: 'application/x-msdownload' }));
  });
});
