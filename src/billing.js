// Pure billing logic shared by the Billing, Pharmacy and IPD pages (tested in billing.test.mjs).
// All rates are tax-inclusive (MRP style, as Indian pharmacies and hospitals print them); GST is
// back-calculated and split equally into CGST + SGST (intra-state supply).
// Money is computed in paise (integers) and returned in rupees with 2 decimals.

const paise = (rupees) => Math.round(Number(rupees || 0) * 100);
const rupees = (p) => Math.round(p) / 100;

/** Indian financial year label for a yyyy-MM-dd date: April–March, e.g. "2026-27". */
export function financialYear(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** GST invoice number: one gap-free series per kind, billing desk and financial year. */
export const invoiceNumber = (kind, desk, fy, seq) => `${kind}/${desk}/${fy}/${String(seq).padStart(6, '0')}`;

/**
 * Totals for invoice lines {qty, rate, discountPct?, gstRate?}. Returns the lines with their computed
 * amounts plus bill totals; `total` is rounded to the rupee with the difference in `roundOff`.
 */
export function computeBill(lines) {
  let gross = 0, discount = 0, taxable = 0, tax = 0, net = 0;
  const out = lines.map((l) => {
    const g = paise(l.rate) * Number(l.qty || 0);
    const d = Math.round(g * Number(l.discountPct || 0) / 100);
    const n = g - d;
    const t = Math.round(n - n / (1 + Number(l.gstRate || 0) / 100));
    gross += g; discount += d; net += n; tax += t; taxable += n - t;
    return { ...l, amount: rupees(n), taxable: rupees(n - t), tax: rupees(t) };
  });
  const total = Math.round(net / 100) * 100;
  const cgst = Math.floor(tax / 2);
  return {
    lines: out,
    gross: rupees(gross),
    discount: rupees(discount),
    taxable: rupees(taxable),
    cgst: rupees(cgst),
    sgst: rupees(tax - cgst),
    roundOff: rupees(total - net),
    total: rupees(total),
  };
}

/** Payment status after `paid` rupees against `total`. */
export function payState(total, paid) {
  const due = rupees(paise(total) - paise(paid));
  return { due: Math.max(0, due), status: paid <= 0 ? 'Unpaid' : due > 0 ? 'Partial' : 'Paid' };
}

/**
 * First-expiry-first-out allocation of `qty` units from batches [{id, expiry: 'yyyy-MM', qty}].
 * Skips batches expired as of `month` (yyyy-MM). Throws if stock is short.
 */
export function fefo(batches, qty, month) {
  const usable = batches.filter((b) => b.qty > 0 && b.expiry >= month).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const picks = [];
  let left = qty;
  for (const b of usable) {
    if (left <= 0) break;
    const take = Math.min(b.qty, left);
    picks.push({ batchId: b.id, batch: b.batch, expiry: b.expiry, qty: take });
    left -= take;
  }
  if (left > 0) throw new Error(`Only ${qty - left} in stock (non-expired)`);
  return picks;
}

/** Billable bed-days: every started 24 hours counts, minimum one day. */
export function bedDays(admittedMs, dischargedMs) {
  return Math.max(1, Math.ceil((dischargedMs - admittedMs) / 86_400_000));
}
