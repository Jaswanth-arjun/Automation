import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { LinkedInBotEngine } from './lib/bot-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('error', (err) => {
  // Handle WS server error silently during port retry
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Application State
let activeBotInstance = null;
let currentStatus = 'idle'; // 'idle', 'running', 'requires_login', 'completed', 'stopped'
const logBuffer = [];
const sentBuffer = [];
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
  ws.send(
    JSON.stringify({
      type: 'init',
      data: {
        status: currentStatus,
        progress: currentProgress,
        logs: logBuffer.slice(-100),
        sentList: sentBuffer,
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
  });
});

app.get('/api/logs', (req, res) => {
  res.json(logBuffer);
});

app.get('/api/sent', (req, res) => {
  res.json(sentBuffer);
});

app.post('/api/start', async (req, res) => {
  if (activeBotInstance && activeBotInstance.isRunning) {
    return res.status(400).json({ error: 'Automation is already running!' });
  }

  const rawConfig = req.body || {};

  // Reset buffers
  logBuffer.length = 0;
  sentBuffer.length = 0;
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
    sentBuffer.push(sentRecord);
    broadcast('sent', sentRecord);
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
  if (!activeBotInstance || !activeBotInstance.isRunning) {
    currentStatus = 'stopped';
    broadcast('status_change', { status: 'stopped' });
    return res.json({ message: 'Automation was not running.' });
  }

  await activeBotInstance.stop();
  currentStatus = 'stopped';
  broadcast('status_change', { status: 'stopped' });
  res.json({ message: 'Stop signal sent successfully.' });
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
  console.log(`║  🌐 LinkedIn Automation Web Dashboard Server Running!         ║`);
  console.log(`║  URL: http://localhost:${currentPort}                                 ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
});

startServer(currentPort);
