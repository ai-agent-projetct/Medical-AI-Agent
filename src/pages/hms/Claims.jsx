import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { arrayUnion, doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db, logAudit } from '../../firebase';
import { addPayment, col, limit, orderBy, query, useQueryDocs, where } from '../../hms';
import { inr, Modal, PatientPicker, Tabs } from './common';

// Cashless: pre-auth → approval → final claim → settlement. Reimbursement: claim → settlement.
export const STAGES = ['Pre-auth Requested', 'Pre-auth Approved', 'Query Raised', 'Claim Submitted', 'Settled', 'Rejected'];
const OPEN = STAGES.slice(0, 4);
const EMPTY = { patient: null, insurer: '', tpa: '', policyNo: '', memberId: '', type: 'Cashless', admissionId: '', invoiceId: '', requested: '', diagnosis: '' };

/** Insurance / TPA claims register with a stage history; settlements post as Insurance receipts. */
export default function Claims({ canEdit }) {
  const [tab, setTab] = useState('Open');
  const [form, setForm] = useState(null);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState('');
  const list = useQueryDocs(() => query(col('claims'), where('stage', 'in', tab === 'Open' ? OPEN : ['Settled', 'Rejected']),
    orderBy('updatedAt', 'desc'), limit(100)), [tab]);
  const me = () => auth?.currentUser?.email ?? 'staff';

  const create = async () => {
    setError('');
    try {
      const ref = doc(col('claims'));
      await runTransaction(db, async (tx) => tx.set(ref, {
        patientId: form.patient.id ?? null, patientName: form.patient.name, phone: form.patient.phone ?? '',
        insurer: form.insurer, tpa: form.tpa, policyNo: form.policyNo, memberId: form.memberId, type: form.type,
        admissionId: form.admissionId || null, invoiceId: form.invoiceId || null, diagnosis: form.diagnosis,
        requested: Number(form.requested), approved: 0, settled: 0, deductions: 0,
        stage: form.type === 'Cashless' ? 'Pre-auth Requested' : 'Claim Submitted',
        history: [{ stage: form.type === 'Cashless' ? 'Pre-auth Requested' : 'Claim Submitted', note: 'Created', by: me(), at: Timestamp.now() }],
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }));
      logAudit('Billing', 'Created Insurance Claim', 'Claims', `${form.patient.name} · ${form.insurer} · ₹${form.requested}`);
      setForm(null);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div><h1>Insurance &amp; TPA Claims</h1><p>Cashless pre-authorisation and reimbursement claims, with approvals, queries, settlement and deductions.</p></div>
        {canEdit && <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><ShieldCheck size={14} /> New claim</button>}
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <Tabs tabs={['Open', 'Closed']} value={tab} onChange={setTab} />
      <div className="card"><div className="table-container"><table className="table-list">
        <thead><tr><th>Patient</th><th>Insurer / TPA</th><th>Type</th><th>Requested</th><th>Approved</th><th>Settled</th><th>Stage</th></tr></thead>
        <tbody>
          {list.error && <tr><td colSpan={7} style={{ color: 'var(--danger)' }}>{list.error.message}</td></tr>}
          {!list.loading && list.docs.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No {tab.toLowerCase()} claims</td></tr>}
          {list.docs.map((c) => (
            <tr key={c.id} onClick={() => setCurrent(c)} style={{ cursor: 'pointer' }}>
              <td><strong>{c.patientName}</strong><br /><small>{c.policyNo}</small></td><td>{c.insurer}<br /><small>{c.tpa}</small></td>
              <td>{c.type}</td><td>{inr(c.requested)}</td><td>{inr(c.approved)}</td><td>{inr(c.settled)}</td>
              <td><span className={`badge ${c.stage === 'Settled' ? 'badge-success' : c.stage === 'Rejected' ? 'badge-danger' : c.stage === 'Query Raised' ? 'badge-warning' : 'badge-info'}`}>{c.stage}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      {form && (
        <Modal title="New insurance claim" onClose={() => setForm(null)}
          footer={<button className="btn btn-primary" disabled={!form.patient || !form.insurer || !form.policyNo || !(form.requested > 0)} onClick={create}>Create claim</button>}>
          <div className="form-group"><label>Patient</label><PatientPicker value={form.patient} onChange={(p) => setForm({ ...form, patient: p })} /></div>
          <div className="form-input-row">
            <div className="form-group"><label>Insurer</label><input className="form-input" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} placeholder="e.g. Star Health" /></div>
            <div className="form-group"><label>TPA (if any)</label><input className="form-input" value={form.tpa} onChange={(e) => setForm({ ...form, tpa: e.target.value })} /></div>
          </div>
          <div className="form-input-row">
            <div className="form-group"><label>Policy no.</label><input className="form-input" value={form.policyNo} onChange={(e) => setForm({ ...form, policyNo: e.target.value })} /></div>
            <div className="form-group"><label>Member / card ID</label><input className="form-input" value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} /></div>
            <div className="form-group"><label>Type</label><select className="form-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Cashless</option><option>Reimbursement</option></select></div>
          </div>
          <div className="form-input-row">
            <div className="form-group"><label>Amount requested (₹)</label><input className="form-input" type="number" min="1" value={form.requested} onChange={(e) => setForm({ ...form, requested: e.target.value })} /></div>
            <div className="form-group"><label>Invoice ID (for settlement)</label><input className="form-input" value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value.trim() })} placeholder="optional" /></div>
          </div>
          <div className="form-group"><label>Diagnosis / procedure</label><input className="form-input" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></div>
        </Modal>
      )}
      {current && <ClaimModal claim={current} canEdit={canEdit} onClose={() => setCurrent(null)} />}
    </div>
  );
}

function ClaimModal({ claim, canEdit, onClose }) {
  const [stage, setStage] = useState(claim.stage);
  const [note, setNote] = useState('');
  const [approved, setApproved] = useState(claim.approved || claim.requested);
  const [settled, setSettled] = useState(claim.settled || claim.approved || '');
  const [error, setError] = useState('');
  const closed = ['Settled', 'Rejected'].includes(claim.stage);

  const save = async () => {
    setError('');
    try {
      const upd = { stage, updatedAt: serverTimestamp(), history: arrayUnion({ stage, note, by: auth.currentUser.email, at: Timestamp.now() }) };
      if (stage === 'Pre-auth Approved' || stage === 'Claim Submitted') upd.approved = Number(approved);
      if (stage === 'Settled') {
        upd.settled = Number(settled);
        upd.deductions = Math.max(0, Number(claim.approved || claim.requested) - Number(settled));
        // Money in from the insurer is an Insurance receipt on the hospital invoice.
        if (claim.invoiceId && Number(settled) > 0) await addPayment(claim.invoiceId, Number(settled), 'Insurance', `Claim ${claim.policyNo}`);
      }
      await runTransaction(db, async (tx) => tx.update(doc(db, 'claims', claim.id), upd));
      logAudit('Billing', 'Updated Insurance Claim', 'Claims', `${claim.patientName} → ${stage}`);
      onClose();
    } catch (e) { setError(e.message); }
  };

  return (
    <Modal title={`${claim.patientName} · ${claim.insurer}`} onClose={onClose} wide
      footer={canEdit && !closed && <button className="btn btn-primary" onClick={save}>Update claim</button>}>
      <p>{claim.type} · Policy {claim.policyNo} {claim.memberId && `· Member ${claim.memberId}`} {claim.tpa && `· TPA ${claim.tpa}`}</p>
      <p>Requested <strong>{inr(claim.requested)}</strong> · Approved {inr(claim.approved)} · Settled {inr(claim.settled)} · Deductions {inr(claim.deductions)}</p>
      {canEdit && !closed && (
        <div className="form-input-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group"><label>Move to</label><select className="form-input" value={stage} onChange={(e) => setStage(e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></div>
          {(stage === 'Pre-auth Approved' || stage === 'Claim Submitted') && <div className="form-group"><label>Approved (₹)</label><input className="form-input" type="number" value={approved} onChange={(e) => setApproved(e.target.value)} /></div>}
          {stage === 'Settled' && <div className="form-group"><label>Settled (₹)</label><input className="form-input" type="number" value={settled} onChange={(e) => setSettled(e.target.value)} /></div>}
          <div className="form-group" style={{ flex: 2 }}><label>Note</label><input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Query details, approval ref…" /></div>
        </div>
      )}
      {stage === 'Settled' && !claim.invoiceId && <small>No invoice linked: record the insurer's payment at the billing counter.</small>}
      <h4>History</h4>
      <ul>{(claim.history ?? []).map((h, i) => <li key={i}><strong>{h.stage}</strong> · {h.at?.toDate?.().toLocaleString('en-IN')} · {h.by}{h.note ? ` · ${h.note}` : ''}</li>)}</ul>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </Modal>
  );
}
