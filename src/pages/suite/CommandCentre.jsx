import React, { useEffect, useState } from 'react';
import { BedDouble, Siren, Scissors, FlaskConical, HeartPulse, Users, Wrench, IndianRupee, Droplet, UserCheck } from 'lucide-react';
import { limit, where } from 'firebase/firestore';
import { ESI } from '../../clinical';
import { collectionReport, scoped, todayYmd, useQueryDocs } from '../../hms';
import { inr } from '../hms/common';
import { Page } from './kit';

function Tile({ icon: Icon, title, value, sub, tone = 'primary', onClick, children }) {
  return (
    <div className="card" onClick={onClick} style={{ borderTop: `4px solid var(--${tone})`, cursor: onClick ? 'pointer' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}><Icon size={16} />{title}</div>
      <div style={{ fontSize: 30, fontWeight: 700, margin: '6px 0' }}>{value}</div>
      {sub && <small>{sub}</small>}
      {children}
    </div>
  );
}

/** Live command centre: beds, emergency, theatres, lab, deteriorating patients, OPD flow, blood stock, equipment and today's collections on one screen. */
export default function CommandCentre({ go }) {
  const today = todayYmd();
  const q = (name, ...c) => () => scoped(name, ...c);
  const beds = useQueryDocs(q('beds', limit(3000)), []);
  const er = useQueryDocs(q('erVisits', where('status', 'in', ['Waiting', 'In treatment', 'Observation']), limit(300)), []);
  const ot = useQueryDocs(q('surgeries', where('date', '==', today), limit(300)), []);
  const lab = useQueryDocs(q('labOrders', where('status', 'in', ['Ordered', 'Collected', 'Resulted']), limit(1000)), []);
  const crit = useQueryDocs(q('labOrders', where('date', '==', today), where('critical', '==', true), limit(100)), []);
  const vit = useQueryDocs(q('vitals', where('date', '==', today), limit(3000)), []);
  const opd = useQueryDocs(q('appointments', where('date', '==', today), limit(3000)), []);
  const blood = useQueryDocs(q('bloodUnits', where('status', '==', 'Available'), limit(2000)), []);
  const down = useQueryDocs(q('assets', where('status', '==', 'Under repair'), limit(200)), []);
  const att = useQueryDocs(q('attendance', where('date', '==', today), limit(5000)), []);
  const [money, setMoney] = useState(null);
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const load = () => collectionReport(today, today).then(setMoney, () => {});
    load();
    const t = setInterval(() => { setClock(new Date()); load(); }, 60_000);
    return () => clearInterval(t);
  }, []);

  const occ = beds.docs.filter((b) => b.status === 'Occupied').length;
  const pct = beds.docs.length ? Math.round((occ / beds.docs.length) * 100) : 0;
  const byWard = {};
  for (const b of beds.docs) { const w = (byWard[b.wardType ?? b.wardName] ??= { total: 0, occ: 0 }); w.total++; if (b.status === 'Occupied') w.occ++; }
  const latest = {};
  for (const v of vit.docs) if (!latest[v.admissionId] || v.time > latest[v.admissionId].time) latest[v.admissionId] = v;
  const deteriorating = Object.values(latest).filter((v) => v.news2 >= 5);
  const opdBy = (re) => opd.docs.filter((a) => re.test(a.status ?? '')).length;
  const collected = money ? money.byMode.reduce((s, m) => s + (m.amount ?? 0), 0) : null;
  const groups = blood.docs.reduce((m, b) => ({ ...m, [b.group]: (m[b.group] ?? 0) + 1 }), {});

  return (
    <Page title="Command Centre" desc={`Live view of the whole hospital · ${clock.toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        <Tile icon={BedDouble} title="Bed occupancy" value={`${pct}%`} sub={`${occ} of ${beds.docs.length} beds occupied`} tone={pct > 90 ? 'danger' : pct > 75 ? 'warning' : 'success'} onClick={() => go?.('hms-ipd')}>
          {Object.entries(byWard).map(([w, x]) => <div key={w} style={{ fontSize: 12 }}>{w}: {x.occ}/{x.total} <div style={{ height: 4, background: 'var(--primary)', width: `${(x.occ / x.total) * 100}%`, borderRadius: 2 }} /></div>)}
        </Tile>
        <Tile icon={Siren} title="Emergency now" value={er.docs.length} tone={er.docs.some((v) => v.esi <= 2) ? 'danger' : 'primary'} onClick={() => go?.('er')}
          sub={ESI.map((e) => `ESI ${e.level}: ${er.docs.filter((v) => v.esi === e.level).length}`).join(' · ')} />
        <Tile icon={HeartPulse} title="Deteriorating (NEWS2 ≥ 5)" value={deteriorating.length} tone={deteriorating.length ? 'danger' : 'success'} onClick={() => go?.('nursing')}
          sub={deteriorating.slice(0, 4).map((v) => `${v.bedLabel} ${v.patientName} (${v.news2})`).join(' · ') || 'All stable'} />
        <Tile icon={Scissors} title="Theatres today" value={`${ot.docs.filter((c) => c.status === 'In OT').length} in OT`} onClick={() => go?.('ot')}
          sub={`${ot.docs.filter((c) => c.status === 'Completed' || c.status === 'Recovery').length} done · ${ot.docs.filter((c) => ['Scheduled', 'Pre-op'].includes(c.status)).length} waiting · ${ot.docs.filter((c) => c.status === 'Cancelled').length} cancelled`} />
        <Tile icon={FlaskConical} title="Lab pending" value={lab.docs.length} tone={crit.docs.some((o) => !o.criticalInformed) ? 'danger' : 'primary'} onClick={() => go?.('lab')}
          sub={`${lab.docs.filter((o) => o.priority === 'STAT').length} STAT · ${crit.docs.length} critical result(s) today`} />
        <Tile icon={Users} title="OPD today" value={opd.docs.length} onClick={() => go?.('appointments')}
          sub={`${opdBy(/complete/i)} seen · ${opdBy(/check|wait|confirm|book/i)} waiting · ${opdBy(/cancel|no.?show/i)} cancelled / no-show`} />
        <Tile icon={IndianRupee} title="Collected today" value={collected === null ? '…' : inr(collected)} tone="success"
          sub={money?.byMode.map((m) => `${m.mode} ${inr(m.amount ?? 0)}`).join(' · ')} />
        <Tile icon={Droplet} title="Blood units available" value={blood.docs.length} tone={Object.keys(groups).length < 8 ? 'warning' : 'success'} onClick={() => go?.('bloodbank')}
          sub={Object.entries(groups).map(([g, n]) => `${g} ${n}`).join(' · ') || 'No stock recorded'} />
        <Tile icon={Wrench} title="Equipment down" value={down.docs.length} tone={down.docs.length ? 'warning' : 'success'} onClick={() => go?.('assets')}
          sub={down.docs.slice(0, 4).map((a) => a.name).join(', ') || 'All working'} />
        <Tile icon={UserCheck} title="Staff present" value={att.docs.filter((a) => a.status === 'P' || a.status === 'HD').length} onClick={() => go?.('hrms')}
          sub={`${att.docs.filter((a) => a.status === 'A').length} absent · ${att.docs.filter((a) => a.status === 'L').length} on leave`} />
      </div>
    </Page>
  );
}
