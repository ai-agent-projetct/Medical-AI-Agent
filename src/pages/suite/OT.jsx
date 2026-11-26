import React, { useState } from 'react';
import { Plus, Printer, ClipboardCheck } from 'lucide-react';
import { todayYmd } from '../../hms';
import { Modal, Tabs } from '../hms/common';
import { Empty, Fields, Page, Stats, badgeFor, esc, fresh, nowHm, printPage, useSuite } from './kit';

// surgeries/{id} {patientId, patientName, phone, procedure, surgeon, assistant, anaesthetist, anaesthesia, room, date, start,
//   duration (min), priority, consent, implants, status, checklist: {signIn: {item: true}, timeOut: {...}, signOut: {...}},
//   inAt, outAt, notes: {findings, procedureDone, bloodLoss, complications, specimen, postOp}}
const ROOMS = ['OT-1', 'OT-2', 'OT-3', 'Minor OT', 'Cath lab', 'Labour room'];
const FLOW = ['Scheduled', 'Pre-op', 'In OT', 'Recovery', 'Completed'];
// WHO Surgical Safety Checklist (2009).
export const WHO_CHECKLIST = {
  signIn: ['Patient identity, site, procedure and consent confirmed', 'Site marked', 'Anaesthesia machine and medication check complete',
    'Pulse oximeter on patient and working', 'Known allergy checked', 'Difficult airway / aspiration risk assessed', 'Risk of >500 ml blood loss assessed (IV access / blood arranged)'],
  timeOut: ['All team members introduced by name and role', 'Patient, site and procedure confirmed by surgeon, anaesthetist and nurse',
    'Antibiotic prophylaxis given within the last 60 minutes', 'Anticipated critical events reviewed', 'Essential imaging displayed', 'Sterility and equipment confirmed'],
  signOut: ['Procedure name recorded', 'Instrument, sponge and needle counts correct', 'Specimen labelled (with patient name)',
    'Equipment problems addressed', 'Key concerns for recovery reviewed'],
};
const PHASE = { signIn: 'Sign in (before induction)', timeOut: 'Time out (before incision)', signOut: 'Sign out (before leaving OT)' };
const done = (s, phase) => WHO_CHECKLIST[phase].every((i) => s.checklist?.[phase]?.[i]);

/** Operation theatre: scheduling by room, live status board, WHO surgical safety checklist enforced at each step, operation notes. */
export default function OT({ doctors = [] }) {
  const [cases, setCases] = useSuite('surgeries', 600);
  const [day, setDay] = useState(todayYmd());
  const [form, setForm] = useState(null);
  const [check, setCheck] = useState(null);
  const [note, setNote] = useState(null);
  const [tab, setTab] = useState('Board');
  const update = (c, data) => setCases((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...data } : x)));
  const list = cases.filter((c) => c.date === day).sort((a, b) => a.start.localeCompare(b.start));

  const advance = (c) => {
    const next = FLOW[FLOW.indexOf(c.status) + 1];
    if (next === 'In OT' && !done(c, 'signIn')) return setCheck({ c, phase: 'signIn' });
    if (next === 'Recovery' && !(done(c, 'timeOut') && done(c, 'signOut'))) return setCheck({ c, phase: done(c, 'timeOut') ? 'signOut' : 'timeOut' });
    update(c, { status: next, ...(next === 'In OT' ? { inAt: nowHm() } : next === 'Recovery' ? { outAt: nowHm() } : {}) });
  };
  const otNote = (c) => printPage(`Operation note · ${c.procedure}`, `<table>${[
    ['Patient', `${c.patientName} ${c.phone ?? ''}`], ['Date / room', `${c.date} · ${c.room} · in ${c.inAt ?? ''} out ${c.outAt ?? ''}`], ['Procedure', c.procedure],
    ['Surgeon / assistant', `${c.surgeon} / ${c.assistant ?? ''}`], ['Anaesthetist / anaesthesia', `${c.anaesthetist} / ${c.anaesthesia}`], ['Implants', c.implants],
    ['Findings', c.notes?.findings], ['Procedure done', c.notes?.procedureDone], ['Blood loss', c.notes?.bloodLoss], ['Complications', c.notes?.complications],
    ['Specimen', c.notes?.specimen], ['Post-op orders', c.notes?.postOp],
    ['WHO checklist', Object.keys(PHASE).map((p) => `${PHASE[p]}: ${done(c, p) ? 'complete' : 'INCOMPLETE'}`).join('; ')],
  ].map(([k, v]) => `<tr><th style="width:30%">${esc(k)}</th><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table><div class="sign">Surgeon's signature</div>`);

  return (
    <Page title="Operation Theatre" desc="Surgery scheduling by theatre, live OT status, the WHO surgical safety checklist enforced before induction, incision and leaving OT, and operation notes."
      actions={<>
        <input className="form-input" type="date" aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setForm({ procedure: '', surgeon: '', assistant: '', anaesthetist: '', anaesthesia: 'GA', room: ROOMS[0], date: day, start: '09:00', duration: 60, priority: 'Elective', consent: false, implants: '' })}><Plus size={16} /> Schedule surgery</button>
      </>}>
      <Stats items={[
        ['Cases this day', list.filter((c) => c.status !== 'Cancelled').length],
        ['In OT now', list.filter((c) => c.status === 'In OT').length, 'warning'],
        ['Completed', list.filter((c) => c.status === 'Completed' || c.status === 'Recovery').length, 'success'],
        ['Cancelled / postponed', list.filter((c) => ['Cancelled', 'Postponed'].includes(c.status)).length],
      ]} />
      <Tabs tabs={['Board', 'List']} value={tab} onChange={setTab} />
      {tab === 'Board' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {ROOMS.filter((r) => list.some((c) => c.room === r) || r.startsWith('OT-')).map((r) => {
            const rc = list.filter((c) => c.room === r && c.status !== 'Cancelled');
            const now = rc.find((c) => c.status === 'In OT');
            return (
              <div key={r} className="card" style={{ borderTop: `4px solid var(--${now ? 'danger' : 'success'})` }}>
                <strong>{r}</strong> <span className={`badge ${now ? 'badge-danger' : 'badge-success'}`}>{now ? 'In use' : 'Free'}</span>
                {rc.map((c) => <div key={c.id} style={{ marginTop: 8, fontSize: 13 }}><b>{c.start}</b> {c.procedure} · {c.patientName}<br /><small>{c.surgeon} · <span className={`badge ${badgeFor(c.status)}`}>{c.status}</span></small></div>)}
                {!rc.length && <div style={{ color: 'var(--text-muted)', marginTop: 8 }}>No cases.</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card"><div className="table-container"><table className="table-list">
          <thead><tr><th>Time / room</th><th>Patient</th><th>Procedure</th><th>Team</th><th>Checklist</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.start}</strong> ({c.duration} min)<br /><small>{c.room} · {c.priority}</small></td>
                <td>{c.patientName}{!c.consent && <><br /><span className="badge badge-danger">Consent pending</span></>}</td>
                <td>{c.procedure}<br /><small>{c.anaesthesia}{c.implants && ` · ${c.implants}`}</small></td>
                <td><small>{c.surgeon}<br />{c.anaesthetist}</small></td>
                <td>{Object.keys(PHASE).map((p) => <button key={p} className={`badge ${done(c, p) ? 'badge-success' : 'badge-secondary'}`} style={{ border: 0, marginRight: 4, cursor: 'pointer' }} onClick={() => setCheck({ c, phase: p })}>{p}</button>)}</td>
                <td><span className={`badge ${badgeFor(c.status)}`}>{c.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {FLOW.indexOf(c.status) >= 0 && c.status !== 'Completed' && <button className="btn btn-primary" disabled={!c.consent && c.status === 'Pre-op'} title={!c.consent ? 'Consent required' : ''} onClick={() => advance(c)}>→ {FLOW[FLOW.indexOf(c.status) + 1]}</button>}{' '}
                  <button className="btn btn-secondary" onClick={() => setNote(c)}>Notes</button>
                  <button className="btn-icon" aria-label="Print operation note" onClick={() => otNote(c)}><Printer size={14} /></button>
                  {['Scheduled', 'Pre-op'].includes(c.status) && <select className="form-input" style={{ width: 120, display: 'inline-block' }} aria-label="Cancel or edit" value="" onChange={(e) => (e.target.value === 'Edit' ? setForm(c) : e.target.value && update(c, { status: e.target.value, consent: c.consent }))}>
                    <option value="">More…</option><option>Edit</option><option>Postponed</option><option>Cancelled</option></select>}
                </td>
              </tr>
            ))}
            {!list.length && <Empty cols={7} text="No surgeries scheduled for this day." />}
          </tbody>
        </table></div></div>
      )}
      <datalist id="ot-doctors">{doctors.map((d) => <option key={d.id} value={d.name} />)}</datalist>

      {form && (
        <Modal wide title={form.id ? 'Edit surgery' : 'Schedule surgery'} onClose={() => setForm(null)} footer={<button className="btn btn-primary" type="submit" form="ot-form">Save</button>}>
          <form id="ot-form" onSubmit={(e) => {
            e.preventDefault();
            const clash = cases.find((c) => c.id !== form.id && c.room === form.room && c.date === form.date && !['Cancelled', 'Postponed'].includes(c.status)
              && c.start < addMin(form.start, form.duration) && form.start < addMin(c.start, c.duration));
            if (clash && !window.confirm(`${form.room} is booked ${clash.start} for ${clash.procedure}. Schedule anyway?`)) return;
            setCases((prev) => (form.id ? prev.map((c) => (c.id === form.id ? form : c)) : [fresh({ ...form, status: 'Scheduled', checklist: {} }), ...prev]));
            setForm(null);
          }}>
            <Fields value={form} onChange={setForm} fields={[
              { k: 'patient', label: 'Patient', patient: true }, { k: 'procedure', label: 'Procedure', required: true, full: true },
              { k: 'surgeon', label: 'Surgeon', required: true }, { k: 'assistant', label: 'Assistant' }, { k: 'anaesthetist', label: 'Anaesthetist' },
              { k: 'anaesthesia', label: 'Anaesthesia', options: ['GA', 'Spinal', 'Epidural', 'Regional block', 'Local', 'Sedation'] },
              { k: 'room', label: 'Theatre', options: ROOMS }, { k: 'date', label: 'Date', type: 'date' }, { k: 'start', label: 'Start', type: 'time' },
              { k: 'duration', label: 'Duration (min)', type: 'number' }, { k: 'priority', label: 'Priority', options: ['Elective', 'Emergency', 'Day care'] },
              { k: 'implants', label: 'Implants / special equipment' }, { k: 'consent', label: 'Informed consent signed', type: 'checkbox' },
            ]} />
          </form>
        </Modal>
      )}

      {check && (
        <Modal title={`${PHASE[check.phase]} · ${check.c.procedure}`} onClose={() => setCheck(null)}
          footer={<button className="btn btn-primary" onClick={() => { update(check.c, { checklist: check.c.checklist }); setCheck(null); }}><ClipboardCheck size={14} /> Save checklist</button>}>
          {WHO_CHECKLIST[check.phase].map((item) => (
            <label key={item} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="checkbox" checked={!!check.c.checklist?.[check.phase]?.[item]}
                onChange={(e) => setCheck({ ...check, c: { ...check.c, checklist: { ...check.c.checklist, [check.phase]: { ...check.c.checklist?.[check.phase], [item]: e.target.checked, at: nowHm() } } } })} />
              {item}
            </label>
          ))}
          <small style={{ color: 'var(--text-muted)' }}>The case cannot move to the next stage until this step is complete.</small>
        </Modal>
      )}

      {note && (
        <Modal wide title={`Operation notes · ${note.procedure}`} onClose={() => setNote(null)}
          footer={<button className="btn btn-primary" onClick={() => { update(note, { notes: note.notes }); setNote(null); }}>Save</button>}>
          <Fields value={note.notes ?? {}} onChange={(n) => setNote({ ...note, notes: n })} fields={[
            { k: 'findings', label: 'Findings', type: 'textarea' }, { k: 'procedureDone', label: 'Procedure done', type: 'textarea' },
            { k: 'bloodLoss', label: 'Estimated blood loss' }, { k: 'complications', label: 'Complications' }, { k: 'specimen', label: 'Specimen sent' },
            { k: 'postOp', label: 'Post-op orders', type: 'textarea' },
          ]} />
        </Modal>
      )}
    </Page>
  );
}

function addMin(hm, m) {
  const [h, mm] = hm.split(':').map(Number);
  const t = h * 60 + mm + Number(m || 0);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
