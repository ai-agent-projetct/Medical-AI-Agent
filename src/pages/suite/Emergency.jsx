import React, { useEffect, useState } from 'react';
import { Plus, Siren, Printer } from 'lucide-react';
import { ESI, news2 } from '../../clinical';
import { todayYmd } from '../../hms';
import { Modal } from '../hms/common';
import { Alerts, Empty, Fields, Page, Stats, badgeFor, esc, fresh, printPage, useSuite } from './kit';

// erVisits/{id} {erNo, patientId, patientName, phone, age, gender, arrival, complaint, esi (1-5), hr, sbp, spo2, rr, temp,
//   avpu, o2, news2, mlc, mlcNo, police, doctor, arrivedAt (ms), seenAt (ms), status, disposition, notes, date}
const OPEN = ['Waiting', 'In treatment', 'Observation'];
const DISPOSITIONS = ['Admitted', 'Discharged', 'Referred', 'LAMA', 'Expired'];
const ESI_HELP = {
  1: 'Needs immediate life-saving intervention (arrest, intubation, shock).',
  2: 'High risk, confused / lethargic, severe pain or distress; should not wait.',
  3: 'Stable but needs 2+ resources (labs, imaging, IV, specialist).',
  4: 'Stable, needs one resource.',
  5: 'Stable, needs no resources (prescription, dressing).',
};
const minsSince = (ms) => (ms ? Math.round((Date.now() - ms) / 60000) : null);

/** Emergency department: triage (ESI 1–5) with NEWS2, live board ordered by acuity with door-to-doctor timers, MLC register, disposition. */
export default function Emergency({ doctors = [] }) {
  const [visits, setVisits] = useSuite('erVisits', 600);
  const [form, setForm] = useState(null);
  const [close, setClose] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const today = todayYmd();

  const open = visits.filter((v) => OPEN.includes(v.status)).sort((a, b) => a.esi - b.esi || a.arrivedAt - b.arrivedAt);
  const seenToday = visits.filter((v) => v.date === today && v.seenAt);
  const d2d = seenToday.length ? Math.round(seenToday.reduce((s, v) => s + (v.seenAt - v.arrivedAt) / 60000, 0) / seenToday.length) : null;
  const breaches = open.filter((v) => v.status === 'Waiting' && minsSince(v.arrivedAt) > ESI[v.esi - 1].target);
  const update = (v, data) => setVisits((prev) => prev.map((x) => (x.id === v.id ? { ...x, ...data } : x)));

  const save = (e) => {
    e.preventDefault();
    const s = news2(form);
    const seq = String(visits.filter((v) => v.date === today).length + 1).padStart(3, '0');
    setVisits((prev) => [fresh({ ...form, patientName: form.patientName || 'Unknown patient', esi: Number(form.esi), news2: s.score, erNo: `ER-${today.replace(/-/g, '').slice(2)}-${seq}`, arrivedAt: Date.now(), date: today, status: 'Waiting' }), ...prev]);
    setForm(null);
  };
  const mlcPrint = (v) => printPage(`Medico-legal case intimation ${v.mlcNo || v.erNo}`, `<table>
    ${[['ER no.', v.erNo], ['MLC no.', v.mlcNo], ['Patient', `${v.patientName} ${v.age ? `${v.age} y` : ''} ${v.gender ?? ''}`], ['Phone', v.phone], ['Arrived', new Date(v.arrivedAt).toLocaleString('en-IN')],
      ['Brought by', v.arrival], ['Complaint / alleged history', v.complaint], ['Police station / informed', v.police], ['Triage', `ESI ${v.esi} ${ESI[v.esi - 1].label}`], ['Attending doctor', v.doctor], ['Findings / notes', v.notes]]
    .map(([k, x]) => `<tr><th style="width:35%">${esc(k)}</th><td>${esc(x)}</td></tr>`).join('')}</table><div class="sign">Signature of Casualty Medical Officer</div>`);

  const live = form ? news2(form) : null;
  return (
    <Page title="Emergency & Triage" desc="Triage by Emergency Severity Index with NEWS2, live board ordered by acuity, door-to-doctor timers against target, medico-legal (MLC) register and disposition."
      actions={<button className="btn btn-primary" onClick={() => setForm({ patientName: '', age: '', gender: 'Male', arrival: 'Walk-in', complaint: '', esi: 3, avpu: 'A', o2: false, mlc: false, mlcNo: '', police: '', doctor: '' })}><Plus size={16} /> New arrival</button>}>
      <Stats items={[
        ['In emergency now', open.length],
        ['ESI 1–2 (critical)', open.filter((v) => v.esi <= 2).length, open.some((v) => v.esi <= 2) ? 'danger' : undefined],
        ['Door-to-doctor today', d2d === null ? '—' : `${d2d} min`],
        ['MLC today', visits.filter((v) => v.date === today && v.mlc).length],
      ]} />
      <Alerts tone="danger" title="Waiting longer than triage target" items={breaches.map((v) => `${v.erNo} ${v.patientName}: ESI ${v.esi}, waiting ${minsSince(v.arrivedAt)} min (target ${ESI[v.esi - 1].target} min)`)} />
      <div className="card"><div className="table-container"><table className="table-list">
        <thead><tr><th>Triage</th><th>Patient</th><th>Complaint</th><th>Vitals / NEWS2</th><th>Waiting</th><th>Doctor</th><th>Status</th><th /></tr></thead>
        <tbody>
          {open.map((v) => {
            const e = ESI[v.esi - 1];
            const w = minsSince(v.arrivedAt);
            return (
              <tr key={v.id}>
                <td><span className="badge" style={{ background: e.color, color: '#fff' }}>ESI {v.esi}</span><br /><small>{e.label}</small></td>
                <td><strong>{v.patientName}</strong> {v.mlc && <span className="badge badge-danger">MLC</span>}<br /><small>{v.erNo} · {v.age && `${v.age} y`} {v.gender} · {v.arrival}</small></td>
                <td>{v.complaint}</td>
                <td><small>P {v.hr ?? '—'} · BP {v.sbp ?? '—'} · SpO₂ {v.spo2 ?? '—'} · RR {v.rr ?? '—'}</small><br /><span className={`badge ${v.news2 >= 7 ? 'badge-danger' : v.news2 >= 5 ? 'badge-warning' : 'badge-secondary'}`}>NEWS2 {v.news2}</span></td>
                <td style={{ color: v.status === 'Waiting' && w > e.target ? 'var(--danger)' : undefined, fontWeight: 600 }}>{w} min</td>
                <td>
                  <input className="form-input" aria-label={`Doctor for ${v.patientName}`} list="er-doctors" defaultValue={v.doctor}
                    onBlur={(ev) => ev.target.value !== v.doctor && update(v, { doctor: ev.target.value })} />
                </td>
                <td><span className={`badge ${badgeFor(v.status)}`}>{v.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {v.status === 'Waiting' && <button className="btn btn-primary" onClick={() => update(v, { status: 'In treatment', seenAt: Date.now() })}>Seen by doctor</button>}
                  {v.status === 'In treatment' && <button className="btn btn-secondary" onClick={() => update(v, { status: 'Observation' })}>Observation</button>}{' '}
                  {v.status !== 'Waiting' && <button className="btn btn-secondary" onClick={() => setClose({ ...v, disposition: 'Discharged' })}>Disposition</button>}
                  {v.mlc && <button className="btn-icon" aria-label="Print MLC intimation" onClick={() => mlcPrint(v)}><Printer size={14} /></button>}
                </td>
              </tr>
            );
          })}
          {!open.length && <Empty cols={8} text="Emergency is clear." />}
        </tbody>
      </table></div>
      <datalist id="er-doctors">{doctors.map((d) => <option key={d.id} value={d.name} />)}</datalist>
      </div>

      <h3 style={{ marginTop: 20 }}>Closed today</h3>
      <div className="card"><div className="table-container"><table className="table-list">
        <thead><tr><th>ER no.</th><th>Patient</th><th>ESI</th><th>Disposition</th><th>Time in ER</th></tr></thead>
        <tbody>{visits.filter((v) => v.date === today && !OPEN.includes(v.status)).map((v) => (
          <tr key={v.id}><td>{v.erNo}</td><td>{v.patientName}</td><td>{v.esi}</td><td><span className={`badge ${badgeFor(v.status)}`}>{v.status}</span></td><td>{v.closedAt ? `${Math.round((v.closedAt - v.arrivedAt) / 60000)} min` : '—'}</td></tr>
        ))}</tbody>
      </table></div></div>

      {form && (
        <Modal wide title="New emergency arrival" onClose={() => setForm(null)} footer={<button className="btn btn-primary" type="submit" form="er-form"><Siren size={14} /> Register &amp; triage</button>}>
          <form id="er-form" onSubmit={save}>
            <Fields value={form} onChange={setForm} fields={[
              { k: 'patient', label: 'Patient (search, or walk-in / "Unknown male ~40")', patient: true },
              { k: 'age', label: 'Age (approx.)', type: 'number' }, { k: 'gender', label: 'Gender', options: ['Male', 'Female', 'Other'] },
              { k: 'arrival', label: 'Arrival', options: ['Walk-in', 'Ambulance (own)', 'Ambulance (108)', 'Referred', 'Police'] },
              { k: 'complaint', label: 'Chief complaint', required: true, full: true },
              { k: 'hr', label: 'Pulse', type: 'number' }, { k: 'sbp', label: 'Systolic BP', type: 'number' }, { k: 'spo2', label: 'SpO₂', type: 'number' },
              { k: 'rr', label: 'Resp. rate', type: 'number' }, { k: 'temp', label: 'Temp °C', type: 'number' }, { k: 'avpu', label: 'AVPU', options: ['A', 'C', 'V', 'P', 'U'] },
              { k: 'o2', label: 'On oxygen', type: 'checkbox' },
              { k: 'esi', label: 'Triage level (ESI)', options: ['1', '2', '3', '4', '5'] },
              { k: 'mlc', label: 'Medico-legal case (MLC)', type: 'checkbox' },
              ...(form.mlc ? [{ k: 'mlcNo', label: 'MLC no.' }, { k: 'police', label: 'Police station informed' }] : []),
            ]} />
          </form>
          <div className="card" style={{ borderLeft: `4px solid ${ESI[form.esi - 1].color}` }}>
            <strong>ESI {form.esi} · {ESI[form.esi - 1].label}</strong> (see doctor within {ESI[form.esi - 1].target || 'immediately'}{ESI[form.esi - 1].target ? ' min' : ''}) — {ESI_HELP[form.esi]}<br />
            NEWS2 {live.score} ({live.risk}){live.score >= 7 && Number(form.esi) > 2 && <b style={{ color: 'var(--danger)' }}> — NEWS2 is high: consider ESI 2.</b>}
          </div>
        </Modal>
      )}

      {close && (
        <Modal title={`Disposition · ${close.patientName}`} onClose={() => setClose(null)}
          footer={<button className="btn btn-primary" onClick={() => { update(close, { status: close.disposition, disposition: close.disposition, notes: close.notes, closedAt: Date.now() }); setClose(null); }}>Close ER visit</button>}>
          <Fields value={close} onChange={setClose} fields={[{ k: 'disposition', label: 'Outcome', options: DISPOSITIONS }, { k: 'notes', label: 'Treatment given / findings / advice', type: 'textarea' }]} />
          {close.disposition === 'Admitted' && <small>Allot the bed in In-Patient (IPD) &amp; Beds.</small>}
        </Modal>
      )}
    </Page>
  );
}
