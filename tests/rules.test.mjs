// Security-rules tests for firestore.rules + storage.rules. Run: npm run test:rules
// (starts the Firestore + Storage emulators, runs this file, shuts them down).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';

let env;
// Hospital h1 staff unless noted. h2 is a second customer hospital, h3 is suspended.
const USERS = {
  owner: { role: 'super_admin' },
  admin: { role: 'admin', hospitalId: 'h1' },
  doc1: { role: 'doctor', hospitalId: 'h1' },
  doc2: { role: 'doctor', hospitalId: 'h1' },
  nurse: { role: 'nurse', hospitalId: 'h1' },
  recep: { role: 'receptionist', hospitalId: 'h1' },
  bill: { role: 'billing', hospitalId: 'h1' },
  ops: { role: 'admin_staff', hospitalId: 'h1' },
  off: { role: 'receptionist', hospitalId: 'h1', active: false },
  admin2: { role: 'hospital_admin', hospitalId: 'h2' },
  recep2: { role: 'receptionist', hospitalId: 'h2' },
  doc3: { role: 'doctor', hospitalId: 'h2' },
  susp: { role: 'receptionist', hospitalId: 'h3' },
  pat: { role: 'patient' },
  pat2: { role: 'patient' },
};
const H1 = { hospitalId: 'h1' };

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
    await setDoc(doc(db, 'hospitals/h1'), { name: 'City Hospital', status: 'Active', plan: 'Pro' });
    await setDoc(doc(db, 'hospitals/h2'), { name: 'Lake Clinic', status: 'Active', plan: 'Basic' });
    await setDoc(doc(db, 'hospitals/h3'), { name: 'Old Care', status: 'Suspended', plan: 'Basic' });
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(db, 'users', uid), u);
    await setDoc(doc(db, 'doctors', 'doc1'), { name: 'Dr A', ...H1 });
    await setDoc(doc(db, 'doctors', 'doc2'), { name: 'Dr B', ...H1 });
    await setDoc(doc(db, 'doctors', 'doc3'), { name: 'Dr C', hospitalId: 'h2' });
    await setDoc(doc(db, 'patients', 'p1'), { name: 'Ravi', hospitalIds: ['h1'] });
    await setDoc(doc(db, 'patients', 'p1', 'records', 'r1'), { type: 'Note', doctorId: 'doc1', ...H1 });
    await setDoc(doc(db, 'patients', 'p2'), { name: 'Lakshmi', hospitalIds: ['h2'] });
    await setDoc(doc(db, 'appointments', 'a1'), { patient: 'Ravi', doctorId: 'doc1', status: 'Confirmed', ...H1 });
    await setDoc(doc(db, 'appointments', 'b1'), { patient: 'Lakshmi', doctorId: 'doc3', status: 'Confirmed', hospitalId: 'h2' });
    await setDoc(doc(db, 'notifications', 'n1'), { userId: 'doc1', read: false });
    await setDoc(doc(db, 'auditLogs', 'l1'), { uid: 'recep', action: 'Viewed Medical Records', ...H1 });
    await setDoc(doc(db, 'auditLogs', 'l2'), { uid: 'recep2', action: 'Login', hospitalId: 'h2' });
    // Asha uses the patient app and has visited both hospitals.
    await setDoc(doc(db, 'patients', 'pat'), { name: 'Asha', ownerUid: 'pat', hospitalIds: ['h1', 'h2'] });
    await setDoc(doc(db, 'patients', 'pat', 'records', 'r9'), { type: 'Consultation', doctorId: 'doc1', ...H1 });
    await setDoc(doc(db, 'patients', 'pat', 'records', 'r8'), { type: 'Consultation', doctorId: 'doc3', hospitalId: 'h2' });
    await setDoc(doc(db, 'appointments', 'a2'), { patientId: 'pat', ownerUid: 'pat', doctorId: 'doc1', status: 'Completed', ...H1 });
    await setDoc(doc(db, 'appointments', 'a3'), { patientId: 'pat', ownerUid: 'pat', doctorId: 'doc1', status: 'Confirmed', ...H1 });
    await setDoc(doc(db, 'counters', 'doc1_2026-12-01'), { next: 10 });
    await setDoc(doc(db, 'bookedSlots', 'doc1_2026-12-01'), { times: ['09:00 AM'] });
    await setDoc(doc(db, 'orders', 'o1'), { ownerUid: 'pat', status: 'Placed', kind: 'medicine', ...H1 });
  });
});

const fs = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const by = (uid, data = {}) => ({ ...data, updatedBy: uid });

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

describe('hospital isolation (multi-tenant)', () => {
  test("staff never read another hospital's patients, records, appointments or audit", async () => {
    await assertSucceeds(getDoc(doc(fs('recep'), 'patients/p1')));
    await assertFails(getDoc(doc(fs('recep'), 'patients/p2')));
    await assertFails(getDoc(doc(fs('admin2'), 'patients/p1')));
    await assertFails(getDoc(doc(fs('doc3'), 'patients/p1/records/r1')));
    await assertFails(getDoc(doc(fs('doc3'), 'appointments/a1')));
    await assertFails(getDoc(doc(fs('admin2'), 'auditLogs/l1')));
    await assertSucceeds(getDoc(doc(fs('admin2'), 'auditLogs/l2')));
  });
  test('a shared patient: each hospital sees the demographics but only its own records', async () => {
    await assertSucceeds(getDoc(doc(fs('doc1'), 'patients/pat')));
    await assertSucceeds(getDoc(doc(fs('doc3'), 'patients/pat')));
    await assertSucceeds(getDoc(doc(fs('doc1'), 'patients/pat/records/r9')));
    await assertFails(getDoc(doc(fs('doc1'), 'patients/pat/records/r8')));
    await assertSucceeds(getDoc(doc(fs('doc3'), 'patients/pat/records/r8')));
    await assertSucceeds(getDocs(query(collection(fs('doc1'), 'patients/pat/records'), where('hospitalId', '==', 'h1'))));
    await assertFails(getDocs(collection(fs('doc1'), 'patients/pat/records')));
  });
  test('list queries must be scoped to your hospital', async () => {
    await assertSucceeds(getDocs(query(collection(fs('recep'), 'appointments'), where('hospitalId', '==', 'h1'))));
    await assertFails(getDocs(query(collection(fs('recep'), 'appointments'), where('hospitalId', '==', 'h2'))));
    await assertFails(getDocs(collection(fs('recep'), 'appointments')));
    await assertSucceeds(getDocs(query(collection(fs('recep'), 'patients'), where('hospitalIds', 'array-contains', 'h1'))));
    await assertFails(getDocs(query(collection(fs('recep'), 'patients'), where('hospitalIds', 'array-contains', 'h2'))));
  });
  test('writes are stamped with your own hospital and can never move to another', async () => {
    await assertSucceeds(setDoc(doc(fs('recep'), 'appointments/n1'), by('recep', { patient: 'X', ...H1 })));
    await assertFails(setDoc(doc(fs('recep'), 'appointments/n2'), by('recep', { patient: 'X', hospitalId: 'h2' })));
    await assertFails(setDoc(doc(fs('recep'), 'appointments/n3'), by('recep', { patient: 'X' })));
    await assertFails(updateDoc(doc(fs('recep'), 'appointments/a1'), by('recep', { hospitalId: 'h2' })));
    await assertFails(updateDoc(doc(fs('recep2'), 'appointments/a1'), by('recep2', { status: 'Cancelled' })));
  });
  test('new walk-in patients belong to your hospital only; nobody edits hospitalIds', async () => {
    await assertSucceeds(setDoc(doc(fs('recep'), 'patients/w1'), by('recep', { name: 'Walk In', hospitalIds: ['h1'] })));
    await assertFails(setDoc(doc(fs('recep'), 'patients/w2'), by('recep', { name: 'Walk In', hospitalIds: ['h1', 'h2'] })));
    await assertFails(updateDoc(doc(fs('recep'), 'patients/pat'), by('recep', { hospitalIds: ['h1'] })));
    await assertSucceeds(updateDoc(doc(fs('recep'), 'patients/pat'), by('recep', { phone: '9845673221' })));
    await assertFails(updateDoc(doc(fs('pat'), 'patients/pat'), { hospitalIds: ['h1', 'h2', 'h9'] }));
  });
  test('changes to audited records must name the writer (updatedBy)', async () => {
    await assertFails(updateDoc(doc(fs('recep'), 'appointments/a1'), { status: 'Checked In' }));
    await assertFails(updateDoc(doc(fs('recep'), 'appointments/a1'), { status: 'Checked In', updatedBy: 'doc1' }));
    await assertSucceeds(updateDoc(doc(fs('recep'), 'appointments/a1'), by('recep', { status: 'Checked In' })));
  });
  test('disabled staff and suspended hospitals are locked out', async () => {
    await assertFails(getDoc(doc(fs('off'), 'patients/p1')));
    await assertFails(setDoc(doc(fs('off'), 'appointments/n1'), by('off', { patient: 'X', ...H1 })));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'patients/p3'), { name: 'Old', hospitalIds: ['h3'] }));
    await assertFails(getDoc(doc(fs('susp'), 'patients/p3')));
  });
  test('booking counters and slots: only the doctor’s own hospital', async () => {
    await assertSucceeds(setDoc(doc(fs('recep'), 'counters/doc1_2026-12-01'), { next: 11 }));
    await assertFails(setDoc(doc(fs('recep2'), 'counters/doc1_2026-12-01'), { next: 11 }));
    await assertFails(setDoc(doc(fs('recep2'), 'bookedSlots/doc1_2026-12-01'), { times: [] }));
    await assertSucceeds(setDoc(doc(fs('bill'), 'counters/h1_inv_OPD_MAIN_2026'), { next: 1 }));
    await assertFails(setDoc(doc(fs('recep2'), 'counters/h1_inv_OPD_MAIN_2026'), { next: 1 }));
  });
});

describe('super admin (platform owner)', () => {
  test('creates, suspends and plans hospitals; hospital admins only edit their own profile', async () => {
    await assertSucceeds(setDoc(doc(fs('owner'), 'hospitals/h9'), { name: 'New', status: 'Active', plan: 'Pro' }));
    await assertSucceeds(updateDoc(doc(fs('owner'), 'hospitals/h2'), { status: 'Suspended' }));
    await assertFails(setDoc(doc(fs('admin'), 'hospitals/h8'), { name: 'Mine', status: 'Active' }));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'hospitals/h1'), { phone: '044 1234' }));
    await assertFails(updateDoc(doc(fs('admin'), 'hospitals/h1'), { plan: 'Enterprise' }));
    await assertFails(updateDoc(doc(fs('admin'), 'hospitals/h2'), { phone: '0' }));
  });
  test('reads every hospital’s data and audit trail', async () => {
    await assertSucceeds(getDoc(doc(fs('owner'), 'patients/p2')));
    await assertSucceeds(getDoc(doc(fs('owner'), 'patients/pat/records/r8')));
    await assertSucceeds(getDocs(collection(fs('owner'), 'appointments')));
    await assertSucceeds(getDocs(collection(fs('owner'), 'auditLogs')));
    await assertSucceeds(getDoc(doc(fs('owner'), 'users/admin2')));
  });
  test('nobody can make themselves (or anyone) a super admin', async () => {
    await assertFails(setDoc(doc(fs('evil'), 'users/evil'), { role: 'super_admin' }));
    await assertFails(updateDoc(doc(fs('admin'), 'users/recep'), by('admin', { role: 'super_admin' })));
    await assertSucceeds(updateDoc(doc(fs('owner'), 'users/admin2'), { role: 'admin' }));
  });
});

describe('hospital admin: users, roles and categories', () => {
  test('creates and edits staff of their own hospital only', async () => {
    await assertSucceeds(setDoc(doc(fs('admin'), 'users/newnurse'), by('admin', { role: 'nurse', ...H1 })));
    await assertFails(setDoc(doc(fs('admin'), 'users/x'), by('admin', { role: 'nurse', hospitalId: 'h2' })));
    await assertFails(setDoc(doc(fs('admin'), 'users/y'), by('admin', { role: 'patient', ...H1 })));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'users/recep'), by('admin', { role: 'billing' })));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'users/recep'), by('admin', { active: false })));
    await assertFails(updateDoc(doc(fs('admin'), 'users/recep2'), by('admin', { active: false })));
    await assertFails(updateDoc(doc(fs('admin'), 'users/recep'), by('admin', { hospitalId: 'h2' })));
    await assertSucceeds(getDoc(doc(fs('admin'), 'users/nurse')));
    await assertFails(getDoc(doc(fs('admin'), 'users/doc3')));
  });
  test('nobody changes their own role, hospital or lock', async () => {
    await assertFails(updateDoc(doc(fs('doc1'), 'users/doc1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(fs('doc1'), 'users/doc1'), { hospitalId: 'h2' }));
    await assertFails(updateDoc(doc(fs('off'), 'users/off'), { active: true }));
    await assertSucceeds(updateDoc(doc(fs('doc1'), 'users/doc1'), { name: 'Dr A' }));
  });
});

describe('roles and sign-up', () => {
  test('doctors self-register locked until their hospital admin enables them', async () => {
    await assertSucceeds(setDoc(doc(fs('newdoc'), 'users/newdoc'), { role: 'doctor', hospitalId: 'h1', active: false }));
    await assertFails(setDoc(doc(fs('newdoc2'), 'users/newdoc2'), { role: 'doctor', hospitalId: 'h1' }));
    await assertFails(setDoc(doc(fs('evil'), 'users/evil'), { role: 'admin', hospitalId: 'h1', active: false }));
    await assertFails(getDoc(doc(fs('newdoc'), 'patients/p1')));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'users/newdoc'), by('admin', { active: true })));
    await assertSucceeds(getDoc(doc(fs('newdoc'), 'patients/p1')));
  });
  test('a doctor who signed up without a hospital names one once, by code, and stays locked', async () => {
    await assertSucceeds(setDoc(doc(fs('gdoc'), 'users/gdoc'), { role: 'doctor', active: false }));
    await assertSucceeds(setDoc(doc(fs('gdoc'), 'doctors/gdoc'), { name: 'Dr G', profileComplete: false }));
    await assertFails(updateDoc(doc(fs('gdoc'), 'users/gdoc'), { hospitalId: 'nowhere' }));
    await assertFails(updateDoc(doc(fs('gdoc'), 'users/gdoc'), { hospitalId: 'h1', active: true }));
    await assertSucceeds(updateDoc(doc(fs('gdoc'), 'users/gdoc'), { hospitalId: 'h1' }));
    await assertFails(updateDoc(doc(fs('gdoc'), 'users/gdoc'), { hospitalId: 'h2' }));
    await assertSucceeds(updateDoc(doc(fs('gdoc'), 'doctors/gdoc'), { hospitalId: 'h1', hospital: 'City Hospital' }));
    await assertFails(getDoc(doc(fs('gdoc'), 'patients/p1')));
  });
  test('doctor directory is visible to signed-in users only', async () => {
    await assertSucceeds(getDoc(doc(fs('brandnew'), 'doctors/brandnew')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'doctors/doc3')));
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
    await assertFails(setDoc(doc(fs('fresh3'), 'users/fresh3'), { role: 'patient', hospitalId: 'h1' }));
  });
  test('patients cannot edit doctors', async () => {
    await assertFails(setDoc(doc(fs('pat'), 'doctors/doc1'), { fee: 1 }, { merge: true }));
  });
  test('doctors edit only their own profile, inside their own hospital', async () => {
    await assertSucceeds(setDoc(doc(fs('doc1'), 'doctors/doc1'), { name: 'Dr A2' }, { merge: true }));
    await assertFails(setDoc(doc(fs('doc2'), 'doctors/doc1'), { name: 'hacked' }, { merge: true }));
    await assertFails(setDoc(doc(fs('doc1'), 'doctors/doc1'), { hospitalId: 'h2' }, { merge: true }));
    await assertFails(setDoc(doc(fs('admin2'), 'doctors/doc1'), { hospitalId: 'h2' }, { merge: true }));
    await assertSucceeds(setDoc(doc(fs('admin'), 'doctors/doc2'), { fee: 900 }, { merge: true }));
  });
});

describe('medical records', () => {
  test('clinical staff read records; billing does not', async () => {
    await assertSucceeds(getDoc(doc(fs('doc2'), 'patients/p1/records/r1')));
    await assertSucceeds(getDoc(doc(fs('nurse'), 'patients/p1/records/r1')));
    await assertFails(getDoc(doc(fs('bill'), 'patients/p1/records/r1')));
  });
  test('billing can see the patient but not write it', async () => {
    await assertSucceeds(getDoc(doc(fs('bill'), 'patients/p1')));
    await assertFails(updateDoc(doc(fs('bill'), 'patients/p1'), by('bill', { name: 'x' })));
  });
  test('records are written into your own hospital for its patients', async () => {
    await assertSucceeds(addDoc(collection(fs('doc1'), 'patients/p1/records'), by('doc1', { type: 'Note', doctorId: 'doc1', ...H1 })));
    await assertFails(addDoc(collection(fs('doc1'), 'patients/p2/records'), by('doc1', { type: 'Note', doctorId: 'doc1', ...H1 })));
  });
  test('only the authoring doctor or an admin edits a record', async () => {
    await assertFails(updateDoc(doc(fs('doc2'), 'patients/p1/records/r1'), by('doc2', { notes: 'x' })));
    await assertSucceeds(updateDoc(doc(fs('doc1'), 'patients/p1/records/r1'), by('doc1', { notes: 'x' })));
    await assertSucceeds(deleteDoc(doc(fs('admin'), 'patients/p1/records/r1')));
  });
});

describe('appointments', () => {
  test('reception books; billing cannot', async () => {
    await assertSucceeds(addDoc(collection(fs('recep'), 'appointments'), by('recep', { patient: 'X', ...H1 })));
    await assertFails(addDoc(collection(fs('bill'), 'appointments'), by('bill', { patient: 'X', ...H1 })));
  });
  test('only admins delete', async () => {
    await assertFails(deleteDoc(doc(fs('doc1'), 'appointments/a1')));
    await assertFails(deleteDoc(doc(fs('admin2'), 'appointments/a1')));
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
    await assertSucceeds(setDoc(doc(fs('admin'), 'departments/d1'), { name: 'ENT', ...H1 }));
    await assertFails(setDoc(doc(fs('recep'), 'departments/d1'), { name: 'ENT', ...H1 }));
    await assertFails(setDoc(doc(fs('doc1'), 'staff/s1'), { name: 'X', role: 'Hospital Admin', ...H1 }));
  });
  test('billing updates payments; nobody but admins deletes them', async () => {
    await assertSucceeds(setDoc(doc(fs('bill'), 'payments/p1'), { status: 'Paid', ...H1 }));
    await assertFails(deleteDoc(doc(fs('bill'), 'payments/p1')));
    await assertFails(setDoc(doc(fs(null), 'payments/p2'), { status: 'Paid', ...H1 }));
  });
  test('audit log is append-only, written as yourself into your hospital, read by its admins', async () => {
    const entry = (uid, h = 'h1') => ({ uid, at: serverTimestamp(), action: 'Login', hospitalId: h });
    await assertSucceeds(addDoc(collection(fs('recep'), 'auditLogs'), entry('recep')));
    await assertFails(addDoc(collection(fs('recep'), 'auditLogs'), entry('admin')));
    await assertFails(addDoc(collection(fs('recep'), 'auditLogs'), entry('recep', 'h2')));
    await assertFails(addDoc(collection(fs('recep'), 'auditLogs'), { uid: 'recep', at: new Date(0), ...H1 }));
    await assertFails(getDoc(doc(fs('recep'), 'auditLogs/l1')));
    await assertSucceeds(getDoc(doc(fs('admin'), 'auditLogs/l1')));
    await assertFails(updateDoc(doc(fs('admin'), 'auditLogs/l1'), { action: 'nothing to see' }));
    await assertFails(deleteDoc(doc(fs('admin'), 'auditLogs/l1')));
  });
  test('equipment and service records: administration keeps them, everyone reads, nobody else edits', async () => {
    const asset = by('ops', { name: 'MRI 1.5T', serial: 'X1', cost: 4500000, ...H1 });
    await assertSucceeds(setDoc(doc(fs('ops'), 'assets/m1'), asset));
    await assertFails(setDoc(doc(fs('doc1'), 'assets/m2'), by('doc1', { name: 'ECG', ...H1 })));
    await assertSucceeds(getDoc(doc(fs('doc1'), 'assets/m1')));
    await assertFails(getDoc(doc(fs('doc3'), 'assets/m1')));
    await assertSucceeds(addDoc(collection(fs('ops'), 'maintenance'), by('ops', { assetId: 'm1', type: 'Preventive', cost: 12000, ...H1 })));
    await assertFails(addDoc(collection(fs('nurse'), 'maintenance'), by('nurse', { assetId: 'm1', ...H1 })));
    await assertFails(deleteDoc(doc(fs('ops'), 'assets/m1')));
  });
});

describe('patient app', () => {
  test('patients see only their own family, records and appointments', async () => {
    await assertSucceeds(getDoc(doc(fs('pat'), 'patients/pat')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'patients/pat/records/r9')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'patients/pat/records/r8')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'appointments/a2')));
    await assertFails(getDoc(doc(fs('pat2'), 'patients/pat')));
    await assertFails(getDoc(doc(fs('pat2'), 'patients/pat/records/r9')));
    await assertFails(getDoc(doc(fs('pat'), 'patients/p1')));
    await assertFails(getDoc(doc(fs('pat'), 'appointments/a1')));
  });
  test('patients add family members they own and upload their own reports, private or shared with one hospital', async () => {
    await assertSucceeds(setDoc(doc(fs('pat'), 'patients/kid'), { name: 'Kid', ownerUid: 'pat' }));
    await assertFails(setDoc(doc(fs('pat'), 'patients/kid2'), { name: 'Kid', ownerUid: 'pat', hospitalIds: ['h1'] }));
    await assertFails(setDoc(doc(fs('pat'), 'patients/x'), { name: 'X', ownerUid: 'pat2' }));
    await assertSucceeds(addDoc(collection(fs('pat'), 'patients/pat/records'), { type: 'Lab Report', uploadedBy: 'pat', hospitalId: '' }));
    await assertSucceeds(addDoc(collection(fs('pat'), 'patients/pat/records'), { type: 'Lab Report', uploadedBy: 'pat', hospitalId: 'h2' }));
    await assertFails(addDoc(collection(fs('pat'), 'patients/pat/records'), { type: 'Lab Report', uploadedBy: 'pat', hospitalId: 'h3' }));
    await assertFails(addDoc(collection(fs('pat'), 'patients/pat/records'), { type: 'Consultation', doctorId: 'doc1' }));
    await assertFails(updateDoc(doc(fs('pat'), 'patients/pat/records/r9'), { diagnosis: 'none' }));
  });
  test('patients cannot create appointments directly (bookAppointment function does it)', async () => {
    await assertFails(setDoc(doc(fs('pat'), 'appointments/n1'), by('pat', { patientId: 'pat', ownerUid: 'pat', doctorId: 'doc1', status: 'Confirmed', ...H1 })));
  });
  test('patients may only cancel their bookings', async () => {
    await assertFails(updateDoc(doc(fs('pat'), 'appointments/a3'), by('pat', { status: 'Completed' })));
    await assertFails(updateDoc(doc(fs('pat'), 'appointments/a3'), by('pat', { status: 'Cancelled', doctorId: 'doc2' })));
    await assertSucceeds(updateDoc(doc(fs('pat'), 'appointments/a3'), by('pat', { status: 'Cancelled' })));
  });
  test('patients read free slots but cannot touch token counters or booked slots', async () => {
    await assertSucceeds(getDoc(doc(fs('pat'), 'bookedSlots/doc1_2026-12-01')));
    await assertFails(setDoc(doc(fs('pat'), 'counters/doc1_2026-12-01'), { next: 11 }));
    await assertFails(setDoc(doc(fs('pat'), 'bookedSlots/doc1_2026-12-01'), { times: ['09:00 AM', '09:30 AM'] }));
    await assertSucceeds(setDoc(doc(fs('doc1'), 'counters/doc1_2026-12-01'), { next: 11 }));
  });
  test('chat is limited to the appointment owner and that hospital’s clinical staff', async () => {
    await assertSucceeds(addDoc(collection(fs('pat'), 'appointments/a2/messages'), { uid: 'pat', text: 'hi' }));
    await assertSucceeds(addDoc(collection(fs('doc1'), 'appointments/a2/messages'), { uid: 'doc1', text: 'hello' }));
    await assertFails(addDoc(collection(fs('doc3'), 'appointments/a2/messages'), { uid: 'doc3', text: 'hello' }));
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
  test('orders: patients place with a real hospital and cancel their own; that hospital fulfils; catalog is the platform’s', async () => {
    await assertSucceeds(addDoc(collection(fs('pat'), 'orders'), { ownerUid: 'pat', status: 'Placed', ...H1 }));
    await assertFails(addDoc(collection(fs('pat'), 'orders'), { ownerUid: 'pat', status: 'Placed', hospitalId: 'nope' }));
    await assertFails(addDoc(collection(fs('pat'), 'orders'), { ownerUid: 'pat', status: 'Delivered', ...H1 }));
    await assertFails(getDoc(doc(fs('pat2'), 'orders/o1')));
    await assertFails(updateDoc(doc(fs('pat'), 'orders/o1'), { status: 'Delivered' }));
    await assertSucceeds(updateDoc(doc(fs('recep'), 'orders/o1'), { status: 'Confirmed' }));
    await assertFails(updateDoc(doc(fs('recep2'), 'orders/o1'), { status: 'Confirmed' }));
    await assertFails(setDoc(doc(fs('pat'), 'medicines/m1'), { name: 'x', price: 0 }));
    await assertFails(setDoc(doc(fs('admin'), 'medicines/m1'), { name: 'x', price: 1 }));
    await assertSucceeds(setDoc(doc(fs('owner'), 'medicines/m1'), { name: 'x', price: 1 }));
  });
  test('patients cannot reach staff-only data', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'payments/p1'), { status: 'Paid', ...H1 }));
    await assertFails(getDoc(doc(fs('pat'), 'payments/p1')));
    await assertFails(addDoc(collection(fs('pat'), 'auditLogs'), { uid: 'pat', at: serverTimestamp(), ...H1 }));
  });
});

describe('hospital billing, pharmacy, IPD', () => {
  const seed = async () => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'pharm'), { role: 'pharmacist', ...H1 });
    await setDoc(doc(db, 'invoices', 'i1'), { status: 'Partial', total: 100, paid: 40, due: 60, lines: [], ...H1 });
    await setDoc(doc(db, 'drugs', 'd1'), { name: 'Para', stock: 10, mrp: 30, ...H1 });
    await setDoc(doc(db, 'stockBatches', 'sb1'), { drugId: 'd1', qty: 10, expiry: '2027-01', ...H1 });
    await setDoc(doc(db, 'beds', 'b1'), { status: 'Free', label: 'GW-01', ...H1 });
  });
  const rcpt = (uid, amount, h = 'h1') => ({ uid, amount, at: serverTimestamp(), mode: 'Cash', hospitalId: h });

  test('billing desk creates invoices and records payments; nobody deletes invoices', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(fs('bill'), 'invoices/i2'), by('bill', { status: 'Unpaid', total: 10, paid: 0, due: 10, ...H1 })));
    await assertFails(setDoc(doc(fs('doc1'), 'invoices/i3'), by('doc1', { status: 'Unpaid', ...H1 })));
    await assertSucceeds(updateDoc(doc(fs('bill'), 'invoices/i1'), by('bill', { paid: 100, due: 0, status: 'Paid' })));
    await assertFails(updateDoc(doc(fs('bill'), 'invoices/i1'), by('bill', { total: 1 })));
    await assertFails(updateDoc(doc(fs('admin2'), 'invoices/i1'), by('admin2', { status: 'Cancelled' })));
    await assertFails(deleteDoc(doc(fs('admin'), 'invoices/i1')));
  });
  test('only admins cancel invoices', async () => {
    await seed();
    await assertFails(updateDoc(doc(fs('bill'), 'invoices/i1'), by('bill', { status: 'Cancelled', due: 0 })));
    await assertSucceeds(updateDoc(doc(fs('admin'), 'invoices/i1'), by('admin', { status: 'Cancelled', due: 0, cancelReason: 'dup' })));
  });
  test('receipts are append-only, signed by the writer; refunds need an admin', async () => {
    await seed();
    await assertSucceeds(addDoc(collection(fs('bill'), 'receipts'), rcpt('bill', 50)));
    await assertFails(addDoc(collection(fs('bill'), 'receipts'), rcpt('bill', 50, 'h2')));
    await assertFails(addDoc(collection(fs('bill'), 'receipts'), rcpt('admin', 50)));
    await assertFails(addDoc(collection(fs('bill'), 'receipts'), rcpt('bill', -50)));
    await assertSucceeds(addDoc(collection(fs('admin'), 'receipts'), rcpt('admin', -50)));
    await assertFails(addDoc(collection(fs('doc1'), 'receipts'), rcpt('doc1', 50)));
    await assertFails(addDoc(collection(fs('pat'), 'receipts'), rcpt('pat', 50)));
  });
  test('pharmacists manage items and stock; billing may only change stock counts', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(fs('pharm'), 'drugs/d2'), { name: 'New', mrp: 10, stock: 0, ...H1 }));
    await assertSucceeds(updateDoc(doc(fs('bill'), 'stockBatches/sb1'), { qty: 8 }));
    await assertSucceeds(updateDoc(doc(fs('bill'), 'drugs/d1'), { stock: 8 }));
    await assertFails(updateDoc(doc(fs('bill'), 'drugs/d1'), { mrp: 1 }));
    await assertFails(setDoc(doc(fs('doc1'), 'stockBatches/sb9'), { drugId: 'd1', qty: 999, ...H1 }));
    await assertFails(getDoc(doc(fs('pat'), 'drugs/d1')));
    await assertFails(getDoc(doc(fs('recep2'), 'drugs/d1')));
  });
  test('beds and admissions: clinical or billing staff admit; patients see nothing', async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(fs('recep'), 'beds/b1'), { status: 'Occupied' }));
    await assertSucceeds(setDoc(doc(fs('recep'), 'admissions/ad1'), { status: 'Admitted', ...H1 }));
    await assertSucceeds(addDoc(collection(fs('doc1'), 'admissions/ad1/charges'), { name: 'Dressing', qty: 1, rate: 200 }));
    await assertFails(addDoc(collection(fs('doc3'), 'admissions/ad1/charges'), { name: 'Dressing', qty: 1, rate: 200 }));
    await assertFails(setDoc(doc(fs('recep'), 'wards/w1'), { name: 'GW', ...H1 }));
    await assertFails(getDoc(doc(fs('pat'), 'beds/b1')));
  });
});

describe('claims, voice calls, reminders, deletion requests', () => {
  test('insurance claims: billing desks create and update; doctors read only; patients nothing', async () => {
    await assertSucceeds(setDoc(doc(fs('bill'), 'claims/c1'), { patientName: 'Ravi', stage: 'Pre-auth Requested', ...H1 }));
    await assertSucceeds(updateDoc(doc(fs('recep'), 'claims/c1'), { stage: 'Pre-auth Approved' }));
    await assertSucceeds(getDoc(doc(fs('doc1'), 'claims/c1')));
    await assertFails(updateDoc(doc(fs('doc1'), 'claims/c1'), { stage: 'Settled' }));
    await assertFails(getDoc(doc(fs('pat'), 'claims/c1')));
    await assertFails(deleteDoc(doc(fs('admin'), 'claims/c1')));
  });
  test('voice-call log: the hospital’s staff read, nobody writes from the client', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'voiceCalls/CA1'), { status: 'Booked', ...H1 }));
    await assertSucceeds(getDoc(doc(fs('recep'), 'voiceCalls/CA1')));
    await assertFails(getDoc(doc(fs('recep2'), 'voiceCalls/CA1')));
    await assertFails(getDoc(doc(fs('pat'), 'voiceCalls/CA1')));
    await assertFails(setDoc(doc(fs('admin'), 'voiceCalls/CA2'), { status: 'Booked', ...H1 }));
  });
  test('medicine reminders belong to their owner', async () => {
    await assertSucceeds(setDoc(doc(fs('pat'), 'reminders/r1'), { ownerUid: 'pat', medicine: 'Para' }));
    await assertFails(setDoc(doc(fs('pat'), 'reminders/r2'), { ownerUid: 'pat2', medicine: 'Para' }));
    await assertFails(getDoc(doc(fs('pat2'), 'reminders/r1')));
    await assertSucceeds(deleteDoc(doc(fs('pat'), 'reminders/r1')));
  });
  test('data-deletion requests: only for yourself; the platform reviews', async () => {
    await assertSucceeds(setDoc(doc(fs('pat'), 'deletionRequests/pat'), { uid: 'pat', status: 'Pending' }));
    await assertFails(setDoc(doc(fs('pat'), 'deletionRequests/pat2'), { uid: 'pat2', status: 'Pending' }));
    await assertFails(updateDoc(doc(fs('pat'), 'deletionRequests/pat'), { status: 'Done' }));
    await assertFails(updateDoc(doc(fs('admin'), 'deletionRequests/pat'), { status: 'Done' }));
    await assertSucceeds(updateDoc(doc(fs('owner'), 'deletionRequests/pat'), { status: 'Done' }));
  });
});

describe('storage', () => {
  test('patients upload to their own family records and prescriptions only', async () => {
    await assertSucceeds(uploadString(ref(st('pat'), 'records/pat/cbc.txt'), 'ok'));
    await assertFails(uploadString(ref(st('pat2'), 'records/pat/cbc.txt'), 'no'));
    await assertSucceeds(uploadString(ref(st('pat'), 'prescriptions/pat/rx.txt'), 'ok'));
    await assertFails(uploadString(ref(st('pat'), 'prescriptions/pat2/rx.txt'), 'no'));
  });
  test("clinical staff upload lab reports for their hospital's patients; billing, other hospitals and strangers cannot", async () => {
    await assertSucceeds(uploadString(ref(st('doc1'), 'records/p1/cbc.txt'), 'ok'));
    await assertFails(uploadString(ref(st('doc3'), 'records/p1/cbc.txt'), 'no'));
    await assertFails(uploadString(ref(st('bill'), 'records/p1/cbc.txt'), 'no'));
    await assertFails(uploadString(ref(st(null), 'records/p1/cbc.txt'), 'no'));
  });
  test('doctors upload only their own avatar image', async () => {
    await assertSucceeds(uploadString(ref(st('doc1'), 'doctors/doc1/a.png'), 'x', 'raw', { contentType: 'image/png' }));
    await assertFails(uploadString(ref(st('doc2'), 'doctors/doc1/a.png'), 'x', 'raw', { contentType: 'image/png' }));
    await assertFails(uploadString(ref(st('doc1'), 'doctors/doc1/a.exe'), 'x', 'raw', { contentType: 'application/x-msdownload' }));
  });
});

describe('hospital suite (lab, nursing, ER, OT, HRMS, stores, accounts, services)', () => {
  const lab = (extra = {}) => by('doc1', { patientId: 'pat', patientName: 'Asha', status: 'Ordered', tests: [], ...H1, ...extra });
  test('clinical staff write lab orders in their own hospital only, stamped by themselves', async () => {
    await assertSucceeds(setDoc(doc(fs('doc1'), 'labOrders/l1'), lab()));
    await assertFails(setDoc(doc(fs('doc1'), 'labOrders/l2'), { ...lab(), updatedBy: 'doc2' }));
    await assertFails(setDoc(doc(fs('doc1'), 'labOrders/l3'), lab({ hospitalId: 'h2' })));
    await assertFails(setDoc(doc(fs('bill'), 'labOrders/l4'), by('bill', lab())));
    await assertFails(getDoc(doc(fs('recep2'), 'labOrders/l1')));
    await assertSucceeds(getDoc(doc(fs('bill'), 'labOrders/l1')));
  });
  test('patients read only their own verified reports', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'labOrders/v1'), lab({ status: 'Verified' }));
      await setDoc(doc(ctx.firestore(), 'labOrders/v2'), lab({ status: 'Resulted' }));
      await setDoc(doc(ctx.firestore(), 'vitals/x1'), by('nurse', { patientId: 'pat', news2: 1, ...H1 }));
    });
    await assertSucceeds(getDoc(doc(fs('pat'), 'labOrders/v1')));
    await assertFails(getDoc(doc(fs('pat'), 'labOrders/v2')));
    await assertFails(getDoc(doc(fs('pat2'), 'labOrders/v1')));
    await assertSucceeds(getDoc(doc(fs('pat'), 'vitals/x1')));
    await assertSucceeds(getDocs(query(collection(fs('pat'), 'labOrders'), where('patientId', '==', 'pat'), where('status', '==', 'Verified'))));
  });
  test('vitals and medication charts: ward clinicians write, front desk cannot', async () => {
    await assertSucceeds(setDoc(doc(fs('nurse'), 'vitals/w1'), by('nurse', { patientId: 'p1', news2: 3, ...H1 })));
    await assertFails(setDoc(doc(fs('recep'), 'vitals/w2'), by('recep', { patientId: 'p1', ...H1 })));
    await assertFails(getDoc(doc(fs('bill'), 'vitals/w1')));
  });
  test('salaries and attendance are HR-only', async () => {
    await assertSucceeds(setDoc(doc(fs('ops'), 'employees/e1'), by('ops', { name: 'Meena', basic: 20000, ...H1 })));
    await assertFails(getDoc(doc(fs('doc1'), 'employees/e1')));
    await assertFails(getDoc(doc(fs('nurse'), 'employees/e1')));
    await assertSucceeds(setDoc(doc(fs('admin'), 'payroll/2026-11_e1'), by('admin', { net: 18000, ...H1 })));
    await assertFails(getDoc(doc(fs('admin2'), 'payroll/2026-11_e1')));
  });
  test('accounts: billing and admins only; hospital cannot be changed; only admins delete', async () => {
    await assertSucceeds(setDoc(doc(fs('bill'), 'expenses/x1'), by('bill', { amount: 500, ...H1 })));
    await assertFails(getDoc(doc(fs('recep'), 'expenses/x1')));
    await assertFails(updateDoc(doc(fs('bill'), 'expenses/x1'), by('bill', { hospitalId: 'h2' })));
    await assertFails(deleteDoc(doc(fs('bill'), 'expenses/x1')));
    await assertSucceeds(deleteDoc(doc(fs('admin'), 'expenses/x1')));
  });
  test('support services: any enabled staff; disabled, suspended and other hospitals refused', async () => {
    await assertSucceeds(setDoc(doc(fs('recep'), 'visitors/v1'), by('recep', { name: 'Kumar', status: 'In', ...H1 })));
    await assertFails(setDoc(doc(fs('off'), 'visitors/v2'), by('off', { name: 'X', ...H1 })));
    await assertFails(setDoc(doc(fs('susp'), 'visitors/v3'), by('susp', { name: 'X', hospitalId: 'h3' })));
    await assertFails(getDoc(doc(fs('recep2'), 'visitors/v1')));
    await assertSucceeds(getDoc(doc(fs('owner'), 'visitors/v1')));
  });
  test('patients read their own bills (any hospital), not other patients bills', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invoices/i1'), { patientId: 'pat', total: 500, status: 'Paid', ...H1 });
      await setDoc(doc(ctx.firestore(), 'invoices/i2'), { patientId: 'p1', total: 900, status: 'Paid', ...H1 });
    });
    await assertSucceeds(getDoc(doc(fs('pat'), 'invoices/i1')));
    await assertFails(getDoc(doc(fs('pat'), 'invoices/i2')));
    await assertFails(getDoc(doc(fs('pat2'), 'invoices/i1')));
    await assertSucceeds(getDocs(query(collection(fs('pat'), 'invoices'), where('patientId', '==', 'pat'))));
    await assertFails(updateDoc(doc(fs('pat'), 'invoices/i1'), { status: 'Cancelled' }));
  });
  test('insurance coverage: billing desk writes, patient reads own cover, analyser keys are server-only', async () => {
    await assertSucceeds(setDoc(doc(fs('recep'), 'insuranceCovers/c1'), by('recep', { patientId: 'pat', coverType: 'Life insurance', policyNo: 'LIC-1', status: 'Active', ...H1 })));
    await assertFails(setDoc(doc(fs('nurse'), 'insuranceCovers/c2'), by('nurse', { patientId: 'pat', ...H1 })));
    await assertSucceeds(getDoc(doc(fs('pat'), 'insuranceCovers/c1')));
    await assertFails(getDoc(doc(fs('pat2'), 'insuranceCovers/c1')));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'integrationKeys/h1'), { labKeyHash: 'x' }));
    await assertFails(getDoc(doc(fs('admin'), 'integrationKeys/h1')));
    await assertFails(setDoc(doc(fs('owner'), 'integrationKeys/h1'), { labKeyHash: 'y' }));
  });
  test('staff link a patient ABHA id (audited write)', async () => {
    await assertSucceeds(updateDoc(doc(fs('recep'), 'patients/p1'), by('recep', { abhaNumber: '12-3456-7890-1234', abhaAddress: 'ravi@sbx' })));
    await assertFails(updateDoc(doc(fs('recep2'), 'patients/p1'), by('recep2', { abhaNumber: '12-3456-7890-1234' })));
  });
  test('collections outside the suite map are not opened by the wildcard rule', async () => {
    await assertFails(setDoc(doc(fs('admin'), 'randomStuff/z1'), by('admin', H1)));
    await assertFails(getDoc(doc(fs('pat'), 'employees/e1')));
  });
});
