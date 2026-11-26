// Database side of the voice agent (Admin SDK). Same documents the apps use:
// schedules/{doctorId}, bookedSlots/{doctorId}_{date}, counters/{doctorId}_{date}, patients, appointments.
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_SESSIONS = [{ from: '09:00', to: '12:00' }, { from: '14:00', to: '17:00' }];
const to12h = (h, m) => `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
/** Same slot maths as src/slots.js and mobile_app/lib/db.dart (keep in sync). */
export function generateSlots(sessions, booked = [], stepMin = 30) {
  const taken = new Set(booked);
  const out = [];
  for (const { from, to } of sessions) {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    for (let t = fh * 60 + fm; t + stepMin <= th * 60 + tm; t += stepMin) {
      const label = to12h(Math.floor(t / 60), t % 60);
      if (!taken.has(label)) out.push(label);
    }
  }
  return out;
}

const IST = 'Asia/Kolkata';
export const istToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: IST });
const istMinutes = (now = new Date()) => {
  const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: IST, hour12: false }).split(':').map(Number);
  return h * 60 + m;
};
export const addDays = (ymd, n) => new Date(Date.UTC(...ymd.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) + n * 86_400_000).toISOString().slice(0, 10);
const slotMinutes = (label) => {
  const [, h, m, ap] = label.match(/(\d+):(\d+) (AM|PM)/);
  return ((Number(h) % 12) + (ap === 'PM' ? 12 : 0)) * 60 + Number(m);
};

/** Indian mobile number in the formats the apps store, for an exact-match lookup. */
export function phoneVariants(phone) {
  const d = String(phone ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  if (d.length !== 10) return phone ? [String(phone)] : [];
  return [`+91 ${d.slice(0, 5)} ${d.slice(5)}`, `+91${d}`, `+91 ${d}`, d, `0${d}`];
}

/**
 * Bookings for one doctor-day serialise on its token counter (tokens must be gap-free). Under a burst the
 * transaction can abort on lock contention; retry with random backoff instead of failing the patient.
 */
export async function withRetry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const aborted = e.code === 10 || /ABORTED/.test(e.message ?? '');
      if (!aborted || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i * (0.5 + Math.random())));
    }
  }
}

/** Booking context for one hospital (hospitalId) — doctors, patients and bookings never cross hospitals. */
export function makeCtx(db, { hospitalId, hospital, receptionNumber, source }) {
  let doctorCache = null;
  return {
    hospital,
    receptionNumber,
    today: () => istToday(),
    addDays,
    async doctors() {
      if (!doctorCache) {
        let q = db.collection('doctors').where('profileComplete', '==', true);
        if (hospitalId) q = q.where('hospitalId', '==', hospitalId);
        const snap = await q.get();
        doctorCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.status !== 'Inactive');
      }
      return doctorCache;
    },
    async freeSlots(doctorId, date) {
      const [sched, booked] = await Promise.all([db.doc(`schedules/${doctorId}`).get(), db.doc(`bookedSlots/${doctorId}_${date}`).get()]);
      const day = sched.data()?.days?.[date];
      if (day?.available === false) return [];
      let slots = generateSlots(day?.sessions ?? DEFAULT_SESSIONS, booked.data()?.times ?? []);
      if (date === istToday()) slots = slots.filter((s) => slotMinutes(s) > istMinutes() + 15); // 15 min to reach the hospital
      return slots;
    },
    async findPatient(phone) {
      const variants = phoneVariants(phone);
      if (!variants.length) return null;
      let q = db.collection('patients').where('phone', 'in', variants.slice(0, 10));
      if (hospitalId) q = q.where('hospitalIds', 'array-contains', hospitalId);
      const snap = await q.limit(1).get();
      return snap.empty ? null : { id: snap.docs[0].id, name: snap.docs[0].data().name };
    },
    /** Slot lock + per-doctor daily token + booking in one transaction (same as the apps). */
    async book({ doctor, date, time, patient, extra = {} }) {
      const docSnap = await db.doc(`doctors/${doctor.id}`).get();
      const d = docSnap.data() ?? {};
      const hid = d.hospitalId ?? hospitalId;
      if (!hid) throw new Error('Doctor is not linked to a hospital');
      const slotRef = db.doc(`bookedSlots/${doctor.id}_${date}`);
      const counterRef = db.doc(`counters/${doctor.id}_${date}`);
      const aptRef = db.collection('appointments').doc();
      const phone = phoneVariants(patient.phone)[0] ?? patient.phone ?? '';
      return withRetry(() => db.runTransaction(async (tx) => {
        const [slot, counter] = await Promise.all([tx.get(slotRef), tx.get(counterRef)]);
        if ((slot.data()?.times ?? []).includes(time)) throw Object.assign(new Error('Slot taken'), { code: 'SLOT_TAKEN' });
        const token = counter.data()?.next ?? 1;
        let patientId = patient.id;
        if (!patientId) {
          const pRef = db.collection('patients').doc();
          patientId = pRef.id;
          tx.set(pRef, { name: patient.name, phone, status: 'Active', source, hospitalIds: [hid], updatedBy: 'system', createdAt: FieldValue.serverTimestamp() });
        } else {
          // An existing (e.g. patient-app) profile becomes visible to the hospital it books with.
          tx.update(db.doc(`patients/${patientId}`), { hospitalIds: FieldValue.arrayUnion(hid), updatedBy: 'system' });
        }
        tx.set(counterRef, { next: token + 1 }, { merge: true });
        tx.set(slotRef, { times: FieldValue.arrayUnion(time) }, { merge: true });
        tx.set(aptRef, {
          patient: patient.name, patientId, patientPhone: phone, doctor: d.name ?? doctor.name, doctorId: doctor.id,
          department: d.department ?? 'General', fee: d.fee ?? 0, date, time, type: 'Offline', visitType: 'General',
          status: 'Confirmed', token, source, createdAt: FieldValue.serverTimestamp(), hospitalId: hid, hospital: d.hospital ?? hospital ?? '',
          updatedBy: extra.ownerUid ?? 'system', ...extra,
        });
        return { token, appointmentId: aptRef.id, patientId };
      }, { maxAttempts: 10 }));
    },
  };
}
