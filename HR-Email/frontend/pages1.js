/* ═══════════════════════════════════════════════════════════════════
   TalentFlow Pro — Pages Part 1 (Dashboard, Upload, Contacts)
   ═══════════════════════════════════════════════════════════════════ */

// ─── Dashboard ────────────────────────────────────────────────────
async function loadDashboard() {
    const page = document.getElementById('page-dashboard');
    page.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Synchronizing outreach analytics...</div>';
    try {
        const [resStats, resReplies] = await Promise.all([
            fetch(`${API}/api/dashboard`),
            fetch(`${API}/api/replies`),
        ]);
        const stats = await resStats.json();
        const replyData = await resReplies.json();
        const replies = replyData.replies || [];

        let repliesHtml = '';
        if (replies.length === 0) {
            repliesHtml = '<div class="empty-state" style="padding: 40px 20px;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><h3>No recruiter responses detected yet</h3><p>Incoming Gmail threads are synced automatically every 120 seconds.</p></div>';
        } else {
            repliesHtml = `<div class="table-wrapper"><table><thead><tr>
                <th>Recruiter</th><th>Company</th><th>Email</th><th>Sentiment</th><th>Reply Date</th><th>Message Snippet</th>
            </tr></thead><tbody>`;
            replies.forEach(r => {
                const sMap = {
                    INTERESTED: 'badge-sent',
                    REFERRAL: 'badge-replied',
                    NOT_INTERESTED: 'badge-danger',
                    GENERAL: 'badge-muted'
                };
                const badgeClass = sMap[r.sentiment] || 'badge-muted';
                const avatarInitials = getInitials(r.name);
                repliesHtml += `<tr>
                    <td>
                        <div style="display:flex;align-items:center;">
                            <div class="contact-avatar">${avatarInitials}</div>
                            <strong>${escapeHtml(r.name||'—')}</strong>
                        </div>
                    </td>
                    <td>${escapeHtml(r.company||'—')}</td>
                    <td style="color:var(--accent-light);font-family:'JetBrains Mono',monospace;font-size:12.5px">${escapeHtml(r.email)}</td>
                    <td><span class="badge ${badgeClass}">${r.sentiment}</span></td>
                    <td>${formatDate(r.reply_at)}</td>
                    <td><div style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)" title="${escapeHtml(r.reply_snippet||'')}">${escapeHtml(r.reply_snippet||'No snippet')}</div></td>
                </tr>`;
            });
            repliesHtml += '</tbody></table></div>';
        }

        // Calculate progress percentage
        const total = stats.total_contacts || 1;
        const lastSentSno = stats.last_sent_sno || 0;
        const progressPct = Math.min(100, Math.round((lastSentSno / total) * 100));

        page.innerHTML = `
            <div class="page-header">
                <h1>Outreach Command Center</h1>
                <p>Real-time campaign delivery monitoring, recruiter sentiment feed, and contact dispatch progress</p>
            </div>
            
            <!-- Serial Progress Tracker Card -->
            <div class="hero-tracker-card">
                <div class="tracker-title-row">
                    <h2>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        Serial Queue Tracker (S.No Progress)
                    </h2>
                    <span class="tracker-badge">${progressPct}% Campaign Dispatched</span>
                </div>
                
                <div style="background:rgba(0,0,0,0.3);height:8px;border-radius:4px;overflow:hidden;margin-bottom:20px;border:1px solid var(--border)">
                    <div style="width:${progressPct}%;height:100%;background:var(--gradient-1);border-radius:4px;transition:width 0.5s ease"></div>
                </div>

                <div class="tracker-details-grid">
                    <div class="tracker-stat-box">
                        <label>✅ Last Sent Contact</label>
                        <div class="tracker-stat-val">
                            <span class="badge badge-sent" style="font-size:12px">S.No #${stats.last_sent_sno || 0}</span>
                            <span>${escapeHtml(stats.last_sent_name || 'None')}</span>
                            <code>${escapeHtml(stats.last_sent_email || '')}</code>
                        </div>
                    </div>
                    <div class="tracker-stat-box">
                        <label>⏳ Next Target in Queue</label>
                        <div class="tracker-stat-val">
                            <span class="badge badge-new" style="font-size:12px">S.No #${stats.next_pending_sno || 'Completed'}</span>
                            <span>${escapeHtml(stats.next_pending_name || 'All contacts sent!')}</span>
                            <code>${escapeHtml(stats.next_pending_email || '')}</code>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Analytics Stats Grid -->
            <div class="stats-grid">
                <div class="stat-card purple">
                    <div class="stat-header">
                        <div class="stat-label">Total Contacts</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${stats.total_contacts}</div>
                </div>
                <div class="stat-card teal">
                    <div class="stat-header">
                        <div class="stat-label">New Pending</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${stats.new_contacts}</div>
                </div>
                <div class="stat-card purple">
                    <div class="stat-header">
                        <div class="stat-label">Emails Delivered</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${stats.emails_sent}</div>
                </div>
                <div class="stat-card teal">
                    <div class="stat-header">
                        <div class="stat-label">Replies Received</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${stats.replies_received}</div>
                </div>
                <div class="stat-card amber">
                    <div class="stat-header">
                        <div class="stat-label">Follow-ups Eligible</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${stats.followups_eligible}</div>
                </div>
                <div class="stat-card purple">
                    <div class="stat-header">
                        <div class="stat-label">Follow-ups Sent</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${stats.followups_sent}</div>
                </div>
                <div class="stat-card pink">
                    <div class="stat-header">
                        <div class="stat-label">Do Not Contact</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${stats.do_not_contact}</div>
                </div>
                <div class="stat-card amber">
                    <div class="stat-header">
                        <div class="stat-label">Sent Today / Limit</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        </div>
                    </div>
                    <div class="stat-value" style="font-size:24px;margin-top:6px">${stats.sent_today} <span style="font-size:16px;color:var(--text-muted)">/ ${stats.daily_limit}</span></div>
                </div>
            </div>
            
            <!-- Recruiter Sentiment Feed -->
            <div class="card">
                <div class="card-header">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        Recruiter Sentiment Intelligence Feed (${replies.length})
                    </h2>
                    <span class="badge badge-sent" style="font-size:11px;padding:5px 12px">⚡ Auto-Synced Background Sync Active</span>
                </div>
                ${repliesHtml}
            </div>

            <!-- Quick Action Hub -->
            <div class="card">
                <div class="card-header"><h2>Action Center</h2></div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="showPage('upload')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Import PDF Contacts
                    </button>
                    <button class="btn btn-outline" onclick="showPage('contacts')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                        Browse Contacts
                    </button>
                    <button class="btn btn-outline" onclick="showPage('send')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        Outreach Dispatch Queue
                    </button>
                    <button class="btn btn-outline" onclick="showPage('assistant')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        Launch AI Copilot
                    </button>
                </div>
            </div>`;
    } catch (e) {
        page.innerHTML = '<div class="empty-state"><h3>Could not load dashboard analytics</h3><p>Ensure backend API is running on localhost:8000.</p></div>';
    }
}

async function doCheckReplies() {
    if (!state.authStatus.is_authenticated) { toast('Connect Gmail account first in Settings', 'warning'); return; }
    toast('Scanning Gmail inbox for recruiter replies...', 'info');
    try {
        const res = await fetch(`${API}/api/check-replies`, { method: 'POST' });
        const data = await res.json();
        if (data.new_replies > 0) {
            toast(`Found ${data.new_replies} new recruiter replies!`, 'success');
        } else {
            toast('Gmail inbox scan complete — no new replies detected', 'info');
        }
        if (state.currentPage === 'dashboard') loadDashboard();
    } catch (e) { toast('Error scanning Gmail replies', 'error'); }
}

// ─── Upload Page ──────────────────────────────────────────────────
function renderUploadPage() {
    const page = document.getElementById('page-upload');
    page.innerHTML = `
        <div class="page-header">
            <h1>PDF Contact Import Engine</h1>
            <p>Upload candidate/HR list PDFs. The system automatically parses, deduplicates, and saves contacts to your live database.</p>
        </div>
        <div class="card">
            <div class="upload-zone" id="upload-zone" onclick="document.getElementById('pdf-input').click()">
                <div class="upload-icon">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <h3>Drop your PDF contact sheet here or click to browse</h3>
                <p>Intelligent parser extracts Name, Email, Job Title, and Company with instant duplicate detection</p>
            </div>
            <input type="file" id="pdf-input" accept=".pdf">
        </div>
        <div id="extraction-results"></div>`;
    
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('pdf-input');
    
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files[0]) uploadPDF(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) uploadPDF(input.files[0]); });
}

async function uploadPDF(file) {
    const results = document.getElementById('extraction-results');
    results.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Parsing PDF and extracting recruiter records...</div>';
    
    const fd = new FormData();
    fd.append('file', file);
    
    try {
        const res = await fetch(`${API}/api/upload-pdf`, { method: 'POST', body: fd });
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
        const data = await res.json();
        state.extractedContacts = data;
        renderExtractionResults(data);
    } catch (e) {
        results.innerHTML = `<div class="card"><p style="color:var(--danger)">Error processing PDF: ${escapeHtml(e.message)}</p></div>`;
    }
}

function renderExtractionResults(data) {
    const results = document.getElementById('extraction-results');
    const s = data.stats;
    const newC = data.new_contacts || [];
    const existC = data.existing_contacts || [];
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h2>Extraction Summary</h2>
                <span class="badge badge-sent">✓ ${s.auto_imported || newC.length} Contacts Auto-Saved</span>
            </div>
            <div class="stats-grid">
                <div class="stat-card purple"><div class="stat-label">Total Parsed</div><div class="stat-value">${s.total_extracted || s.valid + (s.invalid||0)}</div></div>
                <div class="stat-card teal"><div class="stat-label">Valid Emails</div><div class="stat-value">${s.valid}</div></div>
                <div class="stat-card teal"><div class="stat-label">New Added</div><div class="stat-value">${s.new}</div></div>
                <div class="stat-card amber"><div class="stat-label">Existing (Skipped)</div><div class="stat-value">${s.existing}</div></div>
                <div class="stat-card pink"><div class="stat-label">Invalid Format</div><div class="stat-value">${s.invalid}</div></div>
            </div>`;
    
    if (newC.length > 0) {
        html += `<h3 style="margin:20px 0 14px;font-size:16px">Newly Imported Contacts (${newC.length})</h3>
            <div class="table-wrapper"><table><thead><tr><th>Contact</th><th>Email</th><th>Title</th><th>Company</th></tr></thead><tbody>`;
        newC.forEach(c => {
            const avatar = getInitials(c.name);
            html += `<tr>
                <td>
                    <div style="display:flex;align-items:center;">
                        <div class="contact-avatar">${avatar}</div>
                        <strong>${escapeHtml(c.name||'—')}</strong>
                    </div>
                </td>
                <td style="color:var(--accent-light);font-family:'JetBrains Mono',monospace;font-size:12.5px">${escapeHtml(c.email)}</td>
                <td>${escapeHtml(c.title||'—')}</td>
                <td>${escapeHtml(c.company||'—')}</td>
            </tr>`;
        });
        html += `</tbody></table></div>
            <div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between">
                <span class="badge badge-sent" style="font-size:12.5px;padding:8px 16px">✓ Automatically Persisted ${newC.length} Contacts to Database</span>
                <button class="btn btn-primary" onclick="showPage('send')">✉️ Proceed to Dispatch Queue</button>
            </div>`;
    }
    
    if (existC.length > 0) {
        html += `<h3 style="margin:28px 0 14px;font-size:16px;color:var(--text-secondary)">Existing Records in Database (${existC.length})</h3>
            <div class="table-wrapper"><table><thead><tr><th>Contact</th><th>Email</th><th>Database Status</th></tr></thead><tbody>`;
        existC.forEach(c => {
            const avatar = getInitials(c.name);
            html += `<tr>
                <td>
                    <div style="display:flex;align-items:center;">
                        <div class="contact-avatar" style="background:var(--bg-surface)">${avatar}</div>
                        <strong>${escapeHtml(c.name||'—')}</strong>
                    </div>
                </td>
                <td style="color:var(--accent-light);font-family:'JetBrains Mono',monospace;font-size:12.5px">${escapeHtml(c.email)}</td>
                <td>${statusBadge(c.db_status)}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
    }
    
    html += `</div>`;
    results.innerHTML = html;
}

async function importNewContacts() {
    if (!state.extractedContacts) return;
    try {
        const res = await fetch(`${API}/api/import-contacts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.extractedContacts.new_contacts),
        });
        const data = await res.json();
        toast(`Successfully imported ${data.imported} contacts!`, 'success');
        state.extractedContacts.new_contacts = [];
        state.extractedContacts.stats.new = 0;
        renderExtractionResults(state.extractedContacts);
    } catch (e) { toast('Import failed', 'error'); }
}

// ─── Contacts Directory Page ──────────────────────────────────────
async function loadContacts(statusFilter, search) {
    const page = document.getElementById('page-contacts');
    page.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Querying contacts directory...</div>';
    
    let url = `${API}/api/contacts?`;
    if (statusFilter) url += `status=${statusFilter}&`;
    if (search) url += `search=${encodeURIComponent(search)}&`;
    
    try {
        const res = await fetch(url);
        const contacts = await res.json();
        renderContactsPage(contacts, statusFilter, search);
    } catch (e) {
        page.innerHTML = '<div class="empty-state"><h3>Could not load contact records</h3></div>';
    }
}

function renderContactsPage(contacts, statusFilter, search) {
    const page = document.getElementById('page-contacts');
    const statuses = ['', 'NOT_CONTACTED', 'EMAIL_SENT', 'REPLIED', 'FOLLOW_UP_ELIGIBLE', 'FOLLOW_UP_SENT', 'DO_NOT_CONTACT', 'INVALID_EMAIL'];
    
    let html = `
        <div class="page-header">
            <h1>Contacts Directory</h1>
            <p>Manage candidate outreach database (${contacts.length} total records)</p>
        </div>
        <div class="filter-bar">
            <input type="text" placeholder="Search by name, email, or company..." value="${escapeHtml(search||'')}" 
                   onkeyup="if(event.key==='Enter')loadContacts(document.getElementById('status-filter').value, this.value)" id="search-input">
            <select id="status-filter" onchange="loadContacts(this.value, document.getElementById('search-input').value)">
                ${statuses.map(s => `<option value="${s}" ${s===statusFilter?'selected':''}>${s ? s.replace(/_/g, ' ') : 'All Statuses'}</option>`).join('')}
            </select>
            <button class="btn btn-outline btn-sm" onclick="loadContacts()">Reset Filters</button>
        </div>`;
    
    if (contacts.length === 0) {
        html += '<div class="empty-state"><h3>No contacts match your query</h3><p>Try clearing filters or import contacts via PDF.</p></div>';
    } else {
        html += `<div class="table-wrapper"><table><thead><tr>
            <th># S.No</th><th>Contact</th><th>Company</th><th>Job Title</th><th>Email</th><th>Status</th><th>Last Contact</th><th>Actions</th>
        </tr></thead><tbody>`;
        contacts.forEach(c => {
            const avatar = getInitials(c.name);
            html += `<tr>
                <td><span class="badge badge-muted" style="font-family:'JetBrains Mono',monospace;font-weight:700">S.No #${c.sno || c.id}</span></td>
                <td>
                    <div style="display:flex;align-items:center;">
                        <div class="contact-avatar">${avatar}</div>
                        <strong>${escapeHtml(c.name||'—')}</strong>
                    </div>
                </td>
                <td>${escapeHtml(c.company||'—')}</td>
                <td>${escapeHtml(c.title||'—')}</td>
                <td style="color:var(--accent-light);font-family:'JetBrains Mono',monospace;font-size:12.5px">${escapeHtml(c.email)}</td>
                <td>${statusBadge(c.status)}</td>
                <td style="font-size:12.5px;color:var(--text-secondary)">${formatDate(c.last_email_sent)}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-outline btn-sm" onclick="viewContactDetail(${c.id})">History</button>
                        <button class="btn btn-outline btn-sm" onclick="showStatusModal(${c.id}, '${c.status}')">Status</button>
                    </div>
                </td>
            </tr>`;
        });
        html += '</tbody></table></div>';
    }
    page.innerHTML = html;
}

async function viewContactDetail(id) {
    try {
        const res = await fetch(`${API}/api/contacts/${id}`);
        const c = await res.json();
        const history = c.email_history || [];
        let histHtml = history.length ? history.map(h => `
            <div class="email-preview">
                <div class="email-preview-header">
                    <span class="badge ${h.email_type==='INITIAL'?'badge-new':'badge-followup'}">${h.email_type}</span>
                    <span style="font-size:12px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${formatDate(h.sent_at)}</span>
                </div>
                <div class="email-preview-subject">${escapeHtml(h.subject)}</div>
                ${h.error ? `<p style="color:var(--danger);font-size:13px;margin-top:8px">❌ Delivery Error: ${escapeHtml(h.error)}</p>` : ''}
                ${h.reply_received ? `<p style="color:var(--success);font-size:13px;margin-top:8px">✓ Reply Received ${formatDate(h.reply_at)}</p>` : ''}
            </div>`).join('') : '<p style="color:var(--text-muted);padding:12px 0">No emails sent to this contact yet</p>';

        const avatar = getInitials(c.name);
        openModal(`
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
                <div class="contact-avatar" style="width:44px;height:44px;font-size:16px">${avatar}</div>
                <div>
                    <h2 style="margin:0">${escapeHtml(c.name||'Unknown Record')}</h2>
                    <p style="color:var(--text-secondary);font-size:13px">${escapeHtml(c.email)} · ${escapeHtml(c.title||'HR')} at ${escapeHtml(c.company||'Company')}</p>
                </div>
            </div>
            <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px">
                <span style="font-size:13px;color:var(--text-muted)">Current Status:</span> ${statusBadge(c.status)}
                <span class="badge badge-muted" style="font-family:'JetBrains Mono',monospace">S.No #${c.sno || c.id}</span>
            </div>
            <h3 style="margin:24px 0 14px;font-size:16px">Outreach & Activity Logs</h3>
            ${histHtml}
            <div style="margin-top:24px;text-align:right"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
        `);
    } catch (e) { toast('Error loading contact details', 'error'); }
}

function showStatusModal(id, current) {
    const statuses = ['NOT_CONTACTED', 'EMAIL_SENT', 'REPLIED', 'FOLLOW_UP_ELIGIBLE', 'FOLLOW_UP_SENT', 'DO_NOT_CONTACT', 'INVALID_EMAIL', 'UNSUBSCRIBED'];
    openModal(`
        <h2>Update Record Status</h2>
        <div class="form-group" style="margin-top:16px">
            <label>Select New Status</label>
            <select id="new-status">${statuses.map(s=>`<option value="${s}" ${s===current?'selected':''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
        </div>
        <div class="btn-group" style="justify-content:flex-end;margin-top:24px">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="updateContactStatus(${id})">Save Status</button>
        </div>
    `);
}

async function updateContactStatus(id) {
    const status = document.getElementById('new-status').value;
    try {
        await fetch(`${API}/api/contacts/${id}/status`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        toast('Contact status updated', 'success');
        closeModal();
        loadContacts();
    } catch (e) { toast('Error updating contact status', 'error'); }
}
