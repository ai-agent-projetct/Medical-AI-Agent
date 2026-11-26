// Cloud Functions (Node 22, 2nd gen). Secrets live in Secret Manager:
//   firebase functions:secrets:set ZEGO_SERVER_SECRET
//   firebase functions:secrets:set WHATSAPP_TOKEN        (optional: automatic WhatsApp confirmations)
// Plain params are asked for on first deploy (or set in functions/.env.<project>).
import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { generateToken04 } from './zego.js';
import { bookingTemplate, sendWhatsApp } from './whatsapp.js';

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'asia-south1', maxInstances: 50 });

const ZEGO_APP_ID = defineString('ZEGO_APP_ID');
const ZEGO_SERVER_SECRET = defineSecret('ZEGO_SERVER_SECRET');
const WHATSAPP_TOKEN = defineSecret('WHATSAPP_TOKEN');
const WHATSAPP_PHONE_NUMBER_ID = defineString('WHATSAPP_PHONE_NUMBER_ID', { default: '' });
const WHATSAPP_TEMPLATE = defineString('WHATSAPP_TEMPLATE', { default: 'appointment_confirmation' });
const WHATSAPP_API_VERSION = defineString('WHATSAPP_API_VERSION', { default: '' });

const CLINICAL = ['admin', 'hospital_admin', 'doctor', 'nurse', 'receptionist', 'lab_tech'];
const STAFF_ROLES = ['hospital_admin', 'doctor', 'nurse', 'receptionist', 'lab_tech', 'billing', 'pharmacist', 'admin_staff'];

/** users/{uid} of an enabled member of hospital `hospitalId` (or the super admin), else null. */
async function staffOf(uid, hospitalId, roles) {
  const u = uid ? (await db.doc(`users/${uid}`).get()).data() : null;
  if (u?.role === 'super_admin') return u;
  return u && roles.includes(u.role) && u.active !== false && u.hospitalId === hospitalId ? u : null;
}

/**
 * Video-call token for appointment `roomId`. Allowed for clinical staff, the patient who booked it,
 * or anyone holding the appointment's callKey (the patient link). The token only opens that room.
 */
export const zegoToken = onCall({ secrets: [ZEGO_SERVER_SECRET], enforceAppCheck: false }, async (req) => {
  const { roomId, key, userName } = req.data ?? {};
  if (typeof roomId !== 'string' || !roomId || roomId.length > 128) throw new HttpsError('invalid-argument', 'roomId required');
  const apt = (await db.doc(`appointments/${roomId}`).get()).data();
  if (!apt || apt.type !== 'Online') throw new HttpsError('not-found', 'No online consultation with this id');
  if (['Cancelled', 'Completed', 'No-Show'].includes(apt.status)) throw new HttpsError('failed-precondition', `Consultation is ${apt.status}`);

  let allowed = Boolean(key) && key === apt.callKey;
  const uid = req.auth?.uid;
  if (!allowed && uid) {
    allowed = apt.ownerUid === uid || Boolean(await staffOf(uid, apt.hospitalId, CLINICAL));
  }
  if (!allowed) throw new HttpsError('permission-denied', 'Not allowed to join this consultation');

  const userId = uid ?? `guest_${randomBytes(6).toString('hex')}`;
  const token = generateToken04(Number(ZEGO_APP_ID.value()), userId, ZEGO_SERVER_SECRET.value(), 2 * 3600, roomId);
  logger.info('zego token', { roomId, userId, viaKey: !uid });
  return { token, userId, userName: String(userName ?? '').slice(0, 40) || 'Guest', appId: Number(ZEGO_APP_ID.value()) };
});

/**
 * On every appointment write: give online consultations an unguessable callKey for the patient link,
 * and send the WhatsApp booking confirmation (token number) once, when configured.
 */
export const onAppointmentWrite = onDocumentWritten({ document: 'appointments/{id}', secrets: [WHATSAPP_TOKEN] }, async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const apt = after.data();
  const updates = {};
  if (apt.type === 'Online' && !apt.callKey) updates.callKey = randomBytes(18).toString('base64url');

  const canSend = WHATSAPP_PHONE_NUMBER_ID.value() && WHATSAPP_API_VERSION.value() && WHATSAPP_TOKEN.value();
  if (canSend && apt.token && !apt.whatsappSentAt && ['Confirmed', 'Rescheduled'].includes(apt.status)) {
    const body = bookingTemplate(apt, WHATSAPP_TEMPLATE.value());
    if (body) {
      try {
        updates.whatsappMessageId = await sendWhatsApp(body, {
          token: WHATSAPP_TOKEN.value(), phoneNumberId: WHATSAPP_PHONE_NUMBER_ID.value(), apiVersion: WHATSAPP_API_VERSION.value(),
        });
        updates.whatsappSentAt = FieldValue.serverTimestamp();
      } catch (e) {
        logger.error('whatsapp send failed', { id: event.params.id, error: e.message });
        updates.whatsappError = e.message;
      }
    }
  }
  if (Object.keys(updates).length) await after.ref.update(updates);
});

// ---------------------------------------------------------------- AI voice receptionist
import { onRequest } from 'firebase-functions/v2/https';
import { turn } from './voiceAgent.js';
import { makeCtx } from './voiceCtx.js';
import { toTwiml, validTwilioRequest } from './twiml.js';

const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
// The exact public URL configured on the Twilio number (Twilio signs it); also used as the Gather action.
const VOICE_WEBHOOK_URL = defineString('VOICE_WEBHOOK_URL', { default: '' });
const RECEPTION_NUMBER = defineString('RECEPTION_NUMBER', { default: '' });
const HOSPITAL_NAME = defineString('HOSPITAL_NAME', { default: 'ABC Hospital' });
// Hospital answering calls when the dialled number is not set as voiceNumber on any hospitals/{id}.
const DEFAULT_HOSPITAL_ID = defineString('DEFAULT_HOSPITAL_ID', { default: '' });
const inEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

/** Runs one turn, stores state + transcript in voiceCalls/{id} (reception watches it live). */
/** The hospital a call belongs to: each hospital sets its own Twilio number as hospitals/{id}.voiceNumber. */
async function hospitalFor(dialled) {
  const byNumber = dialled ? await db.collection('hospitals').where('voiceNumber', '==', dialled).limit(1).get() : null;
  const doc = byNumber && !byNumber.empty ? byNumber.docs[0] : DEFAULT_HOSPITAL_ID.value() ? await db.doc(`hospitals/${DEFAULT_HOSPITAL_ID.value()}`).get() : null;
  return doc?.exists ? { id: doc.id, ...doc.data() } : null;
}

async function voiceTurnFor(id, { speech, digits, phone, channel, hospital }) {
  const ref = db.doc(`voiceCalls/${id}`);
  const prev = (await ref.get()).data();
  const ctx = makeCtx(db, {
    hospitalId: hospital.id, hospital: hospital.name ?? HOSPITAL_NAME.value(), receptionNumber: hospital.receptionNumber ?? RECEPTION_NUMBER.value(),
    source: channel === 'phone' ? 'Voice Agent (phone)' : 'Voice Agent (demo)',
  });
  const r = await turn(prev?.state ?? { phone }, { speech, digits }, ctx);
  const lines = [];
  if (speech || digits) lines.push({ who: 'caller', text: speech || `pressed ${digits}`, at: new Date() });
  if (r.prompts.length) lines.push({ who: 'agent', text: r.prompts.map((p) => p.text).join(' '), at: new Date() });
  await ref.set({
    state: r.state, phone: phone ?? prev?.phone ?? '', channel, lang: r.state.lang ?? null, hospitalId: hospital.id,
    status: r.booking ? 'Booked' : r.handoff ? 'Transferred' : r.hangup ? 'Ended' : 'In progress',
    booking: r.booking ?? prev?.booking ?? null,
    startedAt: prev?.startedAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    ...(lines.length ? { transcript: FieldValue.arrayUnion(...lines) } : {}),
  }, { merge: true });
  return r;
}

/** Twilio Voice webhook: point the hospital number's "A call comes in" to this URL (HTTP POST). */
export const voiceCall = onRequest({ secrets: [TWILIO_AUTH_TOKEN], timeoutSeconds: 15, maxInstances: 100 }, async (req, res) => {
  const p = req.body ?? {};
  const url = VOICE_WEBHOOK_URL.value() || `https://${req.get('host')}${req.originalUrl}`;
  if (!inEmulator && !validTwilioRequest(TWILIO_AUTH_TOKEN.value(), url, p, req.get('X-Twilio-Signature'))) {
    logger.warn('voiceCall: bad Twilio signature');
    res.status(403).send('Forbidden');
    return;
  }
  if (!p.CallSid) { res.status(400).send('CallSid required'); return; }
  try {
    const hospital = await hospitalFor(p.To);
    if (!hospital || hospital.status === 'Suspended') throw new Error(`No active hospital for number ${p.To}`);
    const r = await voiceTurnFor(p.CallSid, { speech: p.SpeechResult ?? '', digits: p.Digits ?? '', phone: p.From ?? '', channel: 'phone', hospital });
    const doctors = (await makeCtx(db, { hospitalId: hospital.id }).doctors()).map((d) => d.name);
    res.type('text/xml').send(toTwiml(r, { actionUrl: url, receptionNumber: RECEPTION_NUMBER.value(), hints: doctors }));
  } catch (e) {
    logger.error('voiceCall failed', { callSid: p.CallSid, error: e.message });
    const fallback = { state: { lang: 'en' }, prompts: [{ text: 'Sorry, something went wrong. Our staff will call you back.', lang: 'en' }], gather: false, hangup: !RECEPTION_NUMBER.value(), handoff: Boolean(RECEPTION_NUMBER.value()) };
    res.type('text/xml').send(toTwiml(fallback, { actionUrl: url, receptionNumber: RECEPTION_NUMBER.value() }));
  }
});

/** Same agent for the portal's browser demo (staff only): text in, prompts out. */
export const voiceTurn = onCall(async (req) => {
  const { sessionId, speech = '', digits = '', phone = '', hospitalId } = req.data ?? {};
  if (!(await staffOf(req.auth?.uid, hospitalId, [...CLINICAL, 'billing']))) throw new HttpsError('permission-denied', 'Staff of this hospital only');
  const hospital = (await db.doc(`hospitals/${hospitalId}`).get()).data();
  if (!hospital) throw new HttpsError('not-found', 'Unknown hospital');
  if (typeof sessionId !== 'string' || !/^[\w-]{6,64}$/.test(sessionId)) throw new HttpsError('invalid-argument', 'sessionId required');
  const r = await voiceTurnFor(`web-${sessionId}`, { speech: String(speech).slice(0, 300), digits: String(digits).slice(0, 2), phone: String(phone).slice(0, 20), channel: 'web-demo', hospital: { id: hospitalId, ...hospital } });
  return { prompts: r.prompts, hangup: r.hangup || r.handoff, booking: r.booking ?? null, lang: r.state.lang ?? 'en' };
});

// ---------------------------------------------------------------- patient self-booking
/**
 * Patient app booking. Runs on the server so many patients can book the same doctor at once: the Admin
 * SDK transaction locks and retries, where client transactions failed security rules under contention.
 * Checks the caller owns the patient profile and that the slot is a real free slot.
 */
export const bookAppointment = onCall({ maxInstances: 100 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first');
  const { doctorId, date, time, patientId, online = false, reason = '' } = req.data ?? {};
  if (![doctorId, date, time, patientId].every((v) => typeof v === 'string' && v.length > 0 && v.length < 100)) {
    throw new HttpsError('invalid-argument', 'doctorId, date, time and patientId are required');
  }
  const patient = (await db.doc(`patients/${patientId}`).get()).data();
  if (!patient || patient.ownerUid !== uid) throw new HttpsError('permission-denied', 'Not your patient profile');
  const doctor = (await db.doc(`doctors/${doctorId}`).get()).data();
  if (!doctor?.profileComplete || doctor.status === 'Inactive' || !doctor.hospitalId) throw new HttpsError('not-found', 'Doctor not available');
  const hospital = (await db.doc(`hospitals/${doctor.hospitalId}`).get()).data();
  if (!hospital || hospital.status === 'Suspended') throw new HttpsError('failed-precondition', 'This hospital is not taking bookings');
  const ctx = makeCtx(db, { hospitalId: doctor.hospitalId, hospital: hospital.name, source: 'Patient App' });
  if (!(await ctx.freeSlots(doctorId, date)).includes(time)) {
    throw new HttpsError('failed-precondition', `${time} is not available. Please pick another slot.`);
  }
  try {
    const r = await ctx.book({
      doctor: { id: doctorId, name: doctor.name }, date, time,
      patient: { id: patientId, name: patient.name, phone: patient.phone ?? '' },
      extra: { ownerUid: uid, type: online ? 'Online' : 'Offline', reason: String(reason).slice(0, 300), hospital: hospital.name },
    });
    return { appointmentId: r.appointmentId, token: r.token };
  } catch (e) {
    if (e.code === 'SLOT_TAKEN') throw new HttpsError('already-exists', `${time} was just booked by someone else. Please pick another slot.`);
    throw e;
  }
});

// ---------------------------------------------------------------- multi-hospital administration
import { getAuth } from 'firebase-admin/auth';
import { auditEntry } from './audit.js';

/**
 * Creates a login for hospital staff (Auth account + users/{uid}; doctors also get doctors/{uid}).
 * Callers: the super admin (any hospital) or an enabled admin of that hospital.
 */
export const createStaffUser = onCall(async (req) => {
  const { hospitalId, email, password, name = '', phone = '', role, department = '' } = req.data ?? {};
  if (typeof hospitalId !== 'string' || !hospitalId) throw new HttpsError('invalid-argument', 'hospitalId required');
  const me = await staffOf(req.auth?.uid, hospitalId, ['admin', 'hospital_admin']);
  if (!me) throw new HttpsError('permission-denied', 'Only this hospital\'s admin or the platform can add users');
  if (!STAFF_ROLES.includes(role)) throw new HttpsError('invalid-argument', `role must be one of ${STAFF_ROLES.join(', ')}`);
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError('invalid-argument', 'A valid email is required');
  if (typeof password !== 'string' || password.length < 8) throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
  const hospital = (await db.doc(`hospitals/${hospitalId}`).get()).data();
  if (!hospital) throw new HttpsError('not-found', 'Unknown hospital');
  if (hospital.status === 'Suspended' && me.role !== 'super_admin') throw new HttpsError('failed-precondition', 'Hospital is suspended');

  let user;
  try {
    user = await getAuth().createUser({ email: email.trim().toLowerCase(), password, displayName: String(name).slice(0, 80) });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'An account with this email already exists');
    throw new HttpsError('invalid-argument', e.message);
  }
  const profile = {
    name: String(name).slice(0, 80), email: user.email, phone: String(phone).slice(0, 20), department: String(department).slice(0, 60),
  };
  const batch = db.batch();
  batch.set(db.doc(`users/${user.uid}`), { ...profile, role, hospitalId, active: true, createdAt: FieldValue.serverTimestamp(), updatedBy: req.auth.uid });
  if (role === 'doctor') {
    batch.set(db.doc(`doctors/${user.uid}`), { ...profile, hospitalId, hospital: hospital.name, status: 'Active', profileComplete: false, updatedBy: req.auth.uid }, { merge: true });
  }
  await batch.commit();
  logger.info('staff user created', { hospitalId, role, by: req.auth.uid });
  return { uid: user.uid };
});

/**
 * Disabling a user in the portal (users.active false + disabledBy) also disables the Auth account and ends
 * its sessions; re-enabling restores it. Doctors awaiting approval (no disabledBy) can still sign in to wait.
 */
export const syncStaffAccess = onDocumentWritten('users/{uid}', async (event) => {
  const blocked = (d) => Boolean(d && d.active === false && d.disabledBy);
  const before = blocked(event.data?.before?.data());
  const after = blocked(event.data?.after?.data());
  if (before === after || !event.data?.after?.exists) return;
  const { uid } = event.params;
  try {
    await getAuth().updateUser(uid, { disabled: after });
    if (after) await getAuth().revokeRefreshTokens(uid);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }
});

/** Change history: who changed which field from what to what, in the hospital's audit log. */
async function trail(event, module) {
  const entry = auditEntry(event.data?.before?.data(), event.data?.after?.data(), module, event.document);
  if (!entry) return;
  const who = entry.uid.startsWith('system') || entry.uid === 'unknown' ? {} : (await db.doc(`users/${entry.uid}`).get()).data() ?? {};
  await db.collection('auditLogs').add({
    ...entry, at: FieldValue.serverTimestamp(), email: who.email ?? '', user: who.name ?? (who.role ?? entry.uid),
    hospitalId: entry.hospitalId ?? who.hospitalId ?? 'platform',
  });
}
export const auditPatients = onDocumentWritten('patients/{id}', (e) => trail(e, 'Patients'));
export const auditRecords = onDocumentWritten('patients/{pid}/records/{id}', (e) => trail(e, 'Medical Records'));
export const auditAppointments = onDocumentWritten('appointments/{id}', (e) => trail(e, 'Appointments'));
export const auditInvoices = onDocumentWritten('invoices/{id}', (e) => trail(e, 'Billing'));
export const auditAssets = onDocumentWritten('assets/{id}', (e) => trail(e, 'Equipment'));
export const auditMaintenance = onDocumentWritten('maintenance/{id}', (e) => trail(e, 'Equipment'));
export const auditUsers = onDocumentWritten('users/{id}', (e) => trail(e, 'Users & Roles'));

// Hospital suite modules: change history for each collection (deployed as suiteAudit-<collection>).
const SUITE_AUDIT = {
  labOrders: 'Laboratory', radiologyOrders: 'Radiology', vitals: 'Nursing', medAdmin: 'Nursing', nursingNotes: 'Nursing',
  erVisits: 'Emergency', surgeries: 'Operation Theatre', employees: 'HRMS', attendance: 'HRMS', leaves: 'HRMS', payroll: 'HRMS',
  storeItems: 'Stores', purchaseOrders: 'Stores', vendors: 'Stores', indents: 'Stores', expenses: 'Accounts', dayClosings: 'Accounts',
  bloodUnits: 'Blood Bank', ambulanceTrips: 'Ambulance', housekeeping: 'Support Services', dietOrders: 'Support Services',
  cssdBatches: 'Support Services', laundry: 'Support Services', visitors: 'Front Office', vaccinations: 'Clinical',
  feedback: 'Quality', incidents: 'Quality', qualityIndicators: 'Quality',
};
export const suiteAudit = Object.fromEntries(Object.entries(SUITE_AUDIT)
  .map(([c, module]) => [c, onDocumentWritten(`${c}/{id}`, (e) => trail(e, module))]));
