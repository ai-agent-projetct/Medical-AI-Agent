import React, { useState } from 'react';
import { Receipt } from 'lucide-react';
import { col, createInvoice, limit, orderBy, PAGE, query, todayYmd, useQueryDocs, where, scoped } from '../../hms';
import { BillComposer, inr, InvoiceModal, Tabs, useDesk } from './common';

/** OPD / general billing counter: new bills, the day's invoices, outstanding dues. */
export default function Billing({ isAdmin, kind: fixedKind }) {
  const [tab, setTab] = useState(fixedKind === 'PHARMACY' ? 'New sale' : 'New bill');
  const [desk, setDesk] = useDesk(fixedKind === 'PHARMACY' ? 'PH1' : 'C1');
  const [kind, setKind] = useState(fixedKind ?? 'OPD');
  const [date, setDate] = useState(todayYmd());
  const [open, setOpen] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const kinds = fixedKind ? [fixedKind] : ['OPD', 'PHARMACY'];

  const day = useQueryDocs(() => scoped('invoices', where('date', '==', date), ...(fixedKind ? [where('kind', '==', fixedKind)] : []),
    orderBy('createdAt', 'desc'), limit(200)), [date, fixedKind]);
  const dues = useQueryDocs(() => tab !== 'Dues' ? null : scoped('invoices', where('status', 'in', ['Unpaid', 'Partial']),
    orderBy('date', 'desc'), limit(PAGE)), [tab]);
  const paidToday = day.docs.filter((i) => i.status !== 'Cancelled').reduce((s, i) => s + i.paid, 0);
  const billedToday = day.docs.filter((i) => i.status !== 'Cancelled').reduce((s, i) => s + i.total, 0);

  const list = (docs, loading, error) => (
    <div className="card"><div className="table-container"><table className="table-list">
      <thead><tr><th>Invoice</th><th>Date</th><th>Patient</th><th>Type</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>
        {error && <tr><td colSpan={8} style={{ color: 'var(--danger)' }}>{error.message}</td></tr>}
        {!loading && !error && docs.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No invoices</td></tr>}
        {docs.map((i) => (
          <tr key={i.id} onClick={() => setOpen(i)} style={{ cursor: 'pointer' }}>
            <td><strong>{i.number}</strong></td><td>{i.date}</td><td>{i.patientName}<br /><small>{i.phone}</small></td><td>{i.kind}</td>
            <td>{inr(i.total)}</td><td>{inr(i.paid)}</td><td>{inr(i.due)}</td>
            <td><span className={`badge ${i.status === 'Paid' ? 'badge-success' : i.status === 'Cancelled' ? 'badge-secondary' : i.status === 'Partial' ? 'badge-warning' : 'badge-danger'}`}>{i.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table></div></div>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>{fixedKind === 'PHARMACY' ? 'Pharmacy Billing (POS)' : 'Hospital Billing'}</h1>
          <p>GST invoices with gap-free numbering per counter and financial year. Payments by cash, UPI, card or insurance; partial payments tracked as dues.</p>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Counter
          <input className="form-input" style={{ width: 90 }} value={desk} onChange={(e) => setDesk(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'C1')} />
        </label>
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-info"><p>Billed on {date}</p><div className="stat-value">{inr(billedToday)}</div></div><div className="stat-icon"><Receipt size={22} /></div></div>
        <div className="stat-card"><div className="stat-info"><p>Collected against these bills</p><div className="stat-value">{inr(paidToday)}</div></div></div>
        <div className="stat-card"><div className="stat-info"><p>Invoices</p><div className="stat-value">{day.docs.length}</div></div></div>
      </div>

      <Tabs tabs={[fixedKind === 'PHARMACY' ? 'New sale' : 'New bill', 'Invoices', 'Dues']} value={tab} onChange={setTab} />

      {(tab === 'New bill' || tab === 'New sale') && (
        <div className="card">
          {!fixedKind && (
            <div className="tabs-navigation" style={{ marginBottom: 12 }}>
              {kinds.map((k) => <button key={k} className={`tab-btn ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{k === 'OPD' ? 'OPD / services' : 'Pharmacy'}</button>)}
            </div>
          )}
          <BillComposer key={`${kind}-${formKey}`} kind={kind} allowWalkIn={kind === 'PHARMACY'}
            submitLabel={kind === 'PHARMACY' ? 'Save sale' : 'Save bill'}
            onSubmit={async ({ patient, lines, payment }) => {
              const inv = await createInvoice({ kind, desk, patient, lines, payment });
              setFormKey((k) => k + 1);
              setOpen(inv);
            }} />
        </div>
      )}
      {tab === 'Invoices' && (
        <>
          <label className="form-group" style={{ maxWidth: 220 }}>Date
            <input className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {list(day.docs, day.loading, day.error)}
        </>
      )}
      {tab === 'Dues' && list(dues.docs, dues.loading, dues.error)}
      {open && <InvoiceModal inv={open} isAdmin={isAdmin} onClose={() => setOpen(null)} />}
    </div>
  );
}
