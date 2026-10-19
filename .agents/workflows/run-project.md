---
description: How to run the entire HAMZO project (backend + frontend)
---

# Running the HAMZO Project

The project has **2 servers** that need to run simultaneously in **separate terminals**.

## Prerequisites
- Node.js installed
- Dependencies installed in both directories (run `npm install` if not done)

## Terminal 1 — Backend Server (Port 3000)

// turbo
1. Install backend dependencies (skip if already done):
```
cd d:\Automation
npm install
```

// turbo
2. Start the backend server:
```
cd d:\Automation
node server.js
```

Expected output:
```
╔═══════════════════════════════════════════════════════════════╗
║  🌐 LinkedIn Cloud Automation Web Dashboard Server Running!   ║
║  URL: http://localhost:3000                                   ║
╚═══════════════════════════════════════════════════════════════╝
```

## Terminal 2 — Frontend Dev Server (Port 5173)

// turbo
3. Install frontend dependencies (skip if already done):
```
cd d:\Automation\landing-page
npm install
```

// turbo
4. Start the Vite dev server:
```
cd d:\Automation\landing-page
npm run dev
```

Expected output:
```
VITE ready in ~500ms
➜  Local:   http://localhost:5173/
```

## Open in Browser

5. Open **http://localhost:5173** in your browser (this is the main dashboard).

## Notes
- The frontend (Vite on 5173) proxies all `/api/*` requests to the backend (3000).
- If port 3000 is occupied, the backend auto-retries on the next port (3001, 3002, etc.).
- The backend must be running for features like job link tailoring, email, and LinkedIn automation to work.
- Optional: Load the Chrome extension from `d:\Automation\extension` for auto-fill features.
