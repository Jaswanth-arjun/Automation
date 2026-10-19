/* ═══════════════════════════════════════════════════════════════════
   HR Email Automation Agent — Frontend Application (Part 1: Core)
   ═══════════════════════════════════════════════════════════════════ */

const API = (window.location.protocol.startsWith('http') && window.location.port === '8000') ? '' : 'http://localhost:8000';


// ─── State ────────────────────────────────────────────────────────
let state = {
    currentPage: 'dashboard',
    authStatus: { is_authenticated: false },
    settings: {},
    extractedContacts: null,
    selectedContactIds: new Set(),
};

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupAuthListener();
    await checkAuth();
    await loadSettings();
    showPage('dashboard');
});

// ─── Navigation ───────────────────────────────────────────────────
function setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => showPage(btn.dataset.page));
    });
}

function showPage(page) {
    state.currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    const loaders = {
        dashboard: loadDashboard,
        upload: renderUploadPage,
        contacts: loadContacts,
        send: loadSendPage,
        followups: loadFollowups,
        assistant: loadAssistantPage,
        settings: renderSettings,
    };
    if (loaders[page]) loaders[page]();
}

// ─── Auth ─────────────────────────────────────────────────────────
function setupAuthListener() {
    window.addEventListener('message', async (e) => {
        if (e.data === 'auth_success') {
            await checkAuth();
            toast('Gmail connected successfully!', 'success');
        }
    });
}

async function checkAuth() {
    try {
        const res = await fetch(`${API}/api/auth/status`);
        state.authStatus = await res.json();
        updateAuthUI();
    } catch (e) {
        console.error('Auth check failed:', e);
    }
}

function updateAuthUI() {
    const el = document.getElementById('auth-status');
    const a = state.authStatus;
    if (a.is_authenticated) {
        el.innerHTML = `<div class="auth-dot connected"></div><span>Gmail: ${a.user_email || 'Connected'}</span>`;
    } else if (a.has_client_secret) {
        el.innerHTML = `<div class="auth-dot disconnected"></div><span>Gmail: Not connected</span>`;
    } else {
        el.innerHTML = `<div class="auth-dot disconnected"></div><span>Gmail: Setup needed</span>`;
    }
}

// ─── Settings ─────────────────────────────────────────────────────
async function loadSettings() {
    try {
        const res = await fetch(`${API}/api/settings`);
        state.settings = await res.json();
    } catch (e) { console.error(e); }
}

// ─── Toast ────────────────────────────────────────────────────────
function toast(message, type = 'info') {
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

// ─── Modal ────────────────────────────────────────────────────────
function openModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
}

document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});

function getInitials(name) {
    if (!name || name === '—' || name === 'None') return 'HR';
    const clean = name.trim().replace(/^(mr\.|ms\.|dr\.|mrs\.)\s+/i, '').trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return clean.substring(0, 2).toUpperCase();
}

function statusBadge(status) {
    const map = {
        NOT_CONTACTED: ['New', 'badge-new'],
        EMAIL_SENT: ['Sent', 'badge-sent'],
        REPLIED: ['Replied', 'badge-replied'],
        FOLLOW_UP_ELIGIBLE: ['Follow-up', 'badge-followup'],
        FOLLOW_UP_SENT: ['FU Sent', 'badge-followup'],
        DO_NOT_CONTACT: ['DNC', 'badge-danger'],
        INVALID_EMAIL: ['Invalid', 'badge-danger'],
        UNSUBSCRIBED: ['Unsub', 'badge-muted'],
    };
    const [label, cls] = map[status] || [status, 'badge-muted'];
    return `<span class="badge ${cls}">${label}</span>`;
}

function formatDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

