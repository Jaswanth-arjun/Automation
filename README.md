# 🚀 Hamzooh — End-to-End Autonomous AI Job Application & Career Ecosystem

<div align="center">

![Hamzooh Banner](https://img.shields.io/badge/Hamzooh-Autonomous%20Apply%20Agent-00796B?style=for-the-badge&logo=rocket&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome%20Extension-v1.9.27-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white)
![Node Version](https://img.shields.io/badge/Node.js-v22+-green?style=for-the-badge&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-v18-blue?style=for-the-badge&logo=react&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-80%20Passed-success?style=for-the-badge&logo=jest&logoColor=white)
![AI Models](https://img.shields.io/badge/AI%20Router-OpenAI%20%7C%20DeepSeek%20%7C%20Nara-purple?style=for-the-badge&logo=openai&logoColor=white)

**An enterprise-grade, privacy-first career automation platform combining browser-level autonomous form filling, intelligent multi-model AI routing, dynamic resume tailoring, and targeted employee referral outreach.**

[Features](#-core-capabilities) • [Architecture](#-architecture--how-it-works) • [Installation](#-installation--setup) • [AI Routing & Models](#-ai-routing--dual-lane-cost-control) • [Chrome Extension](#-hamzooh-apply-chrome-extension) • [Testing](#-testing--quality-assurance)

</div>

---

## 📖 Overview

**Hamzooh** is an all-in-one AI career co-pilot designed to streamline the entire job search lifecycle. From scraping and importing jobs from arbitrary career portals (Zoho Recruit, Workday, Greenhouse, Lever, LinkedIn), dynamically tailoring resumes with tailored ATS scores and clickable portfolio links, to autonomously filling complex enterprise job forms using Chrome DevTools Protocol (CDP) and executing two-stage recruiter referral outreach.

Unlike generic autofill extensions, Hamzooh operates with a **strict zero-hallucination policy**:
- It **never invents sensitive personal facts** (work authorization, visa sponsorship, legal IDs, demographic disclosures).
- It handles complex Single Page Applications (SPAs) by syncing with React/Angular synthetic event systems (`_valueTracker`) and typing with genuine hardware-level CDP keystrokes.
- It features an **interactive user approval gate** ensuring no application is submitted without explicit confirmation.

---

## 🌟 Core Capabilities

### 1. 🤖 Autonomous "Auto Apply with AI" Agent
- **Broad ATS Compatibility:** Out-of-the-box support for **Workday**, **Zoho Recruit**, **Greenhouse**, **Lever**, **LinkedIn Easy Apply**, **Taleo**, **Ashby**, and custom corporate career portals.
- **Hardware-Level CDP Typing:** Simulates real human keyboard events (`Input.insertText`, keydown/keyup) to reliably trigger React/Workday synthetic state trackers on textareas and dropdown inputs.
- **Smart Unit Normalization:**
  - Notice Period `(in days)`: Auto-converts text like `"Immediately"`, `"None"`, `"Fresher"` → `"0"`.
  - CTC / Compensation `(in lacs)`: Converts full figures like `360000` → `"3.6"`.
  - Experience `(in years)`: Converts fresher roles to `"0"`.
- **Intelligent Address Parsing:** Extracts street, multi-part city, district (`Tirupati District`), state (`Andhra Pradesh`), country (`India`), and postal codes from either structured profile data or resume header lines.
- **Validation Self-Correction:** Scans for `aria-invalid="true"` red errors, parses error messages, adapts values, and re-fills fields automatically before advancing.
- **Post-Fill CAPTCHA Orchestration:** Fills all form fields, attachments, and answers first. It prompts the candidate to solve image CAPTCHAs right before submission, preventing websites from invalidating the CAPTCHA mid-fill.
- **Submission Verification:** Automatically recognizes application submission confirmation screens (`/candidateHome`, `/submitted`, `data-automation-id="viewMyApplications"`) and provides an immediate manual *"I Submitted"* fallback.

### 2. 🧠 Multi-Model AI Router & Dual-Lane Economy
- **Decoupled 4-Role Architecture:**
  - `fast`: Quick micro-decisions and label matching.
  - `primary`: Form field understanding, resume data mapping, and standard input decisions.
  - `reasoning`: Multi-step reasoning for ambiguous questions and error recovery after 3+ retries.
  - `vision`: Screenshot inspection for popups, captcha walls, and visual confirmation.
- **Instant Mode Switching (`OPENAI_ENABLED`):**
  - **Production Mode (`true`):** Routes to OpenAI (`gpt-4.1`, `gpt-4o-mini`, `gpt-4.1-mini`).
  - **100% Free Development Mode (`false`):** Routes Auto Apply to 5 dedicated round-robin Nara accounts (`gpt-6-luna`), mapping each role to a dedicated account so rate limits never clash.
- **Multi-Provider Fallbacks:** Pre-configured connectors for **OpenAI**, **RunCrate** (DeepSeek V4.1 Flash, GLM 5.3, Qwen 3.8 Flash), **Numes AI**, **Nara AI**, **NVIDIA NIM**, and **Google Gemini**.
- **Task Budget Safety:** Enforces strict per-task USD cost ceilings (e.g. $0.40 max per application run, typically costing $0.0013 - $0.003).

### 3. 📄 Tailored Resume Generation & ATS Scorer
- **Job Link Importer:** Extracts job requirements, skills, and descriptions from links including `*.zohorecruit.com`, `*.myworkdayjobs.com`, and LinkedIn.
- **Dynamic 1-Page PDF Engine:** Generates clean, ATS-optimized, single-page PDF resumes using PDFKit with clickable link annotations (GitHub, LinkedIn, live project demos).
- **Keyword Audit & Match Scoring:** Compares JD keywords against candidate profile skills and projects, providing an ATS match score and instant tailoring suggestions.

### 4. 🤝 Targeted LinkedIn Referral Outreach
- **Stage 1 (Connection Engine):** Searches for relevant engineers, recruiters, and hiring managers at target companies and sends personalized connection requests.
- **Stage 2 (Referral Messaging):** Automatically checks accepted connections and sends polite, context-aware referral requests with job links and resume attachments.
- **Anti-Spam & Limit Controls:** Enforces company-wide connection limits, tracks conversation state, and never sends duplicate messages.

### 5. 💻 Modern Full-Stack Dashboard
- Built with **React 18**, **Vite**, and **Tailwind CSS**.
- Real-time application task monitor with live progress steps, pause/resume/cancel controls, and error logs.
- Interactive Profile Vault and Answer Bank for memorizing job questionnaire answers.

---

## 🏗️ Architecture & How It Works

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             HAMZOOH ECOSYSTEM                            │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
   ┌─────────────────────┐                         ┌─────────────────────┐
   │ React 18 Dashboard  │                         │ Chrome Extension    │
   │   (Vite / Tailwind) │                         │   (Hamzooh Apply)   │
   │  - Job Discovery    │◄────── Window Post ─────┤  - filler.js        │
   │  - Task Monitor     │        Message Bridge   │  - agent.js         │
   │  - Profile Vault    │                         │  - background.js    │
   └──────────┬──────────┘                         └──────────┬──────────┘
              │                                               │
              │ REST / WebSocket                              │ CDP Keystrokes
              ▼                                               ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                  Node.js / Express Backend (server.js)              │
   ├─────────────────────────────────────────────────────────────────────┤
   │  • Job Importer (Zoho, Workday, LinkedIn, Web)                      │
   │  • Resume Tailoring & PDFKit Generator                              │
   │  • Task State Machine (application-tasks.js)                        │
   │  • LinkedIn Outreach Automation (Puppeteer)                         │
   └──────────────────────────────────┬──────────────────────────────────┘
                                      │
                                      ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                    Central AI Model Router                          │
   │                     (lib/model-router.js)                           │
   ├──────────────────────────────────┬──────────────────────────────────┤
   │  [OPENAI_ENABLED = true]         │  [OPENAI_ENABLED = false (FREE)]  │
   │  • Primary:   gpt-4.1            │  • Primary:   Nara Key 2 (Luna)  │
   │  • Reasoning: gpt-4.1            │  • Reasoning: Nara Key 3 (Luna)  │
   │  • Vision:    gpt-4o-mini        │  • Vision:    Nara Key 4 (Luna)  │
   │  • Fast:      gpt-4.1-mini       │  • Fast:      Nara Key 5 (Luna)  │
   │  • Provider:  OpenAI Responses   │  • Provider:  BYNARA / CoArena   │
   └──────────────────────────────────┴──────────────────────────────────┘
                                      │
                                      ▼
               External Job Portals (Workday, Zoho, Greenhouse)
```

---

## 📁 Repository Structure

```
Automation/
├── extension/                     # Hamzooh Apply Chrome Extension (Manifest V3)
│   ├── manifest.json              # Extension metadata & permissions (v1.9.27)
│   ├── background.js              # Service worker, CDP debugger & task orchestrator
│   ├── filler.js                  # DOM form engine, field hints & self-healing filler
│   ├── agent.js                   # Visual/reasoning agent fallback for custom widgets
│   └── bridge.js                  # Seamless dashboard-to-extension postMessage bridge
├── landing-page/                  # Frontend Web Application (React 18 + Vite)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Apply.jsx          # Auto Apply control center & job launcher
│   │   │   ├── Jobs.jsx           # Job search, import & bookmarking
│   │   │   ├── Profile.jsx        # Candidate profile, skills & location settings
│   │   │   └── Network.jsx        # LinkedIn referral campaign manager
│   │   ├── components/            # UI Modals, AutoApplyTaskPanel, JobAnalyzer
│   │   └── lib/api.js             # API clients, local storage stores & synchronizers
├── lib/                           # Core Backend Libraries
│   ├── model-router.js            # Dual-lane AI routing, budgeting & account pools
│   ├── apply-intelligence.js      # Field hints, location parser & question similarity
│   ├── application-tasks.js       # Auto-apply task state machine & memory lookup
│   ├── job-import.js              # Scraping & extraction for Zoho, Workday, etc.
│   └── resume-pdf.js              # ATS-optimized 1-page PDF resume generator
├── data/                          # JSON data store (candidates, jobs, campaigns)
├── test/                          # Comprehensive Node test suite (80 passing tests)
├── server.js                      # Express API server & background task controller
├── .env                           # Environment variables & AI model configuration
└── package.json                   # Project scripts and dependencies
```

---

## ⚡ Installation & Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher (v22+ recommended)
- **Google Chrome**: For running the extension and CDP-assisted automation
- **Git**

### 1. Clone the Repository
```bash
git clone https://github.com/Jaswanth-arjun/Automation.git
cd Automation
```

### 2. Install Dependencies
```bash
# Install backend dependencies
npm install

# Install dashboard frontend dependencies
cd landing-page
npm install
cd ..
```

### 3. Configure Environment Variables
Create or verify your `.env` file in the root directory:
```env
PORT=3000

# ==============================================================================
# 🎛️ AI MODEL SWITCH (OPENAI ON / OFF):
#  - 'true' or 'on': Uses OpenAI API key (gpt-4.1, gpt-4o-mini, gpt-4.1-mini)
#  - 'false' or 'off': 100% FREE MODE using 5 dedicated Nara accounts (gpt-6-luna)
# ==============================================================================
OPENAI_ENABLED=true
AI_PAID_ENABLED=true

# --- OpenAI Configuration ---
OPENAI_API_KEY=your_openai_api_key_here
AI_MODEL_PRIMARY_OPENAI=gpt-4.1
AI_MODEL_REASONING_OPENAI=gpt-4.1
AI_MODEL_VISION_OPENAI=gpt-4o-mini
AI_MODEL_FAST_OPENAI=gpt-4.1-mini

# --- Free Nara AI Accounts (Round-Robin & Dedicated Roles) ---
BYNARA_API_KEY=your_nara_key_1        # General app (Resume, Chat)
BYNARA_API_KEY_2=your_nara_key_2      # Primary Form Filling
BYNARA_API_KEY_3=your_nara_key_3      # Reasoning & Self-Correction
BYNARA_API_KEY_4=your_nara_key_4      # Vision Inspection
BYNARA_API_KEY_5=your_nara_key_5      # Fast Micro-decisions
BYNARA_BASE_URL=https://coarena.ai/api/v1
BYNARA_MODEL=gpt-6-luna

# --- Optional Alternative Providers ---
RUNCRATE_API_KEY=your_runcrate_key
NUMES_API_KEY=your_numes_key
GEMINI_API_KEY=your_gemini_key
```

### 4. Install the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `extension/` directory from this project (`d:\Automation\extension`).
5. Verify that **Hamzooh Apply (v1.9.27)** is loaded.

---

## 🚀 Running the Platform

### Start the Backend Server
```bash
npm start
# Server starts on http://localhost:3000
```

### Start the Frontend Dashboard
In a separate terminal:
```bash
cd landing-page
npm run dev
# Dashboard launches on http://localhost:5173
```

### Start an Auto Apply Task
1. Open `http://localhost:5173/dashboard/apply` in Chrome.
2. Select or import a job link (e.g. from Zoho Recruit, Workday, or LinkedIn).
3. Click **Apply with Hamzooh**.
4. The extension will automatically open the job tab, attach to Chrome DevTools Protocol, fill all profile fields, handle dropdowns, upload your tailored resume PDF, and pause right before submission for your approval!

---

## 🎛️ AI Routing & Dual-Lane Cost Control

To prevent unexpected API costs during design and development, Hamzooh features a **Dual-Lane Router**:

| Setting | Mode | Primary Model | Reasoning Model | Vision Model | Fast Model | Cost per Run |
|---|---|---|---|---|---|---|
| `OPENAI_ENABLED=true` | **Production (Paid)** | `gpt-4.1` | `gpt-4.1` | `gpt-4o-mini` | `gpt-4.1-mini` | ~$0.0015 |
| `OPENAI_ENABLED=false` | **Development (Free)** | `BYNARA_KEY_2` (`gpt-6-luna`) | `BYNARA_KEY_3` (`gpt-6-luna`) | `BYNARA_KEY_4` (`gpt-6-luna`) | `BYNARA_KEY_5` (`gpt-6-luna`) | **$0.00 (Free)** |

- When toggled to `false`, zero OpenAI API calls are made.
- Dedicated Nara accounts prevent free-tier 10 req/min rate limit starvation between form-filling and reasoning steps.
- Automatic retry and cooldown mechanisms immediately roll over to the next healthy account upon receiving an HTTP 429.

---

## 🧩 Hamzooh Apply Chrome Extension

The extension (`extension/`) is built on Chrome Manifest V3:
- **`filler.js`**: Core DOM automation engine. Handles heuristic field mapping, Workday `_valueTracker` resets, phone/CTC/notice normalization, date formatting, and input validation verification.
- **`agent.js`**: AI agent executor for visual inspection and non-standard HTML controls.
- **`background.js`**: Service worker managing Chrome DevTools Protocol (CDP) session attachments (`chrome.debugger`), tab navigation, and task state synchronization.
- **`bridge.js`**: Content script running on dashboard URLs enabling cross-context communication via `window.postMessage`.

---

## 🧪 Testing & Quality Assurance

Hamzooh includes an automated test suite verifying form safety, model routing, resume generation, and multi-part location parsing:

```bash
# Run the complete test suite
npm test
```

### Test Coverage Highlights:
- ✅ **Strict Lane Validation:** Verifies OpenAI credits are isolated to Auto Apply and disabled when `OPENAI_ENABLED=false`.
- ✅ **Privacy & Consent Protection:** Ensures sensitive questions (work auth, sponsorship, SSN) are never guessed.
- ✅ **Multi-Part Location Parsing:** Tests 3-part and 4-part Indian address segregation (City, District, State, Country).
- ✅ **Single-Page PDF Generation:** Tests that tailored resumes never spill over to page 2 and maintain valid clickable URLs.
- ✅ **Referral Safety Limits:** Ensures LinkedIn messaging respects recipient limits and previous conversation threads.

**Current Test Status:** `80 pass, 0 fail`

---

## 🛡️ Privacy & Compliance Notice

Hamzooh is designed for candidate empowerment and efficiency while adhering to platform terms:
- **Zero-Storage of Sensitive Data:** Government IDs, passwords, and demographic disclosures are never stored or auto-answered.
- **Human-in-the-Loop:** Submissions require explicit candidate approval on the review card.
- **Non-Circumvention:** Hamzooh never solves, bypasses, or automates CAPTCHA/bot challenges; it orchestrates the workflow so the user solves verification transparently.

---

## 👤 Author

**Jaswanth Nelluru**
- GitHub: [@Jaswanth-arjun](https://github.com/Jaswanth-arjun)

---

## 📄 License

This project is licensed under the ISC License.
