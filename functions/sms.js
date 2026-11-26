// SMS booking confirmations through Twilio Programmable SMS (fallback when WhatsApp is not configured).
// India: commercial SMS must use a DLT-registered sender ID (header) and a DLT-registered template. The
// text sent must match the registered template exactly, so SMS_TEMPLATE holds that template with our
// placeholders: {patient} {doctor} {date} {time} {token} {hospital}.

import { waNumber } from './whatsapp.js';

export const DEFAULT_SMS_TEMPLATE = 'Dear {patient}, your appointment with {doctor} at {hospital} is on {date} at {time}. Token no. {token}.';

/** The confirmation text for an appointment, or null without a usable mobile number. */
export function bookingSms(apt, template = DEFAULT_SMS_TEMPLATE, hospital = '') {
  const to = waNumber(apt.patientPhone);
  if (!to) return null;
  const vars = { patient: apt.patient, doctor: apt.doctor, date: apt.date, time: apt.time, token: apt.token, hospital: apt.hospital ?? hospital };
  return { to: `+${to}`, body: template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m)) };
}

/** Twilio Messages API (POST /2010-04-01/Accounts/{AccountSid}/Messages.json). `from` is the sender or a MessagingServiceSid (MG…). */
export async function sendSms({ to, body }, { accountSid, authToken, from }) {
  const form = new URLSearchParams({ To: to, Body: body, ...(from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SMS ${res.status}: ${json.message ?? 'send failed'}`);
  return json.sid ?? null;
}
