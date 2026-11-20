# 🔧 PowerShell Commands Quick Reference

## ⚠️ Important: PowerShell Script Execution

In PowerShell, you must use `.\` prefix to run scripts in the current directory.

## 🚀 Quick Commands

### Fix Chrome Profile Lock
```powershell
cd d:\Automation
.\fix-chrome-profile.ps1
# OR use the short alias:
.\fix.ps1
```

### Health Check Before Campaign
```powershell
cd d:\Automation
.\pre-campaign-check.ps1
# OR use the short alias:
.\check.ps1
```

### Start Everything
```powershell
cd d:\Automation
.\test-full-auto.bat
```

---

## 📋 All Available Commands

### Maintenance Scripts

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `.\fix.ps1` | Fix Chrome profile locks | When Chrome errors occur |
| `.\check.ps1` | Check system health | Before starting campaigns |
| `.\fix-chrome-profile.ps1` | Full profile cleanup | Same as fix.ps1 |
| `.\pre-campaign-check.ps1` | Full health check | Same as check.ps1 |

### Testing Scripts

| Command | Purpose |
|---------|---------|
| `.\test-full-auto.bat` | Start backend + frontend + extension |
| `node test-gpt6-luna.js` | Test GPT-6-Luna API |
| `node test-ai-endpoint.js` | Test AI engine (10 cases) |

### Server Commands

```powershell
# Start backend
cd d:\Automation
npm start

# Start frontend
cd d:\Automation\landing-page
npm run dev

# Check if backend is running
Test-NetConnection -ComputerName localhost -Port 3000

# Check if frontend is running
Test-NetConnection -ComputerName localhost -Port 5173
```

---

## 🔍 Troubleshooting PowerShell Issues

### Issue: Script Execution Policy

**Error**:
```
.\fix.ps1 : File cannot be loaded because running scripts is disabled
```

**Fix**:
```powershell
# Check current policy
Get-ExecutionPolicy

# Set policy to allow local scripts (run as Administrator)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or run with bypass for single session
powershell -ExecutionPolicy Bypass -File .\fix.ps1
```

### Issue: ".ps1 is not recognized"

**Problem**: Using cmd.exe instead of PowerShell

**Fix**: 
1. Open PowerShell (not cmd)
2. Or use `.bat` versions instead:
   ```cmd
   .\fix-chrome-profile.bat
   .\pre-campaign-check.bat
   ```

### Issue: "Path does not exist"

**Fix**:
```powershell
# Make sure you're in the right directory
cd d:\Automation

# Verify you're in the correct location
Get-Location

# List available scripts
Get-ChildItem *.ps1
```

---

## 🎯 Common Workflows

### Starting Your Work Session

```powershell
# 1. Navigate to project
cd d:\Automation

# 2. Check system health
.\check.ps1

# 3. If issues found, run fix
.\fix.ps1

# 4. Start backend
npm start
```

### Before Starting a Campaign

```powershell
cd d:\Automation
.\check.ps1

# If all checks pass, you're ready!
# If issues found, follow the recommendations
```

### When Error Occurs

```powershell
# 1. Quick fix
cd d:\Automation
.\fix.ps1

# 2. Go to dashboard and click "Resume"
```

### Daily Maintenance

```powershell
# Morning routine
cd d:\Automation
.\check.ps1
npm start

# Evening cleanup
.\fix.ps1
```

---

## 🛠️ Advanced PowerShell Commands

### Kill All Chrome Processes
```powershell
Stop-Process -Name chrome -Force
```

### Check Running Processes
```powershell
# Check Chrome
Get-Process chrome -ErrorAction SilentlyContinue

# Check Node
Get-Process node -ErrorAction SilentlyContinue
```

### Check Port Usage
```powershell
# Check what's using port 3000
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue

# Find process ID
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess

# Kill process by PID
Stop-Process -Id <PID> -Force
```

### Clean Chrome Profile Manually
```powershell
cd d:\Automation

# Remove locks
Remove-Item .chrome-data\Singleton* -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item .chrome-data\lockfile -Force -ErrorAction SilentlyContinue

# Clean cache
Remove-Item .chrome-data\Default\GPUCache -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item .chrome-data\ShaderCache -Recurse -Force -ErrorAction SilentlyContinue
```

### Check System Resources
```powershell
# Check memory
$memory = Get-CimInstance Win32_OperatingSystem
$freeMemoryGB = [math]::Round($memory.FreePhysicalMemory / 1MB, 2)
Write-Host "Free Memory: $freeMemoryGB GB"

# Check CPU
Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1

# Check disk space
Get-PSDrive D | Select-Object Used, Free
```

---

## 📝 Creating Aliases (Optional)

Add to your PowerShell profile for even shorter commands:

```powershell
# Open profile
notepad $PROFILE

# Add these lines:
function hamzooh-fix { Set-Location d:\Automation; .\fix.ps1 }
function hamzooh-check { Set-Location d:\Automation; .\check.ps1 }
function hamzooh-start { Set-Location d:\Automation; npm start }

# Save and reload
. $PROFILE

# Now you can use from anywhere:
hamzooh-fix
hamzooh-check
hamzooh-start
```

---

## 🎨 Colored Output

PowerShell scripts use colors for clarity:

- 🟢 **Green** = Success, everything OK
- 🟡 **Yellow** = Processing, in progress
- 🔴 **Red** = Warning, needs attention
- ⚪ **Gray** = Information, optional

---

## 📚 Related Documentation

- `FIX_SUMMARY.md` - Complete fix overview
- `SMOOTH_OPERATION_GUIDE.md` - Best practices
- `LINKEDIN_CAMPAIGN_FIX.md` - Technical details
- `TROUBLESHOOTING.md` - Common issues

---

## 🆘 Quick Help

```powershell
# Get help for any script
Get-Help .\fix-chrome-profile.ps1 -Detailed

# View script content
Get-Content .\fix.ps1

# Test if script exists
Test-Path .\fix.ps1
```

---

## ✅ Command Cheat Sheet

### Essential 3 Commands (memorize these!)

```powershell
# 1. Fix issues
.\fix.ps1

# 2. Check health
.\check.ps1

# 3. Start system
npm start
```

That's it! These 3 commands solve 95% of issues.

---

**Pro Tip**: Create a desktop shortcut:
1. Right-click Desktop → New → Shortcut
2. Location: `powershell.exe -ExecutionPolicy Bypass -File "d:\Automation\fix.ps1"`
3. Name it "Fix HAMZOOH"
4. Double-click to fix issues instantly!

---

**Status**: ✅ PowerShell commands ready
**Last Updated**: 2024
**Platform**: Windows PowerShell 5.1+ / PowerShell 7+
