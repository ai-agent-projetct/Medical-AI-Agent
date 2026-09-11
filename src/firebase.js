import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, getDoc, query,
  runTransaction, serverTimestamp, addDoc, orderBy,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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

// Firestore role → portal role label used by the RBAC matrix in App.jsx.
export const ROLE_LABELS = {
  admin: 'Super Admin',
  hospital_admin: 'Hospital Admin',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  billing: 'Billing Staff',
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
export function useLiveCollection(name, fallback, prepare = (item) => item) {
  const [items, setItems] = useState(db ? [] : fallback);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;

  useEffect(() => {
    if (!db) return undefined;
    return onSnapshot(collection(db, name),
      (snap) => setItems(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
      (err) => console.error(`${name} listener`, err));
  }, [name]);

  const write = useCallback((updater) => {
    if (!db) return setItems(updater);
    const prev = itemsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    const prevById = new Map(prev.map((i) => [i.id, i]));
    const seen = new Set();
    for (let item of next) {
      // Pages mint random ids (PAT-123); never let a collision overwrite another record.
      if (seen.has(item.id)) item = { ...item, id: doc(collection(db, name)).id };
      seen.add(item.id);
      const old = prevById.get(item.id);
      if (old && JSON.stringify(old) === JSON.stringify(item)) continue;
      Promise.resolve(prepareRef.current(item, !old))
        .then(({ id, ...data }) => setDoc(doc(db, name, id), data, { merge: true }))
        .catch(fail);
    }
    setItems(next); // optimistic; the snapshot listener confirms
    return undefined;
  }, [name]);

  return [items, write, fallback];
}

/** Next hospital-wide token number (#58, #59 …), shared with the mobile app. */
export async function nextToken() {
  if (!db) return Math.floor(100 + Math.random() * 900);
  return runTransaction(db, async (tx) => {
    const counter = doc(db, 'counters', 'appointments');
    const snap = await tx.get(counter);
    const next = (snap.exists() ? snap.data().next : 1) || 1;
    tx.set(counter, { next: next + 1 }, { merge: true });
    return next;
  });
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

// ---- Medical records (patients/{id}/records) ----
export function watchRecords(patientId, cb) {
  if (!db) return () => {};
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

export async function loadUserRole(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.data()?.role ?? null;
}

// ---- Video calls (ZegoCloud room id = appointment id) ----
export const portalUrl = env.VITE_PUBLIC_URL || window.location.origin;
export const callLink = (appointmentId) => `${portalUrl}/#/call/${appointmentId}`;
