// Demo SaaS platform for the EMULATORS ONLY: two customer hospitals, a super admin, logins for every
// role, doctors with schedules, patients, today's/tomorrow's appointments with daily tokens, tariff,
// pharmacy stock, wards and beds, equipment with service records. Every hospital-owned doc carries hospitalId.
// Run after `npm run emulators`:  node scripts/seed-demo.mjs   (wipes emulator data first)
import { readFile } from 'node:fs/promises';

const PROJECT = 'demo-medical-ai';
const FS = `http://127.0.0.1:8181/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

// ---- Firestore REST encoding ----
const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  return { stringValue: String(v) };
};
async function put(path, data) {
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
}
async function account(email, password, displayName) {
  let r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, displayName, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.localId) throw new Error(`${email}: ${JSON.stringify(j.error)}`);
  return j.localId;
}

// ---- reset ----
await fetch(`http://127.0.0.1:8181/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

const ymd = (d) => d.toLocaleDateString('en-CA');
const now = new Date();
const today = ymd(now);
const tomorrow = ymd(new Date(now.getTime() + 86_400_000));
const consent = { version: '2026-11', at: now };

// ---- customer hospitals ----
const H1 = 'city-general';
const H2 = 'lake-view';
const HOSPITAL_1 = 'City General Hospital';
const ALL_MODULES = ['billing', 'pharmacy', 'ipd', 'telehealth', 'assets', 'voice', 'ai'];
await put(`hospitals/${H1}`, { name: HOSPITAL_1, city: 'Chennai', address: '12 Anna Salai', phone: '+91 44 4000 1000', email: 'desk@citygeneral.test', gstin: '33AAACC1234A1Z5', plan: 'Enterprise', modules: ALL_MODULES, status: 'Active', createdAt: now });
await put(`hospitals/${H2}`, { name: 'Lake View Clinic', city: 'Bengaluru', address: '4 Lake Road', phone: '+91 80 4000 2000', email: 'desk@lakeview.test', gstin: '29AAACL1234A1Z5', plan: 'Pro', modules: ['billing', 'pharmacy', 'ipd', 'telehealth', 'assets'], status: 'Active', createdAt: now });
const at1 = (d) => ({ ...d, hospitalId: H1 });

// ---- staff logins (emulator-only demo passwords) ----
const LOGINS = [];
for (const [email, password, role, name, hospitalId] of [
  ['owner@demo.test', 'demo-owner-123', 'super_admin', 'Platform Owner', null],
  ['admin@demo.test', 'demo-admin-123', 'admin', 'Hospital Admin', H1],
  ['reception@demo.test', 'demo-recep-123', 'receptionist', 'Front Desk', H1],
  ['billing@demo.test', 'demo-bill-123', 'billing', 'Billing Counter', H1],
  ['pharmacy@demo.test', 'demo-pharm-123', 'pharmacist', 'Pharmacist', H1],
  ['nurse@demo.test', 'demo-nurse-123', 'nurse', 'Staff Nurse', H1],
  ['ops@demo.test', 'demo-ops-123', 'admin_staff', 'Biomedical & Admin', H1],
  ['admin2@demo.test', 'demo-admin2-123', 'hospital_admin', 'Lake View Admin', H2],
  ['reception2@demo.test', 'demo-recep2-123', 'receptionist', 'Lake View Desk', H2],
]) {
  const uid = await account(email, password, name);
  await put(`users/${uid}`, { role, email, name, active: true, ...(hospitalId ? { hospitalId } : {}) });
  LOGINS.push([`${role}${hospitalId ? ` @${hospitalId}` : ''}`, email, password]);
}

// ---- departments & doctors ----
const DEPTS = [
  ['Cardiology', 'Heart, BP and vascular care'], ['Orthopedics', 'Bones, joints, spine and sports injuries'],
  ['Pediatrics', 'Child health, vaccination and nutrition'], ['Gynecology', 'Women’s health, pregnancy and fertility'],
  ['Dermatology', 'Skin, hair and allergy'], ['General Physician', 'Fever, infections and general medicine'],
  ['Neurology', 'Brain, nerves, headache and stroke'], ['ENT', 'Ear, nose and throat'],
];
for (const [name, description] of DEPTS) {
  await put(`departments/${name.replace(/\W/g, '')}`, at1({ name, description, head: '', workingHours: '09:00 AM - 05:00 PM', defaultFee: 600, status: 'Active' }));
}
const DOCTORS = [
  ['Dr. Arun Kumar', 'Cardiology', 'MD, DM (Cardiology)', 15, 800],
  ['Dr. Priya Sharma', 'Gynecology', 'MS (OBG)', 11, 700],
  ['Dr. Rajesh Kumar', 'Orthopedics', 'MS (Ortho), MCh', 18, 1000],
  ['Dr. Meera Nair', 'Pediatrics', 'MD (Pediatrics)', 9, 600],
  ['Dr. Sarah Mathews', 'Dermatology', 'MD (Derm)', 12, 700],
  ['Dr. Vikram Rao', 'General Physician', 'MD (General Medicine)', 7, 500],
  ['Dr. Anitha Rao', 'Neurology', 'DM (Neurology)', 14, 900],
  ['Dr. Karthik Iyer', 'ENT', 'MS (ENT)', 8, 600],
];
const doctorIds = [];
for (const [i, [name, dept, qual, years, fee]] of DOCTORS.entries()) {
  // The first doctor has an app login; the others are directory entries.
  const id = i === 0 ? await account('doctor@demo.test', 'demo-doctor-123', name) : `DOC-${String(i + 1).padStart(3, '0')}`;
  if (i === 0) await put(`users/${id}`, { role: 'doctor', email: 'doctor@demo.test', name, consent, active: true, hospitalId: H1 });
  doctorIds.push(id);
  await put(`doctors/${id}`, {
    name, email: i === 0 ? 'doctor@demo.test' : '', phone: `+91 90000 0000${i}`, profileComplete: true, status: 'Active',
    education: qual.split(', '), specializations: [dept], department: dept, specialization: dept, qualification: qual,
    practiceYears: years, experience: `${years} Years`, fee, hospital: `${HOSPITAL_1}, Chennai`, hospitalId: H1,
    languages: ['English', 'Tamil', 'Hindi'], onlineConsultation: i % 3 !== 2, doctorCode: `TNMC${1000 + i}`,
  });
  await put(`schedules/${id}`, { days: {} }); // default sessions 09:00–12:00, 14:00–17:00
}

// ---- patients (one has a patient-app login) ----
const FIRST = ['Ravi', 'Priya', 'Karthik', 'Meena', 'Sanjay', 'Lakshmi', 'Arjun', 'Divya', 'Suresh', 'Anjali', 'Mohan', 'Kavya', 'Rahul', 'Deepa', 'Vijay'];
const LAST = ['Kumar', 'Sharma', 'Iyer', 'Nair', 'Reddy', 'Pillai', 'Menon', 'Rao'];
const patientUid = await account('patient@demo.test', 'demo-patient-123', 'Asha Patient');
await put(`users/${patientUid}`, { role: 'patient', email: 'patient@demo.test', consent });
await put(`patients/${patientUid}`, { name: 'Asha Patient', phone: '+91 98765 01234', email: 'patient@demo.test', ownerUid: patientUid, relation: 'Self', gender: 'Female', dob: '1990-05-14', bloodGroup: 'B+', status: 'Active', hospitalIds: [H1] });
await put(`patients/${patientUid}-child`, { name: 'Aarav Patient', phone: '+91 98765 01234', ownerUid: patientUid, relation: 'Child', gender: 'Male', dob: '2018-02-02', status: 'Active' });
const patients = [];
for (let i = 0; i < 60; i++) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
  const id = `PAT-${String(1001 + i)}`;
  const p = { name, phone: `+91 9${String(800000000 + i * 7919).slice(0, 4)} ${String(10000 + i).slice(0, 5)}`, gender: i % 2 ? 'Female' : 'Male', dob: `${1950 + (i % 60)}-0${1 + (i % 9)}-1${i % 9}`, status: 'Active', hospitalIds: [H1] };
  await put(`patients/${id}`, p);
  patients.push({ id, ...p });
}

// ---- appointments with per-doctor daily tokens + bookedSlots ----
const SLOTS = ['09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '02:00 PM', '02:30 PM', '03:00 PM'];
const STATUSES_TODAY = ['Completed', 'Completed', 'In Consultation', 'Waiting', 'Checked In', 'Confirmed', 'Confirmed', 'Confirmed', 'Confirmed'];
let n = 0;
for (const [di, docId] of doctorIds.entries()) {
  const [docName, dept, , , fee] = DOCTORS[di];
  for (const [date, count] of [[today, 6], [tomorrow, 4]]) {
    const times = [];
    for (let k = 0; k < count; k++) {
      const p = patients[(n++ * 13) % patients.length];
      const time = SLOTS[k];
      times.push(time);
      const online = DOCTORS[di] && k % 4 === 3;
      await put(`appointments/APT-${date.replace(/-/g, '')}-${di}${k}`, {
        patient: p.name, patientId: p.id, patientPhone: p.phone, doctor: docName, doctorId: docId, department: dept,
        date, time, type: online ? 'Online' : 'Offline', visitType: k % 3 ? 'General' : 'Follow-up', fee,
        status: date === today ? STATUSES_TODAY[k] : 'Confirmed', token: k + 1, source: 'Front Desk', createdAt: now,
        hospitalId: H1, hospital: HOSPITAL_1, updatedBy: 'system',
      });
    }
    await put(`bookedSlots/${docId}_${date}`, { times });
    await put(`counters/${docId}_${date}`, { next: count + 1 });
  }
}
// The demo patient's own upcoming booking
await put(`appointments/APT-DEMO-PATIENT`, {
  patient: 'Asha Patient', patientId: patientUid, patientPhone: '+91 98765 01234', ownerUid: patientUid,
  doctor: DOCTORS[1][0], doctorId: doctorIds[1], department: DOCTORS[1][1], date: tomorrow, time: '11:00 AM',
  type: 'Online', visitType: 'General', fee: DOCTORS[1][4], status: 'Confirmed', token: 5, source: 'Patient App', createdAt: now,
  hospitalId: H1, hospital: HOSPITAL_1, updatedBy: patientUid,
});

// ---- catalogs (patient app), tariff, pharmacy, IPD ----
const catalog = JSON.parse(await readFile(new URL('../src/catalog.json', import.meta.url), 'utf8'));
for (const [name, items] of Object.entries(catalog)) for (const { id, ...d } of items) await put(`${name}/${id}`, d);

const key = (s) => s.toLowerCase();
const TARIFF = [
  ['OPD Consultation - General', 'Consultation', 'General Physician', 500, 0], ['OPD Consultation - Specialist', 'Consultation', '', 800, 0],
  ['Follow-up Consultation', 'Consultation', '', 300, 0], ['ECG', 'Procedure', 'Cardiology', 350, 0], ['2D Echo', 'Radiology', 'Cardiology', 2200, 0],
  ['X-Ray Chest PA', 'Radiology', '', 450, 0], ['CBC', 'Lab', '', 349, 0], ['Dressing (small)', 'Procedure', '', 250, 0],
  ['Nebulization', 'Nursing', '', 200, 0], ['Injection charge', 'Nursing', '', 100, 0], ['Plaster cast (forearm)', 'Procedure', 'Orthopedics', 1800, 0],
  ['Normal delivery package', 'Package', 'Gynecology', 35000, 0], ['ICU nursing per day', 'Nursing', '', 3000, 0],
];
for (const [i, [name, category, department, rate, gstRate]] of TARIFF.entries()) {
  await put(`services/SVC-${i + 1}`, at1({ name, nameKey: key(name), category, department, rate, gstRate, sac: '9993', active: true }));
}
await put('suppliers/SUP-1', { name: 'Medplus Distributors', nameKey: 'medplus distributors', gstin: '33AAACM1234F1Z5', phone: '+91 44 2345 6789', address: 'Chennai', due: 12500, hospitalId: H1 });
const DRUGS = [
  ['Paracetamol 650 mg', 'Paracetamol', 32, 12, false], ['Amoxicillin 500 mg', 'Amoxicillin', 98, 12, true], ['Pantoprazole 40 mg', 'Pantoprazole', 145, 12, true],
  ['Amlodipine 5 mg', 'Amlodipine', 58, 12, true], ['Metformin 500 mg', 'Metformin', 42, 12, true], ['Cetirizine 10 mg', 'Cetirizine', 24, 12, false],
  ['ORS Sachet', 'Electrolytes', 22, 5, false], ['Insulin Glargine 100 IU', 'Insulin glargine', 780, 5, true], ['Ceftriaxone 1 g Inj', 'Ceftriaxone', 65, 12, true],
  ['Normal Saline 500 ml', 'Sodium chloride', 38, 12, false],
];
for (const [i, [name, composition, mrp, gstRate, rx]] of DRUGS.entries()) {
  const id = `DRG-${i + 1}`;
  const batches = [[`B${i}A`, i % 3 === 0 ? ymd(new Date(now.getTime() + 60 * 86_400_000)).slice(0, 7) : '2027-08', 40], [`B${i}B`, '2028-03', i === 4 ? 2 : 60]];
  let stock = 0;
  for (const [bi, [batch, expiry, qty]] of batches.entries()) {
    await put(`stockBatches/${id}-${bi}`, { drugId: id, drugName: name, batch, expiry, qty, purchaseRate: Math.round(mrp * 0.7), mrp, supplierId: 'SUP-1', hospitalId: H1 });
    stock += qty;
  }
  await put(`drugs/${id}`, { name, nameKey: key(name), composition, manufacturer: 'Demo Pharma', hsn: '3004', gstRate, mrp, unit: 'Strip', reorderLevel: 20, rack: `R${1 + (i % 4)}`, rx, stock: i === 4 ? 10 : stock, hospitalId: H1 });
}
const WARDS = [['General Ward A', 'General', 1500, 12, 'GA'], ['Private Rooms', 'Private', 4500, 6, 'PR'], ['ICU', 'ICU', 9000, 6, 'ICU']];
for (const [wi, [name, type, ratePerDay, beds, prefix]] of WARDS.entries()) {
  await put(`wards/WARD-${wi + 1}`, at1({ name, type, ratePerDay }));
  for (let b = 1; b <= beds; b++) {
    await put(`beds/WARD-${wi + 1}-${b}`, { wardId: `WARD-${wi + 1}`, wardName: name, wardType: type, ratePerDay, label: `${prefix}-${String(b).padStart(2, '0')}`, status: b === beds ? 'Cleaning' : 'Free', admissionId: null, hospitalId: H1 });
  }
}

// ---- equipment register with purchase bills and service history (City General) ----
const ASSETS = [
  ['MRI Scanner 1.5T', 'Imaging', 'Siemens', 'Magnetom Sempra', 'SN-MRI-0091', 'Radiology', 'Block B, Ground floor', 42000000, 'Siemens Healthineers', '2025-02-10', '2028-02-09', 'Siemens Healthineers', '2029-02-09', 1800000, 6],
  ['Ventilator', 'Life support', 'Dräger', 'Savina 300', 'SN-VEN-1123', 'ICU', 'ICU bed 2', 1450000, 'Medline Equipments', '2024-06-01', '2026-05-31', 'Medline Equipments', '2027-05-31', 95000, 3],
  ['Patient Monitor', 'Monitoring', 'Philips', 'IntelliVue MX450', 'SN-MON-5541', 'ICU', 'ICU bed 4', 385000, 'Philips India', '2025-09-15', '2027-09-14', '', '', 0, 6],
  ['Autoclave 120L', 'OT equipment', 'Equitron', 'SLEFA 120', 'SN-ACL-0007', 'Operation Theatre', 'CSSD', 610000, 'Equitron Medica', '2023-11-20', '2025-11-19', 'Equitron Medica', '2026-11-30', 48000, 1],
];
for (const [i, [name, category, make, model, serialNo, department, location, cost, vendor, purchaseDate, warrantyUntil, amcVendor, amcUntil, amcCost, every]] of ASSETS.entries()) {
  const last = ymd(new Date(now.getTime() - (20 + i * 40) * 86_400_000));
  const next = ymd(new Date(new Date(last).getTime() + every * 30 * 86_400_000));
  await put(`assets/AST-${i + 1}`, at1({
    name, category, make, model, serialNo, assetTag: `CGH-${String(101 + i)}`, department, location, vendor, billNo: `PB-${2400 + i}`,
    purchaseDate, cost, gst: Math.round(cost * 0.12), warrantyUntil, amcVendor, amcUntil, amcCost, serviceEveryMonths: every,
    status: 'In use', lastServiced: last, nextServiceDue: next, updatedBy: 'system', createdAt: now,
  }));
  await put(`maintenance/MNT-${i + 1}`, at1({
    assetId: `AST-${i + 1}`, assetName: name, date: last, type: i === 1 ? 'Breakdown repair' : 'Preventive maintenance', vendor: amcVendor || vendor,
    engineer: 'Service engineer', invoiceNo: `SV-${880 + i}`, cost: i === 1 ? 18500 : 0, downtimeHours: i === 1 ? 6 : 1,
    notes: i === 1 ? 'Flow sensor replaced' : 'Routine PM, safety test passed', nextDue: next, updatedBy: 'system', createdAt: now,
  }));
}

// ---- second customer: Lake View Clinic (its staff never see City General's data, and vice versa) ----
const H2_DOCTORS = [['Dr. Nikhil Shetty', 'General Physician', 'MD (General Medicine)', 10, 500], ['Dr. Fathima Khan', 'Pediatrics', 'MD (Pediatrics)', 6, 600]];
for (const [i, [name, dept, qual, years, fee]] of H2_DOCTORS.entries()) {
  const id = `LV-DOC-${i + 1}`;
  await put(`doctors/${id}`, {
    name, department: dept, specialization: dept, specializations: [dept], qualification: qual, education: [qual], practiceYears: years,
    experience: `${years} Years`, fee, hospital: 'Lake View Clinic, Bengaluru', hospitalId: H2, profileComplete: true, status: 'Active',
    languages: ['English', 'Kannada'], onlineConsultation: true,
  });
  await put(`schedules/${id}`, { days: {} });
  await put(`departments/LV-${dept.replace(/\W/g, '')}`, { name: dept, description: '', head: name, workingHours: '09:00 AM - 05:00 PM', defaultFee: fee, status: 'Active', hospitalId: H2 });
}
for (let i = 0; i < 10; i++) {
  const id = `LV-PAT-${101 + i}`;
  const name = `${FIRST[(i + 5) % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;
  await put(`patients/${id}`, { name, phone: `+91 97${String(40000000 + i * 7717).slice(0, 3)} ${String(20000 + i)}`, gender: i % 2 ? 'Male' : 'Female', status: 'Active', hospitalIds: [H2] });
  await put(`appointments/LV-APT-${i}`, {
    patient: name, patientId: id, doctor: H2_DOCTORS[i % 2][0], doctorId: `LV-DOC-${(i % 2) + 1}`, department: H2_DOCTORS[i % 2][1],
    date: today, time: SLOTS[Math.floor(i / 2)], type: 'Offline', visitType: 'General', fee: H2_DOCTORS[i % 2][4], status: 'Confirmed',
    token: Math.floor(i / 2) + 1, source: 'Front Desk', createdAt: now, hospitalId: H2, hospital: 'Lake View Clinic', updatedBy: 'system',
  });
}
for (const d of [1, 2]) {
  const times = SLOTS.slice(0, 5);
  await put(`bookedSlots/LV-DOC-${d}_${today}`, { times });
  await put(`counters/LV-DOC-${d}_${today}`, { next: 6 });
}

console.log('Demo platform ready. Logins (emulator only):');
for (const [role, email, password] of [...LOGINS, ['doctor (mobile app)', 'doctor@demo.test', 'demo-doctor-123'], ['patient (mobile app)', 'patient@demo.test', 'demo-patient-123']]) {
  console.log(`  ${role.padEnd(30)} ${email.padEnd(22)} ${password}`);
}
console.log(`  City General (${H1}): ${doctorIds.length} doctors · ${patients.length + 2} patients · appointments today and tomorrow · ${DRUGS.length} drugs · ${WARDS.reduce((s, w) => s + w[3], 0)} beds`);
console.log(`  Lake View (${H2}): ${H2_DOCTORS.length} doctors · 10 patients · appointments today`);
