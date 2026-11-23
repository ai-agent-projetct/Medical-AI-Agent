/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * Supplier purchase CSV → purchase lines. Header names are matched loosely (case/spaces ignored):
 * item|name|product, batch, expiry|exp (yyyy-MM, MM/yyyy or MM/yy), qty|quantity, free, rate|purchase rate|ptr, mrp.
 * Returns {lines, errors}; `findDrug(name)` resolves an item name to {id, name} or null.
 */
export function purchaseLinesFromCsv(text, findDrug) {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!head) return { lines: [], errors: ['The file is empty'] };
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const col = (...names) => head.findIndex((h) => names.includes(norm(h)));
  const idx = {
    name: col('item', 'name', 'product', 'itemname', 'productname'), batch: col('batch', 'batchno'),
    expiry: col('expiry', 'exp', 'expirydate'), qty: col('qty', 'quantity'), free: col('free', 'freeqty'),
    rate: col('rate', 'purchaserate', 'ptr', 'cost'), mrp: col('mrp'),
  };
  const missing = ['name', 'batch', 'expiry', 'qty', 'rate', 'mrp'].filter((k) => idx[k] < 0);
  if (missing.length) return { lines: [], errors: [`Missing column(s): ${missing.join(', ')}`] };
  const lines = [], errors = [];
  rows.forEach((r, i) => {
    const at = `Row ${i + 2}`;
    const name = (r[idx.name] ?? '').trim();
    const drug = findDrug(name);
    if (!drug) return errors.push(`${at}: "${name}" is not in the item master`);
    const expiry = toYearMonth((r[idx.expiry] ?? '').trim());
    if (!expiry) return errors.push(`${at}: expiry "${r[idx.expiry]}" not understood (use yyyy-MM or MM/yyyy)`);
    const qty = Number(r[idx.qty]), rate = Number(r[idx.rate]), mrp = Number(r[idx.mrp]), free = idx.free >= 0 ? Number(r[idx.free] || 0) : 0;
    if (!(qty > 0) || !(rate >= 0) || !(mrp > 0) || !(free >= 0)) return errors.push(`${at}: quantity, rate and MRP must be numbers`);
    const batch = (r[idx.batch] ?? '').trim().toUpperCase();
    if (!batch) return errors.push(`${at}: batch is empty`);
    lines.push({ drugId: drug.id, name: drug.name, batch, expiry, qty, free, rate, mrp });
  });
  return { lines, errors };
}

function toYearMonth(s) {
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${m[1].padStart(2, '0')}`;
  return null;
}
