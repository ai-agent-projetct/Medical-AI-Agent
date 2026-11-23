import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Printer, MessageCircle, Trash2 } from 'lucide-react';
import { computeBill } from '../../billing';
import { addPayment, cancelInvoice, invoiceWhatsApp, searchByKey, searchPatients } from '../../hms';

const env = import.meta.env;
export const HOSPITAL = {
  name: env.VITE_HOSPITAL_NAME || 'ABC Hospital',
  address: env.VITE_HOSPITAL_ADDRESS || '',
  gstin: env.VITE_HOSPITAL_GSTIN || '',
  phone: env.VITE_HOSPITAL_PHONE || '',
};
export const MODES = ['Cash', 'UPI', 'Card', 'Insurance'];
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Billing desk id (C1, PHARM…) for invoice series; remembered per browser. */
export function useDesk(fallback) {
  const [desk, setDesk] = useState(() => { try { return localStorage.getItem('billingDesk') || fallback; } catch { return fallback; } });
  const save = (d) => { setDesk(d); try { localStorage.setItem('billingDesk', d); } catch { /* private mode */ } };
  return [desk, save];
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-overlay" role="dialog" aria-label={title}>
      <div className="modal-content" style={wide ? { maxWidth: 980, width: '96vw' } : undefined}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs-navigation" style={{ marginBottom: 16 }}>
      {tabs.map((t) => (
        <button key={t} className={`tab-btn ${value === t ? 'active' : ''}`} onClick={() => onChange(t)}>{t}</button>
      ))}
    </div>
  );
}

/** Debounced async search box with a result dropdown. */
export function SearchBox({ placeholder, search, render, onPick, autoFocus }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => search(q).then(setResults, (e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={16} />
        <input className="form-input" autoFocus={autoFocus} value={q} placeholder={placeholder} onChange={(e) => { setErr(''); setQ(e.target.value); }} />
      </div>
      {err && <small style={{ color: 'var(--danger)' }}>{err}</small>}
      {results.length > 0 && (
        <div className="card" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, padding: 4, maxHeight: 280, overflowY: 'auto' }}>
          {results.map((r) => (
            <button key={r.id} type="button" className="btn btn-secondary" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
              onClick={() => { onPick(r); setQ(''); setResults([]); }}>
              {render(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PatientPicker({ value, onChange, allowWalkIn }) {
  const [walkIn, setWalkIn] = useState({ name: '', phone: '' });
  if (value) {
    return (
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
        <div><strong>{value.name}</strong> <small>{value.phone}</small> {!value.id && <span className="badge badge-secondary">Walk-in</span>}</div>
        <button type="button" className="btn btn-secondary" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div>
      <SearchBox placeholder="Search patient by name or phone" search={searchPatients} onPick={onChange}
        render={(p) => <><strong>{p.name}</strong> · {p.phone} {p.gender ? `· ${p.gender}` : ''}</>} />
      {allowWalkIn && (
        <div className="form-input-row" style={{ marginTop: 8 }}>
          <input className="form-input" placeholder="Walk-in name" value={walkIn.name} onChange={(e) => setWalkIn({ ...walkIn, name: e.target.value })} />
          <input className="form-input" placeholder="Phone" value={walkIn.phone} onChange={(e) => setWalkIn({ ...walkIn, phone: e.target.value })} />
          <button type="button" className="btn btn-secondary" disabled={walkIn.name.trim().length < 2} onClick={() => onChange({ ...walkIn, id: null })}>Use walk-in</button>
        </div>
      )}
    </div>
  );
}

/**
 * Bill composer: patient, service lines (charge master) and medicine lines (pharmacy, FEFO from stock),
 * live GST totals, first payment. `onSubmit({patient, lines, payment})` does the write.
 */
export function BillComposer({ kind, initialLines = [], patient: fixedPatient, onSubmit, submitLabel = 'Save bill', allowWalkIn, advance = 0 }) {
  const [patient, setPatient] = useState(fixedPatient ?? null);
  const [lines, setLines] = useState(initialLines);
  const [pay, setPay] = useState({ amount: '', mode: 'Cash', ref: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bill = useMemo(() => computeBill(lines), [lines]);
  const due = Math.max(0, bill.total - advance);
  const set = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const addService = (s) => setLines((ls) => [...ls, { name: s.name, category: s.category, sac: s.sac ?? '', qty: 1, rate: s.rate, gstRate: s.gstRate ?? 0, discountPct: 0 }]);
  const addDrug = (d) => {
    if ((d.stock ?? 0) <= 0) return setError(`${d.name} is out of stock`);
    setLines((ls) => [...ls, { name: d.name, drugId: d.id, hsn: d.hsn ?? '', qty: 1, rate: d.mrp, gstRate: d.gstRate ?? 12, discountPct: 0, rx: !!d.rx }]);
  };

  const submit = async () => {
    setError('');
    if (!patient) return setError('Choose a patient');
    if (!lines.length) return setError('Add at least one item');
    setBusy(true);
    try {
      await onSubmit({ patient, lines, payment: pay.amount > 0 ? { ...pay, amount: Number(pay.amount) } : null });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!fixedPatient && <div className="form-group"><label>Patient</label><PatientPicker value={patient} onChange={setPatient} allowWalkIn={allowWalkIn} /></div>}
      <div className="form-input-row">
        {kind !== 'PHARMACY' && (
          <div className="form-group" style={{ flex: 1 }}>
            <label>Add service / procedure</label>
            <SearchBox placeholder="Consultation, X-ray, dressing…" search={(q) => searchByKey('services', q)} onPick={addService}
              render={(s) => <>{s.name} · {inr(s.rate)} <small>{s.category}</small></>} />
          </div>
        )}
        <div className="form-group" style={{ flex: 1 }}>
          <label>Add medicine / consumable</label>
          <SearchBox placeholder="Medicine name" search={(q) => searchByKey('drugs', q)} onPick={addDrug}
            render={(d) => <>{d.name} · MRP {inr(d.mrp)} · <small>stock {d.stock ?? 0}{d.rx ? ' · Rx' : ''}</small></>} />
        </div>
      </div>

      <div className="table-container">
        <table className="table-list">
          <thead><tr><th>Item</th><th>Qty</th><th>Rate (incl. GST)</th><th>Disc %</th><th>GST %</th><th>Amount</th><th /></tr></thead>
          <tbody>
            {bill.lines.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No items yet</td></tr>}
            {bill.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.name}{l.rx && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Rx</span>}</td>
                <td><input className="form-input" style={{ width: 70 }} type="number" min="1" value={l.qty} onChange={(e) => set(i, 'qty', Math.max(1, Number(e.target.value)))} aria-label={`Quantity of ${l.name}`} /></td>
                <td><input className="form-input" style={{ width: 100 }} type="number" min="0" step="0.01" value={l.rate} disabled={!!l.drugId} onChange={(e) => set(i, 'rate', e.target.value)} aria-label={`Rate of ${l.name}`} /></td>
                <td><input className="form-input" style={{ width: 70 }} type="number" min="0" max="100" value={l.discountPct} onChange={(e) => set(i, 'discountPct', e.target.value)} aria-label={`Discount on ${l.name}`} /></td>
                <td>{l.gstRate}%</td>
                <td>{inr(l.amount)}</td>
                <td><button type="button" className="btn-icon" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 }}>
        <div className="form-input-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group"><label>Collect now (₹)</label>
            <input className="form-input" type="number" min="0" max={due} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <div className="form-group"><label>Mode</label>
            <select className="form-input" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div className="form-group"><label>Ref / UTR</label>
            <input className="form-input" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} /></div>
          <button type="button" className="btn btn-secondary" onClick={() => setPay({ ...pay, amount: due })}>Full {inr(due)}</button>
        </div>
        <table style={{ minWidth: 240 }}>
          <tbody>
            <tr><td>Gross</td><td style={{ textAlign: 'right' }}>{inr(bill.gross)}</td></tr>
            <tr><td>Discount</td><td style={{ textAlign: 'right' }}>− {inr(bill.discount)}</td></tr>
            <tr><td>Taxable value</td><td style={{ textAlign: 'right' }}>{inr(bill.taxable)}</td></tr>
            <tr><td>CGST + SGST</td><td style={{ textAlign: 'right' }}>{inr(bill.cgst)} + {inr(bill.sgst)}</td></tr>
            <tr><td>Round off</td><td style={{ textAlign: 'right' }}>{inr(bill.roundOff)}</td></tr>
            {advance > 0 && <tr><td>Advance paid</td><td style={{ textAlign: 'right' }}>− {inr(advance)}</td></tr>}
            <tr><td><strong>{advance > 0 ? 'Balance' : 'Total'}</strong></td><td style={{ textAlign: 'right' }}><strong>{inr(due)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div style={{ textAlign: 'right', marginTop: 12 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </div>
  );
}

/** Printable GST invoice in a new window. */
export function printInvoice(inv) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return alert('Allow pop-ups to print the invoice.');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = inv.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.picks ? `<br><small>Batch ${l.picks.map((p) => `${esc(p.batch)} (exp ${p.expiry})`).join(', ')}</small>` : ''}</td>
    <td>${esc(l.hsn || l.sac || '')}</td><td>${l.qty}</td><td>${Number(l.rate).toFixed(2)}</td><td>${l.discountPct || 0}%</td><td>${l.gstRate}%</td><td>${l.amount.toFixed(2)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
    <style>body{font:13px system-ui,sans-serif;margin:24px;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;text-align:left}
    .r{text-align:right}h1{margin:0;font-size:20px}.muted{color:#555}</style></head><body>
    <h1>${esc(HOSPITAL.name)}</h1><div class="muted">${esc(HOSPITAL.address)}${HOSPITAL.gstin ? ` · GSTIN ${esc(HOSPITAL.gstin)}` : ''}${HOSPITAL.phone ? ` · ${esc(HOSPITAL.phone)}` : ''}</div>
    <h2 style="font-size:16px">${inv.kind === 'PHARMACY' ? 'Pharmacy' : inv.kind} Tax Invoice ${inv.status === 'Cancelled' ? '(CANCELLED)' : ''}</h2>
    <p>No. <b>${esc(inv.number)}</b> · Date ${esc(inv.date)}<br>Patient: <b>${esc(inv.patientName)}</b> ${esc(inv.phone)}</p>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>Disc</th><th>GST</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <table style="width:320px;margin-left:auto;margin-top:12px">
    <tr><td>Taxable value</td><td class="r">${inv.taxable.toFixed(2)}</td></tr><tr><td>CGST</td><td class="r">${inv.cgst.toFixed(2)}</td></tr>
    <tr><td>SGST</td><td class="r">${inv.sgst.toFixed(2)}</td></tr><tr><td>Round off</td><td class="r">${inv.roundOff.toFixed(2)}</td></tr>
    <tr><td><b>Total</b></td><td class="r"><b>${inv.total.toFixed(2)}</b></td></tr><tr><td>Paid</td><td class="r">${inv.paid.toFixed(2)}</td></tr>
    <tr><td><b>Balance due</b></td><td class="r"><b>${inv.due.toFixed(2)}</b></td></tr></table>
    <p class="muted">Prices are inclusive of GST. Computer-generated invoice.</p><script>window.print()</script></body></html>`);
  w.document.close();
}

export function InvoiceModal({ inv, isAdmin, onClose }) {
  const [amount, setAmount] = useState(inv.due);
  const [mode, setMode] = useState('Cash');
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const wa = invoiceWhatsApp(inv, HOSPITAL.name);
  const run = (fn) => fn().then(onClose, (e) => setError(e.message));
  return (
    <Modal title={`Invoice ${inv.number}`} onClose={onClose} wide footer={<>
      <button className="btn btn-secondary" onClick={() => printInvoice(inv)}><Printer size={14} /> Print</button>
      {wa && <a className="btn btn-secondary" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
      {isAdmin && inv.status !== 'Cancelled' && (
        <button className="btn btn-danger" onClick={() => {
          const reason = prompt(`Reason for cancelling this invoice? Stock is restored${inv.paid > 0 ? ` and ₹${inv.paid} refunded by ${mode} (change the Mode field first if needed)` : ''}.`);
          if (reason) run(() => cancelInvoice(inv.id, reason, mode));
        }}>Cancel invoice</button>
      )}
    </>}>
      <p><strong>{inv.patientName}</strong> {inv.phone} · {inv.date} · <span className="badge badge-secondary">{inv.status}</span></p>
      <div className="table-container"><table className="table-list">
        <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr></thead>
        <tbody>{inv.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.qty}</td><td>{inr(l.rate)}</td><td>{l.gstRate}%</td><td>{inr(l.amount)}</td></tr>)}</tbody>
      </table></div>
      <p style={{ textAlign: 'right' }}>Total <strong>{inr(inv.total)}</strong> · Paid {inr(inv.paid)} · Due <strong>{inr(inv.due)}</strong></p>
      {inv.status !== 'Cancelled' && (inv.due > 0 || isAdmin) && (
        <div className="form-input-row" style={{ alignItems: 'flex-end' }}>
          {inv.due > 0 && <div className="form-group"><label>Receive (₹)</label><input className="form-input" type="number" min="0" max={inv.due} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>}
          <div className="form-group"><label>{inv.due > 0 ? 'Mode' : 'Refund mode (if cancelled)'}</label><select className="form-input" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
          {inv.due > 0 && <>
            <div className="form-group"><label>Ref / UTR</label><input className="form-input" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={() => run(() => addPayment(inv.id, amount, mode, ref))}>Record payment</button>
          </>}
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </Modal>
  );
}
