import React, { useEffect, useState } from 'react';
import { Search, Plus, Calendar, Check, X, Clock, Video, User } from 'lucide-react';
import { freeSlots } from '../firebase';

const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

export default function Appointments({ 
  appointments, 
  setAppointments, 
  doctors, 
  patients, 
  departments, 
  addAuditLog, 
  currentRole 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [selectedApt, setSelectedApt] = useState(null);
  
  // States for new booking
  const [newApt, setNewApt] = useState({
    patient: '', doctor: '', department: '', date: today, time: '10:00 AM', status: 'Confirmed', type: 'Offline', visitType: 'General', fee: 500
  });

  const [rescheduleData, setRescheduleData] = useState({
    date: today, time: '10:00 AM'
  });
  const [slots, setSlots] = useState([]);

  // Offer only the doctor's free slots (their schedule from the mobile app, minus existing bookings).
  const slotDoctor = showRescheduleModal ? selectedApt?.doctor : newApt.doctor;
  const slotDate = showRescheduleModal ? rescheduleData.date : newApt.date;
  useEffect(() => {
    if (!showAddModal && !showRescheduleModal) return;
    let live = true;
    freeSlots(doctors.find(d => d.name === slotDoctor), slotDate, appointments).then(free => {
      if (!live) return;
      setSlots(free);
      const pick = prev => ({ ...prev, time: free.includes(prev.time) ? prev.time : (free[0] ?? '') });
      if (showRescheduleModal) setRescheduleData(pick); else setNewApt(pick);
    }).catch(err => console.error('slots', err));
    return () => { live = false; };
  }, [showAddModal, showRescheduleModal, slotDoctor, slotDate, appointments, doctors]);

  const slotSelect = (value, onChange) => (
    <select className="form-input" required value={value} onChange={onChange}>
      {slots.length === 0 && <option value="">No free slots on this day</option>}
      {slots.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );

  // Setup default values when opening modal
  const handleOpenAddModal = () => {
    setNewApt({
      patient: patients[0]?.name || '',
      doctor: doctors[0]?.name || '',
      department: departments[0]?.name || '',
      date: today,
      time: '10:00 AM',
      status: 'Confirmed',
      type: 'Offline',
      visitType: 'General',
      fee: doctors[0]?.fee || 500
    });
    setShowAddModal(true);
  };

  const handleCreateAppointment = (e) => {
    e.preventDefault();
    const aptId = `APT-${Math.floor(10000 + Math.random() * 90000)}`;
    const feeAmount = doctors.find(doc => doc.name === newApt.doctor)?.fee || 500;
    const finalApt = { ...newApt, id: aptId, fee: feeAmount };
    
    setAppointments(prev => [...prev, finalApt]);
    addAuditLog(currentRole, "Created Appointment", "Appointments", `Booked appointment ${aptId} for ${finalApt.patient} with ${finalApt.doctor}`);
    setShowAddModal(false);
  };

  const updateAptStatus = (id, nextStatus) => {
    setAppointments(prev => prev.map(apt => {
      if (apt.id === id) {
        addAuditLog(currentRole, `Appointment status updated`, "Appointments", `${id} changed to ${nextStatus}`);
        return { ...apt, status: nextStatus };
      }
      return apt;
    }));
  };

  const handleOpenReschedule = (apt) => {
    setSelectedApt(apt);
    setRescheduleData({ date: apt.date, time: apt.time });
    setShowRescheduleModal(true);
  };

  const handleSaveReschedule = (e) => {
    e.preventDefault();
    if (!selectedApt) return;
    setAppointments(prev => prev.map(apt => {
      if (apt.id === selectedApt.id) {
        addAuditLog(currentRole, "Rescheduled Appointment", "Appointments", `Rescheduled ${apt.id} to ${rescheduleData.date} at ${rescheduleData.time}`);
        return { ...apt, date: rescheduleData.date, time: rescheduleData.time, status: 'Confirmed' };
      }
      return apt;
    }));
    setShowRescheduleModal(false);
  };

  // Filter Appointments
  const filteredAppointments = appointments.filter(apt => {
    const matchesSearch = apt.patient.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          apt.doctor.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          apt.id.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (activeTab === 'Today') {
      return matchesSearch && apt.date === today;
    }
    if (activeTab === 'Upcoming') {
      return matchesSearch && apt.date > today;
    }
    if (activeTab === 'No-Show') {
      return matchesSearch && apt.status === 'No-Show';
    }
    if (activeTab === 'Cancelled') {
      return matchesSearch && apt.status === 'Cancelled';
    }
    return matchesSearch;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title">
          <h2>Appointments Scheduler</h2>
          <p>Book online/offline slots, cancel, reschedule, and track patient arrivals.</p>
        </div>
        <button className="btn btn-primary" onClick={handleOpenAddModal}>
          <Plus size={16} /> Book Appointment
        </button>
      </div>

      {/* Tabs / Filters */}
      <div className="tabs-navigation" style={{ marginBottom: '16px' }}>
        {['All', 'Today', 'Upcoming', 'No-Show', 'Cancelled'].map((tab, idx) => (
          <button 
            key={idx} 
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab} Appointments
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
        <div className="header-search" style={{ width: '100%' }}>
          <Search size={16} />
          <input 
            type="text" 
            placeholder="Search by Booking ID, Patient Name, Doctor..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Appointments List */}
      <div className="card">
        <div className="table-container">
          <table className="table-list">
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>Department</th>
                <th>Date / Time</th>
                <th>Type</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    No appointments found matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredAppointments.map((apt, idx) => (
                  <tr key={idx}>
                    <td><strong>{apt.token ? `#${apt.token}` : apt.id}</strong></td>
                    <td>{apt.patient}</td>
                    <td>{apt.doctor}</td>
                    <td>{apt.department}</td>
                    <td>
                      <div><strong>{apt.date}</strong></div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{apt.time}</div>
                    </td>
                    <td>
                      <span className={`badge ${apt.type === 'Online' ? 'badge-info' : 'badge-secondary'}`}>
                        {apt.type === 'Online' ? <Video size={12} style={{ marginRight: '4px' }} /> : <User size={12} style={{ marginRight: '4px' }} />}
                        {apt.type}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${
                        apt.status === 'Confirmed' ? 'badge-success' : 
                        apt.status === 'Checked In' || apt.status === 'In Consultation' ? 'badge-info' : 
                        apt.status === 'Waiting' ? 'badge-warning' : 
                        apt.status === 'No-Show' ? 'badge-danger' : 'badge-secondary'
                      }`}>
                        {apt.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {(apt.status === 'Confirmed' || apt.status === 'Rescheduled') && (
                          <>
                            <button className="btn btn-success" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => updateAptStatus(apt.id, 'Checked In')}>
                              Check In
                            </button>
                            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => handleOpenReschedule(apt)}>
                              Reschedule
                            </button>
                            <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => updateAptStatus(apt.id, 'Cancelled')}>
                              Cancel
                            </button>
                          </>
                        )}
                        {apt.status === 'Checked In' && (
                          <button className="btn btn-warning" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => updateAptStatus(apt.id, 'Waiting')}>
                            Move to Waiting
                          </button>
                        )}
                        {(apt.status === 'Waiting' || apt.status === 'In Consultation') && (
                          <button className="btn btn-success" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => updateAptStatus(apt.id, 'Completed')}>
                            Complete
                          </button>
                        )}
                        {apt.status !== 'Cancelled' && apt.status !== 'Completed' && apt.status !== 'No-Show' && (
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => updateAptStatus(apt.id, 'No-Show')}>
                            Mark No-Show
                          </button>
                        )}
                        {(apt.status === 'Cancelled' || apt.status === 'No-Show') && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No actions</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Book Appointment Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleCreateAppointment}>
            <div className="modal-header">
              <h3>Book Appointment Slot</h3>
              <button type="button" className="btn-icon" onClick={() => setShowAddModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Select Patient</label>
                <select 
                  className="form-input"
                  value={newApt.patient}
                  onChange={(e) => setNewApt(prev => ({ ...prev, patient: e.target.value }))}
                >
                  {patients.map((pat, idx) => (
                    <option key={idx} value={pat.name}>{pat.name} (Phone: {pat.phone})</option>
                  ))}
                </select>
              </div>

              <div className="form-input-row">
                <div className="form-group">
                  <label>Select Doctor</label>
                  <select 
                    className="form-input"
                    value={newApt.doctor}
                    onChange={(e) => {
                      const docName = e.target.value;
                      const matchedDoc = doctors.find(d => d.name === docName);
                      setNewApt(prev => ({ 
                        ...prev, 
                        doctor: docName,
                        department: matchedDoc?.department || prev.department,
                        fee: matchedDoc?.fee || prev.fee
                      }));
                    }}
                  >
                    {doctors.filter(d => d.status === 'Active').map((doc, idx) => (
                      <option key={idx} value={doc.name}>{doc.name} ({doc.specialization})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Department</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    disabled 
                    value={newApt.department}
                  />
                </div>
              </div>

              <div className="form-input-row">
                <div className="form-group">
                  <label>Appointment Date</label>
                  <input 
                    type="date" 
                    className="form-input" 
                    required 
                    value={newApt.date}
                    onChange={(e) => setNewApt(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Select Time Slot</label>
                  {slotSelect(newApt.time, (e) => setNewApt(prev => ({ ...prev, time: e.target.value })))}
                </div>
              </div>

              <div className="form-group">
                <label>Visit Type</label>
                <select
                  className="form-input"
                  value={newApt.visitType}
                  onChange={(e) => setNewApt(prev => ({ ...prev, visitType: e.target.value }))}
                >
                  {['General', 'New visit', 'Follow-up', 'Consultation'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <div className="form-input-row">
                <div className="form-group">
                  <label>Consultation Mode</label>
                  <select 
                    className="form-input"
                    value={newApt.type}
                    onChange={(e) => setNewApt(prev => ({ ...prev, type: e.target.value }))}
                  >
                    <option value="Offline">Offline (Clinic Visit)</option>
                    <option value="Online">Online (Telehealth)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Consultation Fee (₹)</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    disabled 
                    value={`₹${newApt.fee}`}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Confirm Booking</button>
            </div>
          </form>
        </div>
      )}

      {/* Reschedule Appointment Modal */}
      {showRescheduleModal && selectedApt && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleSaveReschedule}>
            <div className="modal-header">
              <h3>Reschedule Appointment {selectedApt.id}</h3>
              <button type="button" className="btn-icon" onClick={() => setShowRescheduleModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '0.88rem', marginBottom: '16px' }}>
                Rescheduling appointment for patient <strong>{selectedApt.patient}</strong> with <strong>{selectedApt.doctor}</strong>.
              </p>
              <div className="form-input-row">
                <div className="form-group">
                  <label>New Date</label>
                  <input 
                    type="date" 
                    className="form-input" 
                    required 
                    value={rescheduleData.date}
                    onChange={(e) => setRescheduleData(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>New Time Slot</label>
                  {slotSelect(rescheduleData.time, (e) => setRescheduleData(prev => ({ ...prev, time: e.target.value })))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowRescheduleModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
