import test from 'node:test';
import assert from 'node:assert/strict';
import { news2, labFlag, rxAlerts, payslip, LAB_TESTS, LAB_PANELS } from './clinical.js';

test('NEWS2: normal adult scores 0', () => {
  const r = news2({ rr: 16, spo2: 98, o2: false, sbp: 120, hr: 72, avpu: 'A', temp: 37 });
  assert.equal(r.score, 0); assert.equal(r.risk, 'Low'); assert.deepEqual(r.missing, []);
});

test('NEWS2: septic picture is high risk', () => {
  // rr 26 (3) spo2 92 (2) o2 (2) sbp 95 (2) hr 125 (2) confused (3) temp 39.4 (2) = 16
  const r = news2({ rr: 26, spo2: 92, o2: true, sbp: 95, hr: 125, avpu: 'C', temp: 39.4 });
  assert.equal(r.score, 16); assert.equal(r.risk, 'High');
});

test('NEWS2: single extreme value is low-medium; band edges', () => {
  assert.equal(news2({ rr: 16, spo2: 98, sbp: 120, hr: 40, temp: 37 }).risk, 'Low-Medium');
  assert.equal(news2({ sbp: 220 }).parts.sbp, 3);
  assert.equal(news2({ sbp: 219 }).parts.sbp, 0);
  assert.equal(news2({ temp: 38 }).parts.temp, 0);
  assert.equal(news2({ temp: 38.1 }).parts.temp, 1);
  assert.equal(news2({ rr: 21, hr: 91, spo2: 95 }).score, 4);
  assert.deepEqual(news2({ hr: 80 }).missing, ['rr', 'spo2', 'sbp', 'temp']);
});

test('lab flags: normal, abnormal, critical', () => {
  const k = LAB_TESTS.find((t) => t.code === 'K');
  assert.equal(labFlag('4.2', k), '');
  assert.equal(labFlag('5.5', k), 'H');
  assert.equal(labFlag('3.1', k), 'L');
  assert.equal(labFlag('6.8', k), 'HH');
  assert.equal(labFlag('2.5', k), 'LL');
  assert.equal(labFlag('', k), '');
  assert.equal(labFlag('Positive', LAB_TESTS.find((t) => t.code === 'NS1')), '');
  for (const codes of Object.values(LAB_PANELS)) for (const c of codes) assert.ok(LAB_TESTS.some((t) => t.code === c), c);
});

test('rx alerts: interaction and allergy class', () => {
  const a = rxAlerts(['Warfarin 5mg', 'Aspirin 75mg'], ['Penicillin']);
  assert.equal(a.length, 1); assert.match(a[0].text, /Bleeding/);
  assert.match(rxAlerts(['Amoxicillin 500mg'], ['penicillin'])[0].text, /Allergy to penicillin: amoxicillin/);
  assert.deepEqual(rxAlerts(['Paracetamol 650mg'], ['sulfa']), []);
});

test('payslip: PF cap, ESI threshold, LOP', () => {
  const hi = payslip({ basic: 30000, hra: 12000, allowances: 8000, pf: true, esi: true, pt: 200, tds: 1000 });
  assert.equal(hi.gross, 50000); assert.equal(hi.pf, 1800); assert.equal(hi.esi, 0);
  assert.equal(hi.net, 50000 - 1800 - 200 - 1000);
  const lo = payslip({ basic: 10000, hra: 4000, allowances: 2000, pf: true, esi: true, pt: 0 }, { inMonth: 30, lop: 3 });
  assert.equal(lo.gross, 14400); assert.equal(lo.lopAmount, 1600);
  assert.equal(lo.pf, 1080); assert.equal(lo.esi, 108); assert.equal(lo.employerEsi, 468);
});
