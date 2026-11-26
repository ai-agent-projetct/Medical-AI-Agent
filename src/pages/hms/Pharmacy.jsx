import React, { useState } from 'react';
import { AlertTriangle, Package, Truck } from 'lucide-react';
import { getDocs } from 'firebase/firestore';
import { col, keyOf, limit, orderBy, query, saveDrug, savePurchase, saveSupplier, searchByKey, thisMonth, todayYmd, useQueryDocs, where, scoped } from '../../hms';
import { purchaseLinesFromCsv } from '../../csv';
import { inr, Modal, SearchBox, Tabs } from './common';

const EMPTY_DRUG = { name: '', composition: '', manufacturer: '', hsn: '3004', gstRate: 12, mrp: '', unit: 'Strip', reorderLevel: 10, rack: '', rx: false };
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Reads a supplier CSV and resolves item names against the item master (exact name, any case). */
async function linesFromFile(file) {
  const text = await file.text();
  const names = new Set();
  purchaseLinesFromCsv(text, (n) => { names.add(keyOf(n)); return null; });
  const byKey = new Map();
  const keys = [...names].filter(Boolean);
  for (let i = 0; i < keys.length; i += 30) {
    const snap = await getDocs(scoped('drugs', where('nameKey', 'in', keys.slice(i, i + 30))));
    snap.docs.forEach((d) => byKey.set(d.data().nameKey, { id: d.id, name: d.data().name }));
  }
  return purchaseLinesFromCsv(text, (n) => byKey.get(keyOf(n)) ?? null);
}

/** Pharmacy inventory: item master, batch stock with expiry, purchases (GRN), suppliers, alerts. */
export default function Pharmacy({ canEdit }) {
  const [tab, setTab] = useState('Stock');
  const [term, setTerm] = useState('');
  const [drug, setDrug] = useState(null);
  const [supplier, setSupplier] = useState(null);
  const [purchase, setPurchase] = useState(null);
  const [error, setError] = useState('');
  const month = thisMonth();

  const stock = useQueryDocs(() => tab !== 'Stock' ? null : term
    ? scoped('drugs', orderBy('nameKey'), where('nameKey', '>=', term.toLowerCase()), where('nameKey', '<=', `${term.toLowerCase()}`), limit(50))
    : scoped('drugs', orderBy('nameKey'), limit(50)), [tab, term]);
  const expiring = useQueryDocs(() => tab !== 'Alerts' ? null
    : scoped('stockBatches', where('expiry', '<=', addMonths(month, 3)), orderBy('expiry'), limit(300)), [tab]);
  const low = useQueryDocs(() => tab !== 'Alerts' ? null : scoped('drugs', orderBy('stock'), limit(200)), [tab]);
  const suppliers = useQueryDocs(() => tab !== 'Suppliers' ? null : scoped('suppliers', orderBy('nameKey'), limit(200)), [tab]);
  const purchases = useQueryDocs(() => tab !== 'Purchases' ? null : scoped('purchases', orderBy('createdAt', 'desc'), limit(50)), [tab]);

  const run = (fn, done) => fn().then(done, (e) => setError(e.message));

  return (
    <div className="page-container">
      <div className="page-header">
        <div><h1>Pharmacy &amp; Inventory</h1><p>Batch-wise stock with expiry, MRP and GST. Sales deduct stock first-expiry-first-out; purchases add batches and supplier dues.</p></div>
        {canEdit && <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setDrug({ ...EMPTY_DRUG })}><Package size={14} /> New item</button>
          <button className="btn btn-primary" onClick={() => setPurchase({ supplier: null, billNo: '', date: todayYmd(), lines: [], paid: 0 })}><Truck size={14} /> Purchase entry</button>
        </div>}
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <Tabs tabs={['Stock', 'Alerts', 'Purchases', 'Suppliers']} value={tab} onChange={setTab} />

      {tab === 'Stock' && (
        <div className="card">
          <input className="form-input" placeholder="Search item…" value={term} onChange={(e) => setTerm(e.target.value)} style={{ marginBottom: 12 }} />
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Item</th><th>Composition</th><th>MRP</th><th>GST</th><th>Stock</th><th>Rack</th></tr></thead>
            <tbody>{stock.docs.map((d) => (
              <tr key={d.id} onClick={() => canEdit && setDrug(d)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                <td><strong>{d.name}</strong> {d.rx && <span className="badge badge-warning">Rx</span>}<br /><small>{d.manufacturer}</small></td>
                <td>{d.composition}</td><td>{inr(d.mrp)}</td><td>{d.gstRate}%</td>
                <td><span className={`badge ${d.stock <= d.reorderLevel ? 'badge-danger' : 'badge-success'}`}>{d.stock ?? 0} {d.unit}</span></td><td>{d.rack}</td>
              </tr>))}
              {!stock.loading && stock.docs.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No items</td></tr>}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'Alerts' && (
        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div className="card"><h3><AlertTriangle size={16} /> Expiring within 3 months</h3>
            <div className="table-container"><table className="table-list"><thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th>Qty</th></tr></thead>
              <tbody>{expiring.docs.filter((b) => b.qty > 0).map((b) => (
                <tr key={b.id}><td>{b.drugName}</td><td>{b.batch}</td>
                  <td><span className={`badge ${b.expiry < month ? 'badge-danger' : 'badge-warning'}`}>{b.expiry}{b.expiry < month ? ' · expired' : ''}</span></td><td>{b.qty}</td></tr>))}
                {!expiring.loading && expiring.docs.length === 0 && <tr><td colSpan={4}>Nothing expiring soon</td></tr>}
              </tbody></table></div></div>
          <div className="card"><h3><AlertTriangle size={16} /> Low stock (at or below reorder level)</h3>
            <div className="table-container"><table className="table-list"><thead><tr><th>Item</th><th>Stock</th><th>Reorder at</th></tr></thead>
              <tbody>{low.docs.filter((d) => (d.stock ?? 0) <= (d.reorderLevel ?? 0)).map((d) => (
                <tr key={d.id}><td>{d.name}</td><td>{d.stock ?? 0}</td><td>{d.reorderLevel}</td></tr>))}
              </tbody></table></div></div>
        </div>
      )}

      {tab === 'Purchases' && (
        <div className="card"><div className="table-container"><table className="table-list">
          <thead><tr><th>Date</th><th>Supplier</th><th>Bill no.</th><th>Items</th><th>Total</th><th>Due</th></tr></thead>
          <tbody>{purchases.docs.map((p) => <tr key={p.id}><td>{p.date}</td><td>{p.supplierName}</td><td>{p.billNo}</td><td>{p.lines.length}</td><td>{inr(p.total)}</td><td>{inr(p.due)}</td></tr>)}</tbody>
        </table></div></div>
      )}

      {tab === 'Suppliers' && (
        <div className="card">
          {canEdit && <button className="btn btn-secondary" style={{ marginBottom: 12 }} onClick={() => setSupplier({ name: '', gstin: '', phone: '', address: '' })}>Add supplier</button>}
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Supplier</th><th>GSTIN</th><th>Phone</th><th>Payable</th></tr></thead>
            <tbody>{suppliers.docs.map((s) => <tr key={s.id} onClick={() => canEdit && setSupplier(s)} style={{ cursor: canEdit ? 'pointer' : 'default' }}><td><strong>{s.name}</strong><br /><small>{s.address}</small></td><td>{s.gstin}</td><td>{s.phone}</td><td>{inr(s.due)}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}

      {drug && (
        <Modal title={drug.id ? 'Edit item' : 'New item'} onClose={() => setDrug(null)}>
          <form onSubmit={(e) => { e.preventDefault(); const { id, stock: _s, nameKey: _k, ...d } = drug; run(() => saveDrug(id, d), () => setDrug(null)); }}>
            <div className="form-group"><label>Name (brand + strength)</label><input className="form-input" required value={drug.name} onChange={(e) => setDrug({ ...drug, name: e.target.value })} /></div>
            <div className="form-input-row">
              <div className="form-group"><label>Composition / salt</label><input className="form-input" value={drug.composition} onChange={(e) => setDrug({ ...drug, composition: e.target.value })} /></div>
              <div className="form-group"><label>Manufacturer</label><input className="form-input" value={drug.manufacturer} onChange={(e) => setDrug({ ...drug, manufacturer: e.target.value })} /></div>
            </div>
            <div className="form-input-row">
              <div className="form-group"><label>MRP (₹, incl. GST)</label><input className="form-input" type="number" step="0.01" min="0" required value={drug.mrp} onChange={(e) => setDrug({ ...drug, mrp: e.target.value })} /></div>
              <div className="form-group"><label>GST %</label><select className="form-input" value={drug.gstRate} onChange={(e) => setDrug({ ...drug, gstRate: e.target.value })}>{[0, 5, 12, 18].map((g) => <option key={g} value={g}>{g}%</option>)}</select></div>
              <div className="form-group"><label>HSN</label><input className="form-input" value={drug.hsn} onChange={(e) => setDrug({ ...drug, hsn: e.target.value })} /></div>
            </div>
            <div className="form-input-row">
              <div className="form-group"><label>Unit</label><input className="form-input" value={drug.unit} onChange={(e) => setDrug({ ...drug, unit: e.target.value })} /></div>
              <div className="form-group"><label>Reorder level</label><input className="form-input" type="number" min="0" value={drug.reorderLevel} onChange={(e) => setDrug({ ...drug, reorderLevel: e.target.value })} /></div>
              <div className="form-group"><label>Rack</label><input className="form-input" value={drug.rack} onChange={(e) => setDrug({ ...drug, rack: e.target.value })} /></div>
            </div>
            <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={!!drug.rx} onChange={(e) => setDrug({ ...drug, rx: e.target.checked })} /> Prescription only (Schedule H/H1/X)</label>
            <div style={{ textAlign: 'right' }}><button className="btn btn-primary">Save item</button></div>
          </form>
        </Modal>
      )}

      {supplier && (
        <Modal title={supplier.id ? 'Edit supplier' : 'Add supplier'} onClose={() => setSupplier(null)}>
          <form onSubmit={(e) => { e.preventDefault(); const { id, nameKey: _k, due: _d, ...s } = supplier; run(() => saveSupplier(id, s), () => setSupplier(null)); }}>
            {['name', 'gstin', 'phone', 'address'].map((f) => (
              <div className="form-group" key={f}><label>{f === 'gstin' ? 'GSTIN' : f[0].toUpperCase() + f.slice(1)}</label>
                <input className="form-input" required={f === 'name'} value={supplier[f] ?? ''} onChange={(e) => setSupplier({ ...supplier, [f]: e.target.value })} /></div>
            ))}
            <div style={{ textAlign: 'right' }}><button className="btn btn-primary">Save supplier</button></div>
          </form>
        </Modal>
      )}

      {purchase && (
        <Modal title="Purchase entry (GRN)" wide onClose={() => setPurchase(null)}
          footer={<button className="btn btn-primary" disabled={!purchase.supplier || !purchase.lines.length || !purchase.billNo || purchase.lines.some((l) => !l.batch || !l.rate)}
            onClick={() => run(() => savePurchase(purchase), () => setPurchase(null))}>Save purchase · {inr(purchase.lines.reduce((s, l) => s + l.qty * l.rate, 0))}</button>}>
          <div className="form-input-row">
            <div className="form-group" style={{ flex: 2 }}><label>Supplier</label>
              {purchase.supplier ? <div><strong>{purchase.supplier.name}</strong> <button className="btn btn-secondary" onClick={() => setPurchase({ ...purchase, supplier: null })}>Change</button></div>
                : <SearchBox placeholder="Search supplier" search={(q) => searchByKey('suppliers', q)} onPick={(s) => setPurchase({ ...purchase, supplier: s })} render={(s) => s.name} />}
            </div>
            <div className="form-group"><label>Supplier bill no.</label><input className="form-input" value={purchase.billNo} onChange={(e) => setPurchase({ ...purchase, billNo: e.target.value })} /></div>
            <div className="form-group"><label>Date</label><input className="form-input" type="date" value={purchase.date} onChange={(e) => setPurchase({ ...purchase, date: e.target.value })} /></div>
          </div>
          <div className="form-group">
            <label>Import supplier CSV (columns: item, batch, expiry, qty, free, rate, mrp)</label>
            <input type="file" accept=".csv,text/csv" className="form-input" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const { lines, errors } = await linesFromFile(file);
              setPurchase((p) => ({ ...p, lines: [...p.lines, ...lines], csvErrors: errors }));
              e.target.value = '';
            }} />
            {purchase.csvErrors?.length > 0 && (
              <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{purchase.csvErrors.length} row(s) skipped:
                <ul>{purchase.csvErrors.slice(0, 8).map((er) => <li key={er}>{er}</li>)}</ul></div>
            )}
          </div>
          <div className="form-group"><label>Add item</label>
            <SearchBox placeholder="Search item" search={(q) => searchByKey('drugs', q)} render={(d) => `${d.name} · MRP ${inr(d.mrp)}`}
              onPick={(d) => setPurchase({ ...purchase, lines: [...purchase.lines, { drugId: d.id, name: d.name, batch: '', expiry: addMonths(month, 24), qty: 1, free: 0, rate: '', mrp: d.mrp }] })} />
          </div>
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Free</th><th>Purchase rate</th><th>MRP</th></tr></thead>
            <tbody>{purchase.lines.map((l, i) => {
              const set = (k, v) => setPurchase({ ...purchase, lines: purchase.lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
              return (
                <tr key={i}><td>{l.name}</td>
                  <td><input className="form-input" style={{ width: 90 }} value={l.batch} onChange={(e) => set('batch', e.target.value.toUpperCase())} aria-label="Batch" /></td>
                  <td><input className="form-input" type="month" value={l.expiry} onChange={(e) => set('expiry', e.target.value)} aria-label="Expiry" /></td>
                  <td><input className="form-input" style={{ width: 70 }} type="number" min="1" value={l.qty} onChange={(e) => set('qty', Number(e.target.value))} aria-label="Quantity" /></td>
                  <td><input className="form-input" style={{ width: 60 }} type="number" min="0" value={l.free} onChange={(e) => set('free', Number(e.target.value))} aria-label="Free quantity" /></td>
                  <td><input className="form-input" style={{ width: 90 }} type="number" step="0.01" min="0" value={l.rate} onChange={(e) => set('rate', Number(e.target.value))} aria-label="Purchase rate" /></td>
                  <td><input className="form-input" style={{ width: 90 }} type="number" step="0.01" min="0" value={l.mrp} onChange={(e) => set('mrp', Number(e.target.value))} aria-label="MRP" /></td>
                </tr>);
            })}</tbody>
          </table></div>
          <div className="form-group" style={{ maxWidth: 200 }}><label>Paid now (₹)</label><input className="form-input" type="number" min="0" value={purchase.paid} onChange={(e) => setPurchase({ ...purchase, paid: e.target.value })} /></div>
          {purchase.lines.some((l) => !l.batch || !l.rate) && <small style={{ color: 'var(--warning)' }}>Every line needs a batch and purchase rate.</small>}
        </Modal>
      )}
    </div>
  );
}
