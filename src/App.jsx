import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  Activity, Users, Calendar, Phone, Video, Sparkles, CreditCard,
  TrendingUp, UserPlus, ShieldCheck, Bell, Settings, HeartPulse, FileText,
  Lock, AlertCircle, Pill, PenTool, Eye, Layers, HelpCircle, Shield, Zap, Bot, Stethoscope, Cpu, LogOut
} from 'lucide-react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { serverTimestamp } from 'firebase/firestore';
import {
  auth, firebaseEnabled, useLiveCollection, reserveSlot, loadUserRole, ROLE_LABELS, logAudit, useAuditLogs, markBooked, seedCatalog, WINDOWS,
  tenant, pickHospital, signOutLogged,
} from './firebase';
import Login from './pages/Login';
import SuperAdmin from './pages/SuperAdmin';
import UsersRoles from './pages/UsersRoles';
import Equipment from './pages/Equipment';
const CallRoom = lazy(() => import('./pages/CallRoom')); // Zego SDK is ~5 MB; only load it for calls

import Dashboard from './pages/Dashboard';
import Doctors from './pages/Doctors';
import Patients from './pages/Patients';
import Departments from './pages/Departments';
import Appointments from './pages/Appointments';
import IVRCalls from './pages/IVRCalls';
import OnlineConsultations from './pages/OnlineConsultations';
import AIScribe from './pages/AIScribe';
import Payments from './pages/Payments';
import Revenue from './pages/Revenue';
import StaffManagement from './pages/StaffManagement';
import RolesPermissions from './pages/RolesPermissions';
import Notifications from './pages/Notifications';
import HospitalSettings from './pages/HospitalSettings';
import SystemHealth from './pages/SystemHealth';
import AuditLogs from './pages/AuditLogs';
import Orders from './pages/Orders';
import Billing from './pages/hms/Billing';
import ChargeMaster from './pages/hms/ChargeMaster';
import Pharmacy from './pages/hms/Pharmacy';
import Ipd from './pages/hms/Ipd';
import HmsReports from './pages/hms/HmsReports';
import Claims from './pages/hms/Claims';
import VoiceAgent from './pages/VoiceAgent';
import catalog from './catalog.json';

// Specification & Feature Pages
import PrescriptionTemplates from './pages/PrescriptionTemplates';
import DigitalSignature from './pages/DigitalSignature';
import ProfileVisibility from './pages/ProfileVisibility';
import PayoutBatchPlanner from './pages/PayoutBatchPlanner';
import SupportHelp from './pages/SupportHelp';
import PrivacyPolicy from './pages/PrivacyPolicy';
import FreedAIScribe from './pages/FreedAIScribe';
import AgenticAiConsole from './pages/AgenticAiConsole';
import AiPrescriptionPrinter from './pages/AiPrescriptionPrinter';
import FuturisticCareMatrix from './pages/FuturisticCareMatrix';

// Routes: #/call/<appointmentId> is the public video room (patients have no account);
// everything else is the staff portal, behind Firebase Auth when Firebase is configured.
export default function App() {
  const callMatch = window.location.hash.match(/^#\/call\/([\w-]+)/);
  const [session, setSession] = useState(firebaseEnabled ? undefined : { role: 'Super Admin', isAdmin: true });

  useEffect(() => {
    if (!firebaseEnabled || callMatch) return undefined;
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return setSession(null);
      const role = await loadUserRole(user.uid).catch(() => null);
      const label = role === 'patient' ? null : ROLE_LABELS[role] ?? null;
      const blocked = role === 'super_admin' ? null
        : tenant.profile?.active === false ? 'This account is disabled. Ask your hospital admin to enable it.'
        : label && !tenant.hospital?.name ? 'This account is not linked to a hospital.'
        : tenant.hospital?.status === 'Suspended' ? `${tenant.hospital.name} is suspended on the platform. Contact the service provider.`
        : null;
      // One Login entry per browser session (onAuthStateChanged also fires on every page reload).
      const key = `loginLogged:${user.uid}`;
      let logged = true;
      try { logged = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch { /* ignore */ }
      if (label && !blocked && !logged) logAudit(label, 'Login', 'Authentication', `Signed in to the portal as ${user.email}`);
      return setSession({ user, role: label, blocked, isSuper: role === 'super_admin', isAdmin: ['super_admin', 'admin', 'hospital_admin'].includes(role) });
    });
  }, []);

  if (callMatch) {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    return <Suspense fallback={null}><CallRoom roomId={callMatch[1]} callKey={params.get('k') ?? ''} presetName={params.get('name') ?? ''} /></Suspense>;
  }
  if (session === undefined) return null;
  if (session === null) return <Login />;
  if (!session.role || session.blocked) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="card" style={{ maxWidth: 440 }}>
          <h3>{session.blocked ? 'Access blocked' : 'No portal role assigned'}</h3>
          <p style={{ color: 'var(--text-muted)' }}>{session.blocked ?? `Ask the hospital admin to set your role for ${session.user.email}.`}</p>
          <button className="btn btn-secondary" onClick={() => signOut(auth)}><LogOut size={16} /> Sign out</button>
        </div>
      </div>
    );
  }
  return <Portal initialRole={session.role} canSwitchRole={session.isAdmin} isSuper={session.isSuper} />;
}

// Which portal tabs each role sees (editable at runtime in the RBAC page). Firestore rules are the real guard.
const PLATFORM_TABS = ['platform', 'audit', 'support', 'privacy', 'health'];
const BASE_PERMISSIONS = {
  'Super Admin': ['platform', 'users', 'assets', 'voice', 'hms-billing', 'hms-pos', 'hms-pharmacy', 'hms-ipd', 'hms-claims', 'hms-tariff', 'hms-reports', 'dashboard', 'futuristic', 'agentic', 'doctors', 'patients', 'departments', 'appointments', 'ivr', 'online', 'scribe', 'freed', 'printer', 'prescriptions', 'signature', 'profile', 'payouts', 'payments', 'orders', 'revenue', 'staff', 'roles', 'notifications', 'settings', 'support', 'privacy', 'health', 'audit'],
  'Hospital Admin': ['users', 'assets', 'voice', 'hms-billing', 'hms-pos', 'hms-pharmacy', 'hms-ipd', 'hms-claims', 'hms-tariff', 'hms-reports', 'dashboard', 'futuristic', 'agentic', 'doctors', 'patients', 'departments', 'appointments', 'ivr', 'online', 'scribe', 'freed', 'printer', 'prescriptions', 'payouts', 'payments', 'orders', 'revenue', 'notifications', 'settings', 'support', 'privacy', 'health', 'audit'],
  'Doctor': ['hms-ipd', 'dashboard', 'futuristic', 'agentic', 'doctors', 'patients', 'appointments', 'online', 'scribe', 'freed', 'printer', 'prescriptions', 'signature', 'profile', 'payouts', 'support', 'privacy', 'health'],
  'Receptionist': ['voice', 'hms-billing', 'hms-ipd', 'dashboard', 'agentic', 'patients', 'appointments', 'orders', 'ivr', 'online', 'notifications', 'support', 'health'],
  'Pharmacist': ['hms-pos', 'hms-pharmacy', 'hms-tariff', 'support'],
  'Billing Staff': ['hms-billing', 'hms-pos', 'hms-ipd', 'hms-claims', 'hms-tariff', 'hms-reports', 'dashboard', 'agentic', 'patients', 'appointments', 'payouts', 'payments', 'orders', 'revenue', 'support', 'health'],
  'Nurse': ['hms-ipd', 'dashboard', 'patients', 'appointments', 'online', 'assets', 'support', 'privacy'],
  'Lab Technician': ['dashboard', 'patients', 'appointments', 'assets', 'support', 'privacy'],
  'Administration': ['dashboard', 'assets', 'departments', 'staff', 'notifications', 'support', 'privacy', 'health'],
};

// Plan modules a hospital has bought (hospitals/{id}.modules); tabs of other modules are hidden.
const MODULE_OF = {
  'hms-billing': 'billing', 'hms-pos': 'pharmacy', 'hms-pharmacy': 'pharmacy', 'hms-ipd': 'ipd', 'hms-claims': 'billing',
  'hms-tariff': 'billing', 'hms-reports': 'billing', voice: 'voice', ivr: 'voice', agentic: 'voice', assets: 'assets',
  online: 'telehealth', scribe: 'ai', freed: 'ai', printer: 'ai', futuristic: 'ai',
};
const hasModule = (key) => !firebaseEnabled || !tenant.hospital?.modules || !MODULE_OF[key] || tenant.hospital.modules.includes(MODULE_OF[key]);

function Portal({ initialRole, canSwitchRole, isSuper }) {
  // The super admin without a hospital picked works in the platform console only.
  const platformOnly = isSuper && firebaseEnabled && !tenant.hospitalId;
  const [currentRole, setCurrentRole] = useState(initialRole);
  const [activeTab, setActiveTab] = useState(platformOnly ? 'platform' : initialRole === 'Pharmacist' ? 'hms-pos' : 'dashboard');
  const [showNotificationsDrawer, setShowNotificationsDrawer] = useState(false);

  // 1. Initial State for Doctors
  const [doctors, setDoctors, sampleDoctors] = useLiveCollection('doctors', [
    { id: 'DOC-001', name: 'Dr. Arun Kumar', department: 'Cardiology', specialization: 'Senior Cardiologist', qualification: 'MD DM (Cardio)', experience: '15 Years', fee: 800, availableDays: ['Mon', 'Wed', 'Fri'], availableTime: '09:00 AM - 01:00 PM', onlineConsultation: true, status: 'Active' },
    { id: 'DOC-002', name: 'Dr. Priya Sharma', department: 'Cardiology', specialization: 'Interventional Cardiology', qualification: 'MD (Gen Med) DNB', experience: '8 Years', fee: 600, availableDays: ['Tue', 'Thu', 'Sat'], availableTime: '10:00 AM - 02:00 PM', onlineConsultation: true, status: 'Active' },
    { id: 'DOC-003', name: 'Dr. Rajesh Kumar', department: 'Orthopedics', specialization: 'HOD Orthopedics', qualification: 'MS (Ortho) MCh', experience: '18 Years', fee: 1000, availableDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], availableTime: '09:00 AM - 05:00 PM', onlineConsultation: true, status: 'Active' },
    { id: 'DOC-004', name: 'Dr. Anitha Rao', department: 'Orthopedics', specialization: 'Joint Replacement', qualification: 'MS (Ortho)', experience: '6 Years', fee: 500, availableDays: ['Mon', 'Wed', 'Fri'], availableTime: '02:00 PM - 05:00 PM', onlineConsultation: false, status: 'Active' },
    { id: 'DOC-005', name: 'Dr. Sarah Mathews', department: 'Dermatology', specialization: 'HOD Dermatology', qualification: 'MD (Derm)', experience: '12 Years', fee: 700, availableDays: ['Tue', 'Thu', 'Sat'], availableTime: '09:00 AM - 01:00 PM', onlineConsultation: true, status: 'Active' }
  ]);

  // 2. Initial State for Patients
  const [patients, setPatients, samplePatients] = useLiveCollection('patients', [
    { id: 'PAT-101', name: 'Ravi Kumar', phone: '+91 98456 73221', email: 'ravi@gmail.com', dob: '1988-04-12', gender: 'Male', emergencyContactName: 'Sita Kumar (Wife)', emergencyContactPhone: '+91 98456 73222', status: 'Active' },
    { id: 'PAT-102', name: 'Priya Sharma', phone: '+91 99456 88734', email: 'priya@gmail.com', dob: '1993-08-25', gender: 'Female', emergencyContactName: 'Karan Sharma (Father)', emergencyContactPhone: '+91 99456 88730', status: 'Active' },
    { id: 'PAT-103', name: 'Karthik B.', phone: '+91 90876 54321', email: 'karthik@gmail.com', dob: '1980-11-05', gender: 'Male', emergencyContactName: 'Balan (Father)', emergencyContactPhone: '+91 90876 54320', status: 'Active' },
    { id: 'PAT-104', name: 'Meena Iyer', phone: '+91 93456 22111', email: 'meena@gmail.com', dob: '1995-02-17', gender: 'Female', emergencyContactName: 'Gopal Iyer (Husband)', emergencyContactPhone: '+91 93456 22110', status: 'Active' },
    { id: 'PAT-105', name: 'Sanjay R.', phone: '+91 97012 33445', email: 'sanjay@gmail.com', dob: '1975-06-30', gender: 'Male', emergencyContactName: 'Raji (Wife)', emergencyContactPhone: '+91 97012 33440', status: 'Active' }
  ], undefined, WINDOWS.patients);

  // 3. Initial State for Departments
  const [departments, setDepartments, sampleDepartments] = useLiveCollection('departments', [
    { name: 'Cardiology', description: 'Advanced diagnostic cardiac lab, coronary surgery care and structural heart solutions.', head: 'Dr. Arun Kumar', workingHours: '09:00 AM - 05:00 PM', defaultFee: 800, status: 'Active' },
    { name: 'Orthopedics', description: 'Joint reconstructions, spine correction, fracture trauma management and athletic physical therapy.', head: 'Dr. Rajesh Kumar', workingHours: '09:00 AM - 05:00 PM', defaultFee: 1000, status: 'Active' },
    { name: 'Dermatology', description: 'Comprehensive clinical care for skin diseases, allergies, psoriasis, eczema, and skin cancer checks.', head: 'Dr. Sarah Mathews', workingHours: '09:00 AM - 05:00 PM', defaultFee: 700, status: 'Active' }
  ]);

  // 4. Initial State for Appointments
  const [appointments, setAppointments, sampleAppointments] = useLiveCollection('appointments', [
    { id: 'APT-25871', patient: 'Ravi Kumar', doctor: 'Dr. Rajesh Kumar', department: 'Orthopedics', date: '2026-08-09', time: '10:00 AM', status: 'Confirmed', type: 'Offline', fee: 1000 },
    { id: 'APT-25872', patient: 'Priya Sharma', doctor: 'Dr. Priya Sharma', department: 'Cardiology', date: '2026-08-09', time: '11:00 AM', status: 'Checked In', type: 'Online', fee: 600 },
    { id: 'APT-25873', patient: 'Karthik B.', doctor: 'Dr. Rajesh Kumar', department: 'Orthopedics', date: '2026-08-09', time: '12:00 PM', status: 'Waiting', type: 'Offline', fee: 1000 },
    { id: 'APT-25874', patient: 'Meena Iyer', doctor: 'Dr. Sarah Mathews', department: 'Dermatology', date: '2026-08-09', time: '01:00 PM', status: 'Completed', type: 'Online', fee: 700 },
    { id: 'APT-25875', patient: 'Sanjay R.', doctor: 'Dr. Arun Kumar', department: 'Cardiology', date: '2026-08-09', time: '02:00 PM', status: 'Confirmed', type: 'Offline', fee: 800 },
    { id: 'APT-25876', patient: 'Ravi Kumar', doctor: 'Dr. Arun Kumar', department: 'Cardiology', date: '2026-08-10', time: '12:15 PM', status: 'Confirmed', type: 'Offline', fee: 800 }
  ], linkAppointment, WINDOWS.appointments);

  // Every appointment write (scheduler, dashboard quick-book, AI console) routes through here, so the
  // mobile app can find it: it queries by doctorId and shows the token number.
  async function linkAppointment(apt, isNew) {
    const doctor = doctors.find(d => d.name === apt.doctor);
    const patient = patients.find(p => p.name === apt.patient);
    const doctorId = apt.doctorId ?? doctor?.id ?? null;
    // New bookings reserve the slot + per-doctor daily token in one transaction (throws if the slot is taken).
    // ponytail: reschedules only mark the new slot taken; a clash there isn't rejected.
    const token = isNew ? apt.token ?? await reserveSlot(doctorId, apt.date, apt.time) : apt.token;
    if (!isNew && !['Cancelled', 'No-Show'].includes(apt.status)) markBooked(doctorId, apt.date, apt.time);
    return {
      ...apt,
      doctorId,
      patientId: apt.patientId ?? patient?.id ?? null,
      patientPhone: apt.patientPhone ?? patient?.phone ?? '',
      visitType: apt.visitType ?? 'General',
      ...(isNew ? { token, createdAt: serverTimestamp() } : {}),
    };
  }

  const canSeed = firebaseEnabled && canSwitchRole && !platformOnly && doctors.length === 0 && patients.length === 0;
  const loadSampleData = async () => {
    setDoctors(sampleDoctors);
    setPatients(samplePatients);
    setDepartments(sampleDepartments);
    if (isSuper) await seedCatalog(catalog); // the medicine / lab-test catalog is platform-wide
    setStaff(sampleStaff);
    setPayments(samplePayments);
    // Link by the sample lists directly: the live doctor/patient lists are still empty at this point.
    // Tokens come from linkAppointment (per doctor per day).
    setAppointments(sampleAppointments.map(a => ({
      ...a,
      doctorId: sampleDoctors.find(d => d.name === a.doctor)?.id ?? null,
      patientId: samplePatients.find(p => p.name === a.patient)?.id ?? null,
      patientPhone: samplePatients.find(p => p.name === a.patient)?.phone ?? '',
    })));
  };

  // 5. Initial State for Payments
  const [payments, setPayments, samplePayments] = useLiveCollection('payments', [
    { id: 'PAY-801', patient: 'Ravi Kumar', doctor: 'Dr. Rajesh Kumar', appointment: 'APT-25871', amount: 1000, method: 'UPI (GPay)', status: 'Paid', type: 'Offline', date: '2026-08-09' },
    { id: 'PAY-802', patient: 'Priya Sharma', doctor: 'Dr. Priya Sharma', appointment: 'APT-25872', amount: 600, method: 'Card (Visa)', status: 'Paid', type: 'Online', date: '2026-08-09' },
    { id: 'PAY-803', patient: 'Karthik B.', doctor: 'Dr. Rajesh Kumar', appointment: 'APT-25873', amount: 1000, method: 'Cash', status: 'Pending', type: 'Offline', date: '2026-08-09' },
    { id: 'PAY-804', patient: 'Meena Iyer', doctor: 'Dr. Sarah Mathews', appointment: 'APT-25874', amount: 700, method: 'Insurance (HDFC)', status: 'Paid', type: 'Online', date: '2026-08-08' },
    { id: 'PAY-805', patient: 'Sanjay R.', doctor: 'Dr. Arun Kumar', appointment: 'APT-25875', amount: 800, method: 'UPI (PhonePe)', status: 'Paid', type: 'Offline', date: '2026-08-08' }
  ], undefined, WINDOWS.payments);

  // 6. Initial State for Staff Directory
  const [staff, setStaff, sampleStaff] = useLiveCollection('staff', [
    { empId: 'EMP-101', name: 'John Doe', role: 'Receptionist', email: 'john@abchospital.com', phone: '+91 99887 76655', department: 'Front Desk / OP', status: 'Active' },
    { empId: 'EMP-102', name: 'Sarah Connor', role: 'Billing Staff', email: 'sarah@abchospital.com', phone: '+91 99887 76644', department: 'Accounts', status: 'Active' },
    { empId: 'EMP-103', name: 'Dr. Arun Kumar', role: 'Doctor', email: 'arun@abchospital.com', phone: '+91 99887 76633', department: 'Cardiology', status: 'Active' },
    { empId: 'EMP-104', name: 'James Carter', role: 'Hospital Admin', email: 'james@abchospital.com', phone: '+91 99887 76622', department: 'Operations', status: 'Active' }
  ]);

  // 7. Initial State for Audit Trail Logs
  const [demoAuditLogs, setDemoAuditLogs] = useState([
    { timestamp: '09 Aug 2026 12:30 PM', user: 'Super Admin', module: 'System Health', action: 'System Ping', details: 'Pinged all microservices nodes: Operational' },
    { timestamp: '09 Aug 2026 10:32 AM', user: 'Super Admin', module: 'Doctor Management', action: 'Added Doctor', details: 'Added Dr. Priya Sharma to Cardiology' },
    { timestamp: '09 Aug 2026 09:15 AM', user: 'Receptionist', module: 'Patient Management', action: 'Added Patient', details: 'Registered patient Ravi Kumar' },
    { timestamp: '08 Aug 2026 04:30 PM', user: 'Doctor', module: 'Appointments', action: 'Appointment Completed', details: 'Completed consultation for Meena Iyer' },
    { timestamp: '08 Aug 2026 02:15 PM', user: 'Billing Staff', module: 'Payments', action: 'Payment Refunded', details: 'Refunded PAY-799 of ₹500 to Patient K.' }
  ]);

  // Pharmacy and lab orders from the patient app
  const [orders, setOrders] = useLiveCollection('orders', [], undefined, WINDOWS.orders);

  // 8. Dynamic Access Permission Matrix per Role
  const [rolePermissions, setRolePermissions] = useState(() => (platformOnly ? { ...BASE_PERMISSIONS, 'Super Admin': PLATFORM_TABS } : BASE_PERMISSIONS));

  const liveAuditLogs = useAuditLogs(['Super Admin', 'Hospital Admin'].includes(initialRole));
  const auditLogs = firebaseEnabled ? liveAuditLogs : demoAuditLogs;

  const addAuditLog = (user, action, module, details) => {
    if (firebaseEnabled) return logAudit(user, action, module, details);
    const timeStr = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    }).replace(',', '');
    
    setDemoAuditLogs(prev => [
      { timestamp: timeStr, user, module, action, details },
      ...prev
    ]);
  };

  // Only the scripted demos (Dashboard IVR simulation, AI voice console) call this. With a real backend they
  // must not write fake bookings, payments or audit entries.
  const demoAuditLog = firebaseEnabled ? () => {} : (...args) => addAuditLog(...args);
  const addAppointment = firebaseEnabled ? () => {} : (newApt) => {
    setAppointments(prev => [newApt, ...prev]);
    const newPay = {
      id: `PAY-${Math.floor(800 + Math.random() * 200)}`,
      patient: newApt.patient,
      doctor: newApt.doctor,
      appointment: newApt.id,
      amount: newApt.fee,
      method: newApt.type === 'Online' ? 'UPI Link' : 'Cash',
      status: 'Paid',
      type: newApt.type,
      date: newApt.date
    };
    setPayments(prev => [newPay, ...prev]);
  };

  const isTabAllowed = rolePermissions[currentRole]?.includes(activeTab);
  const isHmsAdmin = ['Super Admin', 'Hospital Admin'].includes(currentRole);

  const navigationItems = [
    { key: 'platform', label: 'Hospitals, Plans & Metrics', icon: <Layers size={18} />, section: 'platform' },
    { key: 'users', label: 'Users, Roles & Logins', icon: <UserPlus size={18} />, section: 'management' },
    { key: 'assets', label: 'Equipment & Maintenance', icon: <Settings size={18} />, section: 'operations' },
    { key: 'dashboard', label: 'Dashboard', icon: <Activity size={18} />, section: 'main' },
    { key: 'futuristic', label: 'Futuristic AI Care Matrix 🚀', icon: <Cpu size={18} style={{ color: '#86198f' }} />, section: 'main' },
    { key: 'agentic', label: 'Agentic 6-Lang Voice 🤖', icon: <Bot size={18} style={{ color: '#0284c7' }} />, section: 'main' },
    { key: 'freed', label: 'Freed & OpenScribe Studio ✨', icon: <Zap size={18} style={{ color: '#a855f7' }} />, section: 'clinical' },
    { key: 'printer', label: 'AI Prescription & CDSS 🩺', icon: <Stethoscope size={18} style={{ color: '#059669' }} />, section: 'clinical' },
    { key: 'doctors', label: 'Doctors Directory', icon: <Users size={18} />, section: 'clinical' },
    { key: 'patients', label: 'Patients CRM', icon: <Users size={18} />, section: 'clinical' },
    { key: 'departments', label: 'Departments', icon: <BuildingIcon size={18} />, section: 'clinical' },
    { key: 'appointments', label: 'Appointments Scheduler', icon: <Calendar size={18} />, section: 'clinical' },
    { key: 'online', label: 'Telehealth Monitor', icon: <Video size={18} />, section: 'clinical' },
    { key: 'scribe', label: 'AI Scribe SOAP Assist', icon: <Sparkles size={18} />, section: 'clinical' },
    { key: 'prescriptions', label: 'Prescription Templates', icon: <Pill size={18} />, section: 'clinical' },
    { key: 'signature', label: 'Digital Signature', icon: <PenTool size={18} />, section: 'clinical' },
    { key: 'profile', label: 'Profile Visibility', icon: <Eye size={18} />, section: 'clinical' },
    { key: 'ivr', label: 'IVR Center & Calls', icon: <Phone size={18} />, section: 'operations' },
    { key: 'notifications', label: 'Notifications Dispatch', icon: <Bell size={18} />, section: 'operations' },
    { key: 'hms-billing', label: 'Billing Counter (OPD)', icon: <CreditCard size={18} />, section: 'hms' },
    { key: 'hms-pos', label: 'Pharmacy POS', icon: <Pill size={18} />, section: 'hms' },
    { key: 'hms-pharmacy', label: 'Pharmacy Inventory', icon: <Layers size={18} />, section: 'hms' },
    { key: 'hms-ipd', label: 'In-Patient (IPD) & Beds', icon: <HeartPulse size={18} />, section: 'hms' },
    { key: 'hms-claims', label: 'Insurance & TPA Claims', icon: <ShieldCheck size={18} />, section: 'hms' },
    { key: 'hms-tariff', label: 'Charge Master (Tariff)', icon: <FileText size={18} />, section: 'hms' },
    { key: 'hms-reports', label: 'Billing Reports', icon: <TrendingUp size={18} />, section: 'hms' },
    { key: 'payouts', label: 'Payout Batch Planner', icon: <Layers size={18} />, section: 'finance' },
    { key: 'payments', label: 'Payments Ledger', icon: <CreditCard size={18} />, section: 'finance' },
    { key: 'voice', label: 'AI Voice Receptionist (Calls)', icon: <Phone size={18} />, section: 'operations' },
    { key: 'orders', label: 'Pharmacy & Lab Orders', icon: <Pill size={18} />, section: 'operations' },
    { key: 'revenue', label: 'Revenue Dashboard', icon: <TrendingUp size={18} />, section: 'finance' },
    { key: 'staff', label: 'Staff Provisioning', icon: <UserPlus size={18} />, section: 'management' },
    { key: 'roles', label: 'RBAC Security Matrix', icon: <ShieldCheck size={18} />, section: 'management' },
    { key: 'settings', label: 'Hospital Settings', icon: <Settings size={18} />, section: 'management' },
    { key: 'health', label: 'System Health Node', icon: <HeartPulse size={18} />, section: 'management' },
    { key: 'support', label: 'Support & Help Desk', icon: <HelpCircle size={18} />, section: 'support' },
    { key: 'privacy', label: 'Privacy & Policy', icon: <Shield size={18} />, section: 'support' },
    { key: 'audit', label: 'Security Audit Trail', icon: <FileText size={18} />, section: 'management' }
  ];

  const showSection = (section) => navigationItems.some((item) => item.section === section && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key));

  function BuildingIcon({ size }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
        <path d="M6 12H4a2 2 0 0 0-2 2v8h4" />
        <path d="M18 9h2a2 2 0 0 1 2 2v11h-4" />
        <path d="M10 6h4" />
        <path d="M10 10h4" />
        <path d="M10 14h4" />
        <path d="M10 18h4" />
      </svg>
    );
  }

  return (
    <div className="app-container">
      {/* 1. LEFT SIDEBAR */}
      <aside className="app-sidebar">
        <div className="sidebar-logo">
          <HeartPulse size={24} />
          <h1>{tenant.hospital?.name ?? (isSuper ? 'Platform Console' : 'ABC Hospital')}</h1>
        </div>

        <nav className="sidebar-nav">
          {isSuper && <div className="nav-section-title">Platform (Super Admin)</div>}
          {navigationItems
            .filter(item => item.section === 'platform' && rolePermissions[currentRole]?.includes(item.key))
            .map((item) => (
              <a key={item.key} className={`nav-link ${activeTab === item.key ? 'active' : ''}`} onClick={() => setActiveTab(item.key)}>
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}

          {showSection('main') && <div className="nav-section-title">Main</div>}
          {navigationItems
            .filter(item => item.section === 'main' && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key))
            .map((item, idx) => (
              <a 
                key={idx} 
                className={`nav-link ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}

          {showSection('clinical') && <div className="nav-section-title">Clinical Workspace</div>}
          {navigationItems
            .filter(item => item.section === 'clinical' && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key))
            .map((item, idx) => (
              <a 
                key={idx} 
                className={`nav-link ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}

          {showSection('operations') && <div className="nav-section-title">Operations</div>}
          {navigationItems
            .filter(item => item.section === 'operations' && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key))
            .map((item, idx) => (
              <a 
                key={idx} 
                className={`nav-link ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}

          {showSection('hms') && <div className="nav-section-title">Hospital Billing & Pharmacy</div>}
          {navigationItems
            .filter(item => item.section === 'hms' && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key))
            .map((item) => (
              <a key={item.key} className={`nav-link ${activeTab === item.key ? 'active' : ''}`} onClick={() => setActiveTab(item.key)}>
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}

          {showSection('finance') && <div className="nav-section-title">Finance & Payouts</div>}
          {navigationItems
            .filter(item => item.section === 'finance' && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key))
            .map((item, idx) => (
              <a 
                key={idx} 
                className={`nav-link ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}

          {showSection('management') && <div className="nav-section-title">Management & Governance</div>}
          {navigationItems
            .filter(item => item.section === 'management' && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key))
            .map((item, idx) => (
              <a 
                key={idx} 
                className={`nav-link ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}

          {showSection('support') && <div className="nav-section-title">Support & Compliance</div>}
          {navigationItems
            .filter(item => item.section === 'support' && rolePermissions[currentRole]?.includes(item.key) && hasModule(item.key))
            .map((item, idx) => (
              <a 
                key={idx} 
                className={`nav-link ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar">
              {currentRole[0]}
            </div>
            <div className="user-info">
              <h4>{currentRole}</h4>
              <p>Active Session</p>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. MAIN APP CONTENT AREA */}
      <main className="app-content">
        
        {/* Top Header */}
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: '700', fontSize: '1.1rem', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
              {tenant.hospital?.name ?? 'ABC Healthcare'} Portal
            </span>
            {isSuper && firebaseEnabled && (
              <button className="btn btn-secondary" style={{ marginLeft: 12 }} onClick={() => pickHospital(null)} disabled={platformOnly}>
                {platformOnly ? 'Platform console' : '← Back to platform'}
              </button>
            )}
          </div>

          <div className="header-controls">
            {canSeed && (
              <button className="btn btn-secondary" onClick={loadSampleData}>Load sample data</button>
            )}
            {canSwitchRole && <div className="role-switcher-container">
              <span>Current Role:</span>
              <select 
                className="role-dropdown" 
                value={currentRole}
                onChange={(e) => {
                  const nextRole = e.target.value;
                  setCurrentRole(nextRole);
                  addAuditLog("System", `Switched Session Role`, "Security & Roles", `Operator role set to ${nextRole}`);
                  if (!rolePermissions[nextRole]?.includes(activeTab)) {
                    setActiveTab('dashboard');
                  }
                }}
              >
                {[...(isSuper ? ['Super Admin'] : []), 'Hospital Admin', 'Doctor', 'Nurse', 'Receptionist', 'Lab Technician', 'Billing Staff', 'Pharmacist', 'Administration']
                  .map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>}

            {firebaseEnabled && (
              <button className="header-icon-btn" title="Sign out" aria-label="Sign out" onClick={signOutLogged}>
                <LogOut size={18} />
              </button>
            )}

            <button className="header-icon-btn" onClick={() => setShowNotificationsDrawer(!showNotificationsDrawer)}>
              <Bell size={18} />
              <div className="notification-badge"></div>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 600 }}>
              <div className="live-indicator"></div>
              <span style={{ color: 'var(--text-muted)' }}>Node Health</span>
            </div>
          </div>
        </header>

        {/* Global Notifications Drawer */}
        {showNotificationsDrawer && (
          <div className="card" style={{ position: 'absolute', top: '70px', right: '30px', zIndex: 100, width: '350px', boxShadow: 'var(--shadow-lg)' }}>
            <div className="card-header" style={{ paddingBottom: '10px', borderBottom: '1px solid var(--border-light)' }}>
              <h3 style={{ fontSize: '1rem' }}>Clinical System Alerts</h3>
              <button className="btn-icon" style={{ padding: '2px' }} onClick={() => setShowNotificationsDrawer(false)}>×</button>
            </div>
            <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '0.8rem', padding: '6px 12px', borderLeft: '3px solid var(--primary)', backgroundColor: 'var(--bg-input)' }}>
                <strong>New Call Booking</strong>
                <p style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Patient Ravi Kumar scheduled with Dr. Arun Kumar through Agentic AI.</p>
              </div>
              <div style={{ fontSize: '0.8rem', padding: '6px 12px', borderLeft: '3px solid var(--success)', backgroundColor: 'var(--bg-input)' }}>
                <strong>Payment Settled</strong>
                <p style={{ color: 'var(--text-muted)', marginTop: '2px' }}>₹600 received from Priya Sharma via UPI.</p>
              </div>
            </div>
          </div>
        )}

        {/* 3. DYNAMIC TAB PANEL ROUTING */}
        <div style={{ flex: 1 }}>
          {!isTabAllowed ? (
            <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
              <div className="lock-overlay" style={{ position: 'relative', background: 'none', backdropFilter: 'none' }}>
                <div className="lock-box">
                  <Lock size={48} style={{ color: 'var(--danger)' }} />
                  <h3>Permission Restriction</h3>
                  <p>
                    Your current credentials role (<strong>{currentRole}</strong>) does not have clearance to open the <strong>{activeTab}</strong> console module. 
                    Please switch your role in the top header to inspect this page.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <Dashboard 
                  doctors={doctors}
                  patients={patients}
                  appointments={appointments}
                  addAppointment={addAppointment}
                  addAuditLog={demoAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'futuristic' && (
                <FuturisticCareMatrix 
                  patients={patients}
                  doctors={doctors}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'agentic' && (
                <AgenticAiConsole 
                  patients={patients}
                  doctors={doctors}
                  appointments={appointments}
                  addAppointment={addAppointment}
                  addAuditLog={demoAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'freed' && (
                <FreedAIScribe 
                  patients={patients}
                  doctors={doctors}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'printer' && (
                <AiPrescriptionPrinter 
                  patients={patients}
                  doctors={doctors}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'doctors' && (
                <Doctors 
                  doctors={doctors}
                  setDoctors={setDoctors}
                  departments={departments}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'patients' && (
                <Patients 
                  patients={patients}
                  setPatients={setPatients}
                  appointments={appointments}
                  payments={payments}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'departments' && (
                <Departments 
                  departments={departments}
                  setDepartments={setDepartments}
                  doctors={doctors}
                  appointments={appointments}
                  payments={payments}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'appointments' && (
                <Appointments 
                  appointments={appointments}
                  setAppointments={setAppointments}
                  doctors={doctors}
                  patients={patients}
                  departments={departments}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'online' && (
                <OnlineConsultations
                  appointments={appointments}
                  setAppointments={setAppointments}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'scribe' && (
                <AIScribe 
                  patients={patients}
                  doctors={doctors}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'prescriptions' && (
                <PrescriptionTemplates 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'signature' && (
                <DigitalSignature 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'profile' && (
                <ProfileVisibility 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'ivr' && (
                <IVRCalls 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'notifications' && (
                <Notifications 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'payouts' && (
                <PayoutBatchPlanner 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'hms-billing' && <Billing isAdmin={isHmsAdmin} />}
              {activeTab === 'hms-pos' && <Billing kind="PHARMACY" isAdmin={isHmsAdmin} />}
              {activeTab === 'hms-pharmacy' && <Pharmacy canEdit={isHmsAdmin || currentRole === 'Pharmacist'} />}
              {activeTab === 'hms-ipd' && <Ipd doctors={doctors} isAdmin={isHmsAdmin} canBill={currentRole !== 'Doctor'} />}
              {activeTab === 'hms-tariff' && <ChargeMaster canEdit={isHmsAdmin} />}
              {activeTab === 'hms-reports' && <HmsReports />}
              {activeTab === 'hms-claims' && <Claims canEdit={currentRole !== 'Doctor' && currentRole !== 'Pharmacist'} />}
              {activeTab === 'voice' && <VoiceAgent />}
              {activeTab === 'orders' && (
                <Orders orders={orders} setOrders={setOrders} addAuditLog={addAuditLog} currentRole={currentRole}
                  onLoadCatalog={firebaseEnabled && isSuper ? () => seedCatalog(catalog).then(() => alert('Catalog loaded: medicines, lab tests and articles.')) : null} />
              )}
              {activeTab === 'payments' && (
                <Payments 
                  payments={payments}
                  setPayments={setPayments}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'revenue' && (
                <Revenue 
                  payments={payments}
                  doctors={doctors}
                  departments={departments}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'staff' && (
                <StaffManagement 
                  staff={staff}
                  setStaff={setStaff}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'roles' && (
                <RolesPermissions 
                  rolePermissions={rolePermissions}
                  setRolePermissions={setRolePermissions}
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'settings' && (
                <HospitalSettings 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'support' && (
                <SupportHelp 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'privacy' && (
                <PrivacyPolicy 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'health' && (
                <SystemHealth 
                  addAuditLog={addAuditLog}
                  currentRole={currentRole}
                />
              )}
              {activeTab === 'platform' && <SuperAdmin />}
              {activeTab === 'users' && <UsersRoles />}
              {activeTab === 'assets' && <Equipment canEdit={['Super Admin', 'Hospital Admin', 'Administration'].includes(currentRole)} />}
              {activeTab === 'audit' && (
                <AuditLogs 
                  auditLogs={auditLogs}
                />
              )}
            </>
          )}
        </div>

        {/* 4. GOOGLE STITCH AI FLOATING ACTION DOCK */}
        {!platformOnly && <div className="stitch-floating-dock">
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '4px' }}>
            Stitch AI Dock
          </span>

          <button 
            className={`stitch-dock-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={15} /> Dashboard
          </button>

          <button 
            className={`stitch-dock-item ${activeTab === 'futuristic' ? 'active' : ''}`}
            onClick={() => setActiveTab('futuristic')}
          >
            <Cpu size={15} style={{ color: '#c084fc' }} /> Care Matrix
            <span className="stitch-glow-badge">2026+</span>
          </button>

          <button 
            className={`stitch-dock-item ${activeTab === 'agentic' ? 'active' : ''}`}
            onClick={() => setActiveTab('agentic')}
          >
            <Bot size={15} style={{ color: '#38bdf8' }} /> 6-Lang Voice
          </button>

          <button 
            className={`stitch-dock-item ${activeTab === 'freed' ? 'active' : ''}`}
            onClick={() => setActiveTab('freed')}
          >
            <Zap size={15} style={{ color: '#f472b6' }} /> Freed Scribe
          </button>

          <button 
            className={`stitch-dock-item ${activeTab === 'printer' ? 'active' : ''}`}
            onClick={() => setActiveTab('printer')}
          >
            <Stethoscope size={15} style={{ color: '#34d399' }} /> AI Rx & CDSS
          </button>
        </div>}
      </main>
    </div>
  );
}
