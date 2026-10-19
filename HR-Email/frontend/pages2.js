/* ═══════════════════════════════════════════════════════════════════
   TalentFlow Pro — Pages Part 2 (Send Dispatch, Follow-ups, Settings, AI Copilot)
   ═══════════════════════════════════════════════════════════════════ */

// ─── Send Dispatch Queue Page ──────────────────────────────────────
async function loadSendPage() {
    const page = document.getElementById('page-send');
    page.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Preparing outreach queue...</div>';
    
    try {
        const [contactsRes, dashRes] = await Promise.all([
            fetch(`${API}/api/contacts?status=NOT_CONTACTED`),
            fetch(`${API}/api/dashboard`),
        ]);
        const newContacts = await contactsRes.json();
        const dash = await dashRes.json();
        
        const total = dash.total_contacts || 1;
        const lastSentSno = dash.last_sent_sno || 0;
        const progressPct = Math.min(100, Math.round((lastSentSno / total) * 100));

        let html = `
            <div class="page-header">
                <h1>Outreach Dispatch Queue</h1>
                <p>Review contact queue, inspect personalized templates, and launch email dispatching</p>
            </div>
            
            <!-- S.No Progress Tracker Banner -->
            <div class="hero-tracker-card" style="border-left: 4px solid var(--accent)">
                <div class="tracker-title-row">
                    <h2>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        Serial Delivery Tracker (S.No)
                    </h2>
                    <span class="tracker-badge">${progressPct}% Complete</span>
                </div>
                
                <div style="background:rgba(0,0,0,0.3);height:8px;border-radius:4px;overflow:hidden;margin-bottom:20px;border:1px solid var(--border)">
                    <div style="width:${progressPct}%;height:100%;background:var(--gradient-1);border-radius:4px;transition:width 0.5s ease"></div>
                </div>

                <div class="tracker-details-grid">
                    <div class="tracker-stat-box">
                        <label>✅ Last Sent Contact</label>
                        <div class="tracker-stat-val">
                            <span class="badge badge-sent" style="font-size:12px">S.No #${dash.last_sent_sno || 0}</span>
                            <span>${escapeHtml(dash.last_sent_name || 'None')}</span>
                            <code>${escapeHtml(dash.last_sent_email || '')}</code>
                        </div>
                    </div>
                    <div class="tracker-stat-box">
                        <label>⏳ Next Target in Queue</label>
                        <div class="tracker-stat-val">
                            <span class="badge badge-new" style="font-size:12px">S.No #${dash.next_pending_sno || 'Completed'}</span>
                            <span>${escapeHtml(dash.next_pending_name || 'All contacts sent!')}</span>
                            <code>${escapeHtml(dash.next_pending_email || '')}</code>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Stats Grid -->
            <div class="stats-grid">
                <div class="stat-card teal">
                    <div class="stat-header">
                        <div class="stat-label">Pending Dispatch</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${newContacts.length}</div>
                </div>
                <div class="stat-card amber">
                    <div class="stat-header">
                        <div class="stat-label">Sent Today</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${dash.sent_today} / ${dash.daily_limit}</div>
                </div>
                <div class="stat-card purple">
                    <div class="stat-header">
                        <div class="stat-label">Remaining Daily Quota</div>
                        <div class="stat-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        </div>
                    </div>
                    <div class="stat-value">${Math.max(0, dash.daily_limit - dash.sent_today)}</div>
                </div>
            </div>`;
        
        if (!state.authStatus.is_authenticated) {
            html += `<div class="card"><div class="confirm-banner"><div><div class="confirm-banner-text">⚠️ Gmail SMTP Disconnected</div><div class="confirm-banner-sub">Connect your Gmail account in Settings with a 16-character App Password to send emails.</div></div><button class="btn btn-primary" onclick="showPage('settings')">Configure Settings</button></div></div>`;
        }
        
        // Test email section
        html += `
            <div class="card">
                <div class="card-header">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        Test Email Validator
                    </h2>
                </div>
                <p style="color:var(--text-secondary);margin-bottom:18px;font-size:13.5px">Send a quick test message to verify formatting and deliverability before running bulk queue.</p>
                <div class="form-row">
                    <div class="form-group"><label>Your Inbox Address</label><input type="email" id="test-email" placeholder="yourname@gmail.com"></div>
                    <div class="form-group"><label>Sample Company Name</label><input type="text" id="test-company" value="Apex Global" placeholder="Company name"></div>
                </div>
                <button class="btn btn-outline" onclick="sendTestEmail()" ${!state.authStatus.is_authenticated?'disabled':''}>Send Test Email</button>
            </div>`;
        
        if (newContacts.length > 0) {
            html += `
                <div class="card">
                    <div class="card-header">
                        <h2>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            Pending Contacts Queue (${newContacts.length})
                        </h2>
                        <div class="btn-group">
                            <button class="btn btn-outline btn-sm" onclick="previewAllNew()">Preview Generated Templates</button>
                            <button class="btn btn-primary btn-sm" onclick="confirmSendAll()" ${!state.authStatus.is_authenticated?'disabled':''}>Dispatch Selected Queue</button>
                        </div>
                    </div>
                    <div class="table-wrapper"><table><thead><tr>
                        <th><input type="checkbox" id="select-all-send" onchange="toggleSelectAll(this)"></th>
                        <th># S.No</th><th>Contact</th><th>Email</th><th>Company</th><th>Actions</th>
                    </tr></thead><tbody>`;
            
            state.selectedContactIds = new Set(newContacts.map(c => c.id));
            newContacts.forEach(c => {
                const avatar = getInitials(c.name);
                html += `<tr>
                    <td><input type="checkbox" class="contact-cb" value="${c.id}" checked onchange="toggleContactSelect(${c.id}, this.checked)"></td>
                    <td><span class="badge badge-muted" style="font-family:'JetBrains Mono',monospace;font-weight:700">S.No #${c.sno || c.id}</span></td>
                    <td>
                        <div style="display:flex;align-items:center;">
                            <div class="contact-avatar">${avatar}</div>
                            <strong>${escapeHtml(c.name||'—')}</strong>
                        </div>
                    </td>
                    <td style="color:var(--accent-light);font-family:'JetBrains Mono',monospace;font-size:12.5px">${escapeHtml(c.email)}</td>
                    <td>${escapeHtml(c.company||'—')}</td>
                    <td><button class="btn btn-outline btn-sm" onclick="previewSingleEmail(${c.id})">Preview Template</button></td>
                </tr>`;
            });
            html += '</tbody></table></div></div>';
        } else {
            html += '<div class="card"><div class="empty-state"><h3>Queue is currently empty</h3><p>Upload a PDF contact list to queue personalized outreach emails.</p></div></div>';
        }
        
        html += '<div id="preview-container"></div>';
        page.innerHTML = html;
    } catch (e) {
        page.innerHTML = '<div class="empty-state"><h3>Error loading send dispatch page</h3></div>';
    }
}

function toggleSelectAll(cb) {
    const boxes = document.querySelectorAll('.contact-cb');
    boxes.forEach(b => { b.checked = cb.checked; toggleContactSelect(parseInt(b.value), cb.checked); });
}

function toggleContactSelect(id, checked) {
    if (checked) state.selectedContactIds.add(id);
    else state.selectedContactIds.delete(id);
}

async function sendTestEmail() {
    const email = document.getElementById('test-email').value.trim();
    const company = document.getElementById('test-company').value.trim();
    if (!email) { toast('Enter your email address', 'warning'); return; }
    
    toast('Sending test email via SMTP...', 'info');
    try {
        const res = await fetch(`${API}/api/send-test`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, contact_company: company }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
        toast('Test email sent! Check your inbox.', 'success');
    } catch (e) { toast(`Failed: ${e.message}`, 'error'); }
}

async function previewAllNew() {
    const container = document.getElementById('preview-container');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Generating email previews...</div>';
    
    try {
        const res = await fetch(`${API}/api/preview-all-new`, { method: 'POST' });
        const previews = await res.json();
        
        let html = `<div class="card"><div class="card-header"><h2>Generated Previews (${previews.length})</h2></div>`;
        previews.forEach(p => {
            html += `<div class="email-preview">
                <div class="email-preview-header">
                    <span><strong>${escapeHtml(p.contact.name||'—')}</strong> · <span style="font-family:'JetBrains Mono',monospace">${escapeHtml(p.contact.email)}</span></span>
                    <span class="badge badge-new">${p.email_type}</span>
                </div>
                <div class="email-preview-subject">Subject: ${escapeHtml(p.subject)}</div>
                <div class="email-preview-body">${escapeHtml(p.body)}</div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (e) { container.innerHTML = ''; toast('Error generating previews', 'error'); }
}

async function previewSingleEmail(contactId) {
    try {
        const res = await fetch(`${API}/api/preview-emails?contact_ids=${contactId}`);
        const previews = await res.json();
        if (previews.length === 0) { toast('No preview available for this record', 'info'); return; }
        const p = previews[0];
        openModal(`
            <h2>Personalized Email Preview</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-family:'JetBrains Mono',monospace">Recipient: ${escapeHtml(p.contact.email)}</p>
            <div class="email-preview">
                <div class="email-preview-subject">Subject: ${escapeHtml(p.subject)}</div>
                <div class="email-preview-body">${escapeHtml(p.body)}</div>
            </div>
            <div style="text-align:right;margin-top:20px"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
        `);
    } catch (e) { toast('Error loading preview', 'error'); }
}

function confirmSendAll() {
    const ids = Array.from(state.selectedContactIds);
    if (ids.length === 0) { toast('Select at least one contact to send', 'warning'); return; }
    
    openModal(`
        <h2>⚠️ Confirm Queue Dispatch</h2>
        <p style="margin:16px 0;font-size:15px">You are about to launch dispatch for <strong>${ids.length}</strong> personalized emails.</p>
        <p style="color:var(--text-secondary);margin-bottom:20px;font-size:13.5px">Emails will be dispatched sequentially with humanized delay throttling to safeguard domain deliverability.</p>
        <div class="btn-group" style="justify-content:flex-end">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-success" onclick="executeSend(${JSON.stringify(ids)})">✓ Confirm & Dispatch Queue</button>
        </div>
    `);
}

async function executeSend(ids) {
    closeModal();
    toast('Executing email dispatch sequence...', 'info');
    try {
        const res = await fetch(`${API}/api/send-emails`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_ids: ids, email_type: 'INITIAL' }),
        });
        const result = await res.json();
        
        if (result.status === 'daily_limit_reached') {
            toast(result.message, 'warning');
        } else {
            toast(`Dispatched: ${result.sent}, Failed: ${result.failed}, Daily Quota Left: ${result.remaining_today}`, result.failed > 0 ? 'warning' : 'success');
        }
        loadSendPage();
    } catch (e) { toast('Email dispatch failed', 'error'); }
}

// ─── Follow-ups Engine Page ───────────────────────────────────────
async function loadFollowups() {
    const page = document.getElementById('page-followups');
    page.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Calculating eligible follow-up candidates...</div>';
    
    try {
        const res = await fetch(`${API}/api/followups/eligible`);
        const data = await res.json();
        
        let html = `
            <div class="page-header">
                <h1>Follow-ups Automation Engine</h1>
                <p>Automated follow-up campaigns for un-replied outreach messages past the cooldown threshold</p>
            </div>`;
        
        if (data.count > 0) {
            html += `<div class="confirm-banner">
                <div>
                    <div class="confirm-banner-text">${data.count} contacts are eligible for follow-up</div>
                    <div class="confirm-banner-sub">Review generated follow-up messages before sending.</div>
                </div>
                <button class="btn btn-primary" onclick="confirmSendFollowups()">Dispatch Follow-ups Now</button>
            </div>`;
            
            data.eligible.forEach(item => {
                const c = item.contact;
                const avatar = getInitials(c.name);
                html += `<div class="email-preview">
                    <div class="email-preview-header">
                        <span style="display:flex;align-items:center;">
                            <div class="contact-avatar">${avatar}</div>
                            <strong>${escapeHtml(c.name||'—')}</strong> &nbsp;·&nbsp; 
                            <code style="font-family:'JetBrains Mono',monospace">${escapeHtml(c.email)}</code> &nbsp;·&nbsp; 
                            Follow-up #${item.followup_number}
                        </span>
                        <span class="badge badge-followup">FOLLOWUP</span>
                    </div>
                    <div class="email-preview-subject">Subject: ${escapeHtml(item.subject)}</div>
                    <div class="email-preview-body">${escapeHtml(item.body)}</div>
                </div>`;
            });
            
            window._followupContactIds = data.eligible.map(e => e.contact.id);
        } else {
            html += '<div class="card"><div class="empty-state"><h3>No contacts currently eligible for follow-up</h3><p>Contacts enter the follow-up queue automatically after the configured cooldown period (default 30 days) with no response.</p></div></div>';
        }
        page.innerHTML = html;
    } catch (e) {
        page.innerHTML = '<div class="empty-state"><h3>Error loading follow-up intelligence</h3></div>';
    }
}

function confirmSendFollowups() {
    const ids = window._followupContactIds || [];
    if (ids.length === 0) return;
    
    openModal(`
        <h2>⚠️ Confirm Follow-up Dispatch</h2>
        <p style="margin:16px 0">You are about to dispatch <strong>${ids.length}</strong> follow-up emails.</p>
        <p style="color:var(--text-secondary);margin-bottom:20px">Only contacts with zero replies will be contacted.</p>
        <div class="btn-group" style="justify-content:flex-end">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-success" onclick="executeSendFollowups()">✓ Confirm & Send Follow-ups</button>
        </div>
    `);
}

async function executeSendFollowups() {
    closeModal();
    const ids = window._followupContactIds || [];
    toast('Dispatching follow-ups...', 'info');
    try {
        const res = await fetch(`${API}/api/send-emails`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_ids: ids, email_type: 'FOLLOWUP' }),
        });
        const result = await res.json();
        toast(`Dispatched: ${result.sent}, Failed: ${result.failed}`, result.failed > 0 ? 'warning' : 'success');
        loadFollowups();
    } catch (e) { toast('Follow-up dispatch failed', 'error'); }
}

// ─── Settings & Configuration Page ────────────────────────────────
async function renderSettings() {
    await loadSettings();
    const s = state.settings;
    const page = document.getElementById('page-settings');
    
    page.innerHTML = `
        <div class="page-header">
            <h1>System Settings & Account Configuration</h1>
            <p>Manage candidate outreach profile, Gmail SMTP credentials, and deliverability parameters</p>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    Gmail Account Connection
                </h2>
            </div>
            ${state.authStatus.is_authenticated 
                ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0">
                     <p style="color:var(--success);font-weight:600;display:flex;align-items:center;gap:8px">
                         <span class="auth-dot connected"></span> Connected as ${escapeHtml(state.authStatus.user_email)}
                     </p>
                     <button class="btn btn-danger btn-sm" onclick="disconnectGmail()">Disconnect Account</button>
                   </div>`
                : `<p style="color:var(--text-secondary);margin-bottom:18px;font-size:13.5px">Connect your Gmail account using your email address and a 16-character App Password generated from Google Account Security.</p>
                   <div class="form-row" style="margin-bottom:18px">
                       <div class="form-group">
                           <label>Gmail Address</label>
                           <input type="email" id="gmail-email" placeholder="yourname@gmail.com">
                       </div>
                       <div class="form-group">
                           <label>App Password (16 characters)</label>
                           <input type="password" id="gmail-app-password" placeholder="abcdefghijklmnop">
                       </div>
                   </div>
                   <button class="btn btn-primary" onclick="connectGmail()">Authenticate & Connect Gmail</button>`
            }
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    Candidate Professional Profile
                </h2>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Full Name</label><input id="s-name" value="${escapeHtml(s.candidate_name||'')}"></div>
                <div class="form-group"><label>Degree / Specialization</label><input id="s-degree" value="${escapeHtml(s.candidate_degree||'')}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>University / College</label><input id="s-college" value="${escapeHtml(s.candidate_college||'')}"></div>
                <div class="form-group"><label>Graduation Year</label><input id="s-grad" value="${escapeHtml(s.candidate_grad_year||'')}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>LinkedIn URL</label><input id="s-linkedin" value="${escapeHtml(s.linkedin_url||'')}"></div>
                <div class="form-group"><label>GitHub / Portfolio URL</label><input id="s-github" value="${escapeHtml(s.github_url||'')}"></div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Deliverability & Safety Throttling
                </h2>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Daily Sending Limit</label><input type="number" id="s-limit" value="${s.daily_limit||50}" min="1" max="2000"></div>
                <div class="form-group"><label>Follow-up Cooldown (days)</label><input type="number" id="s-cooldown" value="${s.cooldown_days||30}" min="1" max="90"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Max Follow-up Sequence</label><input type="number" id="s-maxfu" value="${s.max_followups||2}" min="0" max="5"></div>
                <div class="form-group"><label>Humanized Send Delay (seconds)</label><input type="number" id="s-delay" value="${s.send_delay_seconds||15}" min="2" max="300"></div>
            </div>
        </div>
        
        <button class="btn btn-primary" onclick="saveSettings()">Save Configuration</button>`;
}

async function saveSettings() {
    try {
        await fetch(`${API}/api/settings`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidate_name: document.getElementById('s-name').value,
                candidate_degree: document.getElementById('s-degree').value,
                candidate_college: document.getElementById('s-college').value,
                candidate_grad_year: document.getElementById('s-grad').value,
                linkedin_url: document.getElementById('s-linkedin').value,
                github_url: document.getElementById('s-github').value,
                daily_limit: document.getElementById('s-limit').value,
                cooldown_days: document.getElementById('s-cooldown').value,
                max_followups: document.getElementById('s-maxfu').value,
                send_delay_seconds: document.getElementById('s-delay').value,
            }),
        });
        await loadSettings();
        toast('Configuration saved successfully!', 'success');
    } catch (e) { toast('Error saving configuration', 'error'); }
}

async function connectGmail() {
    const email = document.getElementById('gmail-email').value.trim();
    const appPassword = document.getElementById('gmail-app-password').value.trim().replace(/\s+/g, '');
    
    if (!email) { toast('Please enter your Gmail address', 'warning'); return; }
    if (!appPassword) { toast('Please enter your 16-character App Password', 'warning'); return; }
    
    toast('Authenticating Gmail credentials via SMTP...', 'info');
    try {
        const res = await fetch(`${API}/api/auth/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, app_password: appPassword }),
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to connect Gmail');
        }
        
        toast('Gmail connected successfully!', 'success');
        await checkAuth();
        renderSettings();
    } catch (e) {
        toast(`Error: ${e.message}`, 'error');
    }
}

async function disconnectGmail() {
    try {
        await fetch(`${API}/api/auth/disconnect`, { method: 'POST' });
        await checkAuth();
        toast('Gmail disconnected', 'info');
        renderSettings();
    } catch (e) { toast('Error disconnecting account', 'error'); }
}

// ─── AI Copilot (RAG) Page ─────────────────────────────────────────
async function loadAssistantPage() {
    const page = document.getElementById('page-assistant');
    page.innerHTML = `
        <div class="page-header">
            <h1>AI Talent Intelligence Copilot (RAG)</h1>
            <p>Query campaign metrics, recruiter sentiment patterns, and recipient statistics using natural language</p>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Intelligence Prompt Suggestions
                </h2>
            </div>
            <div class="btn-group" style="margin-bottom:20px">
                <button class="btn btn-outline btn-sm" onclick="sendAssistantQuery('Show campaign summary & response rate')">📊 Campaign Performance Summary</button>
                <button class="btn btn-outline btn-sm" onclick="sendAssistantQuery('Who replied to my emails?')">📩 All Recruiter Replies</button>
                <button class="btn btn-outline btn-sm" onclick="sendAssistantQuery('Show interested recruiters')">🌟 High Interest Leads</button>
                <button class="btn btn-outline btn-sm" onclick="sendAssistantQuery('Who is eligible for follow-up?')">⏰ Follow-up Queue Analysis</button>
            </div>
            
            <div class="form-row">
                <div class="form-group" style="flex:1;margin-bottom:0">
                    <input type="text" id="assistant-input" placeholder="Ask anything e.g. 'Did anyone from Google reply?' or 'Show positive sentiment leads'..."
                           onkeyup="if(event.key==='Enter')submitAssistantInput()">
                </div>
                <button class="btn btn-primary" onclick="submitAssistantInput()">Ask Copilot</button>
            </div>
        </div>
        
        <div id="assistant-results"></div>
    `;
    sendAssistantQuery("Show campaign summary");
}

function submitAssistantInput() {
    const val = document.getElementById('assistant-input').value.trim();
    if (val) sendAssistantQuery(val);
}

async function sendAssistantQuery(query) {
    const results = document.getElementById('assistant-results');
    if (!results) return;
    results.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Querying intelligence database...</div>';
    
    try {
        const res = await fetch(`${API}/api/ai-assistant/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        const data = await res.json();
        
        const formattedAnswer = escapeHtml(data.answer)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
        
        let html = `
            <div class="card">
                <div class="card-header">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        Intelligence Analysis: "${escapeHtml(query)}"
                    </h2>
                </div>
                <div class="email-preview-body" style="font-size:14.5px;line-height:1.7;background:rgba(10,12,24,0.6)">
                    ${formattedAnswer}
                </div>
            </div>`;
            
        results.innerHTML = html;
    } catch (e) {
        results.innerHTML = '<div class="card"><p style="color:var(--danger)">Error querying AI copilot</p></div>';
    }
}
