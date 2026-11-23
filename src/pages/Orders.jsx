import React, { useState } from 'react';
import { Search, Pill, FlaskConical, FileText } from 'lucide-react';

// Medicine and lab-test orders placed from the patient app (orders collection).
const NEXT = {
  medicine: ['Placed', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'],
  lab: ['Placed', 'Confirmed', 'Sample Collected', 'Completed', 'Cancelled'],
};

export default function Orders({ orders, setOrders, addAuditLog, currentRole, onLoadCatalog }) {
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');

  const shown = orders
    .filter(o => kind === 'all' || o.kind === kind)
    .filter(o => `${o.patient} ${o.phone} ${(o.items || []).map(i => i.name).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));

  const setStatus = (o, status) => {
    setOrders(prev => prev.map(x => (x.id === o.id ? { ...x, status } : x)));
    addAuditLog(currentRole, 'Updated Order Status', 'Orders', `${o.kind === 'lab' ? 'Lab test' : 'Medicine'} order for ${o.patient} → ${status}`);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Pharmacy &amp; Lab Orders</h1>
          <p>Orders placed by patients from the mobile app. Payment is collected on delivery or at sample collection.</p>
        </div>
        {onLoadCatalog && <button className="btn btn-secondary" onClick={onLoadCatalog}>Load sample catalog</button>}
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-box" style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={16} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, phone or item" style={{ flex: 1 }} />
        </div>
        {['all', 'medicine', 'lab'].map(k => (
          <button key={k} className={`btn ${kind === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind(k)}>
            {k === 'all' ? 'All' : k === 'lab' ? 'Lab tests' : 'Medicines'}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="table-container"><table className="table-list">
          <thead>
            <tr><th>Type</th><th>Patient</th><th>Items</th><th>Total</th><th>Address / Slot</th><th>Rx</th><th>Status</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No orders yet</td></tr>}
            {shown.map(o => (
              <tr key={o.id}>
                <td>{o.kind === 'lab' ? <><FlaskConical size={14} /> Lab</> : <><Pill size={14} /> Medicine</>}</td>
                <td><strong>{o.patient}</strong><br /><small>{o.phone}</small></td>
                <td>{(o.items || []).map(i => `${i.name} × ${i.qty ?? 1}`).join(', ')}</td>
                <td>₹{o.total}</td>
                <td>{o.address}{o.date && <><br /><small>{o.date} · {o.slot}</small></>}</td>
                <td>{o.prescriptionUrl ? <a href={o.prescriptionUrl} target="_blank" rel="noreferrer"><FileText size={16} /></a> : '—'}</td>
                <td>
                  <select value={o.status} onChange={e => setStatus(o, e.target.value)} aria-label={`Status of order for ${o.patient}`}>
                    {(NEXT[o.kind] || NEXT.medicine).map(s => <option key={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
