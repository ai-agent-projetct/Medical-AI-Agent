import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Pill, NotebookPen } from 'lucide-react';
import { doc, getDoc, limit, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { news2, rxAlerts } from '../../clinical';
import { scoped, todayYmd, useQueryDocs } from '../../hms';
import { Modal, Tabs } from '../hms/common';
import { Alerts, Empty, Fields, Page, Stats, Trend, fresh, nowHm, useSuite } from './kit';

// vitals/{id}     {patientId, patientName, admissionId, bedLabel, date, time, hr, rr, sbp, dbp, temp, spo2, o2, avpu,
//                  pain, glucose, intake, output, news2, risk, by}
// medAdmin/{id}   {patientId, patientName, admissionId, bedLabel, drug, dose, route, times[], startDate, endDate,
//                  status: Active | Stopped, given: {'yyyy-MM-dd HH:mm': 'name at HH:mm' | 'Held: reason'}}
// nursingNotes/{id} {patientId, patientName, admissionId, shift, note, date, time}
const RISK_TONE = { High: 'danger', Medium: 'warning', 'Low-Medium': 'warning', Low: 'success' };
const VITAL_FIELDS = [
  { k: 'hr', label: 'Pulse (/min)', type: 'number' }, { k: 'rr', label: 'Resp. rate (/min)', type: 'number' },
  { k: 'sbp', label: 'Systolic BP', type: 'number' }, { k: 'dbp', label: 'Diastolic BP', type: 'number' },
  { k: 'temp', label: 'Temp (°C)', type: 'number' }, { k: 'spo2', label: 'SpO₂ (%)', type: 'number' },
  { k: 'o2', label: 'On oxygen', type: 'checkbox' }, { k: 'avpu', label: 'Consciousness', options: ['A', 'C', 'V', 'P', 'U'] },
  { k: 'pain', label: 'Pain (0–10)', type: 'number' }, { k: 'glucose', label: 'Glucose (mg/dL)', type: 'number' },
  { k: 'intake', label: 'Intake (ml)', type: 'number' }, { k: 'output', label: 'Output (ml)', type: 'number' },
];
const ROUTES = ['Oral', 'IV', 'IM', 'SC', 'Inhalation', 'Topical', 'PR', 'SL'];
const FREQ = { OD: ['08:00'], BD: ['08:00', '20:00'], TDS: ['08:00', '14:00', '20:00'], QID: ['06:00', '12:00', '18:00', '22:00'], Q6H: ['00:00', '06:00', '12:00', '18:00'], HS: ['21:00'], STAT: [] };
const who = () => nowHm();

/** Nursing station: ward census with NEWS2 early-warning scores, vitals charting, medication administration (MAR), shift notes. */
export default function Nursing() {
  const adm = useQueryDocs(() => scoped('admissions', where('status', '==', 'Admitted'), limit(300)), []);
  const [vitals, setVitals] = useSuite('vitals', 1500);
  const [meds, setMeds] = useSuite('medAdmin', 1500);
  const [notes, setNotes] = useSuite('nursingNotes', 800);
  const [tab, setTab] = useState('Ward board');
  const [sel, setSel] = useState(null);
  const [vForm, setVForm] = useState(null);
  const [mForm, setMForm] = useState(null);
  const [nForm, setNForm] = useState(null);
  const [allergies, setAllergies] = useState('');
  const today = todayYmd();
  const now = nowHm();

  const patients = adm.docs;
  const latest = useMemo(() => {
    const m = {};
    for (const v of vitals) if (!m[v.admissionId] || `${v.date} ${v.time}` > `${m[v.admissionId].date} ${m[v.admissionId].time}`) m[v.admissionId] = v;
    return m;
  }, [vitals]);
  const active = meds.filter((m) => m.status === 'Active');
  const dueNow = active.flatMap((m) => m.times.filter((t) => t <= now && !m.given?.[`${today} ${t}`] && m.startDate <= today && (!m.endDate || m.endDate >= today)).map((t) => ({ m, t })));
  const highRisk = patients.filter((p) => ['High', 'Medium'].includes(latest[p.id]?.risk));
  const overdueObs = patients.filter((p) => {
    const v = latest[p.id];
    if (!v) return true;
    const hrs = (Date.now() - new Date(`${v.date}T${v.time}`)) / 3_600_000;
    return hrs > ({ High: 1, Medium: 1, 'Low-Medium': 4, Low: v.news2 === 0 ? 12 : 6 }[v.risk] ?? 6);
  });

  useEffect(() => {
    setAllergies('');
    if (sel?.patientId && db) getDoc(doc(db, 'patients', sel.patientId)).then((s) => setAllergies(s.data()?.allergies ?? ''), () => {});
  }, [sel?.patientId]);

  const live = vForm ? news2(vForm) : null;
  const saveVitals = (e) => {
    e.preventDefault();
    const s = news2(vForm);
    setVitals((prev) => [fresh({ ...vForm, news2: s.score, risk: s.risk }), ...prev]);
    setVForm(null);
  };
  const mAlerts = mForm ? rxAlerts([mForm.drug, ...active.filter((m) => m.admissionId === mForm.admissionId).map((m) => m.drug)], allergies.split(/[,;]/)) : [];
  const saveMed = (e) => {
    e.preventDefault();
    if (mAlerts.length && !window.confirm(`Safety alerts:\n${mAlerts.map((a) => a.text).join('\n')}\n\nSave anyway (doctor confirmed)?`)) return;
    setMeds((prev) => [fresh({ ...mForm, times: mForm.freq === 'Custom' ? mForm.custom.split(',').map((s) => s.trim()).filter(Boolean) : FREQ[mForm.freq], status: 'Active', given: {} }), ...prev]);
    setMForm(null);
  };
  const give = (m, t, held) => setMeds((prev) => prev.map((x) => (x.id === m.id ? { ...x, given: { ...x.given, [`${today} ${t}`]: held ? `Held: ${held}` : `Given at ${who()}` } } : x)));

  const ctx = (p) => ({ patientId: p.patientId ?? null, patientName: p.patientName, admissionId: p.id, bedLabel: p.bedLabel });
  const pv = sel ? vitals.filter((v) => v.admissionId === sel.id).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)) : [];

  return (
    <Page title="Nursing Station" desc="Ward census with NEWS2 early-warning scores, vitals charting with trends, medication administration record with drug-safety checks, and shift notes.">
      <Stats items={[
        ['In-patients', patients.length],
        ['High / medium NEWS2', highRisk.length, highRisk.length ? 'danger' : undefined],
        ['Medicines due now', dueNow.length, dueNow.length ? 'warning' : undefined],
        ['Observations overdue', overdueObs.length, overdueObs.length ? 'warning' : undefined],
      ]} />
      <Alerts tone="danger" title="Deteriorating patients (NEWS2)" items={highRisk.map((p) => `${p.bedLabel} · ${p.patientName}: NEWS2 ${latest[p.id].news2} (${latest[p.id].risk}) at ${latest[p.id].time}. ${news2(latest[p.id]).action}`)} />
      <Tabs tabs={['Ward board', 'Medication round', 'Notes']} value={tab} onChange={setTab} />

      {tab === 'Ward board' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {patients.map((p) => {
            const v = latest[p.id];
            return (
              <div key={p.id} className="card" style={{ borderTop: `4px solid var(--${RISK_TONE[v?.risk] ?? 'secondary'})`, cursor: 'pointer' }} onClick={() => setSel(p)}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{p.bedLabel}</strong>{v && <span className={`badge badge-${RISK_TONE[v.risk]}`}>NEWS2 {v.news2}</span>}</div>
                <div>{p.patientName}</div>
                <small style={{ color: 'var(--text-muted)' }}>{p.diagnosis} · {p.doctor}</small>
                <div style={{ marginTop: 6, fontSize: 13 }}>{v ? `P ${v.hr ?? '—'} · BP ${v.sbp ?? '—'}/${v.dbp ?? '—'} · SpO₂ ${v.spo2 ?? '—'}% · T ${v.temp ?? '—'} · ${v.time}` : 'No observations yet'}</div>
                {overdueObs.includes(p) && <small style={{ color: 'var(--warning)' }}>Observations due</small>}
              </div>
            );
          })}
          {!patients.length && <div className="card">{adm.loading ? 'Loading…' : 'No admitted patients.'}</div>}
        </div>
      )}

      {tab === 'Medication round' && (
        <div className="card"><div className="table-container"><table className="table-list">
          <thead><tr><th>Bed / patient</th><th>Medicine</th><th>Route</th><th>Today</th></tr></thead>
          <tbody>
            {active.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.bedLabel}</strong><br /><small>{m.patientName}</small></td>
                <td>{m.drug} <small>{m.dose}</small></td><td>{m.route}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {m.times.map((t) => {
                    const g = m.given?.[`${today} ${t}`];
                    return g
                      ? <span key={t} className={`badge ${g.startsWith('Held') ? 'badge-warning' : 'badge-success'}`} title={g}>{t} ✓</span>
                      : <span key={t}><button className={`btn ${t <= now ? 'btn-primary' : 'btn-secondary'}`} onClick={() => give(m, t)}>{t} Give</button>
                        <button className="btn-icon" aria-label={`Hold ${m.drug} at ${t}`} onClick={() => { const r = prompt('Reason for holding this dose?'); if (r) give(m, t, r); }}>✕</button></span>;
                  })}
                </td>
              </tr>
            ))}
            {!active.length && <Empty cols={4} text="No active medication orders." />}
          </tbody>
        </table></div></div>
      )}

      {tab === 'Notes' && (
        <div className="card"><div className="table-container"><table className="table-list">
          <thead><tr><th>When</th><th>Bed / patient</th><th>Shift</th><th>Note</th></tr></thead>
          <tbody>{notes.map((n) => <tr key={n.id}><td>{n.date} {n.time}</td><td>{n.bedLabel} · {n.patientName}</td><td>{n.shift}</td><td style={{ whiteSpace: 'pre-wrap' }}>{n.note}</td></tr>)}
            {!notes.length && <Empty cols={4} />}</tbody>
        </table></div></div>
      )}

      {sel && !vForm && !mForm && !nForm && (
        <Modal wide title={`${sel.bedLabel} · ${sel.patientName}`} onClose={() => setSel(null)} footer={<>
          <button className="btn btn-primary" onClick={() => setVForm({ ...ctx(sel), date: today, time: nowHm(), avpu: 'A', o2: false })}><Activity size={14} /> Record vitals</button>
          <button className="btn btn-secondary" onClick={() => setMForm({ ...ctx(sel), drug: '', dose: '', route: 'Oral', freq: 'BD', custom: '', startDate: today, endDate: '' })}><Pill size={14} /> Add medication</button>
          <button className="btn btn-secondary" onClick={() => setNForm({ ...ctx(sel), shift: new Date().getHours() < 14 ? 'Morning' : new Date().getHours() < 20 ? 'Evening' : 'Night', note: '', date: today, time: nowHm() })}><NotebookPen size={14} /> Note</button>
        </>}>
          <p>{sel.diagnosis} · {sel.doctor} · admitted {sel.date}{allergies && <> · <b style={{ color: 'var(--danger)' }}>Allergies: {allergies}</b></>}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {[['news2', 'NEWS2', 0, 4], ['hr', 'Pulse', 51, 90], ['sbp', 'Systolic BP', 111, 140], ['spo2', 'SpO₂', 96, 100], ['temp', 'Temperature', 36.1, 38], ['rr', 'Resp. rate', 12, 20], ['glucose', 'Glucose', 70, 180]].map(([k, l, lo, hi]) => (
              <div key={k} className="card"><small>{l}</small><br /><Trend points={pv.filter((v) => v[k] !== '' && v[k] !== undefined).map((v) => ({ x: `${v.date} ${v.time}`, y: v[k] }))} low={lo} high={hi} /></div>
            ))}
          </div>
          <h4>Active medicines</h4>
          <ul>{active.filter((m) => m.admissionId === sel.id).map((m) => <li key={m.id}>{m.drug} {m.dose} · {m.route} · {m.times.join(', ')} <button className="btn btn-secondary" onClick={() => setMeds((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: 'Stopped', endDate: today } : x)))}>Stop</button></li>)}</ul>
        </Modal>
      )}

      {vForm && (
        <Modal wide title={`Vitals · ${vForm.bedLabel} · ${vForm.patientName}`} onClose={() => setVForm(null)} footer={<button className="btn btn-primary" type="submit" form="vitals-form">Save</button>}>
          <form id="vitals-form" onSubmit={saveVitals}><Fields fields={VITAL_FIELDS} value={vForm} onChange={setVForm} /></form>
          {live && <div className="card" style={{ borderLeft: `4px solid var(--${RISK_TONE[live.risk]})` }}>
            <strong>NEWS2 {live.score} · {live.risk} risk</strong><br />{live.action}
            {live.missing.length > 0 && <><br /><small>Not scored (missing): {live.missing.join(', ')}</small></>}
          </div>}
        </Modal>
      )}

      {mForm && (
        <Modal title={`Medication order · ${mForm.patientName}`} onClose={() => setMForm(null)} footer={<button className="btn btn-primary" type="submit" form="med-form">Save</button>}>
          <form id="med-form" onSubmit={saveMed}>
            <Fields value={mForm} onChange={setMForm} fields={[
              { k: 'drug', label: 'Medicine', required: true, full: true }, { k: 'dose', label: 'Dose' }, { k: 'route', label: 'Route', options: ROUTES },
              { k: 'freq', label: 'Frequency', options: [...Object.keys(FREQ), 'Custom'] }, ...(mForm.freq === 'Custom' ? [{ k: 'custom', label: 'Times (HH:mm, comma separated)' }] : []),
              { k: 'startDate', label: 'Start', type: 'date' }, { k: 'endDate', label: 'Stop on', type: 'date' },
            ]} />
          </form>
          {mAlerts.map((a, i) => <p key={i} style={{ color: 'var(--danger)' }}>⚠ {a.text}</p>)}
          <small style={{ color: 'var(--text-muted)' }}>Checks interactions with this patient's other active medicines and the allergies on the patient profile.</small>
        </Modal>
      )}

      {nForm && (
        <Modal title={`Nursing note · ${nForm.patientName}`} onClose={() => setNForm(null)} footer={<button className="btn btn-primary" onClick={() => { setNotes((prev) => [fresh(nForm), ...prev]); setNForm(null); }} disabled={!nForm.note.trim()}>Save</button>}>
          <Fields value={nForm} onChange={setNForm} fields={[{ k: 'shift', label: 'Shift', options: ['Morning', 'Evening', 'Night'] }, { k: 'note', label: 'Note (condition, care given, handover)', type: 'textarea' }]} />
        </Modal>
      )}
    </Page>
  );
}

