import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bedDays, computeBill, fefo, financialYear, invoiceNumber, payState } from './billing.js';

test('financial year runs April to March', () => {
  assert.equal(financialYear('2026-04-01'), '2026-27');
  assert.equal(financialYear('2027-03-31'), '2026-27');
  assert.equal(financialYear('2099-12-01'), '2099-00');
  assert.equal(invoiceNumber('OPD', 'C1', '2026-27', 42), 'OPD/C1/2026-27/000042');
});

test('GST is back-calculated from inclusive rates and split CGST/SGST', () => {
  const b = computeBill([
    { name: 'Paracetamol', qty: 2, rate: 32, gstRate: 12 },
    { name: 'Consultation', qty: 1, rate: 500, gstRate: 0 },
    { name: 'Dressing', qty: 1, rate: 199.5, gstRate: 18, discountPct: 10 },
  ]);
  assert.equal(b.gross, 763.5);
  assert.equal(b.discount, 19.95);
  // 64 incl. 12% → taxable 57.14, tax 6.86; 179.55 incl. 18% → taxable 152.16, tax 27.39
  assert.equal(b.taxable, 709.30);
  assert.equal(b.cgst + b.sgst, 34.25);
  assert.equal(b.cgst, 17.12);
  assert.equal(b.total, 744);
  assert.equal(b.roundOff, 0.45);
  assert.equal(b.lines[2].amount, 179.55);
});

test('payment state', () => {
  assert.deepEqual(payState(744, 0), { due: 744, status: 'Unpaid' });
  assert.deepEqual(payState(744, 500), { due: 244, status: 'Partial' });
  assert.deepEqual(payState(744, 744), { due: 0, status: 'Paid' });
  assert.deepEqual(payState(0.3, 0.1), { due: 0.2, status: 'Partial' });
});

test('FEFO picks earliest non-expired batches and refuses short stock', () => {
  const batches = [
    { id: 'b1', batch: 'A1', expiry: '2027-06', qty: 5 },
    { id: 'b2', batch: 'A2', expiry: '2026-12', qty: 3 },
    { id: 'b3', batch: 'OLD', expiry: '2026-10', qty: 50 },
  ];
  assert.deepEqual(fefo(batches, 6, '2026-11'), [
    { batchId: 'b2', batch: 'A2', expiry: '2026-12', qty: 3 },
    { batchId: 'b1', batch: 'A1', expiry: '2027-06', qty: 3 },
  ]);
  assert.throws(() => fefo(batches, 9, '2026-11'), /Only 8 in stock/);
});

test('bed days: each started 24h, minimum one', () => {
  const h = 3_600_000;
  assert.equal(bedDays(0, 2 * h), 1);
  assert.equal(bedDays(0, 24 * h), 1);
  assert.equal(bedDays(0, 25 * h), 2);
});
