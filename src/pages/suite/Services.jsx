import React from 'react';
import { todayYmd } from '../../hms';
import { Registry } from './kit';
import { LIFE_BENEFITS, SCHEMES } from '../hms/Claims';

const P = { k: 'patient', label: 'Patient', patient: true };
const soon = (days) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA');
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const NABH = ['Hand hygiene compliance (%)', 'Patient falls per 1000 patient-days', 'Medication errors per 1000 prescriptions', 'Surgical site infection rate (%)',
  'CLABSI per 1000 central-line days', 'CAUTI per 1000 catheter days', 'VAP per 1000 ventilator days', 'OPD waiting time (min)', 'Bed occupancy (%)',
  'Average length of stay (days)', 'Return to ICU within 48 h (%)', 'Re-intubation within 48 h (%)', 'Mortality rate (%)', 'Transfusion reactions (%)',
  'Patient satisfaction (%)', 'Discharge time after advice (min)', 'Needle-stick injuries (count)'];

// One register per support service; each collection is hospital-scoped and audited (firestore.rules suite()).
export const SERVICES = {
  coverage: {
    collection: 'insuranceCovers', title: 'Insurance Coverage', desc: 'Every patient\'s cover in one place: private and corporate health insurance, government schemes (PM-JAY, CGHS, ECHS, ESIC, state schemes) and life policies (hospital cash, critical illness, accident, death benefit), with sum insured, balance and validity.',
    statuses: ['Active', 'Verification pending', 'Exhausted', 'Expired'], columns: ['patientName', 'coverType', 'insurer', 'policyNo', 'validTo'],
    fields: [P, { k: 'coverType', label: 'Cover type', options: SCHEMES }, { k: 'insurer', label: 'Insurer / scheme authority', required: true }, { k: 'tpa', label: 'TPA' },
      { k: 'policyNo', label: 'Policy / card no.', required: true }, { k: 'memberId', label: 'Member / beneficiary ID (PM-JAY ID, ABHA, UHID)' },
      { k: 'policyHolder', label: 'Policy holder / employer' }, { k: 'relation', label: 'Patient is', options: ['Self', 'Spouse', 'Child', 'Parent', 'Employee', 'Dependant'] },
      { k: 'sumInsured', label: 'Sum insured / family floater (₹)', type: 'number' }, { k: 'balance', label: 'Balance available (₹)', type: 'number' },
      { k: 'roomLimit', label: 'Room rent limit (₹/day)', type: 'number' }, { k: 'copayPct', label: 'Co-pay %', type: 'number' },
      { k: 'lifeBenefits', label: 'Life policy benefits', options: ['—', ...LIFE_BENEFITS] }, { k: 'nominee', label: 'Nominee (life policy)' },
      { k: 'validFrom', label: 'Valid from', type: 'date' }, { k: 'validTo', label: 'Valid till', type: 'date' },
      { k: 'docsVerified', label: 'Card / KYC documents verified', type: 'checkbox' }, { k: 'notes', label: 'Exclusions / waiting periods / notes', type: 'textarea' }],
    extraStats: (rows) => [['Life policies', rows.filter((r) => r.coverType === 'Life insurance').length], ['Government schemes', rows.filter((r) => /PM-JAY|CGHS|ECHS|ESIC|State/.test(r.coverType)).length]],
    alerts: (rows) => [
      ...rows.filter((r) => r.status === 'Active' && r.validTo && r.validTo < todayYmd()).map((r) => `${r.patientName}: ${r.insurer} ${r.policyNo} expired on ${r.validTo}`),
      ...rows.filter((r) => r.status === 'Active' && r.validTo >= todayYmd() && r.validTo <= soon(30)).map((r) => `${r.patientName}: ${r.insurer} ${r.policyNo} expires ${r.validTo}`),
      ...rows.filter((r) => r.status === 'Active' && r.sumInsured > 0 && Number(r.balance) < Number(r.sumInsured) * 0.1).map((r) => `${r.patientName}: less than 10% of the sum insured left (${r.insurer})`),
    ],
  },
  radiology: {
    collection: 'radiologyOrders', title: 'Radiology & Imaging', desc: 'Imaging orders (X-ray, CT, MRI, ultrasound, ECG, echo), scan status, structured reports with findings and impression, verified reports visible to the patient.',
    statuses: ['Ordered', 'Scanned', 'Reported', 'Verified', 'Cancelled'],
    fields: [P, { k: 'modality', label: 'Modality', options: ['X-ray', 'CT', 'MRI', 'Ultrasound', 'Mammography', 'Doppler', 'ECG', 'Echo', 'DEXA', 'Fluoroscopy'] },
      { k: 'study', label: 'Study / part', required: true }, { k: 'priority', label: 'Priority', options: ['Routine', 'Urgent', 'STAT'] }, { k: 'doctor', label: 'Referring doctor' },
      { k: 'contrast', label: 'With contrast', type: 'checkbox' }, { k: 'clinical', label: 'Clinical history', full: true },
      { k: 'findings', label: 'Findings', type: 'textarea' }, { k: 'impression', label: 'Impression', type: 'textarea' }, { k: 'radiologist', label: 'Reported by' }, { k: 'date', label: 'Date', type: 'date' },
      { k: 'accessionNo', label: 'PACS accession no.' }, { k: 'studyUid', label: 'DICOM Study Instance UID' }, { k: 'imagesUrl', label: 'Images link (PACS / DICOM viewer URL)', full: true }],
    columns: ['patientName', 'modality', 'study', 'priority', 'imagesUrl'],
    alerts: (rows) => rows.filter((r) => r.contrast && r.status === 'Ordered').map((r) => `${r.patientName}: contrast study — check creatinine, allergy and metformin before the scan.`),
  },
  bloodbank: {
    collection: 'bloodUnits', title: 'Blood Bank', desc: 'Blood bag inventory by group and component, screening, cross-match, reservation and issue to patients, expiry tracking.',
    statuses: ['Quarantine', 'Available', 'Reserved', 'Issued', 'Discarded'], columns: ['bagNo', 'group', 'component', 'expiry', 'patientName'],
    fields: [{ k: 'bagNo', label: 'Bag no.', required: true }, { k: 'group', label: 'Blood group', options: GROUPS },
      { k: 'component', label: 'Component', options: ['Whole blood', 'PRBC', 'FFP', 'Platelet concentrate', 'Cryoprecipitate'] }, { k: 'volume', label: 'Volume (ml)', type: 'number' },
      { k: 'donor', label: 'Donor / source' }, { k: 'collected', label: 'Collected on', type: 'date' }, { k: 'expiry', label: 'Expiry', type: 'date' },
      { k: 'screening', label: 'TTI screening (HIV, HBV, HCV, syphilis, malaria)', options: ['Pending', 'Non-reactive', 'Reactive'] },
      { ...P, label: 'Reserved / issued to' }, { k: 'crossmatch', label: 'Cross-match', options: ['Not done', 'Compatible', 'Incompatible'] }],
    extraStats: (rows) => [['Available units', rows.filter((r) => r.status === 'Available').length], ['Expiring in 3 days', rows.filter((r) => r.status === 'Available' && r.expiry <= soon(3)).length, 'warning']],
    alerts: (rows) => [
      ...rows.filter((r) => ['Available', 'Reserved'].includes(r.status) && r.expiry && r.expiry <= soon(3)).map((r) => `Bag ${r.bagNo} (${r.group} ${r.component}) expires ${r.expiry}`),
      ...GROUPS.filter((g) => rows.filter((r) => r.group === g && r.status === 'Available').length < 2).map((g) => `Low stock: ${g} (${rows.filter((r) => r.group === g && r.status === 'Available').length} available)`),
      ...rows.filter((r) => r.screening === 'Reactive' && r.status !== 'Discarded').map((r) => `Bag ${r.bagNo} is TTI reactive: discard it.`),
    ],
  },
  ambulance: {
    collection: 'ambulanceTrips', title: 'Ambulance', desc: 'Ambulance requests and dispatch, crew, pick-up and drop, trip status, distance and charges.',
    statuses: ['Requested', 'Dispatched', 'Picked up', 'Arrived', 'Completed', 'Cancelled'], columns: ['vehicle', 'patientName', 'pickup', 'drop', 'type'],
    fields: [{ k: 'vehicle', label: 'Vehicle no.', required: true }, { k: 'type', label: 'Trip type', options: ['Emergency', 'Inter-hospital transfer', 'Discharge drop', 'Mortuary van', 'Event standby'] },
      P, { k: 'callerPhone', label: 'Caller phone' }, { k: 'pickup', label: 'Pick-up address', full: true }, { k: 'drop', label: 'Drop', full: true },
      { k: 'driver', label: 'Driver' }, { k: 'paramedic', label: 'Paramedic / EMT' }, { k: 'callTime', label: 'Call time', type: 'time' }, { k: 'km', label: 'Distance (km)', type: 'number' }, { k: 'charge', label: 'Charge (₹)', type: 'number' }],
  },
  diet: {
    collection: 'dietOrders', title: 'Diet & Kitchen', desc: 'Therapeutic diet orders for in-patients by meal, allergies, preparation and delivery to the bed.',
    statuses: ['Ordered', 'Prepared', 'Delivered', 'Cancelled'], columns: ['patientName', 'bed', 'diet', 'meal', 'date'],
    fields: [P, { k: 'bed', label: 'Bed' }, { k: 'diet', label: 'Diet', options: ['Normal', 'Soft', 'Liquid', 'Clear liquid', 'Diabetic', 'Renal', 'Cardiac / low salt', 'High protein', 'Ryles tube feed', 'NPO'] },
      { k: 'meal', label: 'Meal', options: ['Breakfast', 'Lunch', 'Evening snack', 'Dinner', 'Feed (2-hourly)'] }, { k: 'date', label: 'Date', type: 'date' }, { k: 'allergies', label: 'Food allergies' }, { k: 'notes', label: 'Dietitian notes', full: true }],
  },
  housekeeping: {
    collection: 'housekeeping', title: 'Housekeeping', desc: 'Cleaning requests and bed turnaround after discharge, spills, terminal cleaning and bio-medical waste pickups.',
    statuses: ['Open', 'In progress', 'Done', 'Verified'], columns: ['area', 'task', 'priority', 'assignedTo', 'date'],
    fields: [{ k: 'area', label: 'Area / bed', required: true }, { k: 'task', label: 'Task', options: ['Bed cleaning after discharge', 'Spill clean-up', 'Terminal cleaning (isolation)', 'Routine cleaning', 'Bio-medical waste pickup', 'Toilet cleaning', 'Pest control'] },
      { k: 'priority', label: 'Priority', options: ['Normal', 'Urgent'] }, { k: 'assignedTo', label: 'Assigned to' }, { k: 'date', label: 'Date', type: 'date' }, { k: 'notes', label: 'Notes', full: true }],
    alerts: (rows) => rows.filter((r) => r.priority === 'Urgent' && r.status === 'Open').map((r) => `${r.area}: ${r.task} is waiting`),
  },
  cssd: {
    collection: 'cssdBatches', title: 'CSSD (Sterilisation)', desc: 'Instrument sets received, washed and sterilised by cycle with indicator results, sterile shelf life and issue to OT / wards.',
    statuses: ['Received', 'Washing', 'Sterilizing', 'Sterile', 'Issued', 'Returned'], columns: ['setName', 'department', 'cycleNo', 'indicator', 'expiry'],
    fields: [{ k: 'setName', label: 'Instrument set', required: true }, { k: 'department', label: 'From / to department' }, { k: 'quantity', label: 'Quantity', type: 'number' },
      { k: 'method', label: 'Method', options: ['Steam autoclave', 'ETO', 'Plasma (H₂O₂)', 'Dry heat'] }, { k: 'cycleNo', label: 'Cycle / load no.' },
      { k: 'indicator', label: 'Indicator result', options: ['Pending', 'Pass', 'Fail'] }, { k: 'sterilizedOn', label: 'Sterilised on', type: 'date' }, { k: 'expiry', label: 'Sterile till', type: 'date' }],
    alerts: (rows) => [...rows.filter((r) => r.indicator === 'Fail' && r.status !== 'Received').map((r) => `${r.setName} cycle ${r.cycleNo}: indicator FAILED — recall and re-process.`),
      ...rows.filter((r) => r.status === 'Sterile' && r.expiry && r.expiry < todayYmd()).map((r) => `${r.setName}: sterility expired ${r.expiry}`)],
  },
  laundry: {
    collection: 'laundry', title: 'Laundry & Linen', desc: 'Linen sent to and received from laundry by department, with shortages and damage.',
    statuses: ['Sent', 'Received', 'Short / damaged'], columns: ['department', 'items', 'qtySent', 'qtyReturned', 'date'],
    fields: [{ k: 'department', label: 'Department / ward', required: true }, { k: 'items', label: 'Items (bedsheets, gowns…)' }, { k: 'qtySent', label: 'Qty sent', type: 'number' },
      { k: 'qtyReturned', label: 'Qty returned', type: 'number' }, { k: 'soiled', label: 'Infected / soiled linen', type: 'checkbox' }, { k: 'vendor', label: 'Laundry / vendor' }, { k: 'date', label: 'Date', type: 'date' }],
  },
  visitors: {
    collection: 'visitors', title: 'Visitors & Passes', desc: 'Visitor passes for in-patients with ID, relation, in and out time.',
    statuses: ['In', 'Out'], columns: ['name', 'patientName', 'bed', 'relation', 'inTime'],
    fields: [{ k: 'name', label: 'Visitor name', required: true }, { k: 'phone', label: 'Phone' }, P, { k: 'bed', label: 'Bed / ward' }, { k: 'relation', label: 'Relation' },
      { k: 'purpose', label: 'Purpose', options: ['Visit', 'Attendant', 'Delivery', 'Official'] }, { k: 'idType', label: 'ID shown', options: ['Aadhaar', 'Driving licence', 'Voter ID', 'Other'] },
      { k: 'passNo', label: 'Pass no.' }, { k: 'date', label: 'Date', type: 'date' }, { k: 'inTime', label: 'In', type: 'time' }, { k: 'outTime', label: 'Out', type: 'time' }],
  },
  vaccination: {
    collection: 'vaccinations', title: 'Vaccination', desc: 'Immunisation schedule per patient (national schedule and adult vaccines), due and overdue doses, batch and site of each dose given.',
    statuses: ['Due', 'Given', 'Missed'], columns: ['patientName', 'vaccine', 'dose', 'dueDate', 'givenDate'],
    fields: [P, { k: 'vaccine', label: 'Vaccine', options: ['BCG', 'Hepatitis B', 'OPV', 'Pentavalent', 'Rotavirus', 'PCV', 'IPV', 'MR', 'JE', 'DPT booster', 'Typhoid', 'Hepatitis A', 'Varicella', 'HPV', 'Influenza', 'Td / Tdap', 'Rabies', 'COVID-19', 'Pneumococcal (adult)'] },
      { k: 'dose', label: 'Dose' }, { k: 'dueDate', label: 'Due on', type: 'date' }, { k: 'givenDate', label: 'Given on', type: 'date' }, { k: 'batch', label: 'Batch' }, { k: 'site', label: 'Site' }, { k: 'givenBy', label: 'Given by' }],
    alerts: (rows) => rows.filter((r) => r.status === 'Due' && r.dueDate && r.dueDate < todayYmd()).map((r) => `${r.patientName}: ${r.vaccine} ${r.dose} overdue since ${r.dueDate} (${r.phone})`),
  },
  feedback: {
    collection: 'feedback', title: 'Patient Feedback', desc: 'Feedback and complaints by department with ratings, actions taken and closure.',
    statuses: ['Open', 'Acted upon', 'Closed'], columns: ['patientName', 'department', 'category', 'rating', 'channel'],
    fields: [P, { k: 'department', label: 'Department' }, { k: 'category', label: 'About', options: ['Doctor', 'Nursing', 'Billing', 'Cleanliness', 'Food', 'Waiting time', 'Front office', 'Pharmacy', 'Other'] },
      { k: 'rating', label: 'Rating (1–5)', options: ['5', '4', '3', '2', '1'] }, { k: 'channel', label: 'Channel', options: ['Discharge form', 'Phone', 'WhatsApp', 'Google review', 'Walk-in'] },
      { k: 'comments', label: 'Comments', type: 'textarea' }, { k: 'action', label: 'Action taken', type: 'textarea' }],
    extraStats: (rows) => [['Average rating', rows.length ? (rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length).toFixed(1) : '—'], ['Complaints (≤ 2★)', rows.filter((r) => Number(r.rating) <= 2).length, 'warning']],
    alerts: (rows) => rows.filter((r) => Number(r.rating) <= 2 && r.status === 'Open').map((r) => `${r.patientName} rated ${r.category} ${r.rating}★: ${r.comments ?? ''}`),
  },
  incidents: {
    collection: 'incidents', title: 'Incidents & Safety', desc: 'Patient-safety incident reporting (falls, medication errors, needle-stick, near misses) with root cause and corrective / preventive action (NABH).',
    statuses: ['Reported', 'Investigating', 'CAPA done', 'Closed'], columns: ['type', 'area', 'severity', 'date', 'reportedBy'],
    fields: [{ k: 'type', label: 'Type', options: ['Patient fall', 'Medication error', 'Needle-stick injury', 'Near miss', 'Equipment failure', 'Wrong site / patient', 'Pressure sore', 'Fire / electrical', 'Violence', 'Other'] },
      { k: 'date', label: 'Date', type: 'date' }, { k: 'area', label: 'Area' }, { k: 'severity', label: 'Severity', options: ['Near miss', 'Minor', 'Moderate', 'Major', 'Sentinel event'] },
      { k: 'reportedBy', label: 'Reported by' }, { k: 'description', label: 'What happened', type: 'textarea' }, { k: 'rootCause', label: 'Root cause', type: 'textarea' }, { k: 'capa', label: 'Corrective / preventive action', type: 'textarea' }],
    alerts: (rows) => rows.filter((r) => ['Major', 'Sentinel event'].includes(r.severity) && r.status !== 'Closed').map((r) => `${r.severity}: ${r.type} in ${r.area} on ${r.date}`),
  },
  quality: {
    collection: 'qualityIndicators', title: 'Quality Indicators (NABH)', desc: 'Monthly NABH key performance indicators with numerator, denominator, target and status.',
    statuses: ['Within target', 'Off target', 'Not measured'], columns: ['indicator', 'month', 'value', 'target'],
    fields: [{ k: 'indicator', label: 'Indicator', options: NABH }, { k: 'month', label: 'Month', type: 'month' }, { k: 'numerator', label: 'Numerator', type: 'number' },
      { k: 'denominator', label: 'Denominator', type: 'number' }, { k: 'value', label: 'Value', type: 'number' }, { k: 'target', label: 'Target', type: 'number' }, { k: 'notes', label: 'Analysis / action', type: 'textarea' }],
    defaults: { month: todayYmd().slice(0, 7) },
  },
};

export default function Services({ module }) {
  const c = SERVICES[module];
  return <Registry key={module} {...c} />;
}
