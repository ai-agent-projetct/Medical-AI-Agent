// Exercises the deployed-in-emulator Cloud Functions end to end (run with emulators up + seed-emulator):
//   onAppointmentWrite gives online appointments a callKey; zegoToken enforces who may join.
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FS = 'http://127.0.0.1:8181/v1/projects/demo-medical-ai/databases/(default)/documents';
const FN = 'http://127.0.0.1:5001/demo-medical-ai/asia-south1/zegoToken';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const id = `FNTEST-${Date.now()}`;

const signIn = async (email, password) => (await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
})).json()).idToken;
const call = async (data, idToken) => (await fetch(FN, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }, body: JSON.stringify({ data }),
})).json();

await fetch(`${FS}/appointments/${id}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: {
  patient: { stringValue: 'Fn Test' }, type: { stringValue: 'Online' }, status: { stringValue: 'Confirmed' }, token: { integerValue: '1' },
} }) });

let key;
for (let i = 0; i < 40 && !key; i++) {
  await new Promise((r) => setTimeout(r, 500));
  key = (await (await fetch(`${FS}/appointments/${id}`, { headers: owner })).json()).fields?.callKey?.stringValue;
}
assert.ok(key, 'onAppointmentWrite should set callKey');
console.log('callKey set by trigger:', `${key.slice(0, 6)}…`);

const denied = await call({ roomId: id });
assert.equal(denied.error?.status, 'PERMISSION_DENIED');
const wrong = await call({ roomId: id, key: 'nope' });
assert.equal(wrong.error?.status, 'PERMISSION_DENIED');
console.log('no key / wrong key: PERMISSION_DENIED');

const viaKey = await call({ roomId: id, key, userName: 'Patient' });
assert.ok(viaKey.result?.token?.startsWith('04'), JSON.stringify(viaKey));
const staff = await call({ roomId: id }, await signIn('reception@demo.test', 'demo-recep-123'));
assert.ok(staff.result?.token?.startsWith('04'), JSON.stringify(staff));
console.log('patient link key and receptionist login: token issued');

// Decode with the emulator's secret: the token is for this room only.
const secret = readFileSync(new URL('../functions/.secret.local', import.meta.url), 'utf8').match(/ZEGO_SERVER_SECRET=(\w+)/)[1];
const buf = Buffer.from(viaKey.result.token.slice(2), 'base64');
const ivLen = buf.readUInt16BE(8);
const iv = buf.subarray(10, 10 + ivLen).toString();
const encLen = buf.readUInt16BE(10 + ivLen);
const d = createDecipheriv('aes-256-cbc', secret, iv);
const info = JSON.parse(Buffer.concat([d.update(buf.subarray(12 + ivLen, 12 + ivLen + encLen)), d.final()]).toString());
assert.equal(JSON.parse(info.payload).room_id, id);
assert.equal(info.user_id, viaKey.result.userId);
console.log('token decodes; scoped to room', id);

await fetch(`${FS}/appointments/${id}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { status: { stringValue: 'Completed' }, type: { stringValue: 'Online' } } }) });
const after = await call({ roomId: id, key });
assert.equal(after.error?.status, 'FAILED_PRECONDITION');
console.log('completed consultation: FAILED_PRECONDITION');
console.log('PASS');
