// TwiML for the voice agent + Twilio webhook signature check.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LOCALE } from './voiceAgent.js';

// Twilio text-to-speech voices per language. Check the current list in Twilio Console › Voice ›
// Text-to-speech before going live; any voice for the same locale works.
export const VOICES = {
  en: 'Google.en-IN-Standard-A', ta: 'Google.ta-IN-Standard-A', te: 'Google.te-IN-Standard-A',
  kn: 'Google.kn-IN-Standard-A', ml: 'Google.ml-IN-Standard-A', hi: 'Google.hi-IN-Standard-A',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const sayXml = ({ text, lang }) => `<Say language="${LOCALE[lang]}" voice="${VOICES[lang]}">${esc(text)}</Say>`;

/**
 * @param r result of voiceAgent.turn()
 * @param o {actionUrl, receptionNumber, hints}
 */
export function toTwiml(r, { actionUrl, receptionNumber = '', hints = [] }) {
  const lang = r.state.lang ?? 'en';
  const says = r.prompts.map(sayXml).join('');
  let body;
  if (r.gather) {
    const hint = hints.length ? ` hints="${esc(hints.slice(0, 100).join(', '))}"` : '';
    // Language menu: one digit is enough. No input → Twilio follows <Redirect> and we count a miss.
    body = `<Gather input="speech dtmf" numDigits="1" language="${LOCALE[lang]}" speechTimeout="auto" action="${esc(actionUrl)}" method="POST"${hint}>${says}</Gather>`
      + `<Redirect method="POST">${esc(actionUrl)}</Redirect>`;
  } else if (r.handoff && receptionNumber) {
    body = `${says}<Dial>${esc(receptionNumber)}</Dial>`;
  } else {
    body = `${says}<Hangup/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

/** X-Twilio-Signature: base64 HMAC-SHA1 of the full webhook URL + each POST param (sorted) as key+value. */
export function twilioSignature(authToken, url, params) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function validTwilioRequest(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(String(signature));
  return expected.length === got.length && timingSafeEqual(expected, got);
}
