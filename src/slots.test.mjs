// Run: node --test src/slots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSlots, to12h } from './slots.js';

test('to12h', () => {
  assert.equal(to12h('00:05'), '12:05 AM');
  assert.equal(to12h('12:00'), '12:00 PM');
  assert.equal(to12h('14:30'), '02:30 PM');
});

test('30-min slots inside sessions, booked ones removed, partial tail dropped', () => {
  const slots = generateSlots([{ from: '09:00', to: '10:45' }, { from: '14:00', to: '15:00' }], ['09:30 AM']);
  assert.deepEqual(slots, ['09:00 AM', '10:00 AM', '02:00 PM', '02:30 PM']);
});
