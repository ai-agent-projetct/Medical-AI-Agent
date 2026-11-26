import React, { useMemo, useState } from 'react';
import { Plus, Printer, Download, Calculator } from 'lucide-react';
import { limit, where } from 'firebase/firestore';
import { payslip } from '../../clinical';
import { scoped, todayYmd, useQueryDocs } from '../../hms';
import { Modal, Tabs, inr } from '../hms/common';
import { Alerts, Empty, Fields, Page, Stats, badgeFor, downloadCsv, esc, fresh, printPage, upsert, useSuite } from './kit';

// employees/{id}  {empCode, name, category, department, designation, phone, email, doj, dob, gender, bloodGroup, shift,
//                  pan, uan, esic, bank, ifsc, accountNo, basic, hra, allowances, pf, esi, pt, tds, regNo, regExpiry, status}
// attendance/{empId}_{date}  {empId, empName, date, month, status: P | A | HD | L | WO | H, in, out}
// leaves/{id}     {empId, empName, type, from, to, days, reason, status: Requested | Approved | Rejected}
// payroll/{month}_{empId}  {month, empId, empName, ...payslip(), lopDays, status: Processed | Paid}
const CATS = ['Doctor', 'Nurse', 'Technician', 'Pharmacist', 'Front office', 'Billing / accounts', 'Administration', 'Housekeeping', 'Security', 'Driver', 'Other'];
const MARKS = { P: 'Present', A: 'Absent', HD: 'Half day', L: 'On leave', WO: 'Week off', H: 'Holiday' };
const LEAVE_QUOTA = { CL: 12, SL: 12, EL: 15 };
const EMP_FIELDS = [
  { k: 'empCode', label: 'Employee code', required: true }, { k: 'name', label: 'Full name', required: true }, { k: 'category', label: 'Category', options: CATS },
  { k: 'department', label: 'Department' }, { k: 'designation', label: 'Designation' }, { k: 'shift', label: 'Shift', options: ['General', 'Morning', 'Evening', 'Night', 'Rotational'] },
  { k: 'phone', label: 'Mobile' }, { k: 'email', label: 'Email', type: 'email' }, { k: 'doj', label: 'Date of joining', type: 'date' }, { k: 'dob', label: 'Date of birth', type: 'date' },
  { k: 'gender', label: 'Gender', options: ['Female', 'Male', 'Other'] }, { k: 'bloodGroup', label: 'Blood group' },
  { k: 'regNo', label: 'Council registration no. (clinical)' }, { k: 'regExpiry', label: 'Registration valid till', type: 'date' },
  { k: 'pan', label: 'PAN' }, { k: 'uan', label: 'PF UAN' }, { k: 'esic', label: 'ESIC no.' },
  { k: 'bank', label: 'Bank' }, { k: 'ifsc', label: 'IFSC' }, { k: 'accountNo', label: 'Account no.' },
  { k: 'basic', label: 'Basic (₹/month)', type: 'number' }, { k: 'hra', label: 'HRA (₹/month)', type: 'number' }, { k: 'allowances', label: 'Other allowances (₹/month)', type: 'number' },
  { k: 'pf', label: 'PF applicable', type: 'checkbox' }, { k: 'esi', label: 'ESI applicable (gross ≤ ₹21,000)', type: 'checkbox' },
  { k: 'pt', label: 'Professional tax (₹/month)', type: 'number' }, { k: 'tds', label: 'TDS (₹/month)', type: 'number' },
  { k: 'status', label: 'Status', options: ['Active', 'Notice period', 'Exited'] },
];
const daysIn = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86_400_000) + 1;

/** HRMS: employee master with statutory and bank details, daily attendance, leave with balances, monthly payroll (PF / ESI / PT / TDS), payslips and bank file. */
export default function Hrms() {
  const [emps, setEmps] = useSuite('employees', 3000);
  const [leaves, setLeaves] = useSuite('leaves', 2000);
  const [tab, setTab] = useState('Employees');
  const [day, setDay] = useState(todayYmd());
  const [month, setMonth] = useState(todayYmd().slice(0, 7));
  const [form, setForm] = useState(null);
  const [leave, setLeave] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const att = useQueryDocs(() => scoped('attendance', where('month', '==', (tab === 'Attendance' ? day : `${month}-01`).slice(0, 7)), limit(20000)), [tab === 'Attendance' ? day.slice(0, 7) : month]);
  const pay = useQueryDocs(() => scoped('payroll', where('month', '==', month), limit(5000)), [month]);

  const active = emps.filter((e) => e.status !== 'Exited');
  const shown = emps.filter((e) => !q || `${e.name} ${e.empCode} ${e.department} ${e.category}`.toLowerCase().includes(q.toLowerCase()));
  const attOf = useMemo(() => Object.fromEntries(att.docs.map((a) => [a.id, a])), [att.docs]);
  const todayMarks = active.map((e) => attOf[`${e.id}_${day}`]?.status);
  const regAlerts = active.filter((e) => e.regExpiry && e.regExpiry <= new Date(Date.now() + 60 * 86_400_000).toLocaleDateString('en-CA'))
    .map((e) => `${e.name} (${e.category}): council registration ${e.regExpiry < todayYmd() ? 'EXPIRED' : 'expires'} ${e.regExpiry}`);
  const year = todayYmd().slice(0, 4);
  const used = (empId, type) => leaves.filter((l) => l.empId === empId && l.type === type && l.status === 'Approved' && l.from.startsWith(year)).reduce((s, l) => s + Number(l.days || 0), 0);

  const mark = (e, status, extra = {}) => upsert('attendance', `${e.id}_${day}`, { empId: e.id, empName: e.name, date: day, month: day.slice(0, 7), status, ...extra }).catch((err) => setError(err.message));
  const run = (fn) => fn().catch((err) => setError(err.message));

  const calc = (e) => {
    const marks = att.docs.filter((a) => a.empId === e.id);
    const lop = marks.filter((a) => a.status === 'A').length + 0.5 * marks.filter((a) => a.status === 'HD').length
      + leaves.filter((l) => l.empId === e.id && l.type === 'LOP' && l.status === 'Approved' && l.from.startsWith(month)).reduce((s, l) => s + Number(l.days || 0), 0);
    return { lopDays: lop, present: marks.filter((a) => a.status === 'P').length, ...payslip(e, { inMonth: daysIn(month), lop }) };
  };
  const payslips = pay.docs.length ? pay.docs : null;
  const process = () => run(async () => {
    if (pay.docs.some((p) => p.status === 'Paid')) throw new Error('This month is already marked paid.');
    for (const e of active) await upsert('payroll', `${month}_${e.id}`, { month, empId: e.id, empCode: e.empCode, empName: e.name, department: e.department, designation: e.designation, bank: e.bank ?? '', ifsc: e.ifsc ?? '', accountNo: e.accountNo ?? '', uan: e.uan ?? '', ...calc(e), status: 'Processed' });
  });
  const slip = (p) => printPage(`Payslip ${p.month} · ${p.empName}`, `<p>${esc(p.empName)} (${esc(p.empCode)}) · ${esc(p.designation ?? '')} · ${esc(p.department ?? '')}<br>
    UAN ${esc(p.uan || '—')} · Bank ${esc(p.bank)} ${esc(String(p.accountNo ?? '').slice(-4).padStart(8, '•'))} · Days present ${p.present} · Loss of pay ${p.lopDays} day(s)</p>
    <table><tr><th>Earnings</th><th>₹</th><th>Deductions</th><th>₹</th></tr>
    <tr><td>Gross (after LOP)</td><td>${p.gross}</td><td>Provident fund</td><td>${p.pf}</td></tr>
    <tr><td>Loss of pay</td><td>−${p.lopAmount}</td><td>ESI</td><td>${p.esi}</td></tr>
    <tr><td></td><td></td><td>Professional tax</td><td>${p.pt}</td></tr><tr><td></td><td></td><td>TDS</td><td>${p.tds}</td></tr>
    <tr><th>Net pay</th><th>${p.net}</th><th>Total deductions</th><th>${p.deductions}</th></tr></table>
    <p class="muted">Employer contribution: PF ₹${p.employerPf} · ESI ₹${p.employerEsi}. Computer-generated payslip.</p>`);

  return (
    <Page title="HR & Payroll" desc="Employee master with statutory and bank details, daily attendance, leave requests with balances, monthly payroll with PF, ESI, PT and TDS, payslips and the bank transfer file."
      actions={tab === 'Employees' && <button className="btn btn-primary" onClick={() => setForm({ status: 'Active', category: 'Nurse', shift: 'General', gender: 'Female', pf: true, esi: true, pt: 200, tds: 0, doj: todayYmd() })}><Plus size={16} /> Add employee</button>}>
      <Stats items={[
        ['Active employees', active.length],
        ['Present today', active.filter((e) => attOf[`${e.id}_${todayYmd()}`]?.status === 'P').length],
        ['Leave requests', leaves.filter((l) => l.status === 'Requested').length, leaves.some((l) => l.status === 'Requested') ? 'warning' : undefined],
        ['Monthly salary cost', inr(active.reduce((s, e) => s + Number(e.basic || 0) + Number(e.hra || 0) + Number(e.allowances || 0), 0))],
      ]} />
      <Alerts title="Registrations expiring (clinical staff)" items={regAlerts} />
      {error && <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>{error}</div>}
      <Tabs tabs={['Employees', 'Attendance', 'Leave', 'Payroll']} value={tab} onChange={(t) => { setTab(t); setError(''); }} />

      {tab === 'Employees' && (
        <div className="card">
          <input className="form-input" placeholder="Search name, code, department…" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Employee</th><th>Category</th><th>Department</th><th>Joined</th><th>Monthly CTC</th><th>Leave left (CL/SL/EL)</th><th>Status</th><th /></tr></thead>
            <tbody>{shown.map((e) => (
              <tr key={e.id}>
                <td><strong>{e.name}</strong><br /><small>{e.empCode} · {e.designation}</small></td><td>{e.category}</td><td>{e.department}<br /><small>{e.shift}</small></td><td>{e.doj}</td>
                <td>{inr(Number(e.basic || 0) + Number(e.hra || 0) + Number(e.allowances || 0))}</td>
                <td>{Object.entries(LEAVE_QUOTA).map(([t, n]) => `${n - used(e.id, t)}`).join(' / ')}</td>
                <td><span className={`badge ${badgeFor(e.status === 'Active' ? 'Approved' : e.status)}`}>{e.status}</span></td>
                <td><button className="btn btn-secondary" onClick={() => setForm(e)}>Edit</button></td>
              </tr>
            ))}{!shown.length && <Empty cols={8} />}</tbody>
          </table></div>
        </div>
      )}

      {tab === 'Attendance' && (
        <div className="card">
          <div className="form-input-row" style={{ marginBottom: 12, alignItems: 'center' }}>
            <input className="form-input" type="date" aria-label="Attendance date" value={day} onChange={(e) => setDay(e.target.value)} style={{ maxWidth: 180 }} />
            <span>{Object.entries(MARKS).map(([k, l]) => `${l}: ${todayMarks.filter((m) => m === k).length}`).join(' · ')} · Not marked: {todayMarks.filter((m) => !m).length}</span>
            <button className="btn btn-secondary" onClick={() => run(async () => { for (const e of active) if (!attOf[`${e.id}_${day}`]) await mark(e, 'P'); })}>Mark rest present</button>
          </div>
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Employee</th><th>Shift</th><th>Mark</th><th>In</th><th>Out</th></tr></thead>
            <tbody>{active.map((e) => {
              const a = attOf[`${e.id}_${day}`];
              return (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong> <small>{e.empCode}</small><br /><small>{e.department}</small></td><td>{e.shift}</td>
                  <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{Object.keys(MARKS).map((k) => (
                    <button key={k} title={MARKS[k]} className={`btn ${a?.status === k ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '2px 8px' }} onClick={() => mark(e, k)}>{k}</button>
                  ))}</td>
                  <td><input className="form-input" type="time" aria-label={`In time of ${e.name}`} defaultValue={a?.in ?? ''} onBlur={(ev) => ev.target.value && mark(e, a?.status ?? 'P', { in: ev.target.value })} /></td>
                  <td><input className="form-input" type="time" aria-label={`Out time of ${e.name}`} defaultValue={a?.out ?? ''} onBlur={(ev) => ev.target.value && mark(e, a?.status ?? 'P', { out: ev.target.value })} /></td>
                </tr>
              );
            })}{!active.length && <Empty cols={5} text="Add employees first." />}</tbody>
          </table></div>
        </div>
      )}

      {tab === 'Leave' && (
        <div className="card">
          <button className="btn btn-primary" style={{ marginBottom: 12 }} disabled={!active.length} onClick={() => setLeave({ empId: active[0]?.id, type: 'CL', from: todayYmd(), to: todayYmd(), reason: '' })}><Plus size={14} /> New leave request</button>
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Employee</th><th>Type</th><th>From – to</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
            <tbody>{leaves.map((l) => (
              <tr key={l.id}>
                <td>{l.empName}</td><td>{l.type}</td><td>{l.from} – {l.to}</td><td>{l.days}</td><td>{l.reason}</td>
                <td><span className={`badge ${badgeFor(l.status)}`}>{l.status}</span></td>
                <td>{l.status === 'Requested' && <>
                  <button className="btn btn-primary" onClick={() => setLeaves((prev) => prev.map((x) => (x.id === l.id ? { ...x, status: 'Approved' } : x)))}>Approve</button>{' '}
                  <button className="btn btn-secondary" onClick={() => setLeaves((prev) => prev.map((x) => (x.id === l.id ? { ...x, status: 'Rejected' } : x)))}>Reject</button></>}</td>
              </tr>
            ))}{!leaves.length && <Empty cols={7} />}</tbody>
          </table></div>
        </div>
      )}

      {tab === 'Payroll' && (
        <div className="card">
          <div className="form-input-row" style={{ marginBottom: 12, alignItems: 'center' }}>
            <input className="form-input" type="month" aria-label="Payroll month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180 }} />
            <button className="btn btn-primary" onClick={process}><Calculator size={14} /> {payslips ? 'Re-process' : 'Process'} payroll</button>
            {payslips && <>
              <button className="btn btn-secondary" onClick={() => downloadCsv(`salary-${month}.csv`, [['Employee code', 'Name', 'Bank', 'IFSC', 'Account no.', 'Net pay'], ...payslips.map((p) => [p.empCode, p.empName, p.bank, p.ifsc, p.accountNo, p.net])])}><Download size={14} /> Bank file</button>
              <button className="btn btn-secondary" onClick={() => downloadCsv(`pf-esi-${month}.csv`, [['UAN', 'Name', 'Gross', 'PF employee', 'PF employer', 'ESI employee', 'ESI employer', 'PT', 'TDS'], ...payslips.map((p) => [p.uan, p.empName, p.gross, p.pf, p.employerPf, p.esi, p.employerEsi, p.pt, p.tds])])}><Download size={14} /> PF / ESI / PT statement</button>
              <button className="btn btn-secondary" onClick={() => window.confirm(`Mark ${month} salaries as paid? It can no longer be re-processed.`) && run(async () => { for (const p of payslips) await upsert('payroll', p.id, { status: 'Paid', paidOn: todayYmd() }); })}>Mark paid</button>
            </>}
          </div>
          {payslips && <p>Gross {inr(payslips.reduce((s, p) => s + p.gross, 0))} · Net {inr(payslips.reduce((s, p) => s + p.net, 0))} · Employer PF+ESI {inr(payslips.reduce((s, p) => s + p.employerPf + p.employerEsi, 0))}</p>}
          <div className="table-container"><table className="table-list">
            <thead><tr><th>Employee</th><th>Present</th><th>LOP days</th><th>Gross</th><th>PF</th><th>ESI</th><th>PT</th><th>TDS</th><th>Net</th><th>Status</th><th /></tr></thead>
            <tbody>{(payslips ?? active.map((e) => ({ id: e.id, empName: e.name, empCode: e.empCode, ...calc(e), status: 'Preview' }))).map((p) => (
              <tr key={p.id}><td><strong>{p.empName}</strong> <small>{p.empCode}</small></td><td>{p.present}</td><td>{p.lopDays}</td><td>{inr(p.gross)}</td><td>{inr(p.pf)}</td><td>{inr(p.esi)}</td><td>{inr(p.pt)}</td><td>{inr(p.tds)}</td><td><b>{inr(p.net)}</b></td>
                <td><span className={`badge ${badgeFor(p.status === 'Processed' ? 'Pending' : p.status)}`}>{p.status}</span></td>
                <td>{p.status !== 'Preview' && <button className="btn-icon" aria-label={`Payslip of ${p.empName}`} onClick={() => slip(p)}><Printer size={14} /></button>}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {form && (
        <Modal wide title={form.id ? `Edit ${form.name}` : 'Add employee'} onClose={() => setForm(null)} footer={<button className="btn btn-primary" type="submit" form="emp-form">Save</button>}>
          <form id="emp-form" onSubmit={(e) => { e.preventDefault(); setEmps((prev) => (form.id ? prev.map((x) => (x.id === form.id ? form : x)) : [fresh(form), ...prev])); setForm(null); }}>
            <Fields fields={EMP_FIELDS} value={form} onChange={setForm} />
          </form>
        </Modal>
      )}
      {leave && (
        <Modal title="Leave request" onClose={() => setLeave(null)} footer={<button className="btn btn-primary" disabled={leave.to < leave.from} onClick={() => {
          const e = emps.find((x) => x.id === leave.empId);
          setLeaves((prev) => [fresh({ ...leave, empName: e.name, days: daysBetween(leave.from, leave.to), status: 'Requested' }), ...prev]);
          setLeave(null);
        }}>Submit</button>}>
          <Fields value={leave} onChange={setLeave} fields={[
            { k: 'empId', label: 'Employee', options: active.map((e) => ({ value: e.id, label: `${e.name} (${e.empCode})` })) }, { k: 'type', label: 'Type', options: ['CL', 'SL', 'EL', 'Maternity', 'Comp-off', 'LOP'] },
            { k: 'from', label: 'From', type: 'date' }, { k: 'to', label: 'To', type: 'date' }, { k: 'reason', label: 'Reason', full: true },
          ]} />
          <small>{emps.find((x) => x.id === leave.empId)?.name} · balance {LEAVE_QUOTA[leave.type] !== undefined ? LEAVE_QUOTA[leave.type] - used(leave.empId, leave.type) : '—'} day(s)</small>
        </Modal>
      )}
    </Page>
  );
}
