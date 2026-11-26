import React, { useState } from 'react';
import { Plus, Printer, PackageCheck, Trash2 } from 'lucide-react';
import { doc, increment, updateDoc } from 'firebase/firestore';
import { db, tenant } from '../../firebase';
import { todayYmd } from '../../hms';
import { Modal, Tabs, inr } from '../hms/common';
import { Alerts, Empty, Fields, Page, Stats, badgeFor, esc, fresh, printPage, useSuite } from './kit';

// storeItems/{id}      {name, code, category, unit, store, stock, reorderLevel, rate, gstRate, expiry, batch}
// indents/{id}         {indentNo, department, requestedBy, lines: [{itemId, name, qty}], status: Requested | Approved | Issued | Rejected}
// purchaseOrders/{id}  {poNo, vendorId, vendorName, lines: [{itemId, name, qty, rate, gstRate}], total, status: Draft | Approved | Received | Cancelled, grnNo, invoiceNo}
// vendors/{id}         {name, gstin, phone, email, address, category, paymentTerms}
const CATS = ['Consumables', 'Surgical', 'Implants', 'Lab reagents', 'Linen', 'Housekeeping', 'Stationery', 'Kitchen', 'IT', 'Other'];
const STORES = ['Main store', 'OT store', 'ICU store', 'Ward store', 'Lab store', 'CSSD'];
const DEPTS = ['OPD', 'Emergency', 'ICU', 'OT', 'Ward', 'Laboratory', 'Radiology', 'Pharmacy', 'Housekeeping', 'Kitchen', 'Administration'];
const lineTotal = (l) => Number(l.qty || 0) * Number(l.rate || 0) * (1 + Number(l.gstRate || 0) / 100);
// Stock moves use increment() so two desks issuing at once never overwrite each other.
const move = (itemId, qty) => updateDoc(doc(db, 'storeItems', itemId), { stock: increment(qty), updatedBy: tenant.uid });

function Lines({ lines, onChange, items, priced }) {
  return (
    <>
      <div className="table-container"><table className="table-list">
        <thead><tr><th>Item</th><th>Qty</th>{priced && <><th>Rate</th><th>GST %</th><th>Amount</th></>}<th /></tr></thead>
        <tbody>{lines.map((l, i) => {
          const set = (k, v) => onChange(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
          return (
            <tr key={i}>
              <td><select className="form-input" aria-label="Item" value={l.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); onChange(lines.map((x, j) => (j === i ? { ...x, itemId: it.id, name: it.name, rate: it.rate ?? 0, gstRate: it.gstRate ?? 12 } : x))); }}>
                {items.map((it) => <option key={it.id} value={it.id}>{it.name} · stock {it.stock ?? 0} {it.unit}</option>)}</select></td>
              <td><input className="form-input" aria-label="Quantity" type="number" min="1" style={{ width: 90 }} value={l.qty} onChange={(e) => set('qty', Number(e.target.value))} /></td>
              {priced && <><td><input className="form-input" aria-label="Rate" type="number" style={{ width: 100 }} value={l.rate} onChange={(e) => set('rate', Number(e.target.value))} /></td>
                <td><input className="form-input" aria-label="GST" type="number" style={{ width: 70 }} value={l.gstRate} onChange={(e) => set('gstRate', Number(e.target.value))} /></td><td>{inr(lineTotal(l))}</td></>}
              <td><button type="button" className="btn-icon" aria-label="Remove" onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <button type="button" className="btn btn-secondary" disabled={!items.length} onClick={() => onChange([...lines, { itemId: items[0].id, name: items[0].name, qty: 1, rate: items[0].rate ?? 0, gstRate: items[0].gstRate ?? 12 }])}><Plus size={14} /> Add item</button>
    </>
  );
}

/** General stores and purchase: item master by store, department indents and issues, purchase orders with goods receipt, vendors, reorder and expiry alerts. */
export default function Stores({ canEdit = true }) {
  const [items, setItems] = useSuite('storeItems', 3000);
  const [indents, setIndents] = useSuite('indents', 1000);
  const [pos, setPos] = useSuite('purchaseOrders', 1000);
  const [vendors, setVendors] = useSuite('vendors', 1000);
  const [tab, setTab] = useState('Stock');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const low = items.filter((i) => Number(i.stock || 0) <= Number(i.reorderLevel || 0));
  const soon = new Date(Date.now() + 60 * 86_400_000).toLocaleDateString('en-CA');
  const expiring = items.filter((i) => i.expiry && i.expiry <= soon && Number(i.stock) > 0);
  const run = (fn) => Promise.resolve(fn()).catch((e) => setError(e.message));
  const seq = (list, prefix) => `${prefix}-${todayYmd().replace(/-/g, '').slice(2, 6)}-${String(list.length + 1).padStart(4, '0')}`;

  const issue = (ind) => run(async () => {
    for (const l of ind.lines) {
      const it = items.find((x) => x.id === l.itemId);
      if (!it || Number(it.stock || 0) < l.qty) throw new Error(`Not enough ${l.name} in stock (${it?.stock ?? 0})`);
    }
    for (const l of ind.lines) await move(l.itemId, -l.qty);
    setIndents((prev) => prev.map((x) => (x.id === ind.id ? { ...x, status: 'Issued', issuedOn: todayYmd() } : x)));
  });
  const receive = (po) => run(async () => {
    const grn = prompt('Supplier invoice no. for this goods receipt?');
    if (grn === null) return;
    for (const l of po.lines) await move(l.itemId, l.qty);
    setPos((prev) => prev.map((x) => (x.id === po.id ? { ...x, status: 'Received', grnNo: seq(pos.filter((p) => p.grnNo), 'GRN'), invoiceNo: grn, receivedOn: todayYmd() } : x)));
  });
  const reorderPo = () => setForm({ kind: 'po', vendorId: vendors[0]?.id ?? '', lines: low.map((i) => ({ itemId: i.id, name: i.name, qty: Math.max(1, Number(i.reorderLevel || 0) * 2 - Number(i.stock || 0)), rate: i.rate ?? 0, gstRate: i.gstRate ?? 12 })) });
  const printPo = (p) => printPage(`Purchase order ${p.poNo}`, `<p>To: <b>${esc(p.vendorName)}</b> · Date ${esc(p.date)}</p><table><tr><th>Item</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr>
    ${p.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${l.rate}</td><td>${l.gstRate}%</td><td>${lineTotal(l).toFixed(2)}</td></tr>`).join('')}
    <tr><th colspan="4">Total</th><th>${Number(p.total).toFixed(2)}</th></tr></table><div class="sign">Authorised signatory</div>`);

  const save = (e) => {
    e.preventDefault();
    const { kind, ...f } = form;
    if (kind === 'item') setItems((prev) => (f.id ? prev.map((x) => (x.id === f.id ? f : x)) : [fresh({ ...f, stock: Number(f.stock || 0) }), ...prev]));
    if (kind === 'vendor') setVendors((prev) => (f.id ? prev.map((x) => (x.id === f.id ? f : x)) : [fresh(f), ...prev]));
    if (kind === 'indent') setIndents((prev) => [fresh({ ...f, indentNo: seq(indents, 'IND'), date: todayYmd(), requestedBy: tenant.profile?.name ?? '', status: 'Requested' }), ...prev]);
    if (kind === 'po') {
      const v = vendors.find((x) => x.id === f.vendorId);
      setPos((prev) => [fresh({ ...f, vendorName: v?.name ?? '', poNo: seq(pos, 'PO'), date: todayYmd(), total: Math.round(f.lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100, status: 'Draft' }), ...prev]);
    }
    setForm(null);
  };

  return (
    <Page title="Stores & Purchase" desc="Non-drug inventory by store, department indents and issues, purchase orders with goods receipt, vendors, and reorder and expiry alerts."
      actions={canEdit && <>
        <button className="btn btn-secondary" onClick={() => setForm({ kind: 'indent', department: DEPTS[0], lines: [] })}>New indent</button>
        <button className="btn btn-secondary" disabled={!vendors.length} onClick={() => setForm({ kind: 'po', vendorId: vendors[0]?.id, lines: [] })}>New PO</button>
        <button className="btn btn-primary" onClick={() => setForm({ kind: 'item', category: CATS[0], store: STORES[0], unit: 'Nos', stock: 0, reorderLevel: 10, gstRate: 12 })}><Plus size={16} /> Add item</button>
      </>}>
      <Stats items={[
        ['Stock value', inr(items.reduce((s, i) => s + Number(i.stock || 0) * Number(i.rate || 0), 0))],
        ['Below reorder level', low.length, low.length ? 'warning' : undefined],
        ['Pending indents', indents.filter((i) => ['Requested', 'Approved'].includes(i.status)).length],
        ['Open purchase orders', pos.filter((p) => ['Draft', 'Approved'].includes(p.status)).length],
      ]} />
      <Alerts items={[
        ...(low.length ? [<span key="r">{low.length} item(s) at or below reorder level: {low.slice(0, 6).map((i) => i.name).join(', ')}{low.length > 6 ? '…' : ''} {canEdit && vendors.length > 0 && <button className="btn btn-secondary" onClick={reorderPo}>Draft PO for these</button>}</span>] : []),
        ...expiring.map((i) => `${i.name} (${i.store}): expires ${i.expiry}, ${i.stock} ${i.unit} in stock`),
      ]} />
      {error && <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>{error}</div>}
      <Tabs tabs={['Stock', 'Indents', 'Purchase orders', 'Vendors']} value={tab} onChange={setTab} />

      {tab === 'Stock' && <div className="card">
        <input className="form-input" placeholder="Search item, store, category" aria-label="Search stock" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
        <div className="table-container"><table className="table-list">
          <thead><tr><th>Item</th><th>Store</th><th>Stock</th><th>Reorder at</th><th>Rate</th><th>Expiry</th><th /></tr></thead>
          <tbody>{items.filter((i) => !q || `${i.name} ${i.store} ${i.category} ${i.code ?? ''}`.toLowerCase().includes(q.toLowerCase())).map((i) => (
            <tr key={i.id}><td><strong>{i.name}</strong><br /><small>{i.code} · {i.category}</small></td><td>{i.store}</td>
              <td style={{ color: Number(i.stock) <= Number(i.reorderLevel) ? 'var(--danger)' : undefined, fontWeight: 600 }}>{i.stock} {i.unit}</td>
              <td>{i.reorderLevel}</td><td>{inr(i.rate)}</td><td>{i.expiry || '—'}</td>
              <td>{canEdit && <button className="btn btn-secondary" onClick={() => setForm({ kind: 'item', ...i })}>Edit</button>}</td></tr>
          ))}{!items.length && <Empty cols={7} />}</tbody>
        </table></div>
      </div>}

      {tab === 'Indents' && <div className="card"><div className="table-container"><table className="table-list">
        <thead><tr><th>Indent</th><th>Department</th><th>Items</th><th>Status</th><th /></tr></thead>
        <tbody>{indents.map((d) => (
          <tr key={d.id}><td><strong>{d.indentNo}</strong><br /><small>{d.date} · {d.requestedBy}</small></td><td>{d.department}</td>
            <td><small>{d.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}</small></td><td><span className={`badge ${badgeFor(d.status)}`}>{d.status}</span></td>
            <td>{canEdit && d.status === 'Requested' && <><button className="btn btn-primary" onClick={() => setIndents((p) => p.map((x) => (x.id === d.id ? { ...x, status: 'Approved' } : x)))}>Approve</button>{' '}
              <button className="btn btn-secondary" onClick={() => setIndents((p) => p.map((x) => (x.id === d.id ? { ...x, status: 'Rejected' } : x)))}>Reject</button></>}
              {canEdit && d.status === 'Approved' && <button className="btn btn-primary" onClick={() => issue(d)}>Issue stock</button>}</td></tr>
        ))}{!indents.length && <Empty cols={5} />}</tbody>
      </table></div></div>}

      {tab === 'Purchase orders' && <div className="card"><div className="table-container"><table className="table-list">
        <thead><tr><th>PO</th><th>Vendor</th><th>Items</th><th>Total</th><th>Status</th><th /></tr></thead>
        <tbody>{pos.map((p) => (
          <tr key={p.id}><td><strong>{p.poNo}</strong><br /><small>{p.date}{p.grnNo && ` · ${p.grnNo}`}</small></td><td>{p.vendorName}</td>
            <td><small>{p.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}</small></td><td>{inr(p.total)}</td><td><span className={`badge ${badgeFor(p.status)}`}>{p.status}</span></td>
            <td style={{ whiteSpace: 'nowrap' }}>{canEdit && p.status === 'Draft' && <button className="btn btn-primary" onClick={() => setPos((x) => x.map((y) => (y.id === p.id ? { ...y, status: 'Approved', approvedBy: tenant.profile?.name ?? '' } : y)))}>Approve</button>}
              {canEdit && p.status === 'Approved' && <button className="btn btn-primary" onClick={() => receive(p)}><PackageCheck size={14} /> Receive (GRN)</button>}
              <button className="btn-icon" aria-label="Print PO" onClick={() => printPo(p)}><Printer size={14} /></button></td></tr>
        ))}{!pos.length && <Empty cols={6} />}</tbody>
      </table></div></div>}

      {tab === 'Vendors' && <div className="card">
        {canEdit && <button className="btn btn-primary" style={{ marginBottom: 12 }} onClick={() => setForm({ kind: 'vendor', category: CATS[0], paymentTerms: '30 days' })}><Plus size={14} /> Add vendor</button>}
        <div className="table-container"><table className="table-list">
          <thead><tr><th>Vendor</th><th>GSTIN</th><th>Contact</th><th>Category</th><th>Purchases</th><th /></tr></thead>
          <tbody>{vendors.map((v) => (
            <tr key={v.id}><td><strong>{v.name}</strong><br /><small>{v.address}</small></td><td>{v.gstin}</td><td>{v.phone}<br /><small>{v.email}</small></td><td>{v.category}</td>
              <td>{inr(pos.filter((p) => p.vendorId === v.id && p.status === 'Received').reduce((s, p) => s + Number(p.total || 0), 0))}</td>
              <td>{canEdit && <button className="btn btn-secondary" onClick={() => setForm({ kind: 'vendor', ...v })}>Edit</button>}</td></tr>
          ))}{!vendors.length && <Empty cols={6} />}</tbody>
        </table></div>
      </div>}

      {form && (
        <Modal wide={form.kind === 'po' || form.kind === 'indent'} title={{ item: 'Store item', vendor: 'Vendor', indent: 'Department indent', po: 'Purchase order' }[form.kind]} onClose={() => setForm(null)}
          footer={<button className="btn btn-primary" type="submit" form="store-form" disabled={(form.kind === 'po' || form.kind === 'indent') && !form.lines.length}>Save</button>}>
          <form id="store-form" onSubmit={save}>
            {form.kind === 'item' && <Fields value={form} onChange={setForm} fields={[
              { k: 'name', label: 'Item name', required: true }, { k: 'code', label: 'Item code' }, { k: 'category', label: 'Category', options: CATS }, { k: 'store', label: 'Store', options: STORES },
              { k: 'unit', label: 'Unit' }, ...(form.id ? [] : [{ k: 'stock', label: 'Opening stock', type: 'number' }]), { k: 'reorderLevel', label: 'Reorder level', type: 'number' },
              { k: 'rate', label: 'Rate (₹)', type: 'number' }, { k: 'gstRate', label: 'GST %', type: 'number' }, { k: 'batch', label: 'Batch' }, { k: 'expiry', label: 'Expiry', type: 'date' },
            ]} />}
            {form.kind === 'vendor' && <Fields value={form} onChange={setForm} fields={[
              { k: 'name', label: 'Vendor name', required: true }, { k: 'gstin', label: 'GSTIN' }, { k: 'phone', label: 'Phone' }, { k: 'email', label: 'Email', type: 'email' },
              { k: 'category', label: 'Supplies', options: CATS }, { k: 'paymentTerms', label: 'Payment terms' }, { k: 'address', label: 'Address', full: true },
            ]} />}
            {form.kind === 'indent' && <><Fields value={form} onChange={setForm} fields={[{ k: 'department', label: 'Department', options: DEPTS }]} />
              <Lines lines={form.lines} items={items} onChange={(lines) => setForm({ ...form, lines })} /></>}
            {form.kind === 'po' && <><Fields value={form} onChange={setForm} fields={[{ k: 'vendorId', label: 'Vendor', options: vendors.map((v) => ({ value: v.id, label: v.name })) }]} />
              <Lines priced lines={form.lines} items={items} onChange={(lines) => setForm({ ...form, lines })} />
              <p style={{ textAlign: 'right' }}>Total <b>{inr(form.lines.reduce((s, l) => s + lineTotal(l), 0))}</b></p></>}
          </form>
        </Modal>
      )}
    </Page>
  );
}
