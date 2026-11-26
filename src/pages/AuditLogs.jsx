import React, { useState } from 'react';
import { Search, Shield, Calendar, Filter } from 'lucide-react';

export default function AuditLogs({ 
  auditLogs 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState('All');

  const modules = ['All', ...new Set(auditLogs.map((l) => l.module).filter(Boolean))];

  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch = log.user.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (log.details ?? '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesModule = selectedModule === 'All' || log.module === selectedModule;
    return matchesSearch && matchesModule;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title">
          <h2>Security Audit Logs</h2>
          <p>Read-only trail of every login, logout, record view and change (who changed which field, from what to what) by this hospital's staff.</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div className="header-search" style={{ flex: 1, minWidth: '250px' }}>
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Search by User, Action details..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-muted)' }}>Module:</span>
            <select 
              className="role-dropdown" 
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
            >
              {modules.map((mod, idx) => (
                <option key={idx} value={mod}>{mod}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card">
        <div className="table-container">
          <table className="table-list">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Who (Operator)</th>
                <th>Module / Tab</th>
                <th>Action</th>
                <th>Details Description</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, idx) => (
                <tr key={idx}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                      <Calendar size={12} style={{ color: 'var(--text-light)' }} />
                      <span>{log.timestamp}</span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-secondary" style={{ gap: '4px' }}>
                      <Shield size={10} /> {log.user}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-info" style={{ fontSize: '0.78rem' }}>
                      {log.module}
                    </span>
                  </td>
                  <td><strong>{log.action}</strong></td>
                  <td style={{ color: 'var(--text-medium)', fontSize: '0.85rem' }}>{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
