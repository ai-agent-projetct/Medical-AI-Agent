// Tally Prime / Tally ERP 9 export: invoices → Sales vouchers, receipts → Receipt (refunds → Payment) vouchers,
// paid expenses → Payment vouchers, as a Tally XML import file (Gateway of Tally › Import › Vouchers).
// Tally sign convention: debit amounts are negative with ISDEEMEDPOSITIVE=Yes, credits positive with No.
// The ledgers must exist in the Tally company (names below, editable per hospital in Accounts).

export const DEFAULT_LEDGERS = {
  debtors: 'Patients (Sundry Debtors)',
  income: { OPD: 'OPD Income', IPD: 'IPD Income', PHARMACY: 'Pharmacy Sales' },
  cgst: 'Output CGST', sgst: 'Output SGST', inputGst: 'Input GST', roundOff: 'Round Off',
  modes: { Cash: 'Cash', UPI: 'Bank - UPI', Card: 'Bank - Card', Insurance: 'Bank - Insurance Settlements', 'Bank transfer': 'Bank', Cheque: 'Bank' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const tdate = (ymd) => String(ymd).replace(/-/g, '');

/** Ledger lines {ledger, amount}: amount > 0 credit, < 0 debit. */
function voucher(type, { date, number, narration, party }, lines) {
  const rows = lines.filter((l) => r2(l.amount) !== 0).map((l) => `
      <ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${r2(l.amount) < 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${r2(l.amount).toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('');
  return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create">
      <DATE>${tdate(date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(number)}</VOUCHERNUMBER>
      ${party ? `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>` : ''}<NARRATION>${esc(narration)}</NARRATION>${rows}
    </VOUCHER></TALLYMESSAGE>`;
}

/** The vouchers as ledger lines (balanced), for checking and for the XML. */
export function tallyVouchers({ invoices = [], receipts = [], expenses = [] }, L = DEFAULT_LEDGERS) {
  const out = [];
  for (const i of invoices.filter((x) => x.status !== 'Cancelled')) {
    out.push({ type: 'Sales', date: i.date, number: i.number, party: L.debtors, narration: `${i.patientName ?? ''} ${i.kind} bill`, lines: [
      { ledger: L.debtors, amount: -r2(i.total) },
      { ledger: L.income[i.kind] ?? L.income.OPD, amount: r2(i.taxable) },
      { ledger: L.cgst, amount: r2(i.cgst) }, { ledger: L.sgst, amount: r2(i.sgst) },
      { ledger: L.roundOff, amount: r2(r2(i.total) - r2(i.taxable) - r2(i.cgst) - r2(i.sgst)) },
    ] });
  }
  for (const p of receipts) {
    const bank = L.modes[p.mode] ?? L.modes.Cash;
    const a = r2(p.amount);
    out.push({ type: a >= 0 ? 'Receipt' : 'Payment', date: p.date, number: p.number ? `${p.number}/${p.type ?? ''}` : '', party: L.debtors,
      narration: `${p.type ?? 'Payment'} ${p.patientName ?? ''} ${p.mode} ${p.ref ?? ''}`.trim(),
      lines: [{ ledger: bank, amount: -a }, { ledger: L.debtors, amount: a }] });
  }
  for (const e of expenses.filter((x) => x.status === 'Paid')) {
    const gst = r2(e.gst);
    out.push({ type: 'Payment', date: e.paidOn ?? e.date, number: e.billNo ?? '', narration: `${e.head} · ${e.vendor ?? ''}`,
      lines: [{ ledger: e.head, amount: -r2(r2(e.amount) - gst) }, { ledger: L.inputGst, amount: -gst }, { ledger: L.modes[e.mode] ?? L.modes.Cash, amount: r2(e.amount) }] });
  }
  return out;
}

/** Tally XML import file for the given company name. */
export function tallyXml(data, company, L = DEFAULT_LEDGERS) {
  const body = tallyVouchers(data, L).map((v) => voucher(v.type, v, v.lines)).join('');
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>
    <REQUESTDATA>${body}
    </REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>
`;
}

/** Every ledger the vouchers use (to create once in Tally before the first import). */
export const ledgersUsed = (data, L = DEFAULT_LEDGERS) => [...new Set(tallyVouchers(data, L).flatMap((v) => v.lines.filter((l) => r2(l.amount) !== 0).map((l) => l.ledger)))].sort();
