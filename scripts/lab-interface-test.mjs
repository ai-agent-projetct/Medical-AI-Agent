// Lab analyser interface end to end (emulators up + seed-emulator / seed-demo):
// hospital admin creates the key → interface engine posts HL7 ORU^R01 → the lab order is filled and flagged.
import assert from 'node:assert/strict';

const FS = 'http://127.0.0.1:8181/v1/projects/demo-medical-ai/databases/(default)/documents';
const FN = 'http://127.0.0.1:5001/demo-medical-ai/asia-south1';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const H = 'city-general';
const sample = `SLT${Date.now()}`;

const signIn = async (email, password) => (await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
})).json()).idToken;
const call = async (name, data, idToken) => (await fetch(`${FN}/${name}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ data }),
})).json();
const post = (body, key) => fetch(`${FN}/labResults`, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(key ? { 'X-Lab-Key': key } : {}) }, body });

const denied = await call('rotateLabKey', { hospitalId: H }, await signIn('reception@demo.test', 'demo-recep-123'));
assert.equal(denied.error?.status, 'PERMISSION_DENIED');
const made = await call('rotateLabKey', { hospitalId: H }, await signIn('admin@demo.test', 'demo-admin-123'));
const key = made.result?.key;
assert.ok(key?.startsWith(`${H}.`), JSON.stringify(made));
console.log('admin created analyser key; receptionist refused');

const num = (v) => ({ doubleValue: v });
const test = (code, name, unit, low, high, crit) => ({ mapValue: { fields: { code: { stringValue: code }, name: { stringValue: name }, unit: { stringValue: unit },
  low: num(low), high: num(high), ...(crit ? { critLow: num(crit) } : {}), value: { stringValue: '' }, flag: { stringValue: '' } } } });
await fetch(`${FS}/labOrders/LT-${sample}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: {
  sampleId: { stringValue: sample }, hospitalId: { stringValue: H }, status: { stringValue: 'Collected' }, patientName: { stringValue: 'Interface Test' },
  tests: { arrayValue: { values: [test('HB', 'Haemoglobin', 'g/dL', 12, 16, 7), test('WBC', 'Total WBC count', 'x10^3/uL', 4, 11)] } },
} }) });

const oru = (sid) => ['MSH|^~\\&|XN-550|LAB|HIS|CITY|20261126101500||ORU^R01|MSG-1|P|2.5.1', `OBR|1|${sid}||CBC`,
  'OBX|1|NM|HB^Haemoglobin||6.4|g/dL|12-16|LL|||F', 'OBX|2|NM|WBC^WBC||8.1|10*3/uL|4-11|N|||F'].join('\r');

assert.equal((await post(oru(sample))).status, 401);
assert.equal((await post(oru(sample), `${H}.wrong-key`)).status, 401);
const ok = await post(oru(sample), key);
const okText = await ok.text();
assert.match(okText, /MSA\|AA\|MSG-1/);
const order = (await (await fetch(`${FS}/labOrders/LT-${sample}`, { headers: owner })).json()).fields;
const tests = order.tests.arrayValue.values.map((v) => v.mapValue.fields);
assert.equal(order.status.stringValue, 'Resulted');
assert.equal(order.critical.booleanValue, true);
assert.equal(tests[0].value.stringValue, '6.4');
assert.equal(tests[0].flag.stringValue, 'LL');
assert.equal(tests[1].flag.stringValue, '');
console.log('ORU^R01 accepted (AA): order Resulted, Hb 6.4 flagged critical low');

const unknown = await (await post(oru('NO-SUCH-SAMPLE'), key)).text();
assert.match(unknown, /MSA\|AE\|MSG-1\|No order for sample NO-SUCH-SAMPLE/);
const bad = await post('hello', key);
assert.equal(bad.status, 400);
console.log('unknown sample → AE, not HL7 → 400');
console.log('PASS');
