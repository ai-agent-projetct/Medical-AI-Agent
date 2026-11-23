import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { col, keyOf, limit, orderBy, query, useQueryDocs, where } from '../../hms';
import { inr, Modal } from './common';

const CATEGORIES = ['Consultation', 'Procedure', 'Surgery', 'Room', 'Nursing', 'Lab', 'Radiology', 'Package', 'Other'];
const EMPTY = { name: '', category: 'Consultation', department: '', rate: '', gstRate: 0, sac: '9993', active: true };

/** Hospital tariff: every billable service with its price (tax-inclusive) and GST rate. */
export default function ChargeMaster({ canEdit }) {
  const [category, setCategory] = useState('Consultation');
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const list = useQueryDocs(() => query(col('services'), where('category', '==', category), orderBy('nameKey'), limit(300)), [category]);

  const save = async (e) => {
    e.preventDefault();
    try {
      const { id, ...s } = edit;
      await setDoc(id ? doc(db, 'services', id) : doc(col('services')),
        { ...s, rate: Number(s.rate), gstRate: Number(s.gstRate), nameKey: keyOf(s.name) }, { merge: true });
      setEdit(null);
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div><h1>Charge Master (Tariff)</h1><p>Services, procedures, room and package rates used on OPD and IPD bills. Healthcare services are usually GST-exempt (SAC 9993).</p></div>
        {canEdit && <button className="btn btn-primary" onClick={() => setEdit({ ...EMPTY, category })}>Add service</button>}
      </div>
      <div className="tabs-navigation" style={{ marginBottom: 16 }}>
        {CATEGORIES.map((c) => <button key={c} className={`tab-btn ${c === category ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}
      </div>
      <div className="card"><div className="table-container"><table className="table-list">
        <thead><tr><th>Service</th><th>Department</th><th>Rate</th><th>GST</th><th>SAC</th><th>Status</th></tr></thead>
        <tbody>
          {list.error && <tr><td colSpan={6} style={{ color: 'var(--danger)' }}>{list.error.message}</td></tr>}
          {!list.loading && list.docs.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No services in {category}</td></tr>}
          {list.docs.map((s) => (
            <tr key={s.id} onClick={() => canEdit && setEdit(s)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
              <td><strong>{s.name}</strong></td><td>{s.department}</td><td>{inr(s.rate)}</td><td>{s.gstRate}%</td><td>{s.sac}</td>
              <td><span className={`badge ${s.active === false ? 'badge-secondary' : 'badge-success'}`}>{s.active === false ? 'Inactive' : 'Active'}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
      {edit && (
        <Modal title={edit.id ? 'Edit service' : 'Add service'} onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <div className="form-group"><label>Name</label><input className="form-input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="form-input-row">
              <div className="form-group"><label>Category</label><select className="form-input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="form-group"><label>Department</label><input className="form-input" value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></div>
            </div>
            <div className="form-input-row">
              <div className="form-group"><label>Rate incl. GST (₹)</label><input className="form-input" type="number" min="0" step="0.01" required value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} /></div>
              <div className="form-group"><label>GST %</label><select className="form-input" value={edit.gstRate} onChange={(e) => setEdit({ ...edit, gstRate: e.target.value })}>{[0, 5, 12, 18].map((g) => <option key={g} value={g}>{g}%</option>)}</select></div>
              <div className="form-group"><label>SAC</label><input className="form-input" value={edit.sac} onChange={(e) => setEdit({ ...edit, sac: e.target.value })} /></div>
            </div>
            <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <div style={{ textAlign: 'right' }}><button className="btn btn-primary">Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
