import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, purchaseLinesFromCsv } from './csv.js';

test('parses quotes, escaped quotes and embedded commas/newlines', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""q"""\r\n1,"x\ny",3\n\n'), [['a', 'b,c', 'd "q"'], ['1', 'x\ny', '3']]);
});

test('purchase CSV → lines with loose headers, expiry formats and row errors', () => {
  const master = { 'paracetamol 650 mg': { id: 'd1', name: 'Paracetamol 650 mg' } };
  const find = (n) => master[n.toLowerCase()] ?? null;
  const csv = '﻿Item Name,Batch No,Exp,Qty,Free Qty,PTR,MRP\n'
    + 'Paracetamol 650 mg,ab12,08/27,10,2,20.5,32\n'
    + 'Unknown Drug,x1,2027-01,5,0,10,20\n'
    + 'Paracetamol 650 mg,c3,13-2027x,5,0,10,32\n'
    + 'Paracetamol 650 mg,d4,2028-3,1,0,abc,32\n';
  const { lines, errors } = purchaseLinesFromCsv(csv, find);
  assert.deepEqual(lines, [{ drugId: 'd1', name: 'Paracetamol 650 mg', batch: 'AB12', expiry: '2027-08', qty: 10, free: 2, rate: 20.5, mrp: 32 }]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Row 3: "Unknown Drug" is not in the item master/);
  assert.match(errors[1], /Row 4: expiry/);
  assert.match(errors[2], /Row 5: quantity, rate and MRP/);
  assert.deepEqual(purchaseLinesFromCsv('name,qty\nx,1', find).errors, ['Missing column(s): batch, expiry, rate, mrp']);
});
