// Simulates a phone call to the voice agent the way Twilio does it: form POSTs to the voiceCall
// webhook with CallSid/From and the caller's SpeechResult or Digits; prints the TwiML <Say> replies.
// Emulator only (signature check is skipped there). Usage: node scripts/voice-call-sim.mjs <from> <answer>...
//   answers: "#2" = keypad digit 2, anything else = speech.
const URL_ = 'http://127.0.0.1:5001/demo-medical-ai/asia-south1/voiceCall';
const [from = '+919800012345', ...answers] = process.argv.slice(2);
const callSid = `CA${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function post(extra) {
  const body = new URLSearchParams({ CallSid: callSid, From: from, To: '+914400000000', CallStatus: 'in-progress', ...extra });
  const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const xml = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${xml}`);
  const says = [...xml.matchAll(/<Say language="([^"]+)"[^>]*>([^<]*)<\/Say>/g)].map((m) => `[${m[1]}] ${m[2].replace(/&amp;/g, '&')}`);
  return { says, gather: xml.includes('<Gather'), end: xml.includes('<Hangup/>') || xml.includes('<Dial>') };
}

let r = await post({});
console.log(`AGENT: ${r.says.join('\n       ')}`);
for (const a of answers) {
  console.log(`CALLER: ${a}`);
  r = await post(a.startsWith('#') ? { Digits: a.slice(1) } : { SpeechResult: a, Confidence: '0.9' });
  console.log(`AGENT: ${r.says.join('\n       ')}`);
  if (r.end) break;
}
console.log(r.end ? '(call ended)' : '(waiting for caller)');
console.log(`CallSid ${callSid}`);
