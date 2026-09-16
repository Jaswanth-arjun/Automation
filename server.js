import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { LinkedInBotEngine } from './lib/bot-engine.js';
import { LinkedInTrackerEngine } from './lib/tracker-engine.js';
import { db } from './lib/db.js';
import { handleRagChat } from './lib/rag-assistant.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('error', () => {
  // Handle WS server error silently during port retry
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Application State
let activeBotInstance = null;
let activeTrackerInstance = null;
let currentStatus = 'idle'; // 'idle', 'running', 'syncing', 'requires_login', 'completed', 'stopped'
const logBuffer = [];
let currentProgress = {
  stats: { sent: 0, skipped: 0, failed: 0, totalTarget: 0 },
  currentRole: '',
  currentRoleSent: 0,
  targetPerRole: 10,
  totalRoles: 0,
};

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function pushLog(logObj) {
  logBuffer.push(logObj);
  if (logBuffer.length > 500) logBuffer.shift();
  broadcast('log', logObj);
}

// WebSocket Connection handler
wss.on('connection', (ws) => {
  const allConns = db.getAllConnections();
  const analytics = db.getAnalytics();

  ws.send(
    JSON.stringify({
      type: 'init',
      data: {
        status: currentStatus,
        progress: currentProgress,
        logs: logBuffer.slice(-100),
        connections: allConns,
        analytics,
      },
    })
  );
});

// REST API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    status: currentStatus,
    progress: currentProgress,
    stats: activeBotInstance ? activeBotInstance.stats : { sent: 0, skipped: 0, failed: 0, totalTarget: 0 },
    analytics: db.getAnalytics(),
  });
});

app.get('/api/connections', (req, res) => {
  const filter = {
    company: req.query.company || 'all',
    status: req.query.status || 'all',
    search: req.query.search || '',
  };
  res.json(db.getAllConnections(filter));
});

app.get('/api/analytics', (req, res) => {
  const company = req.query.company || 'all';
  res.json(db.getAnalytics(company));
});

app.post('/api/chat', async (req, res) => {
  const { message, geminiApiKey } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message query is required' });
  }

  try {
    const existingBrowser = (activeTrackerInstance && activeTrackerInstance.browser) ? activeTrackerInstance.browser :
                            (activeBotInstance && activeBotInstance.browser) ? activeBotInstance.browser : null;
    const reply = await handleRagChat(message, geminiApiKey, existingBrowser);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to process RAG chat request' });
  }
});

async function triggerStatusSync(isAuto = false) {
  if (activeTrackerInstance && activeTrackerInstance.isRunning) {
    if (!isAuto) throw new Error('Background status tracker is already running!');
    return false;
  }

  const existingBrowser = (activeBotInstance && activeBotInstance.isRunning && activeBotInstance.browser) ? activeBotInstance.browser : null;

  activeTrackerInstance = new LinkedInTrackerEngine({
    headless: true,
    existingBrowser,
  });

  activeTrackerInstance.on('log', (logObj) => {
    pushLog(logObj);
  });

  activeTrackerInstance.on('status_change', ({ status, error }) => {
    // Only update main status pill to syncing if campaign is not active
    if (!activeBotInstance || !activeBotInstance.isRunning) {
      currentStatus = status;
      broadcast('status_change', { status, error });
    }
    broadcast('connections_updated', { connections: db.getAllConnections(), analytics: db.getAnalytics() });
  });

  pushLog({
    timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
    message: isAuto ? '⏰ Periodic 24/7 Background Status Sync Triggered (2-Hour Interval)...' : '🔍 Background Status Sync Initiated...',
    level: 'info',
  });

  activeTrackerInstance.startSync().catch((err) => {
    pushLog({ timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }), message: `Tracker Sync Error: ${err.message}`, level: 'error' });
    if (!activeBotInstance || !activeBotInstance.isRunning) {
      currentStatus = 'idle';
      broadcast('status_change', { status: 'idle', error: err.message });
    }
  });

  return true;
}

app.post('/api/sync-status', async (req, res) => {
  try {
    await triggerStatusSync(false);
    res.json({ message: 'Background Connection Status Sync started...' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Auto 24/7 Background Status Tracker (Runs every 15 Minutes automatically)
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
setInterval(() => {
  console.log('⏰ Triggering 24/7 periodic background status check...');
  triggerStatusSync(true).catch(() => {});
}, AUTO_SYNC_INTERVAL_MS);

// Trigger initial background sync 15s after boot
setTimeout(() => {
  console.log('🚀 Triggering initial startup background status check...');
  triggerStatusSync(true).catch(() => {});
}, 15000);

app.get('/api/logs', (req, res) => {
  res.json(logBuffer);
});

app.post('/api/start', async (req, res) => {
  if (activeBotInstance && activeBotInstance.isRunning) {
    return res.status(400).json({ error: 'Automation is already running!' });
  }

  const rawConfig = req.body || {};

  // Reset buffers
  logBuffer.length = 0;
  currentProgress = {
    stats: { sent: 0, skipped: 0, failed: 0, totalTarget: 0 },
    currentRole: '',
    currentRoleSent: 0,
    targetPerRole: parseInt(rawConfig.connectionsPerFilter, 10) || 10,
    totalRoles: Array.isArray(rawConfig.roles) ? rawConfig.roles.length : 5,
  };

  activeBotInstance = new LinkedInBotEngine(rawConfig);

  activeBotInstance.on('log', (logObj) => {
    pushLog(logObj);
  });

  activeBotInstance.on('progress', (progressData) => {
    currentProgress = progressData;
    broadcast('progress', progressData);
  });

  activeBotInstance.on('sent', (sentRecord) => {
    broadcast('sent', sentRecord);
    broadcast('connections_updated', { connections: db.getAllConnections(), analytics: db.getAnalytics() });
  });

  activeBotInstance.on('status_change', ({ status, error }) => {
    currentStatus = status;
    broadcast('status_change', { status, error });
  });

  res.json({ message: 'Automation starting...', config: activeBotInstance.config });

  activeBotInstance.start().catch((err) => {
    pushLog({ timestamp: new Date().toLocaleTimeString(), message: `Fatal: ${err.message}`, level: 'error' });
    currentStatus = 'stopped';
    broadcast('status_change', { status: 'stopped', error: err.message });
  });
});

app.post('/api/stop', async (req, res) => {
  if (activeBotInstance && activeBotInstance.isRunning) {
    await activeBotInstance.stop();
  }
  if (activeTrackerInstance && activeTrackerInstance.isRunning) {
    await activeTrackerInstance.stop();
  }

  currentStatus = 'stopped';
  broadcast('status_change', { status: 'stopped' });
  res.json({ message: 'Stop signal sent successfully.' });
});

// API 404 Fallback - Always Return JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint ${req.originalUrl} not found` });
});

// Global Error Handler Middleware - Always Return JSON
app.use((err, req, res, next) => {
  console.error('Unhandled API Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

let currentPort = Number(PORT);

function startServer(portToListen) {
  server.listen(portToListen);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️  Port ${currentPort} is already in use. Retrying on port ${currentPort + 1}...`);
    currentPort++;
    setTimeout(() => {
      startServer(currentPort);
    }, 500);
  } else {
    console.error('❌ Server Listen Error:', err.message);
  }
});

server.on('listening', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║  🌐 LinkedIn Cloud Automation Web Dashboard Server Running!   ║`);
  console.log(`║  URL: http://localhost:${currentPort}                                 ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
});

startServer(currentPort);
