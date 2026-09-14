# Targeted LinkedIn Connection Automation

A lightweight Puppeteer automation script to automatically send personalized connection requests to MongoDB employees on LinkedIn based on specific role filters.

## 🚀 Features

- **Direct URL Parameter Filtering**: Navigates using LinkedIn's native `?keywords={role}` query parameters.
- **Role Targets**: Iterates through `Recruiter`, `Talent Acquisition`, `HR`, `Hiring Manager`, `Engineering Manager`.
- **Customized Connection Notes**: Automatically inserts recipient's first name into internship inquiry note.
- **Exact Connection Limits**: Sends exactly 10 connection requests per role filter (50 total).
- **Persistent Session Storage**: Stores cookies in `.chrome-data` to stay logged in across runs.

## 📋 Requirements

- Node.js v18 or higher
- Google Chrome installed locally

## ⚡ Quick Start

1. Clone the repository:
```bash
git clone https://github.com/Jaswanth-arjun/linkdin-automation.git
cd linkdin-automation
```

2. Install dependencies:
```bash
npm install
```

3. Run the automation script:
```bash
npm start
```

4. **Login once in the opened Chrome window**. The script will automatically detect your login and run the complete role-based connection automation!
