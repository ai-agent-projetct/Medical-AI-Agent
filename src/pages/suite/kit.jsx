import React, { useMemo, useState } from 'react';
import { Plus, Printer, AlertTriangle } from 'lucide-react';
import { doc, limit, orderBy, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, stampFor, useLiveCollection } from '../../firebase';
import { Modal, PatientPicker, HOSPITAL } from '../hms/common';
import { todayYmd } from '../../hms';

/** Latest `n` docs of a hospital-suite collection, live; [rows, write]. */
export const useSuite = (name, n = 500) => useLiveCollection(name, [], undefined, [orderBy('createdAt', 'desc'), limit(n)]);
/** Adds createdAt to new rows so they sort and stay inside the live window. */
export const fresh = (row) => ({ ...row, createdAt: serverTimestamp() });
/** Create-or-update one doc with a fixed id (e.g. attendance/{empId}_{date}), stamped with hospital and writer. */
export const upsert = (name, id, data) => setDoc(doc(db, name, id),
  stampFor(name, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)), true), { merge: true });
/** Downloads rows (array of arrays) as a CSV file. */
export function downloadCsv(filename, rows) {
  const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
export const nowHm = () => new Date().toTimeString().slice(0, 5);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const minutesSince = (t) => (t?.toDate ? Math.round((Date.now() - t.toDate()) / 60000) : null);

export function Page({ title, desc, actions, children }) {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title"><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Stats({ items }) {
  return (
    <div className="grid-4" style={{ marginBottom: 16 }}>
      {items.map(([label, value, tone]) => (
        <div className="stat-card" key={label} style={tone ? { borderLeft: `4px solid var(--${tone})` } : undefined}>
          <div className="stat-info"><p>{label}</p><div className="stat-value">{value}</div></div>
        </div>
      ))}
    </div>
  );
}

export function Alerts({ items, tone = 'warning', title = 'Needs attention' }) {
  if (!items.length) return null;
  return (
    <div className="card" style={{ borderLeft: `4px solid var(--${tone})`, marginBottom: 16 }}>
      <strong><AlertTriangle size={14} /> {title}</strong>
      <ul style={{ margin: '8px 0 0 18px' }}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

export function Empty({ cols, text = 'Nothing here yet.' }) {
  return <tr><td colSpan={cols} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{text}</td></tr>;
}

export const badgeFor = (s) => (/(done|complete|verified|given|available|discharged|closed|paid|approved|received|present|resolved|clean|returned|sterile|delivered)/i.test(s) ? 'badge-success'
  : /(cancel|critical|expired|discard|absent|rejected|lama|death|overdue|high)/i.test(s) ? 'badge-danger'
    : /(wait|pending|due|ordered|draft|scheduled|open|reserved|requested)/i.test(s) ? 'badge-warning' : 'badge-secondary');

/** Form fields from a schema: {k, label, type?, options?, required?, patient?, full?}. */
export function Fields({ fields, value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 16px' }}>
      {fields.map((f) => (
        <div className="form-group" key={f.k} style={f.full || f.patient || f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
          <label>{f.label}</label>
          {f.patient ? (
            <PatientPicker allowWalkIn value={value.patientName ? { id: value.patientId, name: value.patientName, phone: value.phone } : null}
              onChange={(p) => onChange({ ...value, patientId: p?.id ?? null, patientName: p?.name ?? '', phone: p?.phone ?? '' })} />
          ) : f.options ? (
            <select className="form-input" aria-label={f.label} value={value[f.k] ?? ''} onChange={(e) => onChange({ ...value, [f.k]: e.target.value })}>
              {f.options.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o}>{o}</option>))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea className="form-input" aria-label={f.label} rows={3} value={value[f.k] ?? ''} onChange={(e) => onChange({ ...value, [f.k]: e.target.value })} />
          ) : f.type === 'checkbox' ? (
            <input type="checkbox" aria-label={f.label} checked={!!value[f.k]} onChange={(e) => onChange({ ...value, [f.k]: e.target.checked })} />
          ) : (
            <input className="form-input" aria-label={f.label} type={f.type ?? 'text'} required={f.required} value={value[f.k] ?? ''}
              onChange={(e) => onChange({ ...value, [f.k]: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} />
          )}
        </div>
      ))}
    </div>
  );
}

/** Printable A4 page with the hospital letterhead; `body` is trusted HTML built with esc(). */
export function printPage(title, body) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return alert('Allow pop-ups to print.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font:13px system-ui,sans-serif;margin:28px;color:#111}table{width:100%;border-collapse:collapse;margin:8px 0}
    td,th{border:1px solid #ccc;padding:6px;text-align:left}h1{margin:0;font-size:20px}h2{font-size:16px;margin:16px 0 6px}
    .muted{color:#555}.hi{color:#b91c1c;font-weight:700}.sign{margin-top:48px;text-align:right}</style></head><body>
    <h1>${esc(HOSPITAL.name)}</h1><div class="muted">${esc(HOSPITAL.address)}${HOSPITAL.phone ? ` · ${esc(HOSPITAL.phone)}` : ''}</div>
    <h2>${esc(title)}</h2>${body}<p class="muted">Printed ${new Date().toLocaleString('en-IN')}</p><script>window.print()</script></body></html>`);
  w.document.close();
}

/** Tiny SVG trend line with reference band; points: [{x: label, y: number}]. */
export function Trend({ points, low, high, width = 260, height = 70, color = 'var(--primary)' }) {
  const ys = points.map((p) => Number(p.y)).filter((y) => !Number.isNaN(y));
  if (ys.length < 2) return <small style={{ color: 'var(--text-muted)' }}>{ys.length ? `${ys[0]}` : '—'}</small>;
  const min = Math.min(...ys, low ?? Infinity); const max = Math.max(...ys, high ?? -Infinity);
  const span = max - min || 1;
  const X = (i) => 4 + (i * (width - 8)) / (ys.length - 1);
  const Y = (v) => height - 6 - ((v - min) * (height - 12)) / span;
  return (
    <svg width={width} height={height} role="img" aria-label={`Trend ${ys.join(', ')}`}>
      {low !== undefined && high !== undefined && <rect x="0" width={width} y={Y(high)} height={Math.max(1, Y(low) - Y(high))} fill="var(--success)" opacity="0.12" />}
      <polyline fill="none" stroke={color} strokeWidth="2" points={ys.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />
      {ys.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r="3" fill={(high !== undefined && v > high) || (low !== undefined && v < low) ? 'var(--danger)' : color}><title>{`${points[i].x}: ${v}`}</title></circle>)}
    </svg>
  );
}

/**
 * Generic register for a hospital-suite collection: search, status counts, add / edit form, quick
 * status change, print. Used by the support-service modules (blood bank, ambulance, diet, CSSD…).
 */
export function Registry({ collection, title, desc, fields, statuses, columns, defaults = {}, canEdit = true, extraStats, alerts, n }) {
  const [rows, setRows] = useSuite(collection, n);
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('');
  const cols = columns ?? fields.slice(0, 5).map((f) => f.k);
  const label = (k) => (k === 'patientName' ? 'Patient' : fields.find((f) => f.k === k)?.label ?? k);
  const shown = useMemo(() => rows.filter((r) => (!only || r.status === only)
    && (!q || Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(q.toLowerCase())))), [rows, q, only]);
  const blank = () => ({ ...Object.fromEntries(fields.map((f) => [f.k, f.type === 'date' ? todayYmd() : f.options ? (f.options[0]?.value ?? f.options[0]) : ''])), ...defaults, status: statuses[0] });

  const save = (e) => {
    e.preventDefault();
    setRows((prev) => (form.id ? prev.map((r) => (r.id === form.id ? form : r)) : [fresh(form), ...prev]));
    setForm(null);
  };
  const print = (r) => printPage(`${title}: ${r[cols[0]] ?? ''}`, `<table>${[...fields.map((f) => [f.label, f.patient ? `${r.patientName ?? ''} ${r.phone ?? ''}` : f.type === 'checkbox' ? (r[f.k] ? 'Yes' : 'No') : r[f.k]]), ['Status', r.status]]
    .map(([k, v]) => `<tr><th style="width:35%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table><div class="sign">Signature</div>`);

  return (
    <Page title={title} desc={desc} actions={canEdit && <button className="btn btn-primary" onClick={() => setForm(blank())}><Plus size={16} /> New</button>}>
      <Stats items={[['Total', rows.length], ...statuses.slice(0, extraStats ? 2 : 3).map((s) => [s, rows.filter((r) => r.status === s).length]), ...(extraStats?.(rows) ?? [])].slice(0, 4)} />
      <Alerts items={alerts?.(rows) ?? []} />
      <div className="card">
        <div className="form-input-row" style={{ marginBottom: 12 }}>
          <input className="form-input" placeholder="Search…" aria-label={`Search ${title}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="form-input" aria-label="Filter by status" value={only} onChange={(e) => setOnly(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="table-container">
          <table className="table-list">
            <thead><tr>{cols.map((k) => <th key={k}>{label(k)}</th>)}<th>Status</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  {cols.map((k, i) => <td key={k}>{i === 0 ? <strong>{String(r[k] ?? '')}</strong> : typeof r[k] === 'boolean' ? (r[k] ? 'Yes' : 'No') : String(r[k] ?? '')}</td>)}
                  <td>
                    {canEdit ? (
                      <select className={`badge ${badgeFor(r.status)}`} style={{ border: 0 }} aria-label={`Status of ${r[cols[0]]}`} value={r.status}
                        onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: e.target.value, statusAt: `${todayYmd()} ${nowHm()}` } : x)))}>
                        {statuses.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    ) : <span className={`badge ${badgeFor(r.status)}`}>{r.status}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canEdit && <button className="btn btn-secondary" onClick={() => setForm(r)}>Edit</button>}{' '}
                    <button className="btn-icon" aria-label="Print" onClick={() => print(r)}><Printer size={14} /></button>
                  </td>
                </tr>
              ))}
              {!shown.length && <Empty cols={cols.length + 2} />}
            </tbody>
          </table>
        </div>
      </div>
      {form && (
        <Modal wide title={form.id ? `Edit · ${title}` : `New · ${title}`} onClose={() => setForm(null)}
          footer={<button className="btn btn-primary" type="submit" form={`${collection}-form`}>Save</button>}>
          <form id={`${collection}-form`} onSubmit={save}>
            <Fields fields={[...fields, { k: 'status', label: 'Status', options: statuses }]} value={form} onChange={setForm} />
          </form>
        </Modal>
      )}
    </Page>
  );
}
