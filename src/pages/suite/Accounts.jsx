import React, { useEffect, useState } from 'react';
import { Plus, Lock, Download } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db, tenant } from '../../firebase';
import { collectionReport, todayYmd } from '../../hms';
import { Modal, Tabs, inr } from '../hms/common';
import { Empty, Fields, Page, Stats, badgeFor, downloadCsv, fresh, upsert, useSuite } from './kit';

// expenses/{id}     {date, head, vendor, billNo, amount, gst, mode, notes, status: Unpaid | Paid}
// dayClosings/{date} {date, byMode: {Cash, UPI, Card, Insurance}, counted, variance, notes, closedBy, status: Closed}
const HEADS = ['Salaries & wages', 'Doctor fees / payouts', 'Medical supplies', 'Pharmacy purchases', 'Rent', 'Electricity', 'Water', 'Diesel / generator',
  'Equipment maintenance', 'Housekeeping', 'Laundry', 'Food & kitchen', 'Marketing', 'Professional fees', 'Insurance', 'Taxes & licences', 'IT & software', 'Bank charges', 'Other'];
const MODES = ['Cash', 'UPI', 'Card', 'Insurance'];
const monthRange = (m) => [`${m}-01`, `${m}-${String(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()).padStart(2, '0')}`];

/** Accounts: day-end cash closing against receipts by mode, expenses register, monthly income vs expenditure (profit and loss) and GST summary. */
export default function Accounts() {
  const [expenses, setExpenses] = useSuite('expenses', 3000);
  const [tab, setTab] = useState('Day-end closing');
  const [day, setDay] = useState(todayYmd());
  const [month, setMonth] = useState(todayYmd().slice(0, 7));
  const [dayRep, setDayRep] = useState(null);
  const [monthRep, setMonthRep] = useState(null);
  const [closing, setClosing] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setDayRep(null); setClosing(null);
    collectionReport(day, day).then(setDayRep, (e) => setError(e.message));
    if (db) getDoc(doc(db, 'dayClosings', `${tenant.hospitalId}_${day}`)).then((s) => setClosing(s.data() ?? { counted: '', notes: '' }), () => setClosing({ counted: '', notes: '' }));
  }, [day]);
  useEffect(() => { setMonthRep(null); collectionReport(...monthRange(month)).then(setMonthRep, (e) => setError(e.message)); }, [month]);

  const mode = (r, m) => r?.byMode.find((x) => x.mode === m)?.amount ?? 0;
  const cashExp = expenses.filter((e) => e.date === day && e.mode === 'Cash' && e.status === 'Paid').reduce((s, e) => s + Number(e.amount || 0), 0);
  const expectedCash = mode(dayRep, 'Cash') - cashExp;
  const monthExp = expenses.filter((e) => e.date.startsWith(month));
  const income = monthRep ? monthRep.byKind.reduce((s, k) => s + k.taxable, 0) : 0;
  const gstOut = monthRep ? monthRep.byKind.reduce((s, k) => s + k.cgst + k.sgst, 0) : 0;
  const gstIn = monthExp.reduce((s, e) => s + Number(e.gst || 0), 0);
  const spent = monthExp.reduce((s, e) => s + Number(e.amount || 0), 0) - gstIn; // excl. GST, like income
  const byHead = HEADS.map((h) => [h, monthExp.filter((e) => e.head === h).reduce((s, e) => s + Number(e.amount || 0) - Number(e.gst || 0), 0)]).filter(([, v]) => v > 0);

  const close = () => upsert('dayClosings', `${tenant.hospitalId}_${day}`, {
    date: day, byMode: Object.fromEntries(MODES.map((m) => [m, mode(dayRep, m)])), cashExpenses: cashExp, expectedCash,
    counted: Number(closing.counted || 0), variance: Number(closing.counted || 0) - expectedCash, notes: closing.notes ?? '',
    closedBy: tenant.profile?.name ?? tenant.profile?.email ?? '', status: 'Closed',
  }).then(() => setClosing({ ...closing, status: 'Closed', variance: Number(closing.counted || 0) - expectedCash }), (e) => setError(e.message));

  return (
    <Page title="Accounts & Finance" desc="Day-end closing of cash, UPI and card against receipts, expenses register, and monthly income versus expenditure with a GST summary."
      actions={<button className="btn btn-primary" onClick={() => setForm({ date: todayYmd(), head: HEADS[0], mode: 'Cash', status: 'Paid', amount: '', gst: 0 })}><Plus size={16} /> Add expense</button>}>
      {error && <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>{error}</div>}
      <Tabs tabs={['Day-end closing', 'Expenses', 'Profit & loss']} value={tab} onChange={setTab} />

      {tab === 'Day-end closing' && <>
        <div className="form-input-row" style={{ marginBottom: 12 }}><input className="form-input" type="date" aria-label="Closing date" value={day} onChange={(e) => setDay(e.target.value)} style={{ maxWidth: 180 }} /></div>
        <Stats items={MODES.map((m) => [`${m} received`, dayRep ? inr(mode(dayRep, m)) : '…'])} />
        <div className="card">
          <p>Cash received {inr(mode(dayRep, 'Cash'))} − cash expenses paid {inr(cashExp)} = expected cash in hand <b>{inr(expectedCash)}</b></p>
          {closing?.status === 'Closed' ? (
            <p><span className="badge badge-success"><Lock size={12} /> Closed</span> by {closing.closedBy} · counted {inr(closing.counted)} · variance <b style={{ color: closing.variance ? 'var(--danger)' : undefined }}>{inr(closing.variance)}</b> {closing.notes}</p>
          ) : closing && (
            <div className="form-input-row" style={{ alignItems: 'flex-end' }}>
              <div className="form-group"><label>Cash counted (₹)</label><input className="form-input" type="number" aria-label="Cash counted" value={closing.counted} onChange={(e) => setClosing({ ...closing, counted: e.target.value })} /></div>
              <div className="form-group" style={{ flex: 1 }}><label>Notes</label><input className="form-input" aria-label="Closing notes" value={closing.notes} onChange={(e) => setClosing({ ...closing, notes: e.target.value })} /></div>
              <span>Variance <b>{inr(Number(closing.counted || 0) - expectedCash)}</b></span>
              <button className="btn btn-primary" disabled={closing.counted === '' || !dayRep} onClick={close}><Lock size={14} /> Close day</button>
            </div>
          )}
          {dayRep && <table className="table-list" style={{ marginTop: 12 }}><thead><tr><th>Billing</th><th>Invoices</th><th>Billed</th><th>Outstanding</th></tr></thead>
            <tbody>{dayRep.byKind.map((k) => <tr key={k.kind}><td>{k.kind}</td><td>{k.n}</td><td>{inr(k.total)}</td><td>{inr(k.due)}</td></tr>)}</tbody></table>}
        </div>
      </>}

      {tab === 'Expenses' && <div className="card">
        <div className="table-container"><table className="table-list">
          <thead><tr><th>Date</th><th>Head</th><th>Vendor / bill</th><th>Amount</th><th>GST</th><th>Mode</th><th>Status</th><th /></tr></thead>
          <tbody>{expenses.map((e) => (
            <tr key={e.id}><td>{e.date}</td><td>{e.head}</td><td>{e.vendor}<br /><small>{e.billNo}</small></td><td>{inr(e.amount)}</td><td>{inr(e.gst)}</td><td>{e.mode}</td>
              <td><span className={`badge ${badgeFor(e.status)}`}>{e.status}</span></td>
              <td>{e.status === 'Unpaid' ? <button className="btn btn-primary" onClick={() => setExpenses((p) => p.map((x) => (x.id === e.id ? { ...x, status: 'Paid', paidOn: todayYmd() } : x)))}>Mark paid</button>
                : <button className="btn btn-secondary" onClick={() => setForm(e)}>Edit</button>}</td></tr>
          ))}{!expenses.length && <Empty cols={8} />}</tbody>
        </table></div>
      </div>}

      {tab === 'Profit & loss' && <>
        <div className="form-input-row" style={{ marginBottom: 12 }}>
          <input className="form-input" type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180 }} />
          <button className="btn btn-secondary" disabled={!monthRep} onClick={() => downloadCsv(`pnl-${month}.csv`, [['Line', 'Amount'], ...monthRep.byKind.map((k) => [`Income ${k.kind} (taxable)`, k.taxable]), ...byHead.map(([h, v]) => [`Expense ${h}`, v]), ['Net', income - spent]])}><Download size={14} /> Export</button>
        </div>
        <Stats items={[['Income (excl. GST)', inr(income)], ['Expenditure (excl. GST)', inr(spent)], ['Net surplus', inr(income - spent), income - spent < 0 ? 'danger' : 'success'], ['GST collected − paid', inr(gstOut - gstIn)]]} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div className="card"><b>Income by department</b>
            {monthRep?.byKind.map((k) => <div key={k.kind} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>{k.kind} ({k.n} bills)</span><b>{inr(k.taxable)}</b></div>)}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>Collected (all modes)</span><b>{inr(MODES.reduce((s, m) => s + mode(monthRep, m), 0))}</b></div></div>
          <div className="card"><b>Expenditure by head</b>
            {byHead.map(([h, v]) => <div key={h} style={{ padding: '4px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{h}</span><b>{inr(v)}</b></div>
              <div style={{ height: 6, background: 'var(--primary)', opacity: 0.6, borderRadius: 3, width: `${(v / spent) * 100}%` }} /></div>)}
            {!byHead.length && <p style={{ color: 'var(--text-muted)' }}>No expenses this month.</p>}</div>
        </div>
      </>}

      {form && (
        <Modal title={form.id ? 'Edit expense' : 'Add expense'} onClose={() => setForm(null)} footer={<button className="btn btn-primary" type="submit" form="exp-form">Save</button>}>
          <form id="exp-form" onSubmit={(e) => { e.preventDefault(); const f = { ...form, amount: Number(form.amount || 0), gst: Number(form.gst || 0) }; setExpenses((p) => (f.id ? p.map((x) => (x.id === f.id ? f : x)) : [fresh(f), ...p])); setForm(null); }}>
            <Fields value={form} onChange={setForm} fields={[
              { k: 'date', label: 'Date', type: 'date' }, { k: 'head', label: 'Expense head', options: HEADS }, { k: 'vendor', label: 'Paid to' }, { k: 'billNo', label: 'Bill no.' },
              { k: 'amount', label: 'Amount incl. GST (₹)', type: 'number', required: true }, { k: 'gst', label: 'GST in it (₹)', type: 'number' },
              { k: 'mode', label: 'Paid by', options: [...MODES, 'Bank transfer', 'Cheque'] }, { k: 'status', label: 'Status', options: ['Paid', 'Unpaid'] }, { k: 'notes', label: 'Notes', full: true },
            ]} />
          </form>
        </Modal>
      )}
    </Page>
  );
}
