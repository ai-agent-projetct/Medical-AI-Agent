import React, { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { collection, getDocs, limit, orderBy, where } from 'firebase/firestore';
import { db, tenant } from '../../firebase';
import { scoped, todayYmd } from '../../hms';
import { Tabs, inr } from '../hms/common';
import { Empty, Page, Stats, Trend } from './kit';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const minus = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
const done = (a) => a.status === 'Completed';
const lost = (a) => /no.?show|missed/i.test(a.status ?? '');
const top = (list, n = 8) => Object.entries(list.reduce((m, k) => (k ? { ...m, [k]: (m[k] ?? 0) + 1 } : m), {})).sort((a, b) => b[1] - a[1]).slice(0, n);

/** Pure metrics for one doctor's appointments in a period (all = full history for new / returning). */
export function doctorMetrics(all, from) {
  const inP = all.filter((a) => a.date >= from);
  const key = (a) => a.patientId ?? a.patient;
  const first = {};
  for (const a of [...all].sort((x, y) => x.date.localeCompare(y.date))) first[key(a)] ??= a.date;
  const patients = new Set(inP.map(key));
  const newP = [...patients].filter((p) => first[p] >= from).length;
  const byDay = {};
  for (const a of inP) byDay[a.date] = (byDay[a.date] ?? 0) + 1;
  const visitsOf = {};
  for (const a of all) (visitsOf[key(a)] ??= []).push(a);
  const returning = Object.values(visitsOf).filter((v) => v.length >= 2).length;
  return {
    total: inP.length, completed: inP.filter(done).length, noShow: inP.filter(lost).length,
    cancelled: inP.filter((a) => a.status === 'Cancelled').length, online: inP.filter((a) => a.type === 'Online').length,
    revenue: inP.filter(done).reduce((s, a) => s + Number(a.fee || 0), 0), patients: patients.size, newPatients: newP,
    returningRate: Object.keys(visitsOf).length ? Math.round((returning / Object.keys(visitsOf).length) * 100) : 0,
    byDay, visitsOf,
  };
}

/** Doctor's practice insights: workload, outcomes, new vs returning patients, diagnoses, prescribing, ratings, and each patient's journey. */
export default function DoctorInsights({ doctors = [], openPatient }) {
  const mine = doctors.find((d) => d.id === tenant.uid);
  const [doctorId, setDoctorId] = useState(mine?.id ?? doctors[0]?.id ?? '');
  const [days, setDays] = useState(30);
  const [appts, setAppts] = useState(null);
  const [extra, setExtra] = useState({ admitted: [], surgeries: [], reviews: [] });
  const [tab, setTab] = useState('Overview');
  const [q, setQ] = useState('');
  const doctor = doctors.find((d) => d.id === doctorId);
  useEffect(() => { if (!doctorId && doctors.length) setDoctorId(mine?.id ?? doctors[0].id); }, [doctors.length]);

  useEffect(() => {
    if (!db || !doctorId) return;
    setAppts(null);
    // ponytail: full history capped at 5000 visits per doctor; add monthly rollups if a doctor exceeds that.
    getDocs(scoped('appointments', where('doctorId', '==', doctorId), where('date', '>=', '2000-01-01'), orderBy('date', 'desc'), limit(5000)))
      .then((s) => setAppts(s.docs.map((d) => ({ ...d.data(), id: d.id }))), () => setAppts([]));
    const name = doctor?.name ?? '';
    Promise.all([
      getDocs(scoped('admissions', where('doctor', '==', name), where('status', '==', 'Admitted'), limit(100))).then((s) => s.docs.map((d) => d.data()), () => []),
      getDocs(scoped('surgeries', where('surgeon', '==', name), limit(500))).then((s) => s.docs.map((d) => d.data()), () => []),
      getDocs(collection(db, 'doctors', doctorId, 'reviews')).then((s) => s.docs.map((d) => d.data()), () => []),
    ]).then(([admitted, surgeries, reviews]) => setExtra({ admitted, surgeries, reviews }));
  }, [doctorId]);

  const from = minus(days);
  const m = useMemo(() => (appts ? doctorMetrics(appts, from) : null), [appts, from]);
  const inP = appts?.filter((a) => a.date >= from) ?? [];
  const heat = useMemo(() => {
    const h = {};
    for (const a of inP) {
      const d = DAYS[new Date(`${a.date}T00:00:00`).getDay()];
      const hr = /(\d+):\d+\s*(AM|PM)?/i.exec(a.time ?? '');
      const hour = !hr ? null : hr[2] ? (Number(hr[1]) % 12) + (/PM/i.test(hr[2]) ? 12 : 0) : Number(hr[1]);
      if (hour !== null) h[`${d}-${hour}`] = (h[`${d}-${hour}`] ?? 0) + 1;
    }
    return h;
  }, [inP]);
  const rating = extra.reviews.length ? (extra.reviews.reduce((s, r) => s + r.rating, 0) / extra.reviews.length).toFixed(1) : null;
  const series = [];
  for (let i = Math.min(days, 90); i >= 0; i--) { const d = minus(i); series.push({ x: d, y: m?.byDay[d] ?? 0 }); }

  const patientRows = m ? Object.entries(m.visitsOf).map(([k, v]) => {
    const s = [...v].sort((a, b) => b.date.localeCompare(a.date));
    return { key: k, id: s[0].patientId, name: s[0].patient, phone: s[0].phone, visits: v.length, first: s.at(-1).date, last: s[0].date,
      dx: s.find((a) => a.summary?.diagnosis)?.summary.diagnosis ?? '', dxs: [...new Set(s.map((a) => a.summary?.diagnosis).filter(Boolean))],
      next: s.find((a) => a.date >= todayYmd() && !done(a) && a.status !== 'Cancelled')?.date };
  }).filter((p) => !q || `${p.name} ${p.dx}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.last.localeCompare(a.last)) : [];

  return (
    <Page title="Doctor Insights" desc="Your practice at a glance: consultations, outcomes, new and returning patients, busiest hours, diagnoses, prescribing, ratings, and every patient's journey with you."
      actions={<>
        <select className="form-input" aria-label="Doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.department}</option>)}
        </select>
        <select className="form-input" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </>}>
      {!m ? <div className="card">{doctorId ? 'Loading…' : 'No doctors in this hospital yet.'}</div> : <>
        <Stats items={[
          ['Consultations', m.total], ['Unique patients', `${m.patients} (${m.newPatients} new)`],
          ['Completed / no-show', `${m.completed} / ${m.noShow}`, m.total && m.noShow / m.total > 0.15 ? 'warning' : undefined],
          ['Consultation revenue', inr(m.revenue)],
        ]} />
        <Stats items={[
          ['Returning patients', `${m.returningRate}%`], ['Online consults', m.online],
          ['In-patients now', extra.admitted.length], ['Rating', rating ? <span key="r"><Star size={14} /> {rating} ({extra.reviews.length})</span> : '—'],
        ]} />
        <Tabs tabs={['Overview', 'My patients', 'Diagnoses & prescribing']} value={tab} onChange={setTab} />

        {tab === 'Overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <div className="card"><b>Consultations per day</b><br /><Trend points={series} width={420} height={110} /></div>
            <div className="card"><b>Busiest times</b>
              <table style={{ fontSize: 11, borderCollapse: 'collapse', marginTop: 6 }}><tbody>
                {DAYS.map((d) => <tr key={d}><td style={{ paddingRight: 6 }}>{d}</td>{Array.from({ length: 13 }, (_, i) => i + 8).map((h) => {
                  const n = heat[`${d}-${h}`] ?? 0; const max = Math.max(1, ...Object.values(heat));
                  return <td key={h} title={`${d} ${h}:00 · ${n}`} style={{ width: 18, height: 16, background: n ? `rgba(37,99,235,${0.15 + (0.85 * n) / max})` : 'var(--bg-secondary, #f3f4f6)' }} />;
                })}</tr>)}
                <tr><td />{Array.from({ length: 13 }, (_, i) => <td key={i} style={{ textAlign: 'center' }}>{(i + 8) % 12 || 12}</td>)}</tr>
              </tbody></table>
            </div>
            <div className="card"><b>Outcomes</b>
              {[['Completed', m.completed, 'success'], ['No-show', m.noShow, 'danger'], ['Cancelled', m.cancelled, 'warning'], ['Other / upcoming', m.total - m.completed - m.noShow - m.cancelled, 'secondary']].map(([l, n, t]) => (
                <div key={l} style={{ margin: '6px 0' }}><small>{l} · {n}</small><div style={{ height: 8, borderRadius: 4, background: `var(--${t})`, width: `${m.total ? (n / m.total) * 100 : 0}%`, minWidth: n ? 4 : 0 }} /></div>
              ))}
              <p style={{ marginTop: 12 }}><small>Surgeries performed (all time): <b>{extra.surgeries.filter((s) => s.status === 'Completed' || s.status === 'Recovery').length}</b></small></p>
            </div>
          </div>
        )}

        {tab === 'My patients' && (
          <div className="card">
            <input className="form-input" placeholder="Search patient or diagnosis" aria-label="Search patients" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
            <div className="table-container"><table className="table-list">
              <thead><tr><th>Patient</th><th>Visits</th><th>Under care since</th><th>Last visit</th><th>Diagnoses</th><th>Next visit</th><th /></tr></thead>
              <tbody>{patientRows.slice(0, 300).map((p) => (
                <tr key={p.key}>
                  <td><strong>{p.name}</strong><br /><small>{p.phone}</small></td><td>{p.visits}</td><td>{p.first}</td><td>{p.last}</td>
                  <td><small>{p.dxs.join(' → ') || '—'}</small></td><td>{p.next ?? <small style={{ color: 'var(--text-muted)' }}>none booked</small>}</td>
                  <td>{p.id && openPatient && <button className="btn btn-secondary" onClick={() => openPatient({ id: p.id, name: p.name, phone: p.phone })}>Patient 360</button>}</td>
                </tr>
              ))}{!patientRows.length && <Empty cols={7} />}</tbody>
            </table></div>
          </div>
        )}

        {tab === 'Diagnoses & prescribing' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {[['Top diagnoses', top(inP.map((a) => a.summary?.diagnosis?.trim()))],
              ['Most prescribed', top(inP.flatMap((a) => (a.summary?.medications ?? []).map((x) => x.name?.trim())))],
              ['Departments / visit types', top(inP.map((a) => a.type))]].map(([title, rows]) => (
              <div className="card" key={title}><b>{title}</b>
                {rows.map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>{k}</span><b>{n}</b></div>)}
                {!rows.length && <p style={{ color: 'var(--text-muted)' }}>Nothing recorded in this period.</p>}
              </div>
            ))}
          </div>
        )}
      </>}
    </Page>
  );
}
