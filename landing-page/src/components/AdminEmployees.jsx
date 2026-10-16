import React, { useEffect, useState } from 'react';
import { Mail, Trash2, Upload, UserPlus } from 'lucide-react';
import { api, employeeStore } from '../lib/api';

const EMPTY = { name: '', company: '', role: '', email: '' };

export default function AdminEmployees() {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [pdfCompany, setPdfCompany] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const remember = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    employeeStore.saveAll(list);
    setEmployees(list);
    return list;
  };

  const load = async () => {
    const cached = employeeStore.getAll();
    if (cached.length) setEmployees(cached);
    try {
      const rows = await api.getEmployees();
      if (Array.isArray(rows) && rows.length) {
        remember(rows);
        return;
      }
      if (cached.length) {
        const restored = await api.restoreEmployees(cached);
        remember(restored.employees || cached);
      }
    } catch {
      if (cached.length) setEmployees(cached);
    }
  };

  useEffect(() => { load(); }, []);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!form.name.trim() || !form.company.trim() || !form.role.trim() || !form.email.trim()) {
      setError('Name, company, role, and email are required.');
      return;
    }
    setBusy(true);
    try {
      await api.addEmployee(form);
      setForm(EMPTY);
      setMessage('Employee saved. This list stays stored, so you do not need to add it again.');
      await load();
    } catch (err) {
      setError(err.message || 'Could not save that employee.');
    } finally {
      setBusy(false);
    }
  };

  const handlePdf = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      if (pdfCompany.trim()) body.append('company', pdfCompany.trim());
      const res = await fetch('/api/employees/upload-pdf', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PDF upload failed.');
      setMessage(`Saved ${data.saved} contact${data.saved === 1 ? '' : 's'}. They stay stored, so you do not need to upload this file again.`);
      await load();
    } catch (err) {
      setError(err.message || 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    await api.deleteEmployee(id).catch(() => {});
    await load();
  };

  return (
    <section className="profile-section" style={{ marginTop: '28px' }}>
      <div className="section-header" style={{ marginBottom: '16px' }}>
        <h2><Mail size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />Employee contacts</h2>
      </div>
      <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
        Add one person with the form, or upload an Excel or PDF list once. The contacts are stored permanently and shown again whenever someone applies to that company.
      </p>

      {message && <p style={{ color: '#047857', fontWeight: 700 }}>{message}</p>}
      {error && <p style={{ color: '#b91c1c', fontWeight: 700 }}>{error}</p>}

      <form onSubmit={handleAdd} className="form-grid" style={{ marginBottom: '18px' }}>
        <div className="form-field">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Priya Sharma" />
        </div>
        <div className="form-field">
          <label>Company name</label>
          <input value={form.company} onChange={(e) => setField('company', e.target.value)} placeholder="Zetwerk" />
        </div>
        <div className="form-field">
          <label>Role</label>
          <input value={form.role} onChange={(e) => setField('role', e.target.value)} placeholder="Technical Recruiter" />
        </div>
        <div className="form-field">
          <label>Email id</label>
          <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="priya.sharma@zetwerk.com" />
        </div>
        <div className="form-field" style={{ alignSelf: 'end' }}>
          <button className="btn-accent" type="submit" disabled={busy}>
            <UserPlus size={14} /> Add employee
          </button>
        </div>
      </form>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'end', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div className="form-field" style={{ minWidth: '220px', margin: 0 }}>
          <label>Company if the file does not include it</label>
          <input value={pdfCompany} onChange={(e) => setPdfCompany(e.target.value)} placeholder="Optional company name" />
        </div>
        <label className="btn-ghost" style={{ cursor: 'pointer' }}>
          <Upload size={14} /> Upload employees list
          <input type="file" accept=".xlsx,.xls,.csv,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/pdf" onChange={handlePdf} style={{ display: 'none' }} disabled={busy} />
        </label>
      </div>

      {employees.length === 0 ? (
        <p style={{ color: '#888' }}>No employees saved yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {employees.map((emp) => (
            <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', border: '1px solid #e2e2df', borderRadius: '12px' }}>
              <div>
                <strong>{emp.name}</strong>
                <div style={{ fontSize: '12.5px', color: '#555' }}>
                  {emp.role}{emp.company ? ` · ${emp.company}` : ''} · {emp.email}
                </div>
                {emp.details ? <div style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>{emp.details}</div> : null}
              </div>
              <button className="btn-ghost danger sm" type="button" onClick={() => handleDelete(emp.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
