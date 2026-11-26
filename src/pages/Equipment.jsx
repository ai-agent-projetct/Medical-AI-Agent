import React, { useMemo, useState } from 'react';
import { Plus, Wrench, AlertTriangle } from 'lucide-react';
import { limit, orderBy, serverTimestamp } from 'firebase/firestore';
import { useLiveCollection } from '../firebase';
import { Modal, Tabs, inr } from './hms/common';
import { todayYmd } from '../hms';

// assets/{id}       equipment register with its purchase bill and warranty / AMC
// maintenance/{id}  each service, AMC visit, calibration or breakdown repair, with its bill
const CATEGORIES = ['Imaging', 'Life support', 'Monitoring', 'Laboratory', 'OT equipment', 'Dental', 'IT / Computers', 'Electrical / HVAC', 'Furniture', 'Vehicle', 'Other'];
const SERVICE_TYPES = ['Preventive maintenance', 'Breakdown repair', 'Calibration', 'AMC visit', 'Installation', 'Inspection'];
const STATUSES = ['In use', 'Under repair', 'Standby', 'Condemned'];
const ASSET = {
  name: '', category: 'Monitoring', make: '', model: '', serialNo: '', assetTag: '', location: '', department: '',
  vendor: '', billNo: '', purchaseDate: todayYmd(), cost: '', gst: '', warrantyUntil: '', amcVendor: '', amcUntil: '', amcCost: '',
  serviceEveryMonths: 6, status: 'In use',
};
const addMonths = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setMonth(d.getMonth() + Number(n || 0)); return d.toLocaleDateString('en-CA'); };
const daysTo = (ymd) => (ymd ? Math.round((new Date(`${ymd}T00:00:00`) - new Date(`${todayYmd()}T00:00:00`)) / 86_400_000) : null);
const fyStart = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; };

/** Equipment register: purchase bills, warranty / AMC, service history and service bills, what is due. */
export default function Equipment({ canEdit }) {
  const [tab, setTab] = useState('Register');
  const [assets, setAssets] = useLiveCollection('assets', []);
  const [visits, setVisits] = useLiveCollection('maintenance', [], undefined, [orderBy('date', 'desc'), limit(500)]);
  const [asset, setAsset] = useState(null);
  const [visit, setVisit] = useState(null);
  const [filter, setFilter] = useState('');

  const due = useMemo(() => assets
    .filter((a) => a.status !== 'Condemned' && a.nextServiceDue && daysTo(a.nextServiceDue) <= 15)
    .sort((a, b) => a.nextServiceDue.localeCompare(b.nextServiceDue)), [assets]);
  const expiring = assets.filter((a) => [a.warrantyUntil, a.amcUntil].some((d) => d && daysTo(d) >= 0 && daysTo(d) <= 30));
  const fy = fyStart();
  const serviceSpend = visits.filter((v) => v.date >= fy).reduce((s, v) => s + Number(v.cost || 0), 0);
  const shown = assets.filter((a) => !filter || `${a.name} ${a.serialNo} ${a.assetTag} ${a.department} ${a.location}`.toLowerCase().includes(filter.toLowerCase()));

  const saveAsset = (e) => {
    e.preventDefault();
    const a = { ...asset, cost: Number(asset.cost || 0), gst: Number(asset.gst || 0), amcCost: Number(asset.amcCost || 0) };
    if (!a.id) a.nextServiceDue = addMonths(a.purchaseDate, a.serviceEveryMonths);
    setAssets((prev) => (a.id ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, { ...a, createdAt: serverTimestamp() }]));
    setAsset(null);
  };
  const saveVisit = (e) => {
    e.preventDefault();
    const target = assets.find((a) => a.id === visit.assetId);
    setVisits((prev) => [{ ...visit, cost: Number(visit.cost || 0), downtimeHours: Number(visit.downtimeHours || 0), assetName: target.name, createdAt: serverTimestamp() }, ...prev]);
    setAssets((prev) => prev.map((a) => (a.id !== target.id ? a : {
      ...a, lastServiced: visit.date, nextServiceDue: visit.nextDue || addMonths(visit.date, a.serviceEveryMonths),
      status: visit.type === 'Breakdown repair' && !visit.resolved ? 'Under repair' : a.status === 'Under repair' ? 'In use' : a.status,
    })));
    setVisit(null);
  };

  const field = (obj, set, k, label, type = 'text', options) => (
    <div className="form-group" key={k}>
      <label>{label}</label>
      {options
        ? <select className="form-input" aria-label={label} value={obj[k]} onChange={(e) => set({ ...obj, [k]: e.target.value })}>{options.map((o) => <option key={o}>{o}</option>)}</select>
        : <input className="form-input" aria-label={label} type={type} value={obj[k] ?? ''} onChange={(e) => set({ ...obj, [k]: e.target.value })} required={k === 'name' || k === 'assetId'} />}
    </div>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title">
          <h2>Equipment &amp; Maintenance</h2>
          <p>Every machine with its purchase bill, warranty and AMC, service history and service bills, and what is due next.</p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" disabled={!assets.length} onClick={() => setVisit({ assetId: assets[0]?.id ?? '', date: todayYmd(), type: SERVICE_TYPES[0], vendor: '', engineer: '', invoiceNo: '', cost: '', downtimeHours: '', notes: '', nextDue: '', resolved: true })}>
              <Wrench size={16} /> Record service
            </button>
            <button className="btn btn-primary" onClick={() => setAsset(ASSET)}><Plus size={16} /> Add equipment</button>
          </div>
        )}
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        {[
          ['Equipment', assets.filter((a) => a.status !== 'Condemned').length],
          ['Purchase value', inr(assets.reduce((s, a) => s + Number(a.cost || 0) + Number(a.gst || 0), 0))],
          ['Service spend (this FY)', inr(serviceSpend)],
          ['Service due / overdue', due.length],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}><div className="stat-info"><p>{label}</p><div className="stat-value">{value}</div></div></div>
        ))}
      </div>

      {(due.length > 0 || expiring.length > 0) && (
        <div className="card" style={{ borderLeft: '4px solid var(--warning)', marginBottom: 16 }}>
          <strong><AlertTriangle size={14} /> Needs attention</strong>
          <ul style={{ margin: '8px 0 0 18px' }}>
            {due.map((a) => <li key={`d${a.id}`}>{a.name} ({a.assetTag || a.serialNo}): service {daysTo(a.nextServiceDue) < 0 ? `overdue since ${a.nextServiceDue}` : `due ${a.nextServiceDue}`}</li>)}
            {expiring.map((a) => <li key={`e${a.id}`}>{a.name}: {daysTo(a.warrantyUntil) >= 0 && daysTo(a.warrantyUntil) <= 30 ? `warranty ends ${a.warrantyUntil}` : `AMC ends ${a.amcUntil}`}</li>)}
          </ul>
        </div>
      )}

      <Tabs tabs={['Register', 'Service history', 'Bills']} value={tab} onChange={setTab} />

      {tab === 'Register' && (
        <div className="card">
          <input className="form-input" placeholder="Search name, serial, tag, department…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 12 }} />
          <div className="table-container">
            <table className="table-list">
              <thead><tr><th>Equipment</th><th>Serial / tag</th><th>Location</th><th>Warranty / AMC</th><th>Last service</th><th>Next due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.name}</strong><br /><small style={{ color: 'var(--text-muted)' }}>{a.category} · {a.make} {a.model}</small></td>
                    <td>{a.serialNo}<br /><small>{a.assetTag}</small></td>
                    <td>{a.department}<br /><small>{a.location}</small></td>
                    <td><small>Warranty: {a.warrantyUntil || '—'}<br />AMC: {a.amcUntil ? `${a.amcVendor} till ${a.amcUntil}` : '—'}</small></td>
                    <td>{a.lastServiced ?? '—'}</td>
                    <td style={{ color: daysTo(a.nextServiceDue) < 0 ? 'var(--danger)' : undefined }}>{a.nextServiceDue ?? '—'}</td>
                    <td><span className={`badge ${a.status === 'In use' ? 'badge-success' : a.status === 'Under repair' ? 'badge-danger' : 'badge-warning'}`}>{a.status}</span></td>
                    <td>{canEdit && <button className="btn btn-secondary" onClick={() => setAsset(a)}>Edit</button>}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No equipment registered.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'Service history' && (
        <div className="card">
          <div className="table-container">
            <table className="table-list">
              <thead><tr><th>Date</th><th>Equipment</th><th>Type</th><th>Vendor / engineer</th><th>Downtime</th><th>Cost</th><th>Notes</th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>{v.date}</td><td>{v.assetName}</td><td>{v.type}</td><td>{v.vendor}<br /><small>{v.engineer}</small></td>
                    <td>{v.downtimeHours ? `${v.downtimeHours} h` : '—'}</td><td>{inr(v.cost)}</td><td>{v.notes}</td>
                  </tr>
                ))}
                {!visits.length && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No service records yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'Bills' && (
        <div className="card">
          <div className="table-container">
            <table className="table-list">
              <thead><tr><th>Date</th><th>Bill no.</th><th>Vendor</th><th>For</th><th>Kind</th><th>Amount</th></tr></thead>
              <tbody>
                {[
                  ...assets.filter((a) => a.billNo || a.cost).map((a) => ({ id: `a${a.id}`, date: a.purchaseDate, no: a.billNo, vendor: a.vendor, for: a.name, kind: 'Purchase', amount: Number(a.cost || 0) + Number(a.gst || 0) })),
                  ...assets.filter((a) => a.amcCost).map((a) => ({ id: `m${a.id}`, date: a.amcUntil, no: '', vendor: a.amcVendor, for: a.name, kind: 'AMC contract', amount: a.amcCost })),
                  ...visits.filter((v) => v.cost).map((v) => ({ id: `v${v.id}`, date: v.date, no: v.invoiceNo, vendor: v.vendor, for: v.assetName, kind: v.type, amount: v.cost })),
                ].sort((x, y) => String(y.date).localeCompare(String(x.date))).map((b) => (
                  <tr key={b.id}><td>{b.date}</td><td>{b.no || '—'}</td><td>{b.vendor}</td><td>{b.for}</td><td>{b.kind}</td><td>{inr(b.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {asset && (
        <Modal wide title={asset.id ? `Edit ${asset.name}` : 'Add equipment'} onClose={() => setAsset(null)}
          footer={<button className="btn btn-primary" type="submit" form="asset-form">Save</button>}>
          <form id="asset-form" onSubmit={saveAsset} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 16px' }}>
            {field(asset, setAsset, 'name', 'Equipment name')}
            {field(asset, setAsset, 'category', 'Category', 'text', CATEGORIES)}
            {field(asset, setAsset, 'make', 'Make')}
            {field(asset, setAsset, 'model', 'Model')}
            {field(asset, setAsset, 'serialNo', 'Serial no.')}
            {field(asset, setAsset, 'assetTag', 'Asset tag')}
            {field(asset, setAsset, 'department', 'Department')}
            {field(asset, setAsset, 'location', 'Location / room')}
            {field(asset, setAsset, 'vendor', 'Supplier')}
            {field(asset, setAsset, 'billNo', 'Purchase bill no.')}
            {field(asset, setAsset, 'purchaseDate', 'Purchase date', 'date')}
            {field(asset, setAsset, 'cost', 'Cost (₹, before GST)', 'number')}
            {field(asset, setAsset, 'gst', 'GST (₹)', 'number')}
            {field(asset, setAsset, 'warrantyUntil', 'Warranty until', 'date')}
            {field(asset, setAsset, 'amcVendor', 'AMC / CMC vendor')}
            {field(asset, setAsset, 'amcUntil', 'AMC until', 'date')}
            {field(asset, setAsset, 'amcCost', 'AMC cost (₹)', 'number')}
            {field(asset, setAsset, 'serviceEveryMonths', 'Service every (months)', 'number')}
            {field(asset, setAsset, 'status', 'Status', 'text', STATUSES)}
          </form>
        </Modal>
      )}

      {visit && (
        <Modal title="Record service" onClose={() => setVisit(null)}
          footer={<button className="btn btn-primary" type="submit" form="visit-form">Save</button>}>
          <form id="visit-form" onSubmit={saveVisit}>
            <div className="form-group">
              <label>Equipment</label>
              <select className="form-input" value={visit.assetId} onChange={(e) => setVisit({ ...visit, assetId: e.target.value })}>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.serialNo || a.assetTag}</option>)}
              </select>
            </div>
            {field(visit, setVisit, 'date', 'Date', 'date')}
            {field(visit, setVisit, 'type', 'Type', 'text', SERVICE_TYPES)}
            {field(visit, setVisit, 'vendor', 'Service vendor')}
            {field(visit, setVisit, 'engineer', 'Engineer')}
            {field(visit, setVisit, 'invoiceNo', 'Service bill no.')}
            {field(visit, setVisit, 'cost', 'Bill amount (₹)', 'number')}
            {field(visit, setVisit, 'downtimeHours', 'Downtime (hours)', 'number')}
            {field(visit, setVisit, 'nextDue', 'Next service due (blank = by schedule)', 'date')}
            {field(visit, setVisit, 'notes', 'Work done / parts replaced')}
            {visit.type === 'Breakdown repair' && (
              <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={visit.resolved} onChange={(e) => setVisit({ ...visit, resolved: e.target.checked })} /> Fixed and back in use</label>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
