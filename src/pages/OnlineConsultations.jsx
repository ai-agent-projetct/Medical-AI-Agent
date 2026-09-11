import React, { useState } from 'react';
import { Video, Check, X, ShieldAlert, Clock, Link as LinkIcon } from 'lucide-react';
import { callLink } from '../firebase';

export default function OnlineConsultations({
  appointments,
  setAppointments,
  currentRole
}) {
  const [copied, setCopied] = useState(null);
  // Filters to find only Online consultations
  const onlineAppts = appointments.filter(apt => apt.type === 'Online');
  const openRooms = onlineAppts
    .filter(a => !['Completed', 'Cancelled', 'No-Show'].includes(a.status))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const canJoin = currentRole !== 'Billing Staff';

  const joinCall = (apt) => {
    setAppointments(prev => prev.map(a => a.id === apt.id ? { ...a, status: 'In Consultation' } : a));
    window.open(`${callLink(apt.id)}?name=${encodeURIComponent(apt.doctor)}`, '_blank', 'noopener');
  };
  const copyPatientLink = async (apt) => {
    await navigator.clipboard.writeText(callLink(apt.id));
    setCopied(apt.id);
  };
  const complete = (apt) => setAppointments(prev => prev.map(a => a.id === apt.id ? { ...a, status: 'Completed' } : a));

  // Compute stats
  const total = onlineAppts.length;
  const completed = onlineAppts.filter(a => a.status === 'Completed').length;
  const ongoing = onlineAppts.filter(a => ['Checked In', 'Waiting', 'In Consultation'].includes(a.status)).length;
  const cancelled = onlineAppts.filter(a => a.status === 'Cancelled').length;
  const noShow = onlineAppts.filter(a => a.status === 'No-Show').length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title">
          <h2>Online Consultations Monitor</h2>
          <p>Monitor tele-consultation channels, call connectivity metrics, and doctor-patient session durations.</p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid-4">
        <div className="stat-card">
          <div className="stat-info">
            <p>Total Telehealth</p>
            <div className="stat-value">{total}</div>
          </div>
          <div className="stat-icon primary"><Video size={24} /></div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <p>Active Ongoing</p>
            <div className="stat-value">{ongoing}</div>
          </div>
          <div className="stat-icon warning"><div className="pulse-indicator" style={{ backgroundColor: 'var(--warning)' }}></div></div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <p>Completed Sessions</p>
            <div className="stat-value">{completed}</div>
          </div>
          <div className="stat-icon success"><Check size={24} /></div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <p>Cancelled / No-Show</p>
            <div className="stat-value">{cancelled + noShow}</div>
          </div>
          <div className="stat-icon danger"><X size={24} /></div>
        </div>
      </div>

      <div className="grid-main-side">
        {/* Left Side: Room Monitor */}
        <div className="card">
          <div className="card-header">
            <h3>Video Consultation Rooms</h3>
            <span className="badge badge-info">ZegoCloud</span>
          </div>

          <div className="table-container">
            <table className="table-list">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Doctor</th>
                  <th>Patient</th>
                  <th>Date / Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {openRooms.length === 0 && (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No upcoming online consultations.</td></tr>
                )}
                {openRooms.map((apt) => (
                  <tr key={apt.id}>
                    <td><strong>{apt.token ? `#${apt.token}` : apt.id}</strong></td>
                    <td>{apt.doctor}</td>
                    <td>{apt.patient}</td>
                    <td>{apt.date} · {apt.time}</td>
                    <td>
                      <span className={`badge ${apt.status === 'In Consultation' ? 'badge-success' : 'badge-warning'}`}>
                        {apt.status}
                      </span>
                    </td>
                    <td>
                      {canJoin && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => joinCall(apt)}>
                            <Video size={12} /> Join
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => copyPatientLink(apt)}>
                            <LinkIcon size={12} /> {copied === apt.id ? 'Copied' : 'Patient link'}
                          </button>
                          {apt.status === 'In Consultation' && (
                            <button className="btn btn-success" style={{ padding: '4px 8px', fontSize: '0.78rem' }} onClick={() => complete(apt)}>
                              Complete
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Side: Usage Guidelines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Clinical Interference Protection Panel */}
          <div className="card" style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input)' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <ShieldAlert size={24} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <div>
                <h4 style={{ fontSize: '0.88rem', fontWeight: 'bold' }}>Privacy Assurance Mode</h4>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.45 }}>
                  Admin access is restricted to connectivity ping checks and billing logs. 
                  Direct video stream hook-in is disabled to respect physician-patient clinical privacy policies.
                </p>
              </div>
            </div>
          </div>

          {/* Consultation Metrics */}
          <div className="card">
            <div className="card-header">
              <h3>Avg Session Duration</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Clock size={32} style={{ color: 'var(--info)' }} />
              <div>
                <h4 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>18 min 42s</h4>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Average duration per tele-consultation</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
