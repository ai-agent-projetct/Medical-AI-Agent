// Concurrency test against the EMULATORS: many patients booking the same doctor at the same moment,
// through the real bookAppointment Cloud Function (as the patient app does).
//   1. N patients race for the SAME slot   → exactly one booking succeeds, the rest get "already booked".
//   2. N patients book DIFFERENT slots      → every booking succeeds; daily tokens are unique and gap-free.
// Run: node scripts/load-test.mjs [N]   (N ≤ 30; emulator throughput is not production throughput,
// this checks correctness under contention).
const N = Math.min(Number(process.argv[2] ?? 20), 30); // the emulator times out above ~25 simultaneous transactions
const PROJECT = 'demo-medical-ai';
const FS = `http://127.0.0.1:8181/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-south1/bookAppointment`;
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const run = Date.now().toString(36);
const doctorId = `loadtest-doctor-${run}`;
const date = '2030-01-15';

const put = (path, fields) => fetch(`${FS}/${path}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields }) });
const str = (v) => ({ stringValue: v });

// A hospital, and a doctor there working 06:00–22:00 that day: 32 half-hour slots.
await put('hospitals/loadtest-hospital', { name: str('Load Test Hospital'), status: str('Active') });
await put(`doctors/${doctorId}`, { name: str('Dr Load Test'), department: str('General Physician'), profileComplete: { booleanValue: true }, status: str('Active'), fee: { integerValue: '500' }, hospitalId: str('loadtest-hospital') });
await put(`schedules/${doctorId}`, { days: { mapValue: { fields: { [date]: { mapValue: { fields: {
  available: { booleanValue: true },
  sessions: { arrayValue: { values: [{ mapValue: { fields: { from: str('06:00'), to: str('22:00') } } }] } },
} } } } } } });

async function patient(i) {
  const email = `load-${run}-${i}@demo.test`;
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'load-test-123', returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.localId) throw new Error(JSON.stringify(j.error));
  await put(`users/${j.localId}`, { role: str('patient') });
  await put(`patients/${j.localId}`, { name: str(`Load ${i}`), ownerUid: str(j.localId), phone: str('') });
  return { uid: j.localId, idToken: j.idToken };
}

async function book(p, time) {
  const res = await fetch(FN, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.idToken}` },
    body: JSON.stringify({ data: { doctorId, date, time, patientId: p.uid } }),
  });
  const j = await res.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { status: j.error.status });
  return j.result.token;
}

const label = (i) => {
  const m = 6 * 60 + i * 30;
  const h = Math.floor(m / 60);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

console.log(`creating ${N} patients…`);
const people = await Promise.all(Array.from({ length: N }, (_, i) => patient(i)));

let t0 = Date.now();
const same = await Promise.allSettled(people.map((p) => book(p, label(0))));
const won = same.filter((r) => r.status === 'fulfilled');
const reasons = new Set(same.filter((r) => r.status === 'rejected').map((r) => r.reason.status));
console.log(`same slot: ${won.length} succeeded, ${same.length - won.length} refused (${[...reasons].join(', ')}) in ${Date.now() - t0} ms`);
if (won.length !== 1) throw new Error(`DOUBLE BOOKING: ${won.length} bookings for one slot`);
if ([...reasons].some((s) => !['ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(s))) throw new Error(`unexpected refusal: ${[...reasons]}`);

t0 = Date.now();
const diff = await Promise.allSettled(people.map((p, i) => book(p, label(i + 1))));
const failed = diff.filter((r) => r.status === 'rejected');
const tokens = diff.filter((r) => r.status === 'fulfilled').map((r) => r.value).sort((a, b) => a - b);
console.log(`different slots: ${tokens.length} succeeded, ${failed.length} failed in ${Date.now() - t0} ms`);
if (failed.length) throw new Error(`LOST BOOKINGS: ${failed.length} failed, first: ${failed[0].reason.message}`);
const expected = Array.from({ length: N }, (_, i) => i + 2); // token 1 went to the same-slot winner
if (JSON.stringify(tokens) !== JSON.stringify(expected)) throw new Error(`TOKENS NOT SEQUENTIAL: ${tokens.join(',')}`);
console.log(`tokens: #2..#${tokens.at(-1)} unique and gap-free`);
console.log('PASS');
