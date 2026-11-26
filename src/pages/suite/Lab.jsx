import React, { useMemo, useState } from 'react';
import { Plus, FlaskConical, Printer, MessageCircle, CheckCircle2, Receipt } from 'lucide-react';
import { getDocs, limit, query, where } from 'firebase/firestore';
import { LAB_PANELS, LAB_TESTS, labFlag } from '../../clinical';
import { addCharge, col, createInvoice, todayYmd } from '../../hms';
import { tenant } from '../../firebase';
import { Modal, PatientPicker, Tabs, inr } from '../hms/common';
import { Alerts, Empty, Page, Stats, badgeFor, esc, fresh, nowHm, printPage, useSuite } from './kit';

// labOrders/{id} {orderNo, sampleId, patientId, patientName, phone, age, gender, doctor, priority, date,
//   tests: [{code, name, unit, low, high, critLow, critHigh, qualitative, rate, value, flag, note}],
//   status: Ordered → Collected → Resulted → Verified (| Cancelled), orderedAt, collectedAt, resultedAt,
//   verifiedAt, verifiedBy, critical (bool), billed (invoice / admission id)}
const STAGES = ['Ordered', 'Collected', 'Resulted', 'Verified'];
const FLAG_TEXT = { L: 'Low', H: 'High', LL: 'CRITICAL LOW', HH: 'CRITICAL HIGH' };
const stamp = () => `${todayYmd()} ${nowHm()}`;
const mins = (a, b) => (a && b ? Math.round((new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 60000) : null);
const range = (t) => (t.qualitative ? '' : `${t.low ?? ''}–${t.high ?? ''} ${t.unit}`);

export function reportHtml(o) {
  return `<p>Patient: <b>${esc(o.patientName)}</b> ${esc(o.age ? `${o.age} y` : '')} ${esc(o.gender ?? '')} · ${esc(o.phone)}<br>
    Order ${esc(o.orderNo)} · Sample ${esc(o.sampleId)} · Ref. doctor ${esc(o.doctor)}<br>
    Collected ${esc(o.collectedAt ?? '')} · Reported ${esc(o.verifiedAt ?? o.resultedAt ?? '')}</p>
    <table><thead><tr><th>Test</th><th>Result</th><th>Flag</th><th>Reference range</th></tr></thead><tbody>
    ${o.tests.map((t) => `<tr><td>${esc(t.name)}</td><td class="${t.flag ? 'hi' : ''}">${esc(t.value)} ${esc(t.qualitative ? '' : t.unit)}</td>
      <td class="${t.flag ? 'hi' : ''}">${esc(FLAG_TEXT[t.flag] ?? '')}</td><td>${esc(range(t))}</td></tr>${t.note ? `<tr><td colspan="4"><small>${esc(t.note)}</small></td></tr>` : ''}`).join('')}
    </tbody></table><div class="sign">Verified by ${esc(o.verifiedBy ?? '')}<br>Pathologist / Lab in-charge</div>`;
}

/** Laboratory (LIS): orders and panels, sample collection, result entry with auto flags, delta check, verification, reports, billing. */
export default function Lab({ doctors = [] }) {
  const [orders, setOrders] = useSuite('labOrders', 800);
  const [tab, setTab] = useState('Ordered');
  const [form, setForm] = useState(null);
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const today = todayYmd();

  const todays = orders.filter((o) => o.date === today && o.status !== 'Cancelled');
  const tats = todays.map((o) => mins(o.orderedAt, o.verifiedAt)).filter((m) => m !== null);
  const critical = orders.filter((o) => o.critical && o.status !== 'Cancelled' && !o.criticalInformed);
  const shown = tab === 'All' ? orders : orders.filter((o) => o.status === tab);

  // Last verified value of each test for this patient (delta check).
  const previous = useMemo(() => {
    if (!entry?.patientId) return {};
    const out = {};
    for (const o of orders) {
      if (o.id === entry.id || o.patientId !== entry.patientId || o.status !== 'Verified') continue;
      for (const t of o.tests) if (t.value !== '' && !out[t.code]) out[t.code] = { value: t.value, date: o.date };
    }
    return out;
  }, [entry, orders]);

  const update = (o, data) => setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...data } : x)));

  const create = () => {
    if (!form.patient) return setError('Choose a patient');
    if (!form.codes.length) return setError('Pick at least one test');
    const seq = String(orders.filter((o) => o.date === today).length + 1).padStart(3, '0');
    const stampNo = today.replace(/-/g, '').slice(2);
    setOrders((prev) => [fresh({
      orderNo: `LAB-${stampNo}-${seq}`, sampleId: `S${stampNo}${seq}`,
      patientId: form.patient.id ?? null, patientName: form.patient.name, phone: form.patient.phone ?? '',
      age: form.age, gender: form.patient.gender ?? '', doctor: form.doctor, priority: form.priority, date: today,
      tests: form.codes.map((c) => ({ ...LAB_TESTS.find((t) => t.code === c), value: '', flag: '', note: '' })),
      status: 'Ordered', orderedAt: stamp(), critical: false,
    }), ...prev]);
    setForm(null); setError('');
  };

  const saveResults = (verify) => {
    const tests = entry.tests.map((t) => ({ ...t, flag: labFlag(t.value, t) }));
    if (tests.some((t) => t.value === '')) return setError('Enter every result (write "Not done" if a test was not performed)');
    const isCritical = tests.some((t) => t.flag === 'LL' || t.flag === 'HH');
    update(entry, {
      tests, critical: isCritical, status: verify ? 'Verified' : 'Resulted',
      resultedAt: entry.resultedAt ?? stamp(), ...(verify ? { verifiedAt: stamp(), verifiedBy: tenant.profile?.name ?? tenant.profile?.email ?? '' } : {}),
    });
    setEntry(null); setError('');
  };

  const bill = async (o) => {
    setError('');
    try {
      const lines = o.tests.map((t) => ({ name: `Lab: ${t.name}`, category: 'Laboratory', sac: '999316', qty: 1, rate: t.rate, gstRate: 0, discountPct: 0 }));
      const adm = o.patientId ? (await getDocs(query(col('admissions'), where('hospitalId', '==', tenant.hospitalId), where('patientId', '==', o.patientId), where('status', '==', 'Admitted'), limit(1)))).docs[0] : null;
      if (adm) {
        for (const l of lines) await addCharge(adm.id, l);
        update(o, { billed: `IPD ${adm.data().bedLabel}` });
      } else {
        const inv = await createInvoice({ kind: 'OPD', desk: 'LAB', patient: { id: o.patientId, name: o.patientName, phone: o.phone }, lines });
        update(o, { billed: inv?.number ?? 'OPD invoice' });
      }
    } catch (e) { setError(`Billing: ${e.message}`); }
  };

  const whatsapp = (o) => {
    const digits = String(o.phone ?? '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return setError('No valid mobile number on this order');
    const lines = o.tests.map((t) => `${t.name}: ${t.value} ${t.qualitative ? '' : t.unit}${t.flag ? ` (${FLAG_TEXT[t.flag]})` : ''}`).join('\n');
    window.open(`https://wa.me/91${digits}?text=${encodeURIComponent(`${tenant.hospital?.name ?? ''} lab report ${o.orderNo}\n${o.patientName}\n\n${lines}\n\nPlease consult your doctor.`)}`, '_blank', 'noopener');
  };

  const label = (o) => printPage(`Sample label ${o.sampleId}`, `<div style="border:2px dashed #000;padding:12px;width:320px">
    <div style="font:700 28px monospace;letter-spacing:4px">${esc(o.sampleId)}</div>${esc(o.patientName)} · ${esc(o.age ? `${o.age} y` : '')} ${esc(o.gender ?? '')}<br>
    ${esc(o.tests.map((t) => t.code).join(', '))}<br>${esc(o.priority)} · ${esc(o.collectedAt ?? stamp())}</div>`);

  return (
    <Page title="Laboratory (LIS)" desc="Test orders, sample collection with labels, result entry with automatic high / low / critical flags, delta check against the last result, verification, reports and billing."
      actions={<button className="btn btn-primary" onClick={() => setForm({ patient: null, age: '', doctor: doctors[0]?.name ?? '', priority: 'Routine', codes: [] })}><Plus size={16} /> New lab order</button>}>
      <Stats items={[
        ['Orders today', todays.length],
        ['Pending (all)', orders.filter((o) => ['Ordered', 'Collected', 'Resulted'].includes(o.status)).length, 'warning'],
        ['Critical to inform', critical.length, critical.length ? 'danger' : undefined],
        ['Avg TAT today', tats.length ? `${Math.round(tats.reduce((s, m) => s + m, 0) / tats.length)} min` : '—'],
      ]} />
      <Alerts tone="danger" title="Critical results: inform the doctor and record it" items={critical.map((o) => (
        <span key={o.id}>{o.patientName} · {o.orderNo}: {o.tests.filter((t) => t.flag === 'LL' || t.flag === 'HH').map((t) => `${t.name} ${t.value} ${t.unit}`).join(', ')}{' '}
          <button className="btn btn-secondary" onClick={() => update(o, { criticalInformed: stamp(), criticalInformedBy: tenant.profile?.name ?? '' })}>Mark doctor informed</button></span>
      ))} />
      {error && <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>{error}</div>}
      <Tabs tabs={[...STAGES, 'All']} value={tab} onChange={setTab} />
      <div className="card">
        <div className="table-container">
          <table className="table-list">
            <thead><tr><th>Order / sample</th><th>Patient</th><th>Tests</th><th>Priority</th><th>Doctor</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.orderNo}</strong><br /><small>{o.sampleId} · {o.orderedAt}</small></td>
                  <td>{o.patientName}<br /><small>{o.phone}</small></td>
                  <td><small>{o.tests.map((t) => <span key={t.code} style={{ color: t.flag ? 'var(--danger)' : undefined, marginRight: 6 }}>{t.code}{t.flag && `(${t.flag})`}</span>)}</small></td>
                  <td><span className={`badge ${o.priority === 'STAT' ? 'badge-danger' : o.priority === 'Urgent' ? 'badge-warning' : 'badge-secondary'}`}>{o.priority}</span></td>
                  <td>{o.doctor}</td>
                  <td><span className={`badge ${badgeFor(o.status)}`}>{o.status}</span>{o.critical && <span className="badge badge-danger" style={{ marginLeft: 4 }}>Critical</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {o.status === 'Ordered' && <><button className="btn btn-primary" onClick={() => { update(o, { status: 'Collected', collectedAt: stamp() }); label({ ...o, collectedAt: stamp() }); }}><FlaskConical size={14} /> Collect</button>{' '}
                      <button className="btn btn-secondary" onClick={() => window.confirm('Cancel this order?') && update(o, { status: 'Cancelled' })}>Cancel</button></>}
                    {(o.status === 'Collected' || o.status === 'Resulted') && <button className="btn btn-primary" onClick={() => setEntry(o)}><CheckCircle2 size={14} /> {o.status === 'Collected' ? 'Enter results' : 'Review & verify'}</button>}
                    {o.status === 'Verified' && <>
                      <button className="btn-icon" aria-label="Print report" onClick={() => printPage(`Laboratory report ${o.orderNo}`, reportHtml(o))}><Printer size={14} /></button>
                      <button className="btn-icon" aria-label="Send on WhatsApp" onClick={() => whatsapp(o)}><MessageCircle size={14} /></button></>}
                    {o.status !== 'Cancelled' && !o.billed && <button className="btn btn-secondary" onClick={() => bill(o)}><Receipt size={14} /> Bill {inr(o.tests.reduce((s, t) => s + Number(t.rate || 0), 0))}</button>}
                    {o.billed && <small style={{ color: 'var(--text-muted)' }}> Billed: {o.billed}</small>}
                  </td>
                </tr>
              ))}
              {!shown.length && <Empty cols={7} text={`No ${tab.toLowerCase()} orders.`} />}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <Modal wide title="New lab order" onClose={() => setForm(null)} footer={<button className="btn btn-primary" onClick={create}>Create order · {inr(form.codes.reduce((s, c) => s + (LAB_TESTS.find((t) => t.code === c)?.rate ?? 0), 0))}</button>}>
          <div className="form-group"><label>Patient</label><PatientPicker allowWalkIn value={form.patient} onChange={(p) => setForm({ ...form, patient: p })} /></div>
          <div className="form-input-row">
            <div className="form-group"><label>Age</label><input className="form-input" aria-label="Age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /></div>
            <div className="form-group"><label>Referring doctor</label>
              <input className="form-input" aria-label="Referring doctor" list="lab-doctors" value={form.doctor} onChange={(e) => setForm({ ...form, doctor: e.target.value })} />
              <datalist id="lab-doctors">{doctors.map((d) => <option key={d.id} value={d.name} />)}</datalist></div>
            <div className="form-group"><label>Priority</label><select className="form-input" aria-label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{['Routine', 'Urgent', 'STAT'].map((p) => <option key={p}>{p}</option>)}</select></div>
          </div>
          <label>Panels</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 12px' }}>
            {Object.entries(LAB_PANELS).map(([p, codes]) => (
              <button key={p} type="button" className="btn btn-secondary" onClick={() => setForm((f) => ({ ...f, codes: [...new Set([...f.codes, ...codes])] }))}>+ {p}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 }}>
            {LAB_TESTS.map((t) => (
              <label key={t.code} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={form.codes.includes(t.code)} onChange={(e) => { const on = e.target.checked; setForm((f) => ({ ...f, codes: on ? [...f.codes, t.code] : f.codes.filter((c) => c !== t.code) })); }} />
                {t.name} <small style={{ color: 'var(--text-muted)' }}>{inr(t.rate)}</small>
              </label>
            ))}
          </div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        </Modal>
      )}

      {entry && (
        <Modal wide title={`Results · ${entry.orderNo} · ${entry.patientName}`} onClose={() => { setEntry(null); setError(''); }}
          footer={<><button className="btn btn-secondary" onClick={() => saveResults(false)}>Save results</button><button className="btn btn-primary" onClick={() => saveResults(true)}>Verify &amp; release report</button></>}>
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Test</th><th>Result</th><th>Flag</th><th>Reference</th><th>Previous</th><th>Note</th></tr></thead>
            <tbody>{entry.tests.map((t, i) => {
              const flag = labFlag(t.value, t);
              const set = (k, v) => setEntry({ ...entry, tests: entry.tests.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
              const prev = previous[t.code];
              const delta = prev && !t.qualitative && t.value !== '' && Number(prev.value) ? Math.round(((Number(t.value) - Number(prev.value)) / Number(prev.value)) * 100) : null;
              return (
                <tr key={t.code}>
                  <td>{t.name}</td>
                  <td>{t.qualitative
                    ? <input className="form-input" aria-label={`Result of ${t.name}`} list={`q-${t.code}`} value={t.value} onChange={(e) => set('value', e.target.value)} />
                    : <input className="form-input" aria-label={`Result of ${t.name}`} type="number" step="any" style={{ width: 110 }} value={t.value} onChange={(e) => set('value', e.target.value)} />}
                    <datalist id={`q-${t.code}`}>{['Negative', 'Positive', 'Not detected', 'Detected', 'A +ve', 'B +ve', 'O +ve', 'AB +ve', 'A -ve', 'B -ve', 'O -ve', 'AB -ve', 'Not done'].map((v) => <option key={v} value={v} />)}</datalist></td>
                  <td style={{ color: flag ? 'var(--danger)' : undefined, fontWeight: flag.length === 2 ? 700 : undefined }}>{FLAG_TEXT[flag] ?? ''}</td>
                  <td><small>{range(t)}</small></td>
                  <td><small>{prev ? `${prev.value} (${prev.date})` : '—'}{delta !== null && Math.abs(delta) >= 25 && <b style={{ color: 'var(--warning)' }}> Δ {delta > 0 ? '+' : ''}{delta}%</b>}</small></td>
                  <td><input className="form-input" aria-label={`Note on ${t.name}`} value={t.note ?? ''} onChange={(e) => set('note', e.target.value)} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        </Modal>
      )}
    </Page>
  );
}
