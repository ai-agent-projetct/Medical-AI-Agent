// Appointment slot maths. Keep in sync with generateSlots in mobile_app/lib/db.dart.
export const DEFAULT_SESSIONS = [{ from: '09:00', to: '12:00' }, { from: '14:00', to: '17:00' }];

export function to12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** 30-minute slots inside each session, minus the ones already booked (labels like "09:30 AM"). */
export function generateSlots(sessions, booked = [], stepMin = 30) {
  const taken = new Set(booked);
  const out = [];
  for (const { from, to } of sessions) {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    for (let t = fh * 60 + fm; t + stepMin <= th * 60 + tm; t += stepMin) {
      const label = to12h(`${Math.floor(t / 60)}:${t % 60}`);
      if (!taken.has(label)) out.push(label);
    }
  }
  return out;
}

