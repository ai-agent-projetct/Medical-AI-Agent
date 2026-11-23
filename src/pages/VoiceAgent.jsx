import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneCall, Send, Volume2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db, firebaseEnabled, functions } from '../firebase';

const LANGS = [
  ['en', 'English', 'en-IN'], ['ta', 'தமிழ்', 'ta-IN'], ['te', 'తెలుగు', 'te-IN'],
  ['kn', 'ಕನ್ನಡ', 'kn-IN'], ['ml', 'മലയാളം', 'ml-IN'], ['hi', 'हिंदी', 'hi-IN'],
];
const LOCALE = Object.fromEntries(LANGS.map(([k, , l]) => [k, l]));
const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

/** Speaks a prompt with a browser voice for its language, if the device has one. */
function speak(text, lang) {
  if (!window.speechSynthesis) return false;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').startsWith(LOCALE[lang]))
    ?? window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(LOCALE[lang].slice(0, 2)));
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  window.speechSynthesis.speak(u);
  return true;
}

/** AI voice receptionist: live phone-call log + an in-browser demo of the same booking agent. */
export default function VoiceAgent() {
  const [calls, setCalls] = useState([]);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!firebaseEnabled) return undefined;
    return onSnapshot(query(collection(db, 'voiceCalls'), orderBy('updatedAt', 'desc'), limit(50)),
      (s) => setCalls(s.docs.map((d) => ({ ...d.data(), id: d.id }))), (e) => console.error('voiceCalls', e));
  }, []);
  const today = new Date().toLocaleDateString('en-CA');
  const todays = calls.filter((c) => c.updatedAt?.toDate?.().toLocaleDateString('en-CA') === today);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>AI Voice Receptionist</h1>
          <p>Patients call the hospital number and book by voice in English, Tamil, Telugu, Kannada, Malayalam or Hindi. The agent picks the doctor from their problem, offers free slots, books with the doctor's daily token and sends the WhatsApp confirmation.</p>
        </div>
      </div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-info"><p>Calls today</p><div className="stat-value">{todays.length}</div></div><div className="stat-icon"><PhoneCall size={22} /></div></div>
        <div className="stat-card"><div className="stat-info"><p>Booked by voice today</p><div className="stat-value">{todays.filter((c) => c.status === 'Booked').length}</div></div></div>
        <div className="stat-card"><div className="stat-info"><p>Sent to reception</p><div className="stat-value">{todays.filter((c) => c.status === 'Transferred').length}</div></div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <VoiceDemo />
        <div className="card">
          <h3>Recent calls</h3>
          <div className="table-container"><table className="table-list">
            <thead><tr><th>When</th><th>Caller</th><th>Language</th><th>Status</th><th>Token</th></tr></thead>
            <tbody>
              {calls.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No calls yet</td></tr>}
              {calls.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c)} style={{ cursor: 'pointer' }}>
                  <td>{c.updatedAt?.toDate?.().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{c.channel === 'web-demo' ? 'Browser demo' : c.phone}</td>
                  <td>{LANGS.find(([k]) => k === c.lang)?.[1] ?? '—'}</td>
                  <td><span className={`badge ${c.status === 'Booked' ? 'badge-success' : c.status === 'In progress' ? 'badge-info' : 'badge-warning'}`}>{c.status}</span></td>
                  <td>{c.booking ? `#${c.booking.token}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Connect the hospital phone number</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>Buy an Indian voice number in Twilio (or port yours), then under <em>A call comes in</em> choose <strong>Webhook</strong>, HTTP POST, URL <code>https://asia-south1-&lt;project&gt;.cloudfunctions.net/voiceCall</code>.</li>
          <li>Set the same URL as the <code>VOICE_WEBHOOK_URL</code> parameter and store the Twilio auth token: <code>firebase functions:secrets:set TWILIO_AUTH_TOKEN</code>. Every request's signature is checked.</li>
          <li>Optional: <code>RECEPTION_NUMBER</code> to transfer callers the agent can't help; otherwise it promises a call-back.</li>
        </ol>
      </div>

      {open && (
        <div className="modal-overlay" role="dialog" aria-label="Call transcript">
          <div className="modal-content" style={{ maxWidth: 640 }}>
            <div className="modal-header"><h3>Call {open.channel === 'web-demo' ? '(browser demo)' : open.phone}</h3>
              <button className="btn-icon" onClick={() => setOpen(null)} aria-label="Close">✕</button></div>
            <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              {open.booking && <p><strong>Booked token #{open.booking.token}</strong> · appointment {open.booking.appointmentId}</p>}
              {(open.transcript ?? []).map((l, i) => <Bubble key={i} who={l.who} text={l.text} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ who, text }) {
  const agent = who === 'agent';
  return (
    <div style={{ display: 'flex', justifyContent: agent ? 'flex-start' : 'flex-end', margin: '6px 0' }}>
      <div style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: 12, background: agent ? 'var(--bg-input)' : 'var(--primary)', color: agent ? 'var(--text-main)' : '#fff', whiteSpace: 'pre-wrap' }}>
        <small style={{ opacity: 0.7 }}>{agent ? 'AI receptionist' : 'Caller'}</small><br />{text}
      </div>
    </div>
  );
}

/** Talk to the agent from the browser: microphone (Web Speech API) or typing, keypad 1–6. */
function VoiceDemo() {
  const [session, setSession] = useState(null);
  const [lines, setLines] = useState([]);
  const [lang, setLang] = useState('en');
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const rec = useRef(null);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [lines]); // newer Chromium returns a Promise here

  const send = async (input, id = session) => {
    setBusy(true);
    try {
      const { data } = await httpsCallable(functions, 'voiceTurn')({ sessionId: id, phone, ...input });
      setLines((l) => [...l, ...(input.speech || input.digits ? [{ who: 'caller', text: input.speech || `pressed ${input.digits}` }] : []),
        ...data.prompts.map((p) => ({ who: 'agent', text: p.text, lang: p.lang }))]);
      setLang(data.lang);
      window.speechSynthesis?.cancel();
      const spoken = data.prompts.map((p) => speak(p.text, p.lang));
      setNoVoice(spoken.some((s) => !s));
      if (data.hangup) setEnded(true);
    } catch (e) {
      setLines((l) => [...l, { who: 'agent', text: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };
  const start = () => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    setSession(id); setLines([]); setEnded(false);
    send({}, id);
  };
  const listen = () => {
    if (!Recognition) return;
    const r = new Recognition();
    r.lang = LOCALE[lang];
    r.interimResults = false;
    r.onresult = (e) => send({ speech: e.results[0][0].transcript });
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <div className="card">
      <h3><Volume2 size={16} /> Try it: talk to the agent</h3>
      {!session || ended ? (
        <div className="form-input-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group"><label>Caller number (optional, tests caller-ID)</label>
            <input className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 01234" /></div>
          <button className="btn btn-primary" onClick={start} disabled={!firebaseEnabled}><PhoneCall size={14} /> {ended ? 'New call' : 'Start call'}</button>
        </div>
      ) : null}
      {!firebaseEnabled && <p style={{ color: 'var(--text-muted)' }}>Needs the Firebase backend (run <code>npm run demo</code>).</p>}
      <div style={{ maxHeight: 360, overflowY: 'auto', margin: '12px 0' }}>
        {lines.map((l, i) => <Bubble key={i} who={l.who} text={l.text} />)}
        <div ref={end} />
      </div>
      {noVoice && <small style={{ color: 'var(--text-muted)' }}>This browser has no voice installed for some of these languages, so those replies are shown as text. Phone callers hear Twilio's voices.</small>}
      {session && !ended && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
            {[1, 2, 3, 4, 5, 6].map((d) => <button key={d} className="btn btn-secondary" disabled={busy} onClick={() => send({ digits: String(d) })} aria-label={`Press ${d}`}>{d}</button>)}
          </div>
          <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send({ speech: text.trim() }); setText(''); } }}>
            {Recognition && (
              <button type="button" className={`btn ${listening ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => (listening ? rec.current?.stop() : listen())}
                aria-label={listening ? 'Stop listening' : 'Speak'}>{listening ? <MicOff size={16} /> : <Mic size={16} />}</button>
            )}
            <input className="form-input" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={Recognition ? `Speak (${LANGS.find(([k]) => k === lang)?.[1]}) or type` : 'Type what the caller says'} />
            <button className="btn btn-secondary" disabled={busy || !text.trim()} aria-label="Send"><Send size={16} /></button>
          </form>
        </>
      )}
    </div>
  );
}
