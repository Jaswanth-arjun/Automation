/**
 * LinkedIn Connect AI - Client Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // State
  let roles = ['Recruiter', 'Talent Acquisition', 'HR', 'Hiring Manager', 'Engineering Manager'];
  let ws = null;

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
  const connectionNoteInput = document.getElementById('connectionNote');
  const useAINotesCheckbox = document.getElementById('useAINotes');
  const apiKeyGroup = document.getElementById('apiKeyGroup');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');

  const metricSent = document.getElementById('metricSent');
  const metricSkipped = document.getElementById('metricSkipped');
  const metricFailed = document.getElementById('metricFailed');
  const metricTarget = document.getElementById('metricTarget');

  const currentRoleText = document.getElementById('currentRoleText');
  const progressPercentage = document.getElementById('progressPercentage');
  const progressBarFill = document.getElementById('progressBarFill');

  const terminalBody = document.getElementById('terminalBody');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const sentTableBody = document.getElementById('sentTableBody');

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
      });
    });
  }

  function addTagFromInput() {
    const val = roleTagInput.value.trim();
    if (val && !roles.includes(val)) {
      roles.push(val);
      roleTagInput.value = '';
      renderTags();
    }
  }

  addTagBtn.addEventListener('click', addTagFromInput);
  roleTagInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromInput();
    }
  });

  // Speed Preset Switcher
  speedPreset.addEventListener('change', () => {
    if (speedPreset.value === 'custom') {
      customDelaysRow.classList.remove('hidden');
    } else {
      customDelaysRow.classList.add('hidden');
    }
  });

  // AI Toggle Switcher
  useAINotesCheckbox.addEventListener('change', () => {
    if (useAINotesCheckbox.checked) {
      apiKeyGroup.style.display = 'block';
    } else {
      apiKeyGroup.style.display = 'none';
    }
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

    terminalBody.appendChild(line);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  clearLogsBtn.addEventListener('click', () => {
    terminalBody.innerHTML = '';
  });

  // Sent Record Table Renderer
  function appendSentRecord(record) {
    const emptyRow = document.getElementById('emptyTableMsg');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${record.timestamp || ''}</td>
      <td><strong>${escapeHtml(record.name || '')}</strong></td>
      <td><span class="tag-chip">${escapeHtml(record.role || '')}</span></td>
      <td>${escapeHtml(record.note ? record.note.substring(0, 65) + '...' : '')}</td>
    `;
    sentTableBody.prepend(tr);
  }

  // Update Status Pill UI
  function updateStatusUI(status, errorMsg) {
    statusPill.className = `status-pill status-${status}`;

    if (status === 'idle') {
      statusText.textContent = 'System Ready';
      startBtn.disabled = false;
      stopBtn.disabled = true;
    } else if (status === 'running') {
      statusText.textContent = 'Automation Running';
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else if (status === 'requires_login') {
      statusText.textContent = '👆 Please Log In to LinkedIn';
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else if (status === 'stopped') {
      statusText.textContent = errorMsg ? `Stopped: ${errorMsg}` : 'Stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
    } else if (status === 'completed') {
      statusText.textContent = '🎉 Completed!';
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  // Update Progress Stats & Bar
  function updateProgressUI(data) {
    if (!data) return;
    const { stats, currentRole, currentRoleSent, targetPerRole, totalRoles } = data;

    if (stats) {
      metricSent.textContent = stats.sent || 0;
      metricSkipped.textContent = stats.skipped || 0;
      metricFailed.textContent = stats.failed || 0;
      metricTarget.textContent = stats.totalTarget || (totalRoles * targetPerRole);
    }

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

          if (data.sentList && Array.isArray(data.sentList)) {
            sentTableBody.innerHTML = '';
            data.sentList.forEach((s) => appendSentRecord(s));
          }
        } else if (type === 'log') {
          appendLog(data);
        } else if (type === 'progress') {
          updateProgressUI(data);
        } else if (type === 'sent') {
          appendSentRecord(data);
        } else if (type === 'status_change') {
          updateStatusUI(data.status, data.error);
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
      connectionNote: connectionNoteInput.value.trim(),
      useAINotes: useAINotesCheckbox.checked,
      geminiApiKey: geminiApiKeyInput.value.trim(),
    };

    updateStatusUI('running');
    appendLog({ timestamp: new Date().toLocaleTimeString(), message: 'Initiating Automation...', level: 'info' });

    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        updateStatusUI('stopped', json.error);
        alert(json.error || 'Failed to start automation');
      }
    } catch (err) {
      updateStatusUI('stopped', err.message);
      alert('Server Connection Error: ' + err.message);
    }
  });

  // Stop Handler
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    appendLog({ timestamp: new Date().toLocaleTimeString(), message: 'Sending stop signal to server...', level: 'warning' });

    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (err) {
      console.error('Stop request failed:', err);
    }
  });

  // Initialize
  renderTags();
  initWebSocket();
});
