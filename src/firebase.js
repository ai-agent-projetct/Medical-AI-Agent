import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, getDoc, query,
  runTransaction, serverTimestamp, addDoc, orderBy, limit, arrayUnion, writeBatch, where, getDocs, connectFirestoreEmulator,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { DEFAULT_SESSIONS, generateSlots } from './slots';

const env = import.meta.env;

// No VITE_FIREBASE_* keys → the portal runs on its built-in sample data (demo mode).
export const firebaseEnabled = Boolean(env.VITE_FIREBASE_API_KEY);

const app = firebaseEnabled ? initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}) : null;

export const auth = app && getAuth(app);
export const db = app && getFirestore(app);
export const storage = app && getStorage(app);
export const functions = app && getFunctions(app, 'asia-south1');

// `npm run dev:emulator` → talk to the local Firebase Emulator Suite instead of a real project.
if (app && env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8181);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// Firestore role → portal role label used by the RBAC matrix in App.jsx.
export const ROLE_LABELS = {
  admin: 'Super Admin',
  hospital_admin: 'Hospital Admin',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  billing: 'Billing Staff',
  pharmacist: 'Pharmacist',
};

const fail = (err) => {
  console.error(err);
  alert(`Could not save to the server: ${err.message}`);
};

/**
 * Live-synced collection with the same [items, setItems] shape as useState, so existing pages
 * keep calling setX(prev => ...) unchanged. Changed/new items are written to Firestore; items are
 * never deleted through this path (a bad updater must not wipe the collection).
 * ponytail: diffs the whole array on each write; switch pages to explicit add/update calls if a
 * collection grows past a few thousand docs.
 */
export function useLiveCollection(name, fallback, prepare = (item) => item, constraints = []) {
  const [items, setItems] = useState(db ? [] : fallback);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;

  useEffect(() => {
    if (!db) return undefined;
    // `constraints` bound what each browser downloads (date window / limit); items outside it are
    // untouched by writes, which only send changed or new items.
    return onSnapshot(constraints.length ? query(collection(db, name), ...constraints) : collection(db, name),
      (snap) => setItems(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
      (err) => console.error(`${name} listener`, err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const write = useCallback((updater) => {
    if (!db) return setItems(updater);
    const prev = itemsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    const prevById = new Map(prev.map((i) => [i.id, i]));
    const seen = new Set();
    // Pages mint random ids (PAT-123) or none at all; never let a collision overwrite another record.
    const fixed = next.map((item) => {
      const out = !item.id || seen.has(item.id) ? { ...item, id: doc(collection(db, name)).id } : item;
      seen.add(out.id);
      return out;
    });
    for (const item of fixed) {
      const old = prevById.get(item.id);
      if (old && JSON.stringify(old) === JSON.stringify(item)) continue;
      Promise.resolve(prepareRef.current(item, !old))
        .then(({ id, ...data }) => setDoc(doc(db, name, id), data, { merge: true }))
        .catch(fail);
    }
    setItems(fixed); // optimistic; the snapshot listener confirms
    return undefined;
  }, [name]);

  return [items, write, fallback];
}

/** Records a taken slot in bookedSlots/{doctorId}_{date}, which the patient app reads to offer free slots. */
export function markBooked(doctorId, date, time) {
  if (!db || !doctorId || !date || !time) return;
  setDoc(doc(db, 'bookedSlots', `${doctorId}_${date}`), { times: arrayUnion(time) }, { merge: true }).catch(fail);
}

/** Writes the patient-app catalogs (medicines, labTests, articles) from src/catalog.json. */
export async function seedCatalog(catalog) {
  if (!db) return;
  const batch = writeBatch(db);
  for (const [name, items] of Object.entries(catalog)) {
    for (const { id, ...data } of items) batch.set(doc(db, name, id), data);
  }
  await batch.commit();
}

/**
 * Books doctor/date/time atomically and returns that doctor's next OPD token for the day (#1, #2 …).
 * Throws if the slot is already taken, so two desks (or the apps) can't double-book it.
 * Same counters/bookedSlots docs as the mobile app (Db.book / PDb.book).
 */
export async function reserveSlot(doctorId, date, time) {
  if (!db) return Math.floor(1 + Math.random() * 40);
  const key = `${doctorId ?? 'unassigned'}_${date}`;
  return runTransaction(db, async (tx) => {
    const slotRef = doc(db, 'bookedSlots', key);
    const counterRef = doc(db, 'counters', key);
    const slot = await tx.get(slotRef);
    const counter = await tx.get(counterRef);
    if ((slot.data()?.times ?? []).includes(time)) throw new Error(`${time} on ${date} is already booked for this doctor`);
    const token = counter.data()?.next ?? 1;
    tx.set(counterRef, { next: token + 1 }, { merge: true });
    tx.set(slotRef, { times: arrayUnion(time) }, { merge: true });
    return token;
  });
}

/** WhatsApp click-to-chat link with the booking confirmation (staff tap Send in WhatsApp). */
export function whatsappConfirmation(apt, hospital = 'ABC Hospital') {
  const digits = (apt.patientPhone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const phone = digits.length === 10 ? `91${digits}` : digits;
  const lines = [
    `Hello ${apt.patient}, your appointment at ${hospital} is confirmed.`,
    `Doctor: ${apt.doctor}`,
    `Date: ${apt.date}, ${apt.time}`,
    `Token: #${apt.token}`,
    apt.type === 'Online' ? (apt.callKey ? `Video consultation link: ${callLink(apt.id, apt.callKey)}` : 'Your video link will follow shortly.') : 'Please arrive 10 minutes early and show this token at the front desk.',
  ];
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

// ---- Slots ----
export { DEFAULT_SESSIONS, generateSlots, to12h } from './slots';

/**
 * Free slots for a doctor ({id, name}) on a YYYY-MM-DD date, from their schedule doc and existing
 * bookings. Matches bookings by id or name: rows created before linking only carry the name.
 */
export async function freeSlots(doctor, date, appointments) {
  const doctorId = doctor?.id;
  const booked = appointments
    .filter((a) => (a.doctorId ? a.doctorId === doctorId : a.doctor === doctor?.name))
    .filter((a) => a.date === date && !['Cancelled', 'No-Show'].includes(a.status))
    .map((a) => a.time);
  let day = { available: true, sessions: DEFAULT_SESSIONS };
  if (db && doctorId) {
    const snap = await getDoc(doc(db, 'schedules', doctorId));
    day = snap.data()?.days?.[date] ?? day;
  }
  if (day.available === false) return [];
  const slots = generateSlots(day.sessions, booked);
  const now = new Date();
  if (date !== now.toLocaleDateString('en-CA')) return slots;
  // Today: hide slots that have already started (same rule as the mobile app).
  const minutes = (label) => {
    const [, h, m, ap] = label.match(/(\d+):(\d+) (AM|PM)/);
    return ((Number(h) % 12) + (ap === 'PM' ? 12 : 0)) * 60 + Number(m);
  };
  return slots.filter((s) => minutes(s) > now.getHours() * 60 + now.getMinutes());
}

// ---- Bounded live windows for the large collections (1,000 staff × 25,000+ patients) ----
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');
// ponytail: windows are computed at page load; a portal left open for days keeps its old window until reload.
export const WINDOWS = {
  appointments: [where('date', '>=', daysAgo(7))],
  payments: [where('date', '>=', daysAgo(90))],
  patients: [orderBy('name'), limit(300)],
  orders: [orderBy('createdAt', 'desc'), limit(300)],
};

/** Patients by name prefix or exact phone, straight from the server (not limited to the loaded window). */
export async function searchPatients(term) {
  const t = term.trim();
  if (!db || t.length < 2) return [];
  const cap = t.replace(/\b\w/g, (c) => c.toUpperCase()); // names are stored capitalised
  const q = /^[+\d\s-]{6,}$/.test(t)
    ? query(collection(db, 'patients'), where('phone', '==', t), limit(20))
    : query(collection(db, 'patients'), orderBy('name'), where('name', '>=', cap), where('name', '<=', `${cap}`), limit(20));
  return (await getDocs(q)).docs.map((d) => ({ ...d.data(), id: d.id }));
}

// ---- Audit trail (auditLogs: append-only, admins read) ----
export function logAudit(user, action, module, details) {
  if (!db || !auth.currentUser) return;
  const { uid, email } = auth.currentUser;
  addDoc(collection(db, 'auditLogs'), { at: serverTimestamp(), uid, email, user, action, module, details })
    .catch((err) => console.error('audit log', err));
}

const stamp = (d) => d.toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
}).replace(',', '');

/** Latest 500 audit entries, newest first. Only admins may read; others get an empty list. */
export function useAuditLogs(enabled) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    if (!db || !enabled) return undefined;
    return onSnapshot(query(collection(db, 'auditLogs'), orderBy('at', 'desc'), limit(500)),
      (snap) => setLogs(snap.docs.map((d) => {
        const x = d.data();
        return { ...x, id: d.id, user: `${x.user} (${x.email})`, timestamp: x.at ? stamp(x.at.toDate()) : 'just now' };
      })),
      (err) => console.error('auditLogs listener', err));
  }, [enabled]);
  return logs;
}

// ---- Medical records (patients/{id}/records) ----
export function watchRecords(patientId, cb) {
  if (!db) return () => {};
  logAudit(ROLE_LABELS[cachedRole] ?? 'Staff', 'Viewed Medical Records', 'Patient Records', `Opened records of patient ${patientId}`);
  return onSnapshot(
    query(collection(db, 'patients', patientId, 'records'), orderBy('createdAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    (err) => console.error('records listener', err),
  );
}

export async function addRecord(patientId, record, file) {
  let attachment = {};
  if (file) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Attachment must be under 20 MB');
    const path = `records/${patientId}/${Date.now()}_${file.name}`;
    await uploadBytes(ref(storage, path), file);
    attachment = { fileUrl: await getDownloadURL(ref(storage, path)), fileName: file.name };
  }
  return addDoc(collection(db, 'patients', patientId, 'records'), {
    ...record, ...attachment, createdAt: serverTimestamp(),
  });
}

let cachedRole = null;
export async function loadUserRole(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  cachedRole = snap.data()?.role ?? null;
  return cachedRole;
}

// ---- Video calls (ZegoCloud room id = appointment id) ----
export const portalUrl = env.VITE_PUBLIC_URL || window.location.origin;
// The call key (set on online appointments by the onAppointmentWrite function) lets a patient without an
// account get a token for this one room.
export const callLink = (appointmentId, callKey = '') => `${portalUrl}/#/call/${appointmentId}?k=${callKey ?? ''}`;
