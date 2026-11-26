import test from 'node:test';
import assert from 'node:assert/strict';
import { ack, applyResults, oruResults, parseHl7 } from './hl7.js';
import { bookingSms } from './sms.js';

const ORU = [
  'MSH|^~\\&|XN-550|LAB|HIS|CITY|20261126101500||ORU^R01|MSG0001|P|2.5.1',
  'PID|1||PAT-1001||Menon^Rahul',
  'OBR|1|S261126001||CBC^Complete blood count',
  'OBX|1|NM|HB^Haemoglobin||6.5|g/dL|12-16|LL|||F',
  'OBX|2|NM|WBC^Total WBC||7.2|10*3/uL|4-11|N|||F',
  'OBX|3|NM|PLT^Platelets||||150-450||||X',
  'OBX|4|NM|MCV^Mean cell volume||88|fL|80-100|N|||F',
].join('\r');

test('HL7: parses ORU^R01 with sample id, values, units, flags, final status', () => {
  const [o] = oruResults(ORU);
  assert.equal(o.sampleId, 'S261126001');
  assert.equal(o.controlId, 'MSG0001');
  assert.equal(o.results.length, 4);
  assert.deepEqual(o.results[0], { code: 'HB', name: 'Haemoglobin', value: '6.5', unit: 'g/dL', range: '12-16', flag: 'LL', final: true });
  assert.equal(o.results[2].final, false);
  assert.equal(parseHl7(ORU.replace(/\r/g, '\n'))[0].f[9], 'ORU^R01');
  assert.throws(() => oruResults('PID|1'), /MSH/);
  assert.throws(() => oruResults(ORU.replace('ORU^R01', 'ADT^A01')), /Unsupported/);
});

test('HL7: results fill the order lines; our ranges decide the flag; extras reported', () => {
  const tests = [{ code: 'HB', name: 'Haemoglobin', unit: 'g/dL', low: 12, high: 16, critLow: 7, value: '' }, { code: 'WBC', name: 'Total WBC count', unit: '×10³/µL', low: 4, high: 11, value: '' }];
  const flag = (v, t) => (Number(v) < t.critLow ? 'LL' : Number(v) < t.low ? 'L' : Number(v) > t.high ? 'H' : '');
  const r = applyResults(tests, oruResults(ORU)[0].results, flag);
  assert.equal(r.matched, 2);
  assert.deepEqual(r.unmatched, ['MCV']);
  assert.equal(r.tests[0].value, '6.5');
  assert.equal(r.tests[0].flag, 'LL');
  assert.equal(r.tests[1].flag, '');
  assert.match(r.tests[1].note, /Analyser \(10\*3\/uL\)/);
});

test('HL7 ACK echoes the control id', () => {
  const a = ack('MSG0001', 'AE', 'No order for sample X|Y');
  assert.match(a, /^MSH\|\^~\\&\|HIS/);
  assert.match(a, /\rMSA\|AE\|MSG0001\|No order for sample X Y$/);
});

test('SMS: DLT template filled exactly; bad numbers skipped', () => {
  const apt = { patient: 'Lakshmi', doctor: 'Dr. Arun Kumar', date: '2026-11-27', time: '11:30 AM', token: 5, patientPhone: '98123 45678', hospital: 'City General' };
  assert.deepEqual(bookingSms(apt), { to: '+919812345678', body: 'Dear Lakshmi, your appointment with Dr. Arun Kumar at City General is on 2026-11-27 at 11:30 AM. Token no. 5.' });
  assert.equal(bookingSms({ ...apt, patientPhone: '123' }), null);
  assert.equal(bookingSms(apt, 'Token {token} {unknown}').body, 'Token 5 {unknown}');
});
