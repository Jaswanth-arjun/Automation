/**
 * LinkedIn Cloud Automation & Status Tracker - Client Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // State
  let roles = ['Recruiter', 'Talent Acquisition', 'HR', 'Hiring Manager', 'Engineering Manager'];
  let ws = null;
  let allConnections = [];

  // DOM Elements
  const companyInput = document.getElementById('companyInput');
  const tagsContainer = document.getElementById('tagsContainer');
  const roleTagInput = document.getElementById('roleTagInput');
  const addTagBtn = document.getElementById('addTagBtn');
  const connectionsPerFilter = document.getElementById('connectionsPerFilter');
  const speedPreset = document.getElementById('speedPreset');
  const customDelaysRow = document.getElementById('customDelaysRow');
  const minDelayInput = document.getElementById('minDelay');
  const maxDelayInput = document.getElementById('maxDelay');
  const headlessModeInput = document.getElementById('headlessMode');
  const connectionNoteInput = document.getElementById('connectionNote');
  const useAINotesCheckbox = document.getElementById('useAINotes');
  const apiKeyGroup = document.getElementById('apiKeyGroup');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const syncStatusBtn = document.getElementById('syncStatusBtn');

  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');

  const metricSent = document.getElementById('metricSent');
  const metricAccepted = document.getElementById('metricAccepted');
  const metricSeen = document.getElementById('metricSeen');
  const metricReplied = document.getElementById('metricReplied');
  const metricPending = document.getElementById('metricPending');

  const companyFilter = document.getElementById('companyFilter');
  const statusFilter = document.getElementById('statusFilter');

  const currentRoleText = document.getElementById('currentRoleText');
  const progressPercentage = document.getElementById('progressPercentage');
  const progressBarFill = document.getElementById('progressBarFill');

  const terminalBody = document.getElementById('terminalBody');
  const campaignTerminalBody = document.getElementById('campaignTerminalBody');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const viewFullLogsBtn = document.getElementById('viewFullLogsBtn');
  const sentTableBody = document.getElementById('sentTableBody');
  const tableSearchInput = document.getElementById('tableSearchInput');

  const qmSent = document.getElementById('qmSent');
  const qmAccepted = document.getElementById('qmAccepted');
  const qmReplied = document.getElementById('qmReplied');

  // Tab Switcher Logic
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  function switchTab(tabId) {
    navTabs.forEach((tab) => {
      if (tab.getAttribute('data-tab') === tabId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    tabContents.forEach((content) => {
      if (content.id === `tab-${tabId}`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.getAttribute('data-tab'));
    });
  });

  if (viewFullLogsBtn) {
    viewFullLogsBtn.addEventListener('click', () => {
      switchTab('logs');
    });
  }

  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', () => {
      renderConnectionsTable();
    });
  }

  // Form Configuration Persistence (localStorage)
  function saveFormState() {
    try {
      const config = {
        company: companyInput.value.trim(),
        roles: roles,
        connectionsPerFilter: connectionsPerFilter.value,
        speedPreset: speedPreset.value,
        minDelay: minDelayInput.value,
        maxDelay: maxDelayInput.value,
        headless: headlessModeInput.checked,
        connectionNote: connectionNoteInput.value,
        useAINotes: useAINotesCheckbox.checked,
        geminiApiKey: geminiApiKeyInput.value,
      };
      localStorage.setItem('linkedin_automation_saved_config', JSON.stringify(config));
    } catch {}
  }

  function loadFormState() {
    try {
      const saved = localStorage.getItem('linkedin_automation_saved_config');
      if (!saved) return;
      const config = JSON.parse(saved);

      if (config.company) companyInput.value = config.company;
      if (Array.isArray(config.roles) && config.roles.length > 0) {
        roles = config.roles;
      }
      if (config.connectionsPerFilter) connectionsPerFilter.value = config.connectionsPerFilter;
      if (config.speedPreset) {
        speedPreset.value = config.speedPreset;
        if (config.speedPreset === 'custom') customDelaysRow.classList.remove('hidden');
      }
      if (config.minDelay) minDelayInput.value = config.minDelay;
      if (config.maxDelay) maxDelayInput.value = config.maxDelay;
      if (typeof config.headless === 'boolean') headlessModeInput.checked = config.headless;
      if (config.connectionNote) connectionNoteInput.value = config.connectionNote;
      if (typeof config.useAINotes === 'boolean') {
        useAINotesCheckbox.checked = config.useAINotes;
        apiKeyGroup.style.display = config.useAINotes ? 'block' : 'none';
      }
      if (config.geminiApiKey) geminiApiKeyInput.value = config.geminiApiKey;
    } catch {}
  }

  // Tag Manager Logic
  function renderTags() {
    tagsContainer.innerHTML = '';
    roles.forEach((role, idx) => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${escapeHtml(role)}</span>
        <span class="tag-remove" data-idx="${idx}">&times;</span>
      `;
      tagsContainer.appendChild(chip);
    });

    document.querySelectorAll('.tag-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-idx'), 10);
        roles.splice(index, 1);
        renderTags();
        saveFormState();
      });
    });
  }

  function addTagFromInput() {
    const val = roleTagInput.value.trim();
    if (val && !roles.includes(val)) {
      roles.push(val);
      roleTagInput.value = '';
      renderTags();
      saveFormState();
    }
  }

  addTagBtn.addEventListener('click', addTagFromInput);
  roleTagInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromInput();
    }
  });

  // Save form on any change
  [companyInput, connectionsPerFilter, speedPreset, minDelayInput, maxDelayInput, headlessModeInput, connectionNoteInput, useAINotesCheckbox, geminiApiKeyInput].forEach((el) => {
    if (el) {
      el.addEventListener('change', saveFormState);
      el.addEventListener('input', saveFormState);
    }
  });

  // Speed Preset Switcher
  speedPreset.addEventListener('change', () => {
    if (speedPreset.value === 'custom') {
      customDelaysRow.classList.remove('hidden');
    } else {
      customDelaysRow.classList.add('hidden');
    }
    saveFormState();
  });

  // AI Toggle Switcher
  useAINotesCheckbox.addEventListener('change', () => {
    if (useAINotesCheckbox.checked) {
      apiKeyGroup.style.display = 'block';
    } else {
      apiKeyGroup.style.display = 'none';
    }
    saveFormState();
  });

  // Delays Helper
  function getDelays() {
    const preset = speedPreset.value;
    if (preset === 'safe') return { min: 20000, max: 35000 };
    if (preset === 'balanced') return { min: 10000, max: 20000 };
    if (preset === 'fast') return { min: 5000, max: 10000 };

    const minSec = parseInt(minDelayInput.value, 10) || 10;
    const maxSec = parseInt(maxDelayInput.value, 10) || 25;
    return { min: minSec * 1000, max: maxSec * 1000 };
  }

  // Log Renderer
  function appendLog(logObj) {
    const { timestamp, message, level } = logObj;
    const line = document.createElement('div');
    line.className = `log-entry log-${level || 'info'}`;
    line.innerHTML = `<span class="log-time">[${timestamp || new Date().toLocaleTimeString()}]</span> ${escapeHtml(message)}`;

    if (terminalBody) {
      terminalBody.appendChild(line);
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  clearLogsBtn.addEventListener('click', () => {
    if (terminalBody) terminalBody.innerHTML = '';
  });

  // Connection History Table Renderer
  function renderConnectionsTable() {
    const targetComp = companyFilter.value;
    const targetStatus = statusFilter.value;
    const searchQuery = (tableSearchInput ? tableSearchInput.value : '').toLowerCase().trim();

    let filtered = allConnections.filter((item) => {
      const matchComp = targetComp === 'all' || (item.company || '').toLowerCase().includes(targetComp.toLowerCase());
      const matchStatus = targetStatus === 'all' || item.status === targetStatus;
      const matchQuery = !searchQuery ||
        (item.name || '').toLowerCase().includes(searchQuery) ||
        (item.role || '').toLowerCase().includes(searchQuery) ||
        (item.company || '').toLowerCase().includes(searchQuery);

      return matchComp && matchStatus && matchQuery;
    });

    if (filtered.length === 0) {
      sentTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">No connection records match the selected filters.</td>
        </tr>
      `;
      return;
    }

    sentTableBody.innerHTML = '';
    filtered.forEach((rec) => {
      const tr = document.createElement('tr');

      let statusBadge = '';
      if (rec.status === 'accepted') {
        statusBadge = '<span class="badge-status badge-accepted">✅ Accepted</span>';
      } else if (rec.status === 'seen') {
        statusBadge = '<span class="badge-status badge-seen">👁️ Seen (No Reply)</span>';
      } else if (rec.status === 'replied') {
        statusBadge = '<span class="badge-status badge-replied">💬 Replied</span>';
      } else if (rec.status === 'declined') {
        statusBadge = '<span class="badge-status badge-declined">❌ Declined</span>';
      } else {
        statusBadge = '<span class="badge-status badge-pending">⏳ Pending</span>';
      }

      const profileLinkHtml = rec.profileUrl
        ? `<a href="${escapeHtml(rec.profileUrl)}" target="_blank" class="person-link">View Profile ↗</a>`
        : '';

      const replyHtml = rec.replyText
        ? `<div class="reply-text-box">💬 Reply: "${escapeHtml(rec.replyText)}"</div>`
        : '';

      tr.innerHTML = `
        <td>
          <div class="person-cell">
            <span class="person-name">${escapeHtml(rec.name || 'LinkedIn User')}</span>
            ${profileLinkHtml}
          </div>
        </td>
        <td><strong>${escapeHtml(extractCompanyName(rec.company) || 'MongoDB')}</strong></td>
        <td><span class="tag-chip">${escapeHtml(rec.role || 'Outreach')}</span></td>
        <td>${statusBadge}</td>
        <td>
          <div>${escapeHtml(rec.note ? rec.note.substring(0, 75) + (rec.note.length > 75 ? '...' : '') : 'Note sent')}</div>
          ${replyHtml}
        </td>
      `;
      sentTableBody.appendChild(tr);
    });
  }

  function extractCompanyName(str) {
    if (!str) return 'Unknown';
    let s = str.trim();
    if (s.startsWith('http://') || s.startsWith('https://')) {
      const match = s.match(/\/company\/([^/\?]+)/i);
      if (match && match[1]) {
        s = match[1];
      } else {
        const parts = s.replace(/\/$/, '').split('/');
        s = parts[parts.length - 1] || parts[parts.length - 2] || s;
      }
    }
    return s
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }

  // Populate Company Dropdown
  function updateCompanyDropdown(analytics) {
    const currentVal = companyFilter.value;
    const rawCompanies = analytics?.companies || [];
    const companies = Array.from(new Set(rawCompanies.map(c => extractCompanyName(c)))).sort();

    companyFilter.innerHTML = '<option value="all">All Companies</option>';
    companies.forEach((comp) => {
      const cleanComp = extractCompanyName(comp);
      const opt = document.createElement('option');
      opt.value = cleanComp;
      opt.textContent = cleanComp;
      if (cleanComp === currentVal) opt.selected = true;
      companyFilter.appendChild(opt);
    });
  }

  // Update Status Pill UI
  function updateStatusUI(status, errorMsg) {
    statusPill.className = `status-pill status-${status}`;

    if (status === 'idle') {
      statusText.textContent = 'System Ready';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      syncStatusBtn.disabled = false;
    } else if (status === 'running') {
      statusText.textContent = 'Automation Running';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      syncStatusBtn.disabled = false;
    } else if (status === 'syncing') {
      statusText.textContent = '🔍 Syncing Statuses...';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      syncStatusBtn.disabled = true;
    } else if (status === 'requires_login') {
      statusText.textContent = '👆 Please Log In to LinkedIn';
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else if (status === 'stopped') {
      statusText.textContent = errorMsg ? `Stopped: ${errorMsg}` : 'Stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      syncStatusBtn.disabled = false;
    } else if (status === 'completed' || status === 'completed_sync') {
      statusText.textContent = '🎉 Action Completed!';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      syncStatusBtn.disabled = false;
    }
  }

  // Update Analytics Cards
  function updateAnalyticsUI(analytics) {
    if (!analytics) return;
    metricSent.textContent = analytics.totalSent || 0;
    metricAccepted.textContent = analytics.accepted || 0;
    metricSeen.textContent = analytics.seen || 0;
    metricReplied.textContent = analytics.replied || 0;
    metricPending.textContent = analytics.pending || 0;

    if (qmSent) qmSent.textContent = analytics.totalSent || 0;
    if (qmAccepted) qmAccepted.textContent = analytics.accepted || 0;
    if (qmReplied) qmReplied.textContent = analytics.replied || 0;
  }

  // Update Progress UI
  function updateProgressUI(data) {
    if (!data) return;
    const { stats, currentRole, currentRoleSent, targetPerRole, totalRoles } = data;

    if (currentRole) {
      currentRoleText.textContent = `Current Filter: "${currentRole}" (${currentRoleSent || 0}/${targetPerRole})`;
    } else {
      currentRoleText.textContent = 'Current Filter: None';
    }

    const totalTarget = stats?.totalTarget || (totalRoles * targetPerRole) || 1;
    const sentCount = stats?.sent || 0;
    const pct = Math.min(100, Math.round((sentCount / totalTarget) * 100));

    progressPercentage.textContent = `${pct}%`;
    progressBarFill.style.width = `${pct}%`;
  }

  // Filter Event Listeners
  companyFilter.addEventListener('change', () => {
    fetchAnalytics();
    renderConnectionsTable();
  });

  statusFilter.addEventListener('change', () => {
    renderConnectionsTable();
  });

  // Safe Fetch Helper to prevent non-JSON / HTML error parsing issues
  async function safeFetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';

    let json = null;
    if (contentType.includes('application/json')) {
      try {
        json = await res.json();
      } catch (e) {
        json = null;
      }
    }

    if (!res.ok) {
      const errMsg = json?.error || (json?.message) || `Server Error (HTTP ${res.status})`;
      throw new Error(errMsg);
    }

    return json || {};
  }

  async function fetchAnalytics() {
    try {
      const json = await safeFetchJson(`/api/analytics?company=${encodeURIComponent(companyFilter.value)}`);
      updateAnalyticsUI(json);
    } catch (e) {
      console.warn('Analytics fetch warning:', e.message);
    }
  }

  async function fetchConnections() {
    try {
      const data = await safeFetchJson('/api/connections');
      if (Array.isArray(data)) {
        allConnections = data;
        renderConnectionsTable();
      }
    } catch (e) {
      console.warn('Connections fetch warning:', e.message);
    }
  }

  // WebSocket Setup
  function initWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket Connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { type, data } = message;

        if (type === 'init') {
          updateStatusUI(data.status);
          updateProgressUI(data.progress);

          if (data.logs && Array.isArray(data.logs)) {
            terminalBody.innerHTML = '';
            data.logs.forEach((l) => appendLog(l));
          }

          if (data.connections && Array.isArray(data.connections)) {
            allConnections = data.connections;
            renderConnectionsTable();
          }

          if (data.analytics) {
            updateCompanyDropdown(data.analytics);
            updateAnalyticsUI(data.analytics);
          }
        } else if (type === 'log') {
          appendLog(data);
        } else if (type === 'progress') {
          updateProgressUI(data);
        } else if (type === 'connections_updated') {
          if (data.connections) {
            allConnections = data.connections;
            renderConnectionsTable();
          }
          if (data.analytics) {
            updateCompanyDropdown(data.analytics);
            updateAnalyticsUI(data.analytics);
          }
        } else if (type === 'status_change') {
          updateStatusUI(data.status, data.error);
          fetchConnections();
          fetchAnalytics();
        }
      } catch (err) {
        console.error('WS Error:', err);
      }
    };

    ws.onclose = () => {
      setTimeout(initWebSocket, 3000);
    };
  }

  // Start Automation Handler
  startBtn.addEventListener('click', async () => {
    if (roles.length === 0) {
      alert('Please add at least one Role filter tag!');
      return;
    }

    const payload = {
      company: companyInput.value.trim(),
      roles: roles,
      connectionsPerFilter: parseInt(connectionsPerFilter.value, 10) || 10,
      delayBetweenConnections: getDelays(),
      headless: headlessModeInput.checked,
      connectionNote: connectionNoteInput.value.trim(),
      useAINotes: useAINotesCheckbox.checked,
      geminiApiKey: geminiApiKeyInput.value.trim(),
    };

    updateStatusUI('running');
    appendLog({ timestamp: new Date().toLocaleTimeString(), message: `Initiating ${headlessModeInput.checked ? 'Background (Headless)' : 'Visual'} Automation...`, level: 'info' });

    try {
      await safeFetchJson('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      updateStatusUI('stopped', err.message);
      alert('Automation Start Warning: ' + err.message);
    }
  });

  // Background Status Sync Handler
  syncStatusBtn.addEventListener('click', async () => {
    updateStatusUI('syncing');
    appendLog({ timestamp: new Date().toLocaleTimeString(), message: 'Triggering background connection status sync...', level: 'info' });

    try {
      await safeFetchJson('/api/sync-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: true }),
      });
    } catch (err) {
      updateStatusUI('idle', err.message);
      alert('Status Sync Warning: ' + err.message);
    }
  });

  // Stop Handler
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    appendLog({ timestamp: new Date().toLocaleTimeString(), message: 'Sending stop signal to server...', level: 'warning' });

    try {
      await safeFetchJson('/api/stop', { method: 'POST' });
    } catch (err) {
      console.error('Stop request failed:', err);
    }
  });

  // RAG AI Assistant Widget Handlers
  const ragChatToggleBtn = document.getElementById('ragChatToggleBtn');
  const ragChatBox = document.getElementById('ragChatBox');
  const ragChatCloseBtn = document.getElementById('ragChatCloseBtn');
  const ragChatForm = document.getElementById('ragChatForm');
  const ragChatInput = document.getElementById('ragChatInput');
  const ragChatMessages = document.getElementById('ragChatMessages');
  const ragPillBtns = document.querySelectorAll('.rag-pill-btn');

  const toggleRagChat = () => {
    ragChatBox.classList.toggle('hidden');
    if (!ragChatBox.classList.contains('hidden')) {
      ragChatInput.focus();
    }
  };

  ragChatToggleBtn?.addEventListener('click', toggleRagChat);
  ragChatCloseBtn?.addEventListener('click', toggleRagChat);

  const appendRagMessage = (sender, text) => {
    const msgDiv = document.createElement('div');
    msgDiv.className = `rag-msg rag-msg-${sender}`;
    const formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/\n/g, '<br>');

    msgDiv.innerHTML = `
      <div class="rag-msg-avatar">${sender === 'user' ? '👤' : '🤖'}</div>
      <div class="rag-msg-bubble">${formattedText}</div>
    `;
    ragChatMessages.appendChild(msgDiv);
    ragChatMessages.scrollTop = ragChatMessages.scrollHeight;
  };

  const sendRagQuery = async (queryText) => {
    const message = (queryText || ragChatInput.value || '').trim();
    if (!message) return;

    appendRagMessage('user', message);
    if (!queryText) ragChatInput.value = '';

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'rag-msg rag-msg-bot';
    loadingDiv.id = 'ragLoadingBubble';
    loadingDiv.innerHTML = `
      <div class="rag-msg-avatar">🤖</div>
      <div class="rag-msg-bubble"><i>Thinking & retrieving data...</i></div>
    `;
    ragChatMessages.appendChild(loadingDiv);
    ragChatMessages.scrollTop = ragChatMessages.scrollHeight;

    try {
      const apiKey = geminiApiKeyInput ? geminiApiKeyInput.value.trim() : '';
      const data = await safeFetchJson('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, geminiApiKey: apiKey }),
      });

      document.getElementById('ragLoadingBubble')?.remove();
      appendRagMessage('bot', data.reply || 'Sorry, I could not process your query.');
    } catch (err) {
      document.getElementById('ragLoadingBubble')?.remove();
      appendRagMessage('bot', `⚠️ Could not reach RAG Assistant: ${err.message}`);
    }
  };

  ragChatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendRagQuery();
  });

  ragPillBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const query = btn.getAttribute('data-query');
      if (query) sendRagQuery(query);
    });
  });

  // Initialize
  loadFormState();
  renderTags();
  initWebSocket();
  fetchConnections();
  fetchAnalytics();
});
