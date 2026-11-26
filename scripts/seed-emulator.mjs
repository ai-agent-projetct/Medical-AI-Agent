// Creates local test accounts in the Firebase Auth/Firestore EMULATORS only (demo-medical-ai).
// Run after `npm run emulators`:  node scripts/seed-emulator.mjs [--reset]   (--reset wipes emulator data first)
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FS = 'http://127.0.0.1:8181/v1/projects/demo-medical-ai/databases/(default)/documents';

// Emulator-only test logins. Never reuse these anywhere real.
// Staff belong to hospital 'city-general' (doctors signing up in the app use it as the hospital code).
const HOSPITAL = 'city-general';
const ACCOUNTS = [
  { email: 'owner@demo.test', password: 'demo-owner-123', role: 'super_admin' },
  { email: 'admin@demo.test', password: 'demo-admin-123', role: 'admin', hospitalId: HOSPITAL },
  { email: 'reception@demo.test', password: 'demo-recep-123', role: 'receptionist', hospitalId: HOSPITAL },
  { email: 'billing@demo.test', password: 'demo-bill-123', role: 'billing', hospitalId: HOSPITAL },
  { email: 'pharmacy@demo.test', password: 'demo-pharm-123', role: 'pharmacist', hospitalId: HOSPITAL },
];

if (process.argv.includes('--reset')) {
  await fetch('http://127.0.0.1:8181/emulator/v1/projects/demo-medical-ai/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-medical-ai/accounts', { method: 'DELETE' });
  console.log('emulator data cleared');
}

{
  const w = await fetch(`${FS}/hospitals/${HOSPITAL}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { name: { stringValue: 'City General Hospital' }, city: { stringValue: 'Chennai' }, status: { stringValue: 'Active' }, plan: { stringValue: 'Enterprise' }, voiceNumber: { stringValue: '+914400000000' } } }), // number dialled by scripts/voice-call-sim.mjs
  });
  if (!w.ok) throw new Error(`hospital write ${w.status}`);
  console.log(`seeded hospital     ${HOSPITAL}`);
}

for (const a of ACCOUNTS) {
  let r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: a.email, password: a.password, returnSecureToken: true }),
  });
  let body = await r.json();
  if (body.error?.message === 'EMAIL_EXISTS') {
    r = await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: a.email, password: a.password, returnSecureToken: true }),
    });
    body = await r.json();
  }
  if (!body.localId) throw new Error(`${a.email}: ${JSON.stringify(body.error)}`);
  // "Bearer owner" bypasses security rules — emulator only.
  const w = await fetch(`${FS}/users/${body.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { role: { stringValue: a.role }, email: { stringValue: a.email }, ...(a.hospitalId ? { hospitalId: { stringValue: a.hospitalId } } : {}) } }),
  });
  if (!w.ok) throw new Error(`${a.email}: role write ${w.status}`);
  console.log(`seeded ${a.role.padEnd(12)} ${a.email}`);
}

// Patient-app catalogs (medicines, lab tests, articles) from the portal's src/catalog.json.
const { readFile } = await import('node:fs/promises');
const catalog = JSON.parse(await readFile(new URL('../src/catalog.json', import.meta.url), 'utf8'));
const value = (v) => typeof v === 'boolean' ? { booleanValue: v }
  : Number.isInteger(v) ? { integerValue: String(v) }
  : typeof v === 'number' ? { doubleValue: v } : { stringValue: String(v) };
for (const [name, items] of Object.entries(catalog)) {
  for (const { id, ...data } of items) {
    const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, value(v)]));
    const w = await fetch(`${FS}/${name}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    });
    if (!w.ok) throw new Error(`${name}/${id}: ${w.status}`);
  }
  console.log(`seeded ${name.padEnd(12)} ${items.length}`);
}
