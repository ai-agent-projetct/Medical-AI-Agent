import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgersUsed, tallyVouchers, tallyXml } from './tally.js';

const data = {
  invoices: [
    { date: '2026-11-26', number: 'OPD/C1/2026-27/000001', kind: 'OPD', patientName: 'Rahul & Co', total: 1180, taxable: 1000, cgst: 90, sgst: 90, status: 'Paid' },
    { date: '2026-11-26', number: 'PH/2026-27/000002', kind: 'PHARMACY', total: 113, taxable: 100.89, cgst: 6.05, sgst: 6.05, status: 'Partial' },
    { date: '2026-11-26', number: 'X', kind: 'OPD', total: 500, taxable: 500, cgst: 0, sgst: 0, status: 'Cancelled' },
  ],
  receipts: [
    { date: '2026-11-26', number: 'OPD/C1/2026-27/000001', type: 'Payment', patientName: 'Rahul', amount: 1180, mode: 'UPI', ref: 'UTR1' },
    { date: '2026-11-26', number: 'PH/2026-27/000002', type: 'Refund', amount: -13, mode: 'Cash' },
  ],
  expenses: [
    { date: '2026-11-25', paidOn: '2026-11-26', head: 'Electricity', vendor: 'TNEB', billNo: 'EB-9', amount: 11800, gst: 1800, mode: 'Bank transfer', status: 'Paid' },
    { date: '2026-11-26', head: 'Rent', amount: 50000, gst: 0, mode: 'Cash', status: 'Unpaid' },
  ],
};

test('every voucher balances (debits = credits), cancelled and unpaid skipped', () => {
  const v = tallyVouchers(data);
  assert.equal(v.length, 5);
  for (const x of v) assert.equal(Math.round(x.lines.reduce((s, l) => s + l.amount, 0) * 100), 0, x.number);
  const ph = v.find((x) => x.number.startsWith('PH/') && x.type === 'Sales');
  assert.equal(ph.lines.find((l) => l.ledger === 'Round Off').amount, 0.01);
  assert.equal(v.find((x) => x.narration.startsWith('Refund')).type, 'Payment');
});

test('XML: Tally import envelope, sign convention, escaping, dates', () => {
  const xml = tallyXml(data, 'City General Hospital');
  assert.match(xml, /<TALLYREQUEST>Import Data<\/TALLYREQUEST>/);
  assert.match(xml, /<SVCURRENTCOMPANY>City General Hospital<\/SVCURRENTCOMPANY>/);
  assert.match(xml, /<VOUCHER VCHTYPE="Sales" ACTION="Create">\s*<DATE>20261126<\/DATE>/);
  assert.match(xml, /<LEDGERNAME>Patients \(Sundry Debtors\)<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-1180.00<\/AMOUNT>/);
  assert.match(xml, /<LEDGERNAME>OPD Income<\/LEDGERNAME><ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE><AMOUNT>1000.00<\/AMOUNT>/);
  assert.match(xml, /Rahul &amp; Co/);
  assert.doesNotMatch(xml, /<AMOUNT>0.00<\/AMOUNT>/);
  assert.deepEqual(ledgersUsed(data), ['Bank', 'Bank - UPI', 'Cash', 'Electricity', 'Input GST', 'OPD Income', 'Output CGST', 'Output SGST', 'Patients (Sundry Debtors)', 'Pharmacy Sales', 'Round Off']);
});
