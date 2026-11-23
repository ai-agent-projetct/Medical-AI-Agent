// WhatsApp Business (Meta Cloud API) template messages. Templates must be approved in Meta Business
// Manager first; the booking template takes 5 body variables in this order:
//   {{1}} patient name  {{2}} doctor  {{3}} date  {{4}} time  {{5}} token number

/** E.164 digits for an Indian or international number, or null. */
export function waNumber(phone) {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export function bookingTemplate(apt, templateName, language = 'en') {
  const to = waNumber(apt.patientPhone);
  if (!to) return null;
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: [{
        type: 'body',
        parameters: [apt.patient, apt.doctor, apt.date, apt.time, `#${apt.token}`].map((text) => ({ type: 'text', text: String(text ?? '') })),
      }],
    },
  };
}

export async function sendWhatsApp(body, { token, phoneNumberId, apiVersion }) {
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${json.error?.message ?? 'send failed'}`);
  return json.messages?.[0]?.id ?? null;
}
