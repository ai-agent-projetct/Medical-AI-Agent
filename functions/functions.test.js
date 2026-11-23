import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { test } from 'node:test';
import { bookingTemplate, waNumber } from './whatsapp.js';
import { generateToken04 } from './zego.js';

/** Decodes a Token04 the way ZEGOCLOUD's server does, to check our output is well-formed. */
function decode(token, secret) {
  assert.equal(token.slice(0, 2), '04');
  const buf = Buffer.from(token.slice(2), 'base64');
  const expire = Number(buf.readBigInt64BE(0));
  const ivLen = buf.readUInt16BE(8);
  const iv = buf.subarray(10, 10 + ivLen).toString();
  const encLen = buf.readUInt16BE(10 + ivLen);
  const enc = buf.subarray(12 + ivLen, 12 + ivLen + encLen);
  const d = createDecipheriv('aes-256-cbc', secret, iv);
  return { expire, info: JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString()) };
}

test('Token04 round-trips and is scoped to the room', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyz012345';
  const { expire, info } = decode(generateToken04(123456, 'user_1', secret, 7200, 'APT-1'), secret);
  assert.equal(info.app_id, 123456);
  assert.equal(info.user_id, 'user_1');
  assert.equal(info.expire, expire);
  assert.equal(info.expire - info.ctime, 7200);
  assert.deepEqual(JSON.parse(info.payload), { room_id: 'APT-1', privilege: { 1: 1, 2: 1 }, stream_id_list: null });
  assert.throws(() => generateToken04(1, 'u', 'short', 60), /32 byte/);
});

test('WhatsApp numbers and booking template', () => {
  assert.equal(waNumber('+91 98456 73221'), '919845673221');
  assert.equal(waNumber('09845673221'), '919845673221');
  assert.equal(waNumber('12345'), null);
  const body = bookingTemplate({ patient: 'Ravi', doctor: 'Dr A', date: '2026-12-01', time: '09:30 AM', token: 4, patientPhone: '9845673221' }, 'appointment_confirmation');
  assert.equal(body.to, '919845673221');
  assert.deepEqual(body.template.components[0].parameters.map((p) => p.text), ['Ravi', 'Dr A', '2026-12-01', '09:30 AM', '#4']);
  assert.equal(bookingTemplate({ patientPhone: '' }, 't'), null);
});

test('voice ctx helpers: IST dates, phone formats, slot maths', async () => {
  const { addDays, istToday, phoneVariants, generateSlots } = await import('./voiceCtx.js');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-02-28', 2), '2026-03-02');
  assert.equal(istToday(new Date('2026-11-24T20:00:00Z')), '2026-11-25'); // 01:30 IST next day
  assert.deepEqual(phoneVariants('+919845673221').slice(0, 2), ['+91 98456 73221', '+919845673221']);
  assert.equal(phoneVariants('09845673221')[3], '9845673221');
  assert.deepEqual(generateSlots([{ from: '09:00', to: '10:30' }], ['09:30 AM']), ['09:00 AM', '10:00 AM']);
});

test('withRetry retries ABORTED with backoff, not other errors', async () => {
  const { withRetry } = await import('./voiceCtx.js');
  let n = 0;
  assert.equal(await withRetry(async () => { if (++n < 3) throw Object.assign(new Error('10 ABORTED: lock'), { code: 10 }); return 'ok'; }), 'ok');
  assert.equal(n, 3);
  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw Object.assign(new Error('taken'), { code: 'SLOT_TAKEN' }); }), /taken/);
  assert.equal(m, 1);
});
