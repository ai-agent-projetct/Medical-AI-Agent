// HL7 v2 results from lab analysers (ORU^R01), as sent by the analyser's LIS interface or an interface
// engine (e.g. Mirth) on the hospital network. Pure parsing; the labResults function writes the values.
//
//   MSH|^~\&|ANALYSER|LAB|HIS|HOSP|20261126101500||ORU^R01|MSG0001|P|2.5.1
//   PID|1||PAT-1001||Menon^Rahul
//   OBR|1|S261126001||CBC^Complete blood count
//   OBX|1|NM|HB^Haemoglobin||10.5|g/dL|12-16|L|||F
//
// Sample id: OBR-2 (placer order no.), else OBR-3 (filler order no.) = labOrders.sampleId printed on the tube label.

/** Splits a message into segments of fields; tolerant of \r, \n and \r\n separators. */
export function parseHl7(text) {
  const lines = String(text ?? '').replace(/^\u000b|\u001c\r?$/g, '').split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (!lines[0]?.startsWith('MSH')) throw new Error('Not an HL7 v2 message (no MSH segment)');
  const fs = lines[0][3];
  const comp = lines[0][4];
  return lines.map((l) => {
    const f = l.split(fs);
    // MSH-1 is the field separator itself, so MSH fields are shifted by one.
    return l.startsWith('MSH') ? ['MSH', fs, ...f.slice(1)] : f;
  }).map((f) => ({ id: f[0], f, c: (i) => String(f[i] ?? '').split(comp) }));
}

/**
 * ORU^R01 → [{sampleId, controlId, results: [{code, name, value, unit, range, flag}]}] (one entry per OBR).
 * Throws for other message types.
 */
export function oruResults(text) {
  const segs = parseHl7(text);
  const msh = segs[0];
  const type = msh.c(9);
  if (type[0] !== 'ORU') throw new Error(`Unsupported message type ${type.join('^')}`);
  const controlId = msh.f[10] ?? '';
  const out = [];
  for (const s of segs) {
    if (s.id === 'OBR') out.push({ sampleId: (s.c(2)[0] || s.c(3)[0] || '').trim(), controlId, results: [] });
    if (s.id === 'OBX' && out.length) {
      const [code, name] = s.c(3);
      out.at(-1).results.push({
        code: (code ?? '').trim().toUpperCase(), name: (name ?? '').trim(), value: String(s.f[5] ?? '').trim(),
        unit: String(s.f[6] ?? '').trim(), range: String(s.f[7] ?? '').trim(), flag: String(s.f[8] ?? '').trim().toUpperCase(),
        final: !['P', 'X', 'D'].includes(String(s.f[11] ?? 'F').trim().toUpperCase()),
      });
    }
  }
  return out;
}

const hl7Time = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** HL7 acknowledgement: AA accepted, AE error, AR rejected. */
export function ack(controlId, code = 'AA', text = '') {
  return [`MSH|^~\\&|HIS|HOSPITAL|ANALYSER|LAB|${hl7Time(new Date())}||ACK^R01|ACK${controlId}|P|2.5.1`,
    `MSA|${code}|${controlId}${text ? `|${text.replace(/[|^~\\&\r\n]/g, ' ')}` : ''}`].join('\r');
}

/**
 * Applies analyser results to a lab order's tests (matched by test code, else by name). Machine flags are
 * kept only when the order line has no reference range of its own. Returns {tests, matched, unmatched}.
 */
export function applyResults(tests, results, flagOf) {
  const out = tests.map((t) => ({ ...t }));
  const unmatched = [];
  let matched = 0;
  for (const r of results.filter((x) => x.final && x.value !== '')) {
    const t = out.find((x) => x.code === r.code) ?? out.find((x) => r.name && x.name?.toLowerCase() === r.name.toLowerCase());
    if (!t) { unmatched.push(r.code || r.name); continue; }
    t.value = r.value;
    t.flag = flagOf(r.value, t) || (t.low === undefined && t.high === undefined ? r.flag.replace(/[^LH]/g, '') : '');
    t.note = t.note || `Analyser${r.unit && r.unit !== t.unit ? ` (${r.unit})` : ''}`;
    matched++;
  }
  return { tests: out, matched, unmatched };
}
