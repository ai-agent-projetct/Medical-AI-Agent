import React, { useState } from 'react';
import { BedDouble } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { addCharge, admit, col, discharge, dischargeLines, limit, orderBy, query, saveWard, searchByKey, useQueryDocs, where, scoped } from '../../hms';
import { BillComposer, inr, InvoiceModal, Modal, PatientPicker, SearchBox, Tabs, useDesk } from './common';

const WARD_TYPES = ['General', 'Semi-private', 'Private', 'Deluxe', 'ICU', 'NICU', 'HDU'];
const STATUS_COLOR = { Free: 'var(--success-bg)', Occupied: 'var(--danger-bg)', Cleaning: 'var(--warning-bg)' };

/** In-patients: live bed board, admissions with advance, running charges, discharge with final IPD bill. */
export default function Ipd({ doctors, isAdmin, canBill }) {
  const [tab, setTab] = useState('Bed board');
  const [desk] = useDesk('C1');
  const [admitBed, setAdmitBed] = useState(null);
  const [form, setForm] = useState(null);
  const [current, setCurrent] = useState(null);
  const [dischargeOf, setDischargeOf] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [ward, setWard] = useState(null);
  const [error, setError] = useState('');

  const beds = useQueryDocs(() => scoped('beds', orderBy('label'), limit(1000)), []);
  const admitted = useQueryDocs(() => scoped('admissions', where('status', '==', 'Admitted'), orderBy('admittedAt', 'desc'), limit(500)), []);
  const charges = useQueryDocs(() => current ? query(col(`admissions/${current.id}/charges`), orderBy('at'), limit(500)) : null, [current?.id]);
  const byWard = beds.docs.reduce((m, b) => ({ ...m, [b.wardName]: [...(m[b.wardName] ?? []), b] }), {});
  const free = beds.docs.filter((b) => b.status === 'Free').length;
  const run = (fn, done) => fn().then(done, (e) => setError(e.message));

  return (
    <div className="page-container">
      <div className="page-header">
        <div><h1>In-Patient (IPD)</h1><p>{beds.docs.length} beds · {free} free · {admitted.docs.length} admitted. Room rent is billed per started 24 hours.</p></div>
        {isAdmin && <button className="btn btn-secondary" onClick={() => setWard({ name: '', type: 'General', ratePerDay: 1500, beds: 10, prefix: '' })}>Add ward</button>}
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <Tabs tabs={['Bed board', 'Admitted patients']} value={tab} onChange={setTab} />

      {tab === 'Bed board' && Object.entries(byWard).map(([name, list]) => (
        <div className="card" key={name} style={{ marginBottom: 12 }}>
          <h3>{name} <small>· {list[0].wardType} · {inr(list[0].ratePerDay)}/day · {list.filter((b) => b.status === 'Free').length}/{list.length} free</small></h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {list.map((b) => (
              <button key={b.id} className="btn" style={{ background: STATUS_COLOR[b.status], minWidth: 110, textAlign: 'left' }}
                title={b.status === 'Occupied' ? b.patientName : b.status}
                onClick={() => {
                  if (b.status === 'Free') { setAdmitBed(b); setForm({ patient: null, doctor: doctors[0]?.name ?? '', department: doctors[0]?.department ?? '', diagnosis: '', advance: 0, mode: 'Cash' }); }
                  else if (b.status === 'Cleaning') run(() => updateDoc(doc(db, 'beds', b.id), { status: 'Free' }), () => {});
                  else setCurrent(admitted.docs.find((a) => a.id === b.admissionId) ?? null);
                }}>
                <BedDouble size={14} /> <strong>{b.label}</strong><br />
                <small>{b.status === 'Occupied' ? b.patientName : b.status === 'Cleaning' ? 'Cleaning · tap when ready' : 'Free · tap to admit'}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
      {tab === 'Bed board' && !beds.loading && beds.docs.length === 0 && <div className="card">No wards yet. {isAdmin ? 'Add a ward to create its beds.' : 'Ask an admin to add wards.'}</div>}

      {tab === 'Admitted patients' && (
        <div className="card"><div className="table-container"><table className="table-list">
          <thead><tr><th>Patient</th><th>Bed</th><th>Doctor</th><th>Admitted</th><th>Advance</th></tr></thead>
          <tbody>{admitted.docs.map((a) => (
            <tr key={a.id} onClick={() => setCurrent(a)} style={{ cursor: 'pointer' }}>
              <td><strong>{a.patientName}</strong><br /><small>{a.diagnosis}</small></td><td>{a.bedLabel} · {a.wardName}</td>
              <td>{a.doctor}</td><td>{a.admittedAt?.toDate().toLocaleString('en-IN')}</td><td>{inr(a.advance)}</td>
            </tr>))}</tbody>
        </table></div></div>
      )}

      {admitBed && form && (
        <Modal title={`Admit to ${admitBed.label} (${admitBed.wardName})`} onClose={() => setAdmitBed(null)}
          footer={<button className="btn btn-primary" disabled={!form.patient} onClick={() => run(() => admit({ ...form, bed: admitBed }), () => setAdmitBed(null))}>Admit</button>}>
          <div className="form-group"><label>Patient</label><PatientPicker value={form.patient} onChange={(p) => setForm({ ...form, patient: p })} allowWalkIn /></div>
          <div className="form-input-row">
            <div className="form-group"><label>Consultant</label>
              <select className="form-input" value={form.doctor} onChange={(e) => { const d = doctors.find((x) => x.name === e.target.value); setForm({ ...form, doctor: e.target.value, department: d?.department ?? form.department }); }}>
                {doctors.map((d) => <option key={d.id}>{d.name}</option>)}
              </select></div>
            <div className="form-group"><label>Department</label><input className="form-input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          </div>
          <div className="form-group"><label>Provisional diagnosis</label><input className="form-input" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></div>
          {canBill && <div className="form-input-row">
            <div className="form-group"><label>Advance (₹)</label><input className="form-input" type="number" min="0" value={form.advance} onChange={(e) => setForm({ ...form, advance: Number(e.target.value) })} /></div>
            <div className="form-group"><label>Mode</label><select className="form-input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>{['Cash', 'UPI', 'Card', 'Insurance'].map((m) => <option key={m}>{m}</option>)}</select></div>
          </div>}
        </Modal>
      )}

      {current && !dischargeOf && (
        <Modal title={`${current.patientName} · ${current.bedLabel}`} wide onClose={() => setCurrent(null)}
          footer={canBill && <button className="btn btn-primary" onClick={() => run(() => dischargeLines(current), (lines) => setDischargeOf({ adm: current, lines }))}>Discharge &amp; final bill</button>}>
          <p>{current.doctor} · {current.department} · admitted {current.admittedAt?.toDate().toLocaleString('en-IN')} · advance {inr(current.advance)}</p>
          <div className="form-group"><label>Add charge (procedure, nursing, investigation…)</label>
            <SearchBox placeholder="Search charge master" search={(q) => searchByKey('services', q)} render={(s) => `${s.name} · ${inr(s.rate)}`}
              onPick={(s) => run(() => addCharge(current.id, { name: s.name, category: s.category, qty: 1, rate: s.rate, gstRate: s.gstRate }), () => {})} />
          </div>
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Date</th><th>Charge</th><th>Qty</th><th>Rate</th><th>By</th></tr></thead>
            <tbody>{charges.docs.map((c) => <tr key={c.id}><td>{c.date}</td><td>{c.name}</td><td>{c.qty}</td><td>{inr(c.rate)}</td><td>{c.by}</td></tr>)}
              {!charges.loading && charges.docs.length === 0 && <tr><td colSpan={5}>No charges yet. Medicines can also be added on the final bill.</td></tr>}</tbody>
          </table></div>
        </Modal>
      )}

      {dischargeOf && (
        <Modal title={`Final bill · ${dischargeOf.adm.patientName}`} wide onClose={() => setDischargeOf(null)}>
          <BillComposer kind="IPD" initialLines={dischargeOf.lines} advance={dischargeOf.adm.advance}
            patient={{ id: dischargeOf.adm.patientId, name: dischargeOf.adm.patientName, phone: dischargeOf.adm.phone }}
            submitLabel="Discharge & save bill"
            onSubmit={async ({ lines, payment }) => {
              const inv = await discharge(dischargeOf.adm, desk, lines, payment);
              setDischargeOf(null); setCurrent(null); setInvoice(inv);
            }} />
        </Modal>
      )}
      {invoice && <InvoiceModal inv={invoice} isAdmin={isAdmin} onClose={() => setInvoice(null)} />}

      {ward && (
        <Modal title="Add ward" onClose={() => setWard(null)}
          footer={<button className="btn btn-primary" disabled={!ward.name || ward.beds < 1} onClick={() => run(() => saveWard(ward), () => setWard(null))}>Create ward &amp; {ward.beds} beds</button>}>
          <div className="form-input-row">
            <div className="form-group"><label>Ward name</label><input className="form-input" value={ward.name} onChange={(e) => setWard({ ...ward, name: e.target.value })} /></div>
            <div className="form-group"><label>Type</label><select className="form-input" value={ward.type} onChange={(e) => setWard({ ...ward, type: e.target.value })}>{WARD_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          </div>
          <div className="form-input-row">
            <div className="form-group"><label>Rate per day (₹)</label><input className="form-input" type="number" min="0" value={ward.ratePerDay} onChange={(e) => setWard({ ...ward, ratePerDay: Number(e.target.value) })} /></div>
            <div className="form-group"><label>Beds</label><input className="form-input" type="number" min="1" max="200" value={ward.beds} onChange={(e) => setWard({ ...ward, beds: Number(e.target.value) })} /></div>
            <div className="form-group"><label>Bed prefix</label><input className="form-input" placeholder="e.g. GW" value={ward.prefix} onChange={(e) => setWard({ ...ward, prefix: e.target.value.toUpperCase() })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
