// Hospital operations data layer: billing (OPD / IPD / pharmacy invoices, receipts), pharmacy stock,
// IPD (wards, beds, admissions). Built for large hospitals: pages subscribe to bounded queries
// (by date, status or search prefix, always with a limit) and reports use server-side aggregates,
// so no page downloads whole collections.
//
//   services/{id}        charge master {name, category, department, rate, gstRate, sac, active}
//   invoices/{id}        {number, kind: OPD|IPD|PHARMACY, desk, fy, date, patientId?, patientName, phone,
//                         admissionId?, lines[], gross, discount, taxable, cgst, sgst, roundOff, total,
//                         paid, due, status: Unpaid|Partial|Paid|Cancelled, createdBy, createdAt}
//   receipts/{id}        append-only money in/out {invoiceId?, admissionId?, number?, patientName, amount
//                         (negative = refund), mode: Cash|UPI|Card|Insurance, ref, type, date, by, at}
//   drugs/{id}           {name, nameKey, composition, manufacturer, hsn, gstRate, mrp, unit, reorderLevel,
//                         rack, rx, stock}  (stock = sum of batch qty, kept in the same transactions)
//   stockBatches/{id}    {drugId, drugName, batch, expiry: yyyy-MM, qty, purchaseRate, mrp, supplierId}
//   suppliers/{id}       {name, nameKey, gstin, phone, address, due}
//   purchases/{id}       {supplierId, supplierName, billNo, date, lines[], total, paid, due}
//   wards/{id}           {name, type, ratePerDay}   beds/{id} {wardId, wardName, label, status, admissionId}
//   admissions/{id}      {patientId?, patientName, phone, doctor, department, bedId, bedLabel, wardType,
//                         ratePerDay, admittedAt, date, status: Admitted|Discharged, diagnosis, advance}
//   admissions/{id}/charges/{cid}  {name, category, qty, rate, gstRate, date, by}
import { useEffect, useState } from 'react';
import {
  collection, doc, query, where, orderBy, limit, onSnapshot, getDocs, runTransaction, serverTimestamp,
  increment, startAt, endAt, getAggregateFromServer, sum, count, Timestamp,
} from 'firebase/firestore';
import { auth, db, logAudit } from './firebase';
import { bedDays, computeBill, fefo, financialYear, invoiceNumber, payState } from './billing';

export const todayYmd = () => new Date().toLocaleDateString('en-CA'); // yyyy-MM-dd in local time
export const thisMonth = () => todayYmd().slice(0, 7);
const me = () => auth?.currentUser?.email ?? 'staff';
const PAGE = 50;

/** Search key for prefix queries: lowercase, single spaces. */
export const keyOf = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Live results of a bounded query; `make` returns a Query (or null to skip). */
export function useQueryDocs(make, deps) {
  const [state, setState] = useState({ docs: [], loading: true, error: null });
  useEffect(() => {
    const q = db && make();
    if (!q) { setState({ docs: [], loading: false, error: null }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(q,
      (snap) => setState({ docs: snap.docs.map((d) => ({ ...d.data(), id: d.id })), loading: false, error: null }),
      (error) => setState({ docs: [], loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export const col = (name) => collection(db, name);

// ---------------------------------------------------------------- lookups
/** Patients by name prefix or exact phone (existing patient docs only have `name`/`phone`). */
export async function searchPatients(term) {
  const t = term.trim();
  if (t.length < 2) return [];
  if (/^[+\d\s-]{6,}$/.test(t)) {
    const snap = await getDocs(query(col('patients'), where('phone', '==', t), limit(10)));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  const cap = t.replace(/\b\w/g, (c) => c.toUpperCase());
  const snap = await getDocs(query(col('patients'), orderBy('name'), startAt(cap), endAt(`${cap}`), limit(10)));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function searchByKey(name, term, extra = []) {
  const k = keyOf(term);
  if (k.length < 1) return [];
  const snap = await getDocs(query(col(name), ...extra, orderBy('nameKey'), startAt(k), endAt(`${k}`), limit(15)));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function batchesOf(drugId) {
  const snap = await getDocs(query(col('stockBatches'), where('drugId', '==', drugId), where('qty', '>', 0), limit(50)));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

// ---------------------------------------------------------------- invoices
/**
 * Creates an invoice with the next number of its series. Medicine lines ({drugId, qty}) are allocated
 * FEFO from stock batches and deducted in the same transaction. Optional first payment.
 */
export async function createInvoice({ kind, desk, patient, lines, admissionId = null, payment = null, advancePaid = 0 }) {
  if (!lines.length) throw new Error('Add at least one item');
  const date = todayYmd();
  const fy = financialYear(date);
  // Allocate medicines from a fresh read; the transaction re-checks each picked batch.
  const allocated = [];
  for (const l of lines) {
    if (!l.drugId) { allocated.push(l); continue; }
    const picks = fefo(await batchesOf(l.drugId), Number(l.qty), thisMonth());
    allocated.push({ ...l, picks });
  }
  const bill = computeBill(allocated);
  const ref = doc(col('invoices'));
  const counterRef = doc(db, 'counters', `inv_${kind}_${desk}_${fy}`);
  const result = await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef);
    const batchSnaps = [];
    for (const l of allocated) for (const p of l.picks ?? []) batchSnaps.push([l, p, await tx.get(doc(db, 'stockBatches', p.batchId))]);
    for (const [l, p, s] of batchSnaps) {
      if (!s.exists() || s.data().qty < p.qty) throw new Error(`Stock of ${l.name} changed. Please try again.`);
    }
    const seq = counter.data()?.next ?? 1;
    const paidNow = Number(payment?.amount || 0) + Number(advancePaid || 0);
    const { due, status } = payState(bill.total, paidNow);
    const data = {
      number: invoiceNumber(kind, desk, fy, seq), kind, desk, fy, date,
      patientId: patient.id ?? null, patientName: patient.name ?? 'Walk-in', phone: patient.phone ?? '',
      admissionId, ...bill, paid: paidNow, due, status, createdBy: me(), createdAt: serverTimestamp(),
    };
    tx.set(counterRef, { next: seq + 1 }, { merge: true });
    for (const [l, p] of batchSnaps) {
      tx.update(doc(db, 'stockBatches', p.batchId), { qty: increment(-p.qty) });
      tx.update(doc(db, 'drugs', l.drugId), { stock: increment(-p.qty) });
    }
    tx.set(ref, data);
    if (payment?.amount > 0) {
      tx.set(doc(col('receipts')), receipt(data, ref.id, payment.amount, payment.mode, payment.ref, 'Payment'));
    }
    return data;
  });
  logAudit('Billing', 'Created Invoice', 'Billing', `${result.number} · ${result.patientName} · ₹${result.total}`);
  return { ...result, id: ref.id };
}

const receipt = (inv, invoiceId, amount, mode, ref, type) => ({
  invoiceId, number: inv.number, kind: inv.kind, patientName: inv.patientName, admissionId: inv.admissionId ?? null,
  amount: Number(amount), mode, ref: ref ?? '', type, date: todayYmd(), by: me(), uid: auth.currentUser.uid, at: serverTimestamp(),
});

/** Records a payment (or partial payment) against an invoice. */
export async function addPayment(invoiceId, amount, mode, ref = '') {
  const a = Number(amount);
  if (!(a > 0)) throw new Error('Enter an amount');
  const invRef = doc(db, 'invoices', invoiceId);
  await runTransaction(db, async (tx) => {
    const inv = (await tx.get(invRef)).data();
    if (inv.status === 'Cancelled') throw new Error('Invoice is cancelled');
    if (a > inv.due + 0.001) throw new Error(`Only ₹${inv.due} is due`);
    const paid = Math.round((inv.paid + a) * 100) / 100;
    tx.update(invRef, { paid, ...payState(inv.total, paid) });
    tx.set(doc(col('receipts')), receipt(inv, invoiceId, a, mode, ref, 'Payment'));
  });
  logAudit('Billing', 'Recorded Payment', 'Billing', `₹${a} ${mode} on invoice ${invoiceId}`);
}

/** Cancels an invoice: restores medicine stock and records a refund of anything paid. Admins only. */
export async function cancelInvoice(invoiceId, reason, refundMode = 'Cash') {
  const invRef = doc(db, 'invoices', invoiceId);
  await runTransaction(db, async (tx) => {
    const inv = (await tx.get(invRef)).data();
    if (inv.status === 'Cancelled') return;
    for (const l of inv.lines) for (const p of l.picks ?? []) {
      tx.update(doc(db, 'stockBatches', p.batchId), { qty: increment(p.qty) });
      tx.update(doc(db, 'drugs', l.drugId), { stock: increment(p.qty) });
    }
    tx.update(invRef, { status: 'Cancelled', due: 0, cancelReason: reason, cancelledBy: me() });
    if (inv.paid > 0) tx.set(doc(col('receipts')), receipt(inv, invoiceId, -inv.paid, refundMode, reason, 'Refund'));
  });
  logAudit('Billing', 'Cancelled Invoice', 'Billing', `${invoiceId}: ${reason}`);
}

/** WhatsApp click-to-chat summary of an invoice (no medical details). */
export function invoiceWhatsApp(inv, hospital = 'ABC Hospital') {
  let digits = (inv.phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11) return null;
  const text = [
    `${hospital} · Bill ${inv.number}`,
    `Patient: ${inv.patientName}`,
    `Amount: ₹${inv.total} · Paid: ₹${inv.paid} · Due: ₹${inv.due}`,
    inv.due > 0 ? 'Please clear the balance at the billing counter.' : 'Thank you. Payment received in full.',
  ].join('\n');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------- pharmacy
export async function saveDrug(id, d) {
  const data = { ...d, nameKey: keyOf(d.name), mrp: Number(d.mrp), gstRate: Number(d.gstRate), reorderLevel: Number(d.reorderLevel || 0) };
  await runTransaction(db, async (tx) => {
    const ref = id ? doc(db, 'drugs', id) : doc(col('drugs'));
    tx.set(ref, id ? data : { ...data, stock: 0 }, { merge: true });
  });
}

export async function saveSupplier(id, s) {
  const ref = id ? doc(db, 'suppliers', id) : doc(col('suppliers'));
  await runTransaction(db, async (tx) => tx.set(ref, { ...s, nameKey: keyOf(s.name), ...(id ? {} : { due: 0 }) }, { merge: true }));
}

/** Purchase / GRN: adds a stock batch per line and the bill to the supplier's balance. */
export async function savePurchase({ supplier, billNo, date, lines, paid = 0 }) {
  if (!lines.length) throw new Error('Add at least one item');
  const total = Math.round(lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0) * 100) / 100;
  const purchaseRef = doc(col('purchases'));
  await runTransaction(db, async (tx) => {
    for (const l of lines) {
      const units = Number(l.qty) + Number(l.free || 0);
      tx.set(doc(col('stockBatches')), {
        drugId: l.drugId, drugName: l.name, batch: l.batch, expiry: l.expiry, qty: units,
        purchaseRate: Number(l.rate), mrp: Number(l.mrp), supplierId: supplier.id, purchaseId: purchaseRef.id,
      });
      tx.update(doc(db, 'drugs', l.drugId), { stock: increment(units), mrp: Number(l.mrp) });
    }
    tx.set(purchaseRef, {
      supplierId: supplier.id, supplierName: supplier.name, billNo, date, lines, total,
      paid: Number(paid), due: total - Number(paid), createdBy: me(), createdAt: serverTimestamp(),
    });
    tx.update(doc(db, 'suppliers', supplier.id), { due: increment(total - Number(paid)) });
  });
  logAudit('Pharmacy', 'Recorded Purchase', 'Pharmacy', `${supplier.name} bill ${billNo} · ₹${total}`);
}

// ---------------------------------------------------------------- IPD
export async function saveWard(w) {
  const wardRef = doc(col('wards'));
  await runTransaction(db, async (tx) => {
    tx.set(wardRef, { name: w.name, type: w.type, ratePerDay: Number(w.ratePerDay) });
    for (let i = 1; i <= Number(w.beds); i++) {
      tx.set(doc(col('beds')), { wardId: wardRef.id, wardName: w.name, wardType: w.type, ratePerDay: Number(w.ratePerDay),
        label: `${w.prefix || w.name.slice(0, 3).toUpperCase()}-${String(i).padStart(2, '0')}`, status: 'Free', admissionId: null });
    }
  });
}

/** Admits a patient to a free bed; an optional advance becomes a receipt against the admission. */
export async function admit({ patient, bed, doctor, department, diagnosis, advance = 0, mode = 'Cash' }) {
  const ref = doc(col('admissions'));
  await runTransaction(db, async (tx) => {
    const b = await tx.get(doc(db, 'beds', bed.id));
    if (b.data().status !== 'Free') throw new Error(`Bed ${bed.label} is no longer free`);
    tx.update(b.ref, { status: 'Occupied', admissionId: ref.id, patientName: patient.name });
    tx.set(ref, {
      patientId: patient.id ?? null, patientName: patient.name, phone: patient.phone ?? '', doctor, department, diagnosis,
      bedId: bed.id, bedLabel: bed.label, wardName: bed.wardName, wardType: bed.wardType, ratePerDay: bed.ratePerDay,
      admittedAt: Timestamp.now(), date: todayYmd(), status: 'Admitted', advance: Number(advance), createdBy: me(),
    });
    if (advance > 0) {
      tx.set(doc(col('receipts')), {
        admissionId: ref.id, invoiceId: null, number: null, kind: 'IPD', patientName: patient.name, amount: Number(advance),
        mode, ref: '', type: 'Advance', date: todayYmd(), by: me(), uid: auth.currentUser.uid, at: serverTimestamp(),
      });
    }
  });
  logAudit('IPD', 'Admitted Patient', 'IPD', `${patient.name} → ${bed.label}`);
  return ref.id;
}

export async function addCharge(admissionId, c) {
  await runTransaction(db, async (tx) => tx.set(doc(collection(db, 'admissions', admissionId, 'charges')), {
    name: c.name, category: c.category ?? 'Service', qty: Number(c.qty), rate: Number(c.rate),
    gstRate: Number(c.gstRate || 0), date: todayYmd(), by: me(), at: serverTimestamp(),
  }));
}

/** Room rent line(s) + recorded charges for an admission, as invoice lines. */
export async function dischargeLines(adm, nowMs = Date.now()) {
  const days = bedDays(adm.admittedAt.toMillis(), nowMs);
  // Room rent up to ₹5,000/day (and ICU) is GST-exempt; above that 5% applies.
  const roomGst = adm.wardType !== 'ICU' && adm.ratePerDay > 5000 ? 5 : 0;
  const charges = await getDocs(collection(db, 'admissions', adm.id, 'charges'));
  return [
    { name: `Room rent · ${adm.wardName} (${adm.bedLabel})`, category: 'Room', qty: days, rate: adm.ratePerDay, gstRate: roomGst },
    ...charges.docs.map((d) => { const c = d.data(); return { name: c.name, category: c.category, qty: c.qty, rate: c.rate, gstRate: c.gstRate }; }),
  ];
}

/** Final bill: creates the IPD invoice (advance counted as paid), frees the bed, closes the admission. */
export async function discharge(adm, desk, lines, payment) {
  const inv = await createInvoice({
    kind: 'IPD', desk, admissionId: adm.id, lines, payment, advancePaid: adm.advance,
    patient: { id: adm.patientId, name: adm.patientName, phone: adm.phone },
  });
  await runTransaction(db, async (tx) => {
    tx.update(doc(db, 'admissions', adm.id), { status: 'Discharged', dischargedAt: serverTimestamp(), invoiceId: inv.id });
    tx.update(doc(db, 'beds', adm.bedId), { status: 'Cleaning', admissionId: null, patientName: null });
  });
  logAudit('IPD', 'Discharged Patient', 'IPD', `${adm.patientName} · ${inv.number}`);
  return inv;
}

// ---------------------------------------------------------------- reports (server-side aggregates)
export async function collectionReport(from, to) {
  const modes = ['Cash', 'UPI', 'Card', 'Insurance'];
  const base = [where('date', '>=', from), where('date', '<=', to)];
  const byMode = await Promise.all(modes.map(async (m) => {
    const a = await getAggregateFromServer(query(col('receipts'), ...base, where('mode', '==', m)), { amount: sum('amount'), n: count() });
    return { mode: m, ...a.data() };
  }));
  const kinds = ['OPD', 'IPD', 'PHARMACY'];
  // Firestore allows at most 5 aggregations per query, so the sums go in two queries.
  const fields = { total: sum('total'), due: sum('due'), cgst: sum('cgst'), sgst: sum('sgst'), taxable: sum('taxable'), n: count() };
  const agg = async (q) => ({
    ...(await getAggregateFromServer(q, { total: fields.total, due: fields.due, n: fields.n })).data(),
    ...(await getAggregateFromServer(q, { cgst: fields.cgst, sgst: fields.sgst, taxable: fields.taxable })).data(),
  });
  const byKind = await Promise.all(kinds.map(async (k) => {
    const all = await agg(query(col('invoices'), ...base, where('kind', '==', k)));
    const cancelled = await agg(query(col('invoices'), ...base, where('kind', '==', k), where('status', '==', 'Cancelled')));
    // Cancelled invoices keep their number (GST series has no gaps) but don't count as revenue.
    const net = Object.fromEntries(Object.keys(fields).map((f) => [f, Math.round(((all[f] ?? 0) - (cancelled[f] ?? 0)) * 100) / 100]));
    return { kind: k, ...net, cancelled: cancelled.n };
  }));
  return { byMode, byKind };
}

export { PAGE, query, where, orderBy, limit, doc };
