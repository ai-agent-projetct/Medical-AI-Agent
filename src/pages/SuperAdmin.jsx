import React, { useEffect, useState } from 'react';
import { Building2, Plus, Power, LogIn, UserPlus, RefreshCw } from 'lucide-react';
import {
  collection, doc, getAggregateFromServer, getCountFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc,
  sum, updateDoc, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, logAudit, pickHospital } from '../firebase';
import { Modal, inr } from './hms/common';

// What each subscription plan switches on (hospitals/{id}.modules gates the portal tabs).
export const MODULES = {
  billing: 'OPD billing & claims', pharmacy: 'Pharmacy & inventory', ipd: 'In-patient & beds', telehealth: 'Video consults',
  assets: 'Equipment & maintenance', voice: 'AI voice receptionist', ai: 'AI scribe & CDSS',
  clinical: 'Lab, radiology, OT, emergency, nursing & blood bank', hrms: 'HR & payroll', erp: 'Stores, accounts & support services',
};
export const PLANS = {
  Basic: ['billing', 'pharmacy'],
  Pro: ['billing', 'pharmacy', 'ipd', 'telehealth', 'assets', 'clinical'],
  Enterprise: Object.keys(MODULES),
};
const slug = (name) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}`;
const monthStart = () => `${new Date().toLocaleDateString('en-CA').slice(0, 7)}-01`;

/** Metrics of one hospital, straight from server-side counts (no documents downloaded). */
async function metricsOf(h) {
  const count = async (q) => (await getCountFromServer(q)).data().count;
  const by = () => where('hospitalId', '==', h);
  const [users, patients, appointments, revenue] = await Promise.all([
    count(query(collection(db, 'users'), by())),
    count(query(collection(db, 'patients'), where('hospitalIds', 'array-contains', h))),
    count(query(collection(db, 'appointments'), by(), where('date', '>=', monthStart()))),
    getAggregateFromServer(query(collection(db, 'invoices'), by(), where('date', '>=', monthStart())), { total: sum('total') })
      .then((a) => a.data().total ?? 0),
  ]);
  return { users, patients, appointments, revenue };
}

/** Super Admin (platform owner): customer hospitals, plans and modules, suspension, hospital admins, metrics. */
export default function SuperAdmin() {
  const [hospitals, setHospitals] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [form, setForm] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(query(collection(db, 'hospitals'), orderBy('name')),
    (snap) => setHospitals(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    (err) => setError(err.message)), []);

  const refresh = async () => {
    setBusy(true);
    try {
      setMetrics(Object.fromEntries(await Promise.all(hospitals.map(async (h) => [h.id, await metricsOf(h.id)]))));
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  useEffect(() => { if (hospitals.length && !Object.keys(metrics).length) refresh(); }, [hospitals.length]);

  const run = async (fn, done) => {
    setError(''); setBusy(true);
    try { await fn(); done?.(); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const saveHospital = () => run(async () => {
    const { id, ...h } = form;
    const data = { ...h, modules: h.modules ?? PLANS[h.plan] };
    if (id) await updateDoc(doc(db, 'hospitals', id), data);
    else await setDoc(doc(db, 'hospitals', slug(h.name)), { ...data, status: 'Active', createdAt: serverTimestamp() });
    logAudit('Super Admin', id ? 'Updated Hospital' : 'Created Hospital', 'Platform', `${h.name} · ${h.plan}`);
  }, () => setForm(null));

  const toggle = (h) => run(async () => {
    const status = h.status === 'Suspended' ? 'Active' : 'Suspended';
    if (status === 'Suspended' && !window.confirm(`Suspend ${h.name}? All its staff lose access until it is re-activated.`)) return;
    await updateDoc(doc(db, 'hospitals', h.id), { status });
    logAudit('Super Admin', status === 'Suspended' ? 'Suspended Hospital' : 'Activated Hospital', 'Platform', h.name);
  });

  const createAdmin = () => run(async () => {
    await httpsCallable(functions, 'createStaffUser')({ ...admin, role: 'hospital_admin' });
    logAudit('Super Admin', 'Created Hospital Admin', 'Platform', `${admin.email} → ${admin.hospitalName}`);
  }, () => setAdmin(null));

  const totals = Object.values(metrics).reduce((t, m) => ({
    users: t.users + m.users, patients: t.patients + m.patients, appointments: t.appointments + m.appointments, revenue: t.revenue + m.revenue,
  }), { users: 0, patients: 0, appointments: 0, revenue: 0 });

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title">
          <h2>Platform · Hospitals</h2>
          <p>Every customer hospital on the service: plan and modules, status, administrators and usage this month.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={refresh} disabled={busy}><RefreshCw size={16} /> Refresh metrics</button>
          <button className="btn btn-primary" onClick={() => setForm({ name: '', city: '', phone: '', email: '', gstin: '', voiceNumber: '', receptionNumber: '', plan: 'Pro' })}>
            <Plus size={16} /> New hospital
          </button>
        </div>
      </div>
      {error && <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 16 }}>{error}</div>}

      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          ['Active hospitals', hospitals.filter((h) => h.status !== 'Suspended').length],
          ['Staff accounts', totals.users],
          ['Patients', totals.patients],
          ['Appointments (month)', totals.appointments],
          ['Billed (month)', inr(totals.revenue)],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}><div className="stat-info"><p>{label}</p><div className="stat-value">{value}</div></div></div>
        ))}
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table-list">
            <thead>
              <tr><th>Hospital</th><th>Plan &amp; modules</th><th>Status</th><th>Staff</th><th>Patients</th><th>Appts (month)</th><th>Billed (month)</th><th /></tr>
            </thead>
            <tbody>
              {hospitals.map((h) => {
                const m = metrics[h.id];
                return (
                  <tr key={h.id}>
                    <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Building2 size={16} /><div><strong>{h.name}</strong><br /><small style={{ color: 'var(--text-muted)' }}>{h.city} · {h.id}</small></div></div></td>
                    <td><strong>{h.plan}</strong><br /><small style={{ color: 'var(--text-muted)' }}>{(h.modules ?? []).join(', ')}</small></td>
                    <td><span className={`badge ${h.status === 'Suspended' ? 'badge-danger' : 'badge-success'}`}>{h.status ?? 'Active'}</span></td>
                    <td>{m?.users ?? '…'}</td><td>{m?.patients ?? '…'}</td><td>{m?.appointments ?? '…'}</td><td>{m ? inr(m.revenue) : '…'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary" title="Work inside this hospital" onClick={() => pickHospital(h.id)}><LogIn size={14} /> Open</button>{' '}
                      <button className="btn btn-secondary" onClick={() => setForm({ id: h.id, name: h.name, city: h.city ?? '', phone: h.phone ?? '', email: h.email ?? '', gstin: h.gstin ?? '', voiceNumber: h.voiceNumber ?? '', receptionNumber: h.receptionNumber ?? '', plan: h.plan, modules: h.modules ?? PLANS[h.plan] })}>Edit</button>{' '}
                      <button className="btn btn-secondary" onClick={() => setAdmin({ hospitalId: h.id, hospitalName: h.name, name: '', email: '', password: '' })}><UserPlus size={14} /> Admin</button>{' '}
                      <button className="btn btn-secondary" onClick={() => toggle(h)} disabled={busy}><Power size={14} /> {h.status === 'Suspended' ? 'Activate' : 'Suspend'}</button>
                    </td>
                  </tr>
                );
              })}
              {!hospitals.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No hospitals yet. Create the first one.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <Modal title={form.id ? `Edit ${form.name}` : 'New hospital'} onClose={() => setForm(null)}
          footer={<button className="btn btn-primary" disabled={busy || !form.name.trim()} onClick={saveHospital}>Save</button>}>
          {[['name', 'Hospital name'], ['city', 'City'], ['phone', 'Phone'], ['email', 'Email'], ['gstin', 'GSTIN'],
            ['voiceNumber', 'AI voice line (Twilio number, +91…)'], ['receptionNumber', 'Reception number (calls transfer here)']].map(([k, label]) => (
            <div className="form-group" key={k}>
              <label>{label}</label>
              <input className="form-input" aria-label={label} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div className="form-group">
            <label>Plan</label>
            <select className="form-input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value, modules: PLANS[e.target.value] })}>
              {Object.keys(PLANS).map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Modules</label>
            {Object.entries(MODULES).map(([k, label]) => {
              const on = (form.modules ?? PLANS[form.plan]).includes(k);
              return (
                <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
                  <input type="checkbox" checked={on} onChange={() => {
                    const cur = form.modules ?? PLANS[form.plan];
                    setForm({ ...form, modules: on ? cur.filter((x) => x !== k) : [...cur, k] });
                  }} /> {label}
                </label>
              );
            })}
          </div>
        </Modal>
      )}

      {admin && (
        <Modal title={`Hospital admin · ${admin.hospitalName}`} onClose={() => setAdmin(null)}
          footer={<button className="btn btn-primary" disabled={busy || !admin.email || admin.password.length < 8} onClick={createAdmin}>Create admin login</button>}>
          {[['name', 'Full name', 'text'], ['email', 'Login email', 'email'], ['password', 'Temporary password (min 8)', 'password']].map(([k, label, type]) => (
            <div className="form-group" key={k}>
              <label>{label}</label>
              <input className="form-input" aria-label={label} type={type} value={admin[k]} onChange={(e) => setAdmin({ ...admin, [k]: e.target.value })} />
            </div>
          ))}
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>The hospital admin then creates their own doctors, nurses, front desk, billing, pharmacy and administration users.</p>
        </Modal>
      )}
    </div>
  );
}
