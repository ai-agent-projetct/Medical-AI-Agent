// Pure clinical / HR calculations shared by the hospital suite pages (unit-tested in clinical.test.mjs).
// Decision support only: every score and alert is advisory and shown next to the raw values.

const band = (v, steps) => { for (const [max, pts] of steps) if (v <= max) return pts; return steps.at(-1)[1]; };

/**
 * NEWS2 (Royal College of Physicians, 2017; SpO2 scale 1). Missing values score 0 and are listed.
 * v: {rr, spo2, o2 (bool, on supplemental oxygen), sbp, hr, avpu ('A' | 'C' | 'V' | 'P' | 'U'), temp}
 */
export function news2(v) {
  const n = (x) => (x === '' || x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(x));
  const parts = {
    rr: n(v.rr) === null ? null : band(n(v.rr), [[8, 3], [11, 1], [20, 0], [24, 2], [Infinity, 3]]),
    spo2: n(v.spo2) === null ? null : band(n(v.spo2), [[91, 3], [93, 2], [95, 1], [Infinity, 0]]),
    o2: v.o2 ? 2 : 0,
    sbp: n(v.sbp) === null ? null : band(n(v.sbp), [[90, 3], [100, 2], [110, 1], [219, 0], [Infinity, 3]]),
    hr: n(v.hr) === null ? null : band(n(v.hr), [[40, 3], [50, 1], [90, 0], [110, 1], [130, 2], [Infinity, 3]]),
    avpu: !v.avpu || v.avpu === 'A' ? 0 : 3,
    temp: n(v.temp) === null ? null : band(n(v.temp), [[35, 3], [36, 1], [38, 0], [39, 1], [Infinity, 2]]),
  };
  const score = Object.values(parts).reduce((s, p) => s + (p ?? 0), 0);
  const redFlag = Object.values(parts).some((p) => p === 3);
  const risk = score >= 7 ? 'High' : score >= 5 ? 'Medium' : redFlag ? 'Low-Medium' : 'Low';
  const action = {
    High: 'Emergency response: inform the doctor now, consider ICU / critical-care review, continuous monitoring.',
    Medium: 'Urgent review by the doctor; observations at least hourly.',
    'Low-Medium': 'One parameter is extreme: urgent ward-based review by the doctor.',
    Low: score === 0 ? 'Routine observations every 12 hours.' : 'Inform the nurse in charge; observations every 4–6 hours.',
  }[risk];
  const missing = Object.entries(parts).filter(([, p]) => p === null).map(([k]) => k);
  return { score, risk, action, parts, missing };
}

/** Result flag against reference and critical limits: '', 'L', 'H', 'LL' (critical low), 'HH' (critical high). */
export function labFlag(value, t) {
  if (value === '' || value === null || value === undefined || t.low === undefined && t.high === undefined) return '';
  const x = Number(value);
  if (Number.isNaN(x)) return '';
  if (t.critLow !== undefined && x < t.critLow) return 'LL';
  if (t.critHigh !== undefined && x > t.critHigh) return 'HH';
  if (t.low !== undefined && x < t.low) return 'L';
  if (t.high !== undefined && x > t.high) return 'H';
  return '';
}

// Adult reference ranges (common Indian lab defaults); the hospital can edit them per order line.
// ponytail: fixed master in code; move to a per-hospital labMaster collection when labs need their own ranges.
export const LAB_TESTS = [
  { code: 'HB', name: 'Haemoglobin', unit: 'g/dL', low: 12, high: 16, critLow: 7, critHigh: 20, rate: 150, dept: 'Haematology' },
  { code: 'WBC', name: 'Total WBC count', unit: '×10³/µL', low: 4, high: 11, critLow: 2, critHigh: 30, rate: 150, dept: 'Haematology' },
  { code: 'PLT', name: 'Platelet count', unit: '×10³/µL', low: 150, high: 450, critLow: 50, critHigh: 1000, rate: 150, dept: 'Haematology' },
  { code: 'ESR', name: 'ESR', unit: 'mm/hr', low: 0, high: 20, rate: 100, dept: 'Haematology' },
  { code: 'FBS', name: 'Glucose (fasting)', unit: 'mg/dL', low: 70, high: 100, critLow: 50, critHigh: 400, rate: 80, dept: 'Biochemistry' },
  { code: 'PPBS', name: 'Glucose (post-prandial)', unit: 'mg/dL', low: 70, high: 140, critLow: 50, critHigh: 400, rate: 80, dept: 'Biochemistry' },
  { code: 'RBS', name: 'Glucose (random)', unit: 'mg/dL', low: 70, high: 140, critLow: 50, critHigh: 400, rate: 80, dept: 'Biochemistry' },
  { code: 'HBA1C', name: 'HbA1c', unit: '%', low: 4, high: 5.6, rate: 450, dept: 'Biochemistry' },
  { code: 'UREA', name: 'Blood urea', unit: 'mg/dL', low: 15, high: 40, critHigh: 150, rate: 150, dept: 'Biochemistry' },
  { code: 'CREAT', name: 'Serum creatinine', unit: 'mg/dL', low: 0.6, high: 1.2, critHigh: 5, rate: 150, dept: 'Biochemistry' },
  { code: 'NA', name: 'Sodium', unit: 'mmol/L', low: 135, high: 145, critLow: 120, critHigh: 160, rate: 200, dept: 'Biochemistry' },
  { code: 'K', name: 'Potassium', unit: 'mmol/L', low: 3.5, high: 5.1, critLow: 2.8, critHigh: 6.2, rate: 200, dept: 'Biochemistry' },
  { code: 'TBIL', name: 'Total bilirubin', unit: 'mg/dL', low: 0.3, high: 1.2, critHigh: 15, rate: 150, dept: 'Biochemistry' },
  { code: 'SGOT', name: 'SGOT (AST)', unit: 'U/L', low: 5, high: 40, rate: 150, dept: 'Biochemistry' },
  { code: 'SGPT', name: 'SGPT (ALT)', unit: 'U/L', low: 7, high: 56, rate: 150, dept: 'Biochemistry' },
  { code: 'CHOL', name: 'Total cholesterol', unit: 'mg/dL', low: 0, high: 200, rate: 150, dept: 'Biochemistry' },
  { code: 'TG', name: 'Triglycerides', unit: 'mg/dL', low: 0, high: 150, rate: 150, dept: 'Biochemistry' },
  { code: 'HDL', name: 'HDL cholesterol', unit: 'mg/dL', low: 40, high: 100, rate: 150, dept: 'Biochemistry' },
  { code: 'LDL', name: 'LDL cholesterol', unit: 'mg/dL', low: 0, high: 100, rate: 150, dept: 'Biochemistry' },
  { code: 'TSH', name: 'TSH', unit: 'µIU/mL', low: 0.4, high: 4, rate: 350, dept: 'Immunology' },
  { code: 'CRP', name: 'C-reactive protein', unit: 'mg/L', low: 0, high: 5, rate: 400, dept: 'Immunology' },
  { code: 'TROP', name: 'Troponin I', unit: 'ng/mL', low: 0, high: 0.04, critHigh: 0.4, rate: 900, dept: 'Immunology' },
  { code: 'NS1', name: 'Dengue NS1 antigen', unit: '', qualitative: true, rate: 600, dept: 'Serology' },
  { code: 'MP', name: 'Malaria parasite', unit: '', qualitative: true, rate: 200, dept: 'Serology' },
  { code: 'URINE', name: 'Urine routine', unit: '', qualitative: true, rate: 150, dept: 'Clinical pathology' },
  { code: 'BG', name: 'Blood group & Rh', unit: '', qualitative: true, rate: 100, dept: 'Haematology' },
];
export const LAB_PANELS = {
  CBC: ['HB', 'WBC', 'PLT', 'ESR'], RFT: ['UREA', 'CREAT', 'NA', 'K'], LFT: ['TBIL', 'SGOT', 'SGPT'],
  'Lipid profile': ['CHOL', 'TG', 'HDL', 'LDL'], Diabetes: ['FBS', 'PPBS', 'HBA1C'], Fever: ['NS1', 'MP', 'WBC', 'PLT', 'CRP'],
};

// Major interactions worth stopping for (subset; advisory, not a substitute for a drug database).
const INTERACTIONS = [
  [['warfarin', 'acenocoumarol'], ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'ketorolac', 'clopidogrel'], 'Bleeding risk: anticoagulant with antiplatelet / NSAID.'],
  [['sildenafil', 'tadalafil'], ['nitroglycerin', 'isosorbide', 'nicorandil'], 'Severe hypotension: PDE-5 inhibitor with nitrate.'],
  [['enalapril', 'ramipril', 'lisinopril', 'telmisartan', 'losartan'], ['spironolactone', 'potassium chloride', 'eplerenone'], 'Hyperkalaemia: ACE inhibitor / ARB with potassium-sparing drug.'],
  [['simvastatin', 'atorvastatin', 'lovastatin'], ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole'], 'Myopathy / rhabdomyolysis: statin with strong CYP3A4 inhibitor.'],
  [['tramadol'], ['sertraline', 'fluoxetine', 'escitalopram', 'paroxetine', 'linezolid'], 'Serotonin syndrome and seizures.'],
  [['methotrexate'], ['ibuprofen', 'diclofenac', 'naproxen', 'cotrimoxazole', 'trimethoprim'], 'Methotrexate toxicity.'],
  [['digoxin'], ['amiodarone', 'verapamil', 'clarithromycin'], 'Digoxin toxicity: levels rise.'],
  [['clopidogrel'], ['omeprazole', 'esomeprazole'], 'Reduced antiplatelet effect; prefer pantoprazole.'],
  [['metformin'], ['iodinated contrast', 'contrast'], 'Lactic acidosis: hold metformin around contrast.'],
  [['ciprofloxacin', 'levofloxacin', 'azithromycin', 'ondansetron'], ['amiodarone', 'haloperidol', 'domperidone'], 'QT prolongation.'],
];
const ALLERGY_CLASSES = {
  penicillin: ['amoxicillin', 'ampicillin', 'piperacillin', 'penicillin', 'cloxacillin', 'augmentin'],
  sulfa: ['cotrimoxazole', 'sulfamethoxazole', 'sulfasalazine'],
  nsaid: ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'ketorolac', 'mefenamic'],
  cephalosporin: ['cefixime', 'ceftriaxone', 'cefuroxime', 'cephalexin', 'cefpodoxime'],
};

/** Interaction and allergy alerts for a list of drug names against the patient's allergies. */
export function rxAlerts(drugs, allergies = []) {
  const names = drugs.map((d) => String(d).toLowerCase());
  const has = (list) => names.filter((n) => list.some((x) => n.includes(x)));
  const alerts = [];
  for (const [a, b, why] of INTERACTIONS) {
    const x = has(a); const y = has(b);
    if (x.length && y.length) alerts.push({ level: 'danger', text: `${x[0]} + ${y[0]}: ${why}` });
  }
  for (const al of allergies.map((s) => String(s).toLowerCase().trim()).filter(Boolean)) {
    const cls = Object.entries(ALLERGY_CLASSES).find(([k, list]) => al.includes(k) || list.some((x) => al.includes(x)));
    const hit = cls ? has(cls[1]) : names.filter((n) => n.includes(al));
    if (hit.length) alerts.push({ level: 'danger', text: `Allergy to ${al}: ${hit.join(', ')}` });
  }
  return alerts;
}

/** Emergency Severity Index levels with the target time to be seen by a doctor (minutes). */
export const ESI = [
  { level: 1, label: 'Resuscitation', color: '#b91c1c', target: 0 },
  { level: 2, label: 'Emergent', color: '#ea580c', target: 10 },
  { level: 3, label: 'Urgent', color: '#ca8a04', target: 30 },
  { level: 4, label: 'Less urgent', color: '#16a34a', target: 60 },
  { level: 5, label: 'Non-urgent', color: '#2563eb', target: 120 },
];

/**
 * Monthly salary (India): PF 12% of basic capped at ₹15,000 (employee and employer), ESI 0.75% / 3.25%
 * when gross ≤ ₹21,000, professional tax and TDS as set on the employee, loss of pay for unpaid days.
 * e: {basic, hra, allowances, pf (bool), esi (bool), pt, tds}; days: {inMonth, lop}
 */
export function payslip(e, days = { inMonth: 30, lop: 0 }) {
  const r = (x) => Math.round(x);
  const full = Number(e.basic || 0) + Number(e.hra || 0) + Number(e.allowances || 0);
  const factor = Math.max(0, (days.inMonth - (days.lop || 0)) / days.inMonth);
  const basic = Number(e.basic || 0) * factor;
  const gross = r(full * factor);
  const pfBase = Math.min(basic, 15000);
  const pf = e.pf ? r(pfBase * 0.12) : 0;
  const esiOn = e.esi && full <= 21000;
  const esi = esiOn ? Math.ceil(gross * 0.0075) : 0;
  const pt = gross > 0 ? Number(e.pt || 0) : 0;
  const tds = Number(e.tds || 0);
  const deductions = pf + esi + pt + tds;
  return {
    gross, lopAmount: r(full - gross), pf, esi, pt, tds, deductions, net: gross - deductions,
    employerPf: e.pf ? r(pfBase * 0.12) : 0, employerEsi: esiOn ? Math.ceil(gross * 0.0325) : 0,
  };
}

/** Age in years from yyyy-mm-dd (or '' if unknown). */
export const ageOf = (dob) => {
  if (!dob) return '';
  const d = new Date(dob); const n = new Date();
  return n.getFullYear() - d.getFullYear() - (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
};
