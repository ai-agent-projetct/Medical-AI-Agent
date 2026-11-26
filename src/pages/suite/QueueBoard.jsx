import React, { useEffect, useRef, useState } from 'react';
import { Maximize, Volume2, VolumeX } from 'lucide-react';
import { limit, where } from 'firebase/firestore';
import { tenant } from '../../firebase';
import { scoped, todayYmd, useQueryDocs } from '../../hms';

const serving = (s) => /in.?consult|in.?progress|checked.?in/i.test(s ?? '');
const waiting = (s) => /confirm|wait|book|scheduled|pending/i.test(s ?? '');

/** Waiting-hall TV: each doctor's token now being served and the next tokens, with a spoken announcement when the token changes. */
export default function QueueBoard() {
  const today = todayYmd();
  const appts = useQueryDocs(() => scoped('appointments', where('date', '==', today), limit(3000)), [today]);
  const [voice, setVoice] = useState(true);
  const said = useRef({});
  const box = useRef(null);

  const byDoctor = {};
  for (const a of appts.docs) (byDoctor[a.doctor ?? 'Doctor'] ??= []).push(a);
  const rows = Object.entries(byDoctor).map(([doctor, list]) => {
    const sorted = [...list].sort((x, y) => (x.token ?? 0) - (y.token ?? 0));
    return { doctor, dept: list[0].department, now: sorted.find((a) => serving(a.status)), next: sorted.filter((a) => waiting(a.status)).slice(0, 4), done: list.filter((a) => /complete/i.test(a.status ?? '')).length };
  }).sort((a, b) => a.doctor.localeCompare(b.doctor));

  useEffect(() => {
    for (const r of rows) {
      const t = r.now?.token;
      if (t && said.current[r.doctor] !== t) {
        const first = said.current[r.doctor] === undefined;
        said.current[r.doctor] = t;
        if (!first && voice && window.speechSynthesis) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Token number ${t}, please proceed to ${r.doctor}${r.dept ? `, ${r.dept}` : ''}.`));
        }
      }
    }
  });

  return (
    <div ref={box} className="page-container" style={{ background: 'var(--bg-primary, #0f172a)', minHeight: '80vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{tenant.hospital?.name ?? 'OPD'} · Token display</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setVoice(!voice)} aria-label="Toggle announcements">{voice ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
          <button className="btn btn-secondary" onClick={() => box.current?.requestFullscreen?.()} aria-label="Full screen"><Maximize size={16} /> Full screen</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {rows.map((r) => (
          <div key={r.doctor} className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{r.doctor}</div>
            <small style={{ color: 'var(--text-muted)' }}>{r.dept}</small>
            <div style={{ margin: '12px 0', fontSize: 14, color: 'var(--text-muted)' }}>NOW SERVING</div>
            <div style={{ fontSize: 64, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{r.now?.token ?? '—'}</div>
            <div style={{ marginTop: 12 }}>Next: {r.next.map((a) => <span key={a.id} className="badge badge-secondary" style={{ fontSize: 16, margin: 2 }}>{a.token}</span>)}{!r.next.length && '—'}</div>
            <small style={{ color: 'var(--text-muted)' }}>{r.done} seen today</small>
          </div>
        ))}
        {!rows.length && <div className="card">{appts.loading ? 'Loading…' : 'No appointments today.'}</div>}
      </div>
    </div>
  );
}
