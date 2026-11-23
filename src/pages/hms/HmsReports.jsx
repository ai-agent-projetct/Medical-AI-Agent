import React, { useEffect, useState } from 'react';
import { collectionReport, todayYmd } from '../../hms';
import { inr } from './common';

/** Collections by payment mode, revenue and GST by department (server-side sums; no bulk downloads). */
export default function HmsReports() {
  const [from, setFrom] = useState(todayYmd());
  const [to, setTo] = useState(todayYmd());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    collectionReport(from, to).then(setData, (e) => setError(e.message));
  }, [from, to]);

  const totalCollected = data?.byMode.reduce((s, m) => s + (m.amount ?? 0), 0) ?? 0;
  const billed = data?.byKind.reduce((s, k) => s + k.total, 0) ?? 0;
  const dues = data?.byKind.reduce((s, k) => s + k.due, 0) ?? 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <div><h1>Billing Reports</h1><p>Day-end collection, department revenue and GST summary for the selected dates. Refunds reduce collections.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input className="form-input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && (
        <>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <div className="stat-card"><div className="stat-info"><p>Collected</p><div className="stat-value">{inr(totalCollected)}</div></div></div>
            <div className="stat-card"><div className="stat-info"><p>Billed (net of cancellations)</p><div className="stat-value">{inr(billed)}</div></div></div>
            <div className="stat-card"><div className="stat-info"><p>Outstanding on these bills</p><div className="stat-value">{inr(dues)}</div></div></div>
          </div>
          <div className="card"><h3>Collection by payment mode</h3>
            <div className="table-container"><table className="table-list"><thead><tr><th>Mode</th><th>Receipts</th><th>Amount</th></tr></thead>
              <tbody>{data.byMode.map((m) => <tr key={m.mode}><td>{m.mode}</td><td>{m.n}</td><td>{inr(m.amount)}</td></tr>)}</tbody></table></div></div>
          <div className="card" style={{ marginTop: 16 }}><h3>Revenue &amp; GST by department</h3>
            <div className="table-container"><table className="table-list">
              <thead><tr><th>Department</th><th>Invoices</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>Total</th><th>Due</th><th>Cancelled</th></tr></thead>
              <tbody>{data.byKind.map((k) => (
                <tr key={k.kind}><td>{k.kind}</td><td>{k.n}</td><td>{inr(k.taxable)}</td><td>{inr(k.cgst)}</td><td>{inr(k.sgst)}</td><td>{inr(k.total)}</td><td>{inr(k.due)}</td><td>{k.cancelled}</td></tr>))}
              </tbody></table></div></div>
        </>
      )}
    </div>
  );
}
