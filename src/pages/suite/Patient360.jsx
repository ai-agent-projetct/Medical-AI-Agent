import React, { useEffect, useMemo, useState } from 'react';
import { Printer, Calendar, FlaskConical, HeartPulse, BedDouble, Receipt, Scissors, Siren, FileText, Syringe } from 'lucide-react';
import { doc, getDoc, getDocs, limit, where } from 'firebase/firestore';
import { db, watchRecords } from '../../firebase';
import { ageOf, rxAlerts } from '../../clinical';
import { scoped } from '../../hms';
import { PatientPicker, Tabs, inr } from '../hms/common';
import { Alerts, Empty, Page, Stats, Trend, badgeFor, esc, printPage } from './kit';
import { reportHtml } from './Lab';

const SOURCES = {
  appointments: { icon: Calendar, label: 'Visit' }, labOrders: { icon: FlaskConical, label: 'Lab' }, vitals: { icon: HeartPulse, label: 'Vitals' },
  admissions: { icon: BedDouble, label: 'Admission' }, invoices: { icon: Receipt, label: 'Bill' }, surgeries: { icon: Scissors, label: 'Surgery' },
  erVisits: { icon: Siren, label: 'Emergency' }, radiologyOrders: { icon: FileText, label: 'Imaging' }, vaccinations: { icon: Syringe, label: 'Vaccine' },
};
const when = (r) => r.date ?? (r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-CA') : '');

/** Findings worth a doctor's attention, from the patient's own history (rules, not a diagnosis). */
export function insights({ labs, vitals, appts, invoices }) {
  const out = [];
  const series = {};
  for (const o of [...labs].filter((o) => o.status === 'Verified').sort((a, b) => a.date.localeCompare(b.date))) {
    for (const t of o.tests) if (!t.qualitative && t.value !== '' && !Number.isNaN(Number(t.value))) (series[t.code] ??= { t, pts: [] }).pts.push({ x: o.date, y: Number(t.value) });
  }
  for (const { t, pts } of Object.values(series)) {
    if (pts.length < 2) continue;
    const a = pts.at(-2).y; const b = pts.at(-1).y;
    const ch = a ? Math.round(((b - a) / a) * 100) : 0;
    if (Math.abs(ch) >= 25) out.push(`${t.name} ${ch > 0 ? 'rose' : 'fell'} ${Math.abs(ch)}% (${a} → ${b} ${t.unit}) between ${pts.at(-2).x} and ${pts.at(-1).x}.`);
    else if (t.high !== undefined && b > t.high && pts.slice(-3).every((p, i, arr) => i === 0 || p.y >= arr[i - 1].y)) out.push(`${t.name} above range and rising (${pts.slice(-3).map((p) => p.y).join(' → ')}).`);
  }
  const lastV = [...vitals].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
  if (lastV?.news2 >= 5) out.push(`Last NEWS2 ${lastV.news2} (${lastV.risk}) on ${lastV.date} ${lastV.time}.`);
  const bp = vitals.filter((v) => Number(v.sbp) >= 140).length;
  if (bp >= 3) out.push(`${bp} readings with systolic BP ≥ 140: review for hypertension.`);
  const noShow = appts.filter((a) => /no.?show|missed/i.test(a.status)).length;
  if (noShow >= 2) out.push(`${noShow} missed appointments: consider a reminder call.`);
  const due = invoices.filter((i) => i.status !== 'Cancelled').reduce((s, i) => s + Number(i.due || 0), 0);
  if (due > 0) out.push(`Outstanding bills ${inr(due)}.`);
  return { out, series };
}

/** One screen per patient: profile, allergies, every visit, admission, lab, imaging, surgery, bill and vital in one timeline, with trends and insights. */
export default function Patient360({ initial }) {
  const [patient, setPatient] = useState(initial ?? null);
  const [profile, setProfile] = useState({});
  const [data, setData] = useState(null);
  const [records, setRecords] = useState([]);
  const [tab, setTab] = useState('Timeline');

  useEffect(() => {
    setData(null); setProfile({}); setRecords([]);
    if (!patient?.id || !db) return undefined;
    let live = true;
    getDoc(doc(db, 'patients', patient.id)).then((s) => live && setProfile(s.data() ?? {}), () => {});
    Promise.all(Object.keys(SOURCES).map((c) => getDocs(scoped(c, where('patientId', '==', patient.id), limit(300)))
      .then((s) => [c, s.docs.map((d) => ({ ...d.data(), id: d.id, _src: c }))], () => [c, []])))
      .then((pairs) => live && setData(Object.fromEntries(pairs)));
    const stop = watchRecords(patient.id, setRecords);
    return () => { live = false; stop?.(); };
  }, [patient?.id]);

  const view = useMemo(() => {
    if (!data) return null;
    const timeline = [...Object.values(data).flat(), ...records.map((r) => ({ ...r, _src: 'records' }))]
      .filter((r) => r._src !== 'vitals' || r.news2 >= 5)
      .sort((a, b) => `${when(b)} ${b.time ?? ''}`.localeCompare(`${when(a)} ${a.time ?? ''}`));
    const meds = [...new Set([
      ...data.appointments.flatMap((a) => (a.summary?.medications ?? []).map((m) => m.name)).filter(Boolean),
    ])];
    const { out, series } = insights({ labs: data.labOrders, vitals: data.vitals, appts: data.appointments, invoices: data.invoices });
    const billed = data.invoices.filter((i) => i.status !== 'Cancelled');
    return { timeline, meds, insights: out, series, billed };
  }, [data, records]);

  const allergies = String(profile.allergies ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const alerts = view ? rxAlerts(view.meds, allergies) : [];
  const line = (r) => {
    switch (r._src) {
      case 'appointments': return `${r.doctor ?? ''} · ${r.department ?? ''} · ${r.type ?? ''}${r.summary?.diagnosis ? ` · Dx: ${r.summary.diagnosis}` : ''}`;
      case 'labOrders': return `${r.orderNo}: ${r.tests.map((t) => `${t.name}${t.value !== '' ? ` ${t.value}${t.flag ? ` (${t.flag})` : ''}` : ''}`).join(', ')}`;
      case 'vitals': return `NEWS2 ${r.news2} (${r.risk}) · P ${r.hr} BP ${r.sbp}/${r.dbp} SpO₂ ${r.spo2}`;
      case 'admissions': return `${r.wardName ?? ''} ${r.bedLabel} · ${r.doctor} · ${r.diagnosis ?? ''}`;
      case 'invoices': return `${r.number} · ${inr(r.total)} · paid ${inr(r.paid)}${r.due > 0 ? ` · due ${inr(r.due)}` : ''}`;
      case 'surgeries': return `${r.procedure} · ${r.surgeon} · ${r.room}`;
      case 'erVisits': return `${r.complaint} · ESI ${r.esi}${r.disposition ? ` → ${r.disposition}` : ''}`;
      case 'radiologyOrders': return `${r.modality ?? ''} ${r.study ?? ''}${r.impression ? ` · ${r.impression}` : ''}`;
      case 'vaccinations': return `${r.vaccine ?? ''} dose ${r.dose ?? ''}`;
      default: return `${r.title ?? r.type ?? 'Record'}${r.notes ? ` · ${r.notes}` : ''}`;
    }
  };

  const printSummary = () => printPage(`Patient health summary · ${patient.name}`, `
    <p><b>${esc(patient.name)}</b> · ${esc(profile.gender ?? '')} ${esc(ageOf(profile.dob) ? `${ageOf(profile.dob)} y` : '')} · ${esc(patient.phone ?? '')}<br>
    Blood group ${esc(profile.bloodGroup ?? '—')} · Allergies: <b>${esc(profile.allergies || 'None recorded')}</b></p>
    <h2>Current / recent medicines</h2><p>${esc(view.meds.join(', ') || '—')}</p>
    ${view.insights.length ? `<h2>Points to note</h2><ul>${view.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    <h2>History</h2><table>${view.timeline.slice(0, 60).map((r) => `<tr><td style="width:90px">${esc(when(r))}</td><td style="width:90px">${esc(SOURCES[r._src]?.label ?? 'Record')}</td><td>${esc(line(r))}</td></tr>`).join('')}</table>
    ${data.labOrders.filter((o) => o.status === 'Verified').slice(0, 3).map(reportHtml).join('')}`);

  return (
    <Page title="Patient 360" desc="Everything about one patient in one place: profile and allergies, visits, admissions, labs, imaging, surgeries, emergency visits, bills and vitals, with trends and points to note."
      actions={view && <button className="btn btn-secondary" onClick={printSummary}><Printer size={16} /> Print health summary</button>}>
      <div className="card" style={{ marginBottom: 16 }}><PatientPicker value={patient} onChange={setPatient} /></div>
      {patient && !view && <div className="card">Loading history…</div>}
      {view && <>
        <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div><h3 style={{ margin: 0 }}>{patient.name}</h3><small>{profile.gender} {ageOf(profile.dob) !== '' && `· ${ageOf(profile.dob)} y`} · {patient.phone} {profile.bloodGroup && `· ${profile.bloodGroup}`}</small></div>
          <div><small>Allergies</small><br /><b style={{ color: allergies.length ? 'var(--danger)' : undefined }}>{allergies.join(', ') || 'None recorded'}</b></div>
          {profile.conditions && <div><small>Conditions</small><br /><b>{profile.conditions}</b></div>}
          {profile.emergencyContactName && <div><small>Emergency contact</small><br />{profile.emergencyContactName} {profile.emergencyContactPhone}</div>}
        </div>
        <Stats items={[
          ['Visits', data.appointments.length], ['Admissions', data.admissions.length],
          ['Total billed', inr(view.billed.reduce((s, i) => s + Number(i.total || 0), 0))],
          ['Outstanding', inr(view.billed.reduce((s, i) => s + Number(i.due || 0), 0)), view.billed.some((i) => i.due > 0) ? 'warning' : undefined],
        ]} />
        <Alerts tone="danger" title="Medicine safety" items={alerts.map((a) => a.text)} />
        <Alerts title="Points to note" items={view.insights} />
        <Tabs tabs={['Timeline', 'Trends', 'Medicines', 'Bills', 'Documents']} value={tab} onChange={setTab} />

        {tab === 'Timeline' && (
          <div className="card">
            {view.timeline.map((r) => {
              const S = SOURCES[r._src]; const Icon = S?.icon ?? FileText;
              return (
                <div key={`${r._src}${r.id}`} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-color, #eee)' }}>
                  <Icon size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ width: 92, flexShrink: 0 }}><b>{when(r)}</b><br /><small>{S?.label ?? 'Record'}</small></div>
                  <div style={{ flex: 1 }}>{line(r)}</div>
                  {r.status && <span className={`badge ${badgeFor(r.status)}`} style={{ alignSelf: 'flex-start' }}>{r.status}</span>}
                </div>
              );
            })}
            {!view.timeline.length && <p style={{ color: 'var(--text-muted)' }}>No history in this hospital yet.</p>}
          </div>
        )}

        {tab === 'Trends' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {Object.values(view.series).map(({ t, pts }) => (
              <div className="card" key={t.code}><b>{t.name}</b> <small>{t.unit} · ref {t.low}–{t.high}</small><br /><Trend points={pts} low={t.low} high={t.high} width={280} /></div>
            ))}
            {[['sbp', 'Systolic BP', 90, 140], ['hr', 'Pulse', 51, 90], ['spo2', 'SpO₂', 95, 100], ['glucose', 'Glucose', 70, 180]].map(([k, l, lo, hi]) => {
              const pts = data.vitals.filter((v) => v[k] !== '' && v[k] !== undefined).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).map((v) => ({ x: `${v.date} ${v.time}`, y: v[k] }));
              return pts.length > 0 && <div className="card" key={k}><b>{l}</b><br /><Trend points={pts} low={lo} high={hi} width={280} /></div>;
            })}
            {!Object.keys(view.series).length && !data.vitals.length && <div className="card">No results recorded yet.</div>}
          </div>
        )}

        {tab === 'Medicines' && (
          <div className="card"><div className="table-container"><table className="table-list">
            <thead><tr><th>Date</th><th>Doctor</th><th>Diagnosis</th><th>Prescribed</th></tr></thead>
            <tbody>{data.appointments.filter((a) => a.summary?.medications?.length).sort((a, b) => b.date.localeCompare(a.date)).map((a) => (
              <tr key={a.id}><td>{a.date}</td><td>{a.doctor}</td><td>{a.summary.diagnosis}</td>
                <td>{a.summary.medications.map((m, i) => <div key={i}>{m.name} <small>{[m.dose, m.frequency, m.duration].filter(Boolean).join(' · ')}</small></div>)}</td></tr>
            ))}{!view.meds.length && <Empty cols={4} text="No prescriptions recorded." />}</tbody>
          </table></div></div>
        )}

        {tab === 'Bills' && (
          <div className="card"><div className="table-container"><table className="table-list">
            <thead><tr><th>Date</th><th>Invoice</th><th>Kind</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{data.invoices.sort((a, b) => b.date.localeCompare(a.date)).map((i) => (
              <tr key={i.id}><td>{i.date}</td><td>{i.number}</td><td>{i.kind}</td><td>{inr(i.total)}</td><td>{inr(i.paid)}</td><td>{inr(i.due)}</td><td><span className={`badge ${badgeFor(i.status)}`}>{i.status}</span></td></tr>
            ))}{!data.invoices.length && <Empty cols={7} />}</tbody>
          </table></div></div>
        )}

        {tab === 'Documents' && (
          <div className="card"><div className="table-container"><table className="table-list">
            <thead><tr><th>Date</th><th>Record</th><th>Notes</th><th>File</th></tr></thead>
            <tbody>{records.map((r) => <tr key={r.id}><td>{when(r)}</td><td>{r.title ?? r.type}</td><td>{r.notes ?? r.description}</td><td>{r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noreferrer">{r.fileName ?? 'Open'}</a>}</td></tr>)}
              {!records.length && <Empty cols={4} />}</tbody>
          </table></div></div>
        )}
      </>}
    </Page>
  );
}
