import React, { useEffect, useState } from 'react';
import { UserPlus, Power, LogIn, LogOut } from 'lucide-react';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, logAudit, ROLE_LABELS, STAFF_ROLES, tenant } from '../firebase';
import { Modal, Tabs } from './hms/common';

const BLANK = { name: '', email: '', phone: '', role: 'receptionist', department: '', password: '' };
const when = (t) => (t ? t.toDate().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…');

/**
 * Hospital admin: the hospital's login accounts and their category (doctor, nurse, front desk, lab, billing,
 * pharmacy, administration), department, enable / disable, doctors waiting for approval, and login activity.
 * Accounts are created by the createStaffUser function (Firebase Auth + users doc); disabling also blocks
 * the Auth account (syncStaffAccess function).
 */
export default function UsersRoles() {
  const [tab, setTab] = useState('Users');
  const [users, setUsers] = useState([]);
  const [logins, setLogins] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hid = tenant.hospitalId;

  useEffect(() => onSnapshot(query(collection(db, 'users'), where('hospitalId', '==', hid), limit(2000)),
    (snap) => setUsers(snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))),
    (err) => setError(err.message)), [hid]);
  useEffect(() => (tab !== 'Login activity' ? undefined : onSnapshot(
    query(collection(db, 'auditLogs'), where('hospitalId', '==', hid), where('action', 'in', ['Login', 'Logout']), orderBy('at', 'desc'), limit(200)),
    (snap) => setLogins(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    (err) => setError(err.message))), [tab, hid]);

  const run = async (fn, done) => {
    setError(''); setBusy(true);
    try { await fn(); done?.(); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const change = (u, data, what) => run(async () => {
    await updateDoc(doc(db, 'users', u.id), { ...data, updatedBy: tenant.uid });
    logAudit('Hospital Admin', what, 'Users & Roles', `${u.name ?? u.email}: ${JSON.stringify(data)}`);
  });
  const create = () => run(async () => {
    await httpsCallable(functions, 'createStaffUser')({ ...form, hospitalId: hid });
    logAudit('Hospital Admin', 'Created User', 'Users & Roles', `${form.email} as ${ROLE_LABELS[form.role]}`);
  }, () => setForm(null));

  const pending = users.filter((u) => u.active === false && u.role === 'doctor' && !u.disabledBy);
  const shown = tab === 'Pending approval' ? pending : users;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title">
          <h2>Users, Roles &amp; Logins</h2>
          <p>Every login of {tenant.hospital?.name ?? 'this hospital'}: who they are, their category and department, and whether they may sign in.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setForm(BLANK)}><UserPlus size={16} /> Add user</button>
      </div>
      {error && <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 16 }}>{error}</div>}

      <div className="grid-4" style={{ marginBottom: 16 }}>
        {STAFF_ROLES.filter((r) => r !== 'hospital_admin').slice(0, 4).map((r) => (
          <div className="stat-card" key={r}><div className="stat-info"><p>{ROLE_LABELS[r]}s</p><div className="stat-value">{users.filter((u) => u.role === r && u.active !== false).length}</div></div></div>
        ))}
      </div>

      <Tabs tabs={['Users', `Pending approval`, 'Login activity']} value={tab} onChange={setTab} />

      {tab !== 'Login activity' ? (
        <div className="card">
          <div className="table-container">
            <table className="table-list">
              <thead><tr><th>Name</th><th>Login</th><th>Category</th><th>Department</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.name ?? '—'}</strong><br /><small style={{ color: 'var(--text-muted)' }}>{u.phone ?? ''}</small></td>
                    <td>{u.email ?? u.id}</td>
                    <td>
                      <select className="form-input" value={u.role} disabled={busy || u.id === tenant.uid} aria-label={`Category of ${u.name}`}
                        onChange={(e) => change(u, { role: e.target.value }, 'Changed Category')}>
                        {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="form-input" defaultValue={u.department ?? ''} aria-label={`Department of ${u.name}`}
                        onBlur={(e) => e.target.value !== (u.department ?? '') && change(u, { department: e.target.value }, 'Changed Department')} />
                    </td>
                    <td>
                      <span className={`badge ${u.active === false ? (u.disabledBy ? 'badge-danger' : 'badge-warning') : 'badge-success'}`}>
                        {u.active === false ? (u.disabledBy ? 'Disabled' : 'Awaiting approval') : 'Active'}
                      </span>
                    </td>
                    <td>
                      {u.id !== tenant.uid && (u.active === false
                        ? <button className="btn btn-primary" disabled={busy} onClick={() => change(u, { active: true, disabledBy: null }, u.disabledBy ? 'Enabled User' : 'Approved Doctor')}><Power size={14} /> {u.disabledBy ? 'Enable' : 'Approve'}</button>
                        : <button className="btn btn-secondary" disabled={busy} onClick={() => window.confirm(`Disable ${u.name ?? u.email}? They are signed out and cannot log in.`) && change(u, { active: false, disabledBy: tenant.uid }, 'Disabled User')}><Power size={14} /> Disable</button>)}
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{tab === 'Users' ? 'No users yet.' : 'No doctors waiting for approval.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table-list">
              <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Details</th></tr></thead>
              <tbody>
                {logins.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(l.at)}</td>
                    <td>{l.email ?? l.uid}<br /><small style={{ color: 'var(--text-muted)' }}>{l.user}</small></td>
                    <td>{l.action === 'Login' ? <><LogIn size={14} /> Login</> : <><LogOut size={14} /> Logout</>}</td>
                    <td>{l.details}</td>
                  </tr>
                ))}
                {!logins.length && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No logins recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && (
        <Modal title="Add user" onClose={() => setForm(null)}
          footer={<button className="btn btn-primary" disabled={busy || !form.name || !form.email || form.password.length < 8} onClick={create}>Create login</button>}>
          {[['name', 'Full name', 'text'], ['email', 'Login email', 'email'], ['phone', 'Mobile', 'tel'], ['department', 'Department', 'text'], ['password', 'Temporary password (min 8)', 'password']].map(([k, label, type]) => (
            <div className="form-group" key={k}>
              <label>{label}</label>
              <input className="form-input" aria-label={label} type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div className="form-group">
            <label>Category</label>
            <select className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
}
