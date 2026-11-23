import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toTwiml, twilioSignature, validTwilioRequest } from './twiml.js';
import { choice, dayOffset, language, matchDoctors, turn, yesNo } from './voiceAgent.js';

const DOCTORS = [
  { id: 'd1', name: 'Dr. Arun Kumar', department: 'Cardiology', specializations: ['Cardiology'] },
  { id: 'd2', name: 'Dr. Rajesh Kumar', department: 'Orthopedics', specializations: ['Orthopedics'] },
  { id: 'd3', name: 'Dr. Anitha Rao', department: 'Orthopedics', specializations: ['Orthopedics'] },
  { id: 'd4', name: 'Dr. Vikram Rao', department: 'General Physician', specializations: ['General Physician'] },
  { id: 'd5', name: 'Dr. Meera Nair', department: 'Pediatrics', specializations: ['Pediatrics'] },
];

function fakeCtx({ known = null, taken = [] } = {}) {
  const booked = [];
  return {
    booked,
    hospital: 'ABC Hospital',
    today: () => '2026-11-24',
    addDays: (d, n) => `2026-11-${24 + n}`,
    doctors: async () => DOCTORS,
    freeSlots: async (id, date) => ['09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM'].filter((t) => !taken.includes(`${id}|${date}|${t}`)),
    findPatient: async (phone) => (known && phone === known.phone ? known : null),
    book: async (b) => {
      const key = `${b.doctor.id}|${b.date}|${b.time}`;
      if (taken.includes(key)) throw Object.assign(new Error('taken'), { code: 'SLOT_TAKEN' });
      booked.push(b);
      return { token: booked.length + 6, appointmentId: `A${booked.length}` };
    },
  };
}

/** Plays a caller's answers through the engine; returns every agent prompt and the final result. */
async function call(answers, ctx, phone = '+919800000001') {
  let state = { phone };
  let r = await turn(state, {}, ctx);
  const said = [r.prompts.map((p) => p.text).join(' ')];
  for (const a of answers) {
    r = await turn(r.state, typeof a === 'string' ? { speech: a } : a, ctx);
    said.push(r.prompts.map((p) => p.text).join(' '));
  }
  return { r, said };
}

test('understands numbers, yes/no, days and languages in all six languages', () => {
  assert.equal(choice({ digits: '2' }, 3), 2);
  for (const w of ['two', 'ரெண்டு', 'రెండు', 'ಎರಡು', 'രണ്ട്', 'दो']) assert.equal(choice({ speech: w }, 3), 2, w);
  for (const w of ['yes', 'ஆமா', 'అవును', 'ಹೌದು', 'അതെ', 'हाँ']) assert.equal(yesNo({ speech: w }), true, w);
  for (const w of ['no', 'இல்லை', 'వద్దు', 'ಬೇಡ', 'വേണ്ട', 'नहीं']) assert.equal(yesNo({ speech: w }), false, w);
  assert.equal(dayOffset({ speech: 'நாளை மறுநாள்' }), 2); // contains நாளை (tomorrow) too
  assert.equal(dayOffset({ speech: 'రేపు' }), 1);
  assert.equal(dayOffset({ speech: 'ಇಂದು' }), 0);
  assert.equal(language({ speech: 'Malayalam' }), 'ml');
  assert.equal(language({ digits: '3' }), 'te');
});

test('symptoms and names in any language find the right doctors', () => {
  assert.deepEqual(matchDoctors('I have chest pain', DOCTORS).map((d) => d.id), ['d1']);
  assert.deepEqual(matchDoctors('மூட்டு வலி', DOCTORS).map((d) => d.id), ['d2', 'd3']);
  assert.deepEqual(matchDoctors('జ్వరం వచ్చింది', DOCTORS).map((d) => d.id), ['d4']);
  assert.deepEqual(matchDoctors('ಮಗುವಿಗೆ ಹುಷಾರಿಲ್ಲ', DOCTORS).map((d) => d.id), ['d5']);
  assert.deepEqual(matchDoctors('ഹൃദയ ഡോക്ടർ', DOCTORS).map((d) => d.id), ['d1']);
  assert.deepEqual(matchDoctors('Dr Meera please', DOCTORS).map((d) => d.id), ['d5']);
  assert.deepEqual(matchDoctors('orthopedics', DOCTORS).map((d) => d.id), ['d2', 'd3']);
});

test('Tamil caller with a new number books by voice and gets a token', async () => {
  const ctx = fakeCtx();
  const { r, said } = await call([{ digits: '2' }, 'எனக்கு நெஞ்சு வலி', 'நாளை', 'ரெண்டு', 'Lakshmi', 'ஆமா'], ctx);
  assert.match(said[1], /எந்த மருத்துவர்/);
  assert.match(said[2], /Dr\. Arun Kumar/);
  assert.match(said[3], /09:30 AM/);
  assert.match(said[5], /Lakshmi.*Dr\. Arun Kumar.*நாளை.*09:30 AM/);
  assert.equal(r.hangup, true);
  assert.match(r.prompts[0].text, /டோக்கன் எண் 7/);
  assert.deepEqual(ctx.booked[0], { doctor: { id: 'd1', name: 'Dr. Arun Kumar' }, date: '2026-11-25', time: '09:30 AM', patient: { id: null, name: 'Lakshmi', phone: '+919800000001' } });
});

test('Telugu, Kannada and Malayalam callers: department choice, caller-ID match, today', async () => {
  const known = { id: 'p9', name: 'Ravi Kumar', phone: '+919845673221' };
  for (const [digit, ortho, pickSecond, today, yes, tokenWord] of [
    ['3', 'మోకాలి నొప్పి', 'రెండు', 'ఈ రోజు', 'అవును', 'టోకెన్ నంబర్'],
    ['4', 'ಮೊಣಕಾಲು ನೋವು', 'ಎರಡು', 'ಇಂದು', 'ಹೌದು', 'ಟೋಕನ್ ಸಂಖ್ಯೆ'],
    ['5', 'മുട്ടുവേദന', 'രണ്ട്', 'ഇന്ന്', 'അതെ', 'ടോക്കൺ നമ്പർ'],
  ]) {
    const ctx = fakeCtx({ known });
    const { r } = await call([{ digits: digit }, ortho, pickSecond, today, { digits: '1' }, yes, yes], ctx, known.phone);
    assert.equal(ctx.booked.length, 1, digit);
    assert.equal(ctx.booked[0].doctor.id, 'd3'); // second orthopedic doctor
    assert.equal(ctx.booked[0].date, '2026-11-24');
    assert.equal(ctx.booked[0].time, '09:00 AM');
    assert.deepEqual(ctx.booked[0].patient, { id: 'p9', name: 'Ravi Kumar', phone: known.phone });
    assert.ok(r.prompts[0].text.includes(tokenWord), r.prompts[0].text);
  }
});

test('slot taken at the last moment → offers fresh slots; repeated confusion → reception', async () => {
  const ctx = fakeCtx({ taken: ['d4|2026-11-24|09:00 AM'] });
  // freeSlots still lists 09:00 for this test? No: it filters taken, so make book() fail by racing:
  ctx.freeSlots = async () => ['09:00 AM', '09:30 AM'];
  const { r, said } = await call([{ digits: '1' }, 'fever', 'today', 'one', 'Asha', 'yes'], ctx);
  assert.match(said.at(-1), /just taken.*Available times/);
  assert.equal(r.gather, true);
  assert.equal(ctx.booked.length, 0);

  const lost = await call([{ digits: '1' }, 'blah', 'hmm', 'what'], { ...fakeCtx(), receptionNumber: '+914400000000' });
  assert.equal(lost.r.handoff, true);
  assert.match(lost.said.at(-1), /connect you to our reception/);
});

test('TwiML gathers speech + keypad in the caller language and escapes text', () => {
  const xml = toTwiml({ state: { lang: 'ta' }, prompts: [{ text: 'A & B <x>', lang: 'ta' }], gather: true }, { actionUrl: 'https://h/voice?x=1&y=2' });
  assert.match(xml, /<Gather input="speech dtmf" numDigits="1" language="ta-IN"/);
  assert.match(xml, /<Say language="ta-IN" voice="Google\.ta-IN-Standard-A">A &amp; B &lt;x&gt;<\/Say>/);
  assert.match(xml, /action="https:\/\/h\/voice\?x=1&amp;y=2"/);
  assert.match(toTwiml({ state: {}, prompts: [], gather: false, hangup: true }, { actionUrl: '' }), /<Hangup\/>/);
  assert.match(toTwiml({ state: {}, prompts: [], gather: false, handoff: true }, { actionUrl: '', receptionNumber: '+9144' }), /<Dial>\+9144<\/Dial>/);
});

test('Twilio signature matches the worked example in Twilio’s webhook-security docs', () => {
  const p = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  assert.equal(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', p), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
});

test('Twilio signature (algorithm from Twilio docs: URL + sorted key/value pairs, HMAC-SHA1)', () => {
  const params = { CallSid: 'CA1', Digits: '1', From: '+14158675310' };
  const sig = twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params);
  assert.ok(validTwilioRequest('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params, sig));
  assert.ok(!validTwilioRequest('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', { ...params, Digits: '2' }, sig));
  assert.ok(!validTwilioRequest('', 'u', params, sig));
});
