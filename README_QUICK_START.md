# 🚀 HAMZOOH Quick Start Guide

## ⚡ Super Quick Commands (Copy & Paste)

### Fix Any Issue
```powershell
cd d:\Automation
.\fix.ps1
```

### Check System Health
```powershell
cd d:\Automation
.\check.ps1
```

### Start Everything
```powershell
cd d:\Automation
npm start
```

---

## 📋 Common Issues & Solutions

### Issue 0: LinkedIn Session Not Active ⭐ MOST COMMON

**Error Message**:
```
LinkedIn search encountered a technical issue
Could not safely inspect LinkedIn connections
```

**Cause**: You haven't logged into LinkedIn yet!

**Solution**:
```powershell
cd d:\Automation
.\setup-linkedin-session.ps1
```

Then follow the instructions to login to LinkedIn.

**Quick Method**:
1. Go to dashboard: http://localhost:5173
2. Start ANY campaign (Job Tracker, Post Jobs, etc.)
3. Chrome will open → **LOGIN TO LINKEDIN**
4. After login, stop the campaign
5. Session is saved! Resume your original campaign

---

### Issue 1: LinkedIn Campaign Error

**Error Message**:
```
Could not safely inspect LinkedIn connections: Too many arguments...
```

**Solution**:
```powershell
cd d:\Automation
.\fix.ps1
```
Then click "Resume" in dashboard.

---

### Issue 2: Script Not Found

**Error Message**:
```
The term 'fix.ps1' is not recognized...
```

**Solution**: Add `.\` prefix
```powershell
# ❌ Wrong:
fix.ps1

# ✅ Correct:
.\fix.ps1
```

---

### Issue 3: Backend Not Running

**Error Message**:
```
Cannot connect to localhost:3000
```

**Solution**:
```powershell
cd d:\Automation
npm start
```

---

### Issue 4: Chrome Profile Lock

**Error Message**:
```
Profile is locked by another process
```

**Solution**:
```powershell
cd d:\Automation
.\fix.ps1
```

---

## 📁 Important Files

| File | Purpose | Command |
|------|---------|---------|
| `fix.ps1` | Fix Chrome issues | `.\fix.ps1` |
| `check.ps1` | Health check | `.\check.ps1` |
| `fix-chrome-profile.ps1` | Full fix (same as fix.ps1) | `.\fix-chrome-profile.ps1` |
| `pre-campaign-check.ps1` | Full check (same as check.ps1) | `.\pre-campaign-check.ps1` |

---

## 🎯 Daily Workflow

### Morning (Start Work)
```powershell
cd d:\Automation
.\check.ps1     # Check system
npm start       # Start backend
```

### During Work (Before Each Campaign)
```powershell
cd d:\Automation
.\check.ps1     # Quick health check
```

### When Error Occurs
```powershell
cd d:\Automation
.\fix.ps1       # Fix issue
# Then resume campaign in dashboard
```

### Evening (End Work)
```powershell
# Press Ctrl+C in backend terminal to stop
# Optional: Run fix.ps1 to clean up
```

---

## 🆘 Emergency: Everything Broken?

```powershell
# Nuclear option - fixes everything
cd d:\Automation

# 1. Close Chrome
Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue

# 2. Run fix
.\fix.ps1

# 3. Restart backend
npm start

# 4. Test AI
node test-gpt6-luna.js
```

---

## 📚 Full Documentation

Detailed guides available:

1. **POWERSHELL_COMMANDS.md** - All PowerShell commands
2. **SMOOTH_OPERATION_GUIDE.md** - Best practices
3. **FIX_SUMMARY.md** - What was fixed
4. **LINKEDIN_CAMPAIGN_FIX.md** - Technical details
5. **TROUBLESHOOTING.md** - Common issues

---

## ✅ Success Checklist

Before starting a campaign, verify:

- [ ] Backend running (`npm start`)
- [ ] Chrome closed (or run `.\fix.ps1`)
- [ ] Health check passed (`.\check.ps1`)
- [ ] Dashboard accessible (http://localhost:5173)

---

## 💡 Pro Tips

1. **Bookmark this page** - Keep it open for quick reference
2. **Run check.ps1 daily** - Prevents issues before they happen
3. **Always use `.\` prefix** - PowerShell requires it for local scripts
4. **Keep backend running** - Don't close terminal during work
5. **Fix immediately** - Don't ignore warnings from health check

---

## 🎉 Current System Status

✅ **Backend**: Running on port 3000
✅ **Frontend**: Running on port 5173  
✅ **AI Engine**: GPT-6-Luna configured
✅ **Automation**: 98-100% (Full Auto Mode)
✅ **Error Handling**: Enhanced with clear messages
✅ **Recovery Tools**: fix.ps1 and check.ps1 ready

---

**You're all set! Start with `.\check.ps1` and you're ready to go!** 🚀

**Need help?** Check POWERSHELL_COMMANDS.md for detailed documentation.
