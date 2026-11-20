# 🔧 Troubleshooting Guide - Full Auto Apply

## Common Issues & Solutions

---

### ❌ Issue 1: "Extension Not Detected"

**Symptoms:**
- Alert: "Hamzooh Apply extension is not detected"
- Button disabled in dashboard
- No HAMZOOH_PONG messages in console

**Solutions:**

1. **Reload Extension:**
   ```
   chrome://extensions → Find "Hamzooh Apply" → Click reload icon (🔄)
   ```

2. **Verify Extension Loaded:**
   ```
   chrome://extensions → Check "Hamzooh Apply" is enabled
   ```

3. **Check Manifest:**
   ```
   Verify files exist:
   - d:\Automation\extension\manifest.json
   - d:\Automation\extension\filler.js
   - d:\Automation\extension\filler-enhancements.js
   - d:\Automation\extension\background.js
   - d:\Automation\extension\bridge.js
   ```

4. **Clear Extension Errors:**
   ```
   chrome://extensions → Hamzooh Apply → "Errors" button
   - If errors shown, reload extension
   ```

5. **Test Connection:**
   ```javascript
   // In dashboard console (http://localhost:5173)
   window.postMessage({source:'hamzooh-app',type:'HAMZOOH_PING'},'*');
   
   // Wait 1 second, should see:
   // {source:'hamzooh-extension',type:'HAMZOOH_PONG'}
   ```

6. **Last Resort - Reinstall:**
   ```
   chrome://extensions
   → Remove "Hamzooh Apply"
   → Load unpacked → d:\Automation\extension
   ```

---

### ❌ Issue 2: "AI Not Responding / Hanging"

**Symptoms:**
- Stuck on "🤖 AI analyzing..." for >10 seconds
- Console shows timeout errors
- Form filling stops

**Solutions:**

1. **Check API Key:**
   ```bash
   # In d:\Automation\.env
   cat .env | grep GEMINI_API_KEY
   
   # Should see:
   GEMINI_API_KEY=AIza...
   ```

2. **Verify Backend Running:**
   ```bash
   curl http://localhost:3000/api/health
   
   # Should return: {"status":"ok"}
   ```

3. **Test AI Endpoint Directly:**
   ```bash
   curl -X POST http://localhost:3000/api/vault/infer-answer-v2 \
     -H "Content-Type: application/json" \
     -d '{"question":"Test question?","profile":{}}'
   
   # Should return JSON with answer
   ```

4. **Check Backend Console:**
   ```
   Look for errors in terminal where you ran `npm start`
   Common errors:
   - "Invalid API key"
   - "Rate limit exceeded"
   - "Network error"
   ```

5. **Check API Quota:**
   ```
   Visit: https://aistudio.google.com/app/apikey
   Check your API key status and quota
   ```

6. **Fallback to Profile Inference:**
   ```javascript
   // If AI continues failing, system falls back to:
   // 1. Profile-based inference
   // 2. Safe defaults
   // These don't require AI but have lower confidence
   ```

---

### ❌ Issue 3: "Form Not Filling"

**Symptoms:**
- Job opens in new tab
- No fields get filled
- Console shows "No inputs found"

**Solutions:**

1. **Check Page Loaded:**
   ```javascript
   // In job tab console
   console.log('Inputs found:', document.querySelectorAll('input, select, textarea').length);
   
   // Should be > 0
   ```

2. **Wait for Dynamic Content:**
   ```javascript
   // Some forms load dynamically
   // Extension waits up to 18 seconds
   // Check if form is still loading
   ```

3. **Check Profile Data:**
   ```javascript
   // In job tab console
   console.log(window.__HAMZOOH_PROFILE__);
   
   // Should have: fullName, email, phone, etc.
   ```

4. **Platform-Specific Issue:**
   ```javascript
   // Check platform detection
   console.log('Platform:', window.location.hostname);
   
   // Some custom ATSs need specific handling
   ```

5. **Check Extension Injected:**
   ```javascript
   // In job tab console
   console.log(window.__HAMZOOH_FILLER_LOADED__);
   
   // Should be: true
   ```

6. **Manually Trigger:**
   ```javascript
   // In job tab console
   window.__HAMZOOH_BOOT__();
   
   // This manually starts the filling process
   ```

---

### ❌ Issue 4: "Not Auto-Submitting (Even in Full Auto Mode)"

**Symptoms:**
- Full Auto Mode enabled
- Form fills successfully
- Still shows review modal instead of auto-submitting

**Solutions:**

1. **Check Confidence Score:**
   ```javascript
   // In job tab console
   const confidences = window.__HAMZOOH_FIELD_CONFIDENCES__;
   const avg = confidences.reduce((a,b)=>a+b) / confidences.length;
   console.log('Average Confidence:', (avg*100).toFixed(1)+'%');
   console.log('Threshold:', '85%');
   console.log('Will auto-submit?', avg >= 0.85);
   ```

2. **Check Fill Rate:**
   ```javascript
   // In job tab console
   const filled = document.querySelectorAll('input[value], textarea[value], select[value]').length;
   const total = document.querySelectorAll('input[required], textarea[required], select[required]').length;
   const rate = (filled / total * 100).toFixed(1);
   console.log('Fill Rate:', rate + '%');
   console.log('Threshold:', '95%');
   ```

3. **Check Resume Attached:**
   ```javascript
   // In job tab console
   const resumeInput = document.querySelector('input[type="file"]');
   console.log('Resume attached?', resumeInput?.files?.length > 0);
   ```

4. **Check Critical Fields:**
   ```javascript
   // In job tab console
   const email = document.querySelector('input[type="email"]')?.value;
   const phone = document.querySelector('input[type="tel"], input[name*="phone"]')?.value;
   console.log('Email:', email);
   console.log('Phone:', phone);
   // Both should have values
   ```

5. **View Auto-Submit Decision:**
   ```javascript
   // Check the actual decision
   // Look for message in console:
   // "⚠️ Quality checks failed: ..."
   // This tells you exactly why it didn't auto-submit
   ```

6. **Lower Threshold (Testing Only):**
   ```javascript
   // Temporarily lower threshold for testing
   // In extension/filler-enhancements.js
   // Change: const CONFIDENCE_THRESHOLD = 0.85;
   // To:     const CONFIDENCE_THRESHOLD = 0.75;
   // DON'T use in production!
   ```

---

### ❌ Issue 5: "Resume Not Attaching"

**Symptoms:**
- Other fields fill correctly
- Resume upload fails
- Console shows "resume_failed" or "resume_missing"

**Solutions:**

1. **Check Resume Exists:**
   ```javascript
   // In dashboard
   const profile = profileStore.get();
   console.log('Resume:', profile.resume?.fileName);
   console.log('Base64 length:', profile.resume?.dataUrl?.length);
   // Should both have values
   ```

2. **Check File Input:**
   ```javascript
   // In job tab console
   const fileInputs = document.querySelectorAll('input[type="file"]');
   console.log('File inputs found:', fileInputs.length);
   fileInputs.forEach((input, i) => {
     console.log(`Input ${i}:`, input.id, input.name);
   });
   ```

3. **Manual Test:**
   ```javascript
   // Manually click file input to test if it works
   const fileInput = document.querySelector('input[type="file"]');
   fileInput.click();
   // If file picker doesn't open, platform issue
   ```

4. **Check Shadow DOM:**
   ```javascript
   // Some platforms hide file input in Shadow DOM
   // Extension should handle this, but check:
   document.querySelectorAll('*').forEach(el => {
     if (el.shadowRoot) {
       console.log('Shadow DOM found in:', el.tagName);
     }
   });
   ```

5. **Platform-Specific Upload:**
   ```
   Workday: Uses dropzone, not file input
   → Look for: [data-automation-id="file-upload-drop-zone"]
   
   Greenhouse: Standard file input
   → Look for: [data-automation-id="resume-upload"]
   ```

6. **Check File Size:**
   ```javascript
   // Some platforms limit file size
   const resumeSize = Math.round(profile.resume.dataUrl.length * 0.75 / 1024);
   console.log('Resume size:', resumeSize + ' KB');
   // Most accept up to 2-5 MB
   ```

---

### ❌ Issue 6: "Validation Errors After Filling"

**Symptoms:**
- Form fills
- Click submit (manual or auto)
- Page shows validation errors
- Fields highlighted in red

**Solutions:**

1. **Check Error Messages:**
   ```javascript
   // In job tab console
   const errors = document.querySelectorAll('.error, [aria-invalid="true"], .field-error');
   errors.forEach(err => {
     console.log('Error:', err.innerText || err.textContent);
   });
   ```

2. **Verify Field Formats:**
   ```javascript
   // Common validation issues:
   // - Phone: Wrong format (should be +91 9876543210)
   // - Email: Invalid format
   // - Date: Wrong format (MM/DD/YYYY vs DD/MM/YYYY)
   ```

3. **Check Required Fields:**
   ```javascript
   const required = document.querySelectorAll('[required], [aria-required="true"]');
   required.forEach(field => {
     if (!field.value) {
       console.log('Empty required field:', field.name || field.id);
     }
   });
   ```

4. **Check Hidden Fields:**
   ```javascript
   // Some platforms have hidden required fields
   const hiddenRequired = document.querySelectorAll('input[required][type="hidden"]');
   console.log('Hidden required:', hiddenRequired.length);
   ```

5. **Fix Profile Data:**
   ```javascript
   // Update profile with correct formats
   // Phone: Include country code
   // Email: Valid format
   // Dates: Check format requirements
   ```

---

### ❌ Issue 7: "Multi-Page Navigation Stuck"

**Symptoms:**
- First page fills correctly
- Clicks "Next" or "Continue"
- Stuck, doesn't move to next page
- Console shows "Could not confirm advancement"

**Solutions:**

1. **Check Button Detection:**
   ```javascript
   // In job tab console
   const nextBtn = document.querySelector('button[type="submit"], button:contains("Next"), button:contains("Continue")');
   console.log('Next button:', nextBtn);
   ```

2. **Manual Test:**
   ```javascript
   // Click next button manually to see if it works
   nextBtn.click();
   // If page doesn't advance, platform issue
   ```

3. **Check Validation:**
   ```javascript
   // Button might be disabled due to validation
   console.log('Button disabled?', nextBtn.disabled);
   console.log('Button text:', nextBtn.innerText);
   ```

4. **Check AJAX Loading:**
   ```javascript
   // Some pages have loading spinners
   const loading = document.querySelector('[aria-busy="true"], .loading, .spinner');
   console.log('Page loading?', !!loading);
   ```

5. **Wait Longer:**
   ```javascript
   // Extension waits 25 seconds for page change
   // Some slow platforms may need more time
   // Check network tab for ongoing requests
   ```

6. **Platform-Specific Navigation:**
   ```
   Workday: Uses custom navigation
   → Look for: [data-automation-id="bottom-navigation-next-button"]
   
   Greenhouse: Standard buttons
   → Look for: button[type="submit"]
   ```

---

### ❌ Issue 8: "CAPTCHA Not Pausing"

**Symptoms:**
- CAPTCHA appears
- Extension doesn't pause
- Tries to submit without solving CAPTCHA

**Solutions:**

1. **Check CAPTCHA Detection:**
   ```javascript
   // In job tab console
   const captcha = document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha');
   console.log('CAPTCHA detected?', !!captcha);
   ```

2. **Manual Pause:**
   ```javascript
   // If CAPTCHA not detected, extension won't pause
   // Solve CAPTCHA manually
   // Extension should detect completion
   ```

3. **Check CAPTCHA Type:**
   ```
   reCAPTCHA v2: Checkbox
   reCAPTCHA v3: Invisible
   hCaptcha: Image challenges
   Cloudflare Turnstile: Automatic
   ```

4. **Wait for Pause Overlay:**
   ```
   Extension should show:
   "⚠️ Verification detected — waiting for you."
   If not showing, CAPTCHA not detected
   ```

---

### ❌ Issue 9: "Profile Data Not Loading"

**Symptoms:**
- Extension starts but fields empty
- Console shows "Profile not available"
- Form doesn't fill

**Solutions:**

1. **Check Profile Exists:**
   ```javascript
   // In dashboard
   import { profileStore } from './lib/api';
   const profile = profileStore.get();
   console.log('Profile:', profile);
   // Should have fullName, email, phone, etc.
   ```

2. **Re-Save Profile:**
   ```
   Dashboard → Profile section
   → Fill all fields
   → Click "Save Profile"
   ```

3. **Check LocalStorage:**
   ```javascript
   // In dashboard console
   console.log(localStorage.getItem('hamzooh_profile'));
   // Should contain JSON data
   ```

4. **Check Extension Storage:**
   ```javascript
   // In extension console (service worker)
   chrome.storage.local.get(['profile'], (result) => {
     console.log('Profile in extension:', result.profile);
   });
   ```

5. **Force Sync:**
   ```javascript
   // In dashboard
   window.postMessage({
     source: 'hamzooh-app',
     type: 'HAMZOOH_SAVE_PROFILE',
     profile: profileStore.get(),
     answers: {}
   }, '*');
   ```

---

### ❌ Issue 10: "Backend Connection Failed"

**Symptoms:**
- "Could not connect to server" error
- AI decisions timeout
- Vault not working

**Solutions:**

1. **Check Backend Running:**
   ```bash
   curl http://localhost:3000/api/health
   
   # Should return:
   # {"status":"ok"}
   
   # If error:
   # - Backend not started
   # - Wrong port
   # - Port blocked
   ```

2. **Start Backend:**
   ```bash
   cd d:\Automation
   npm start
   
   # Should see:
   # Server running on port 3000
   ```

3. **Check Port:**
   ```bash
   # Windows
   netstat -ano | findstr :3000
   
   # Should show:
   # TCP 0.0.0.0:3000 ... LISTENING
   ```

4. **Check Firewall:**
   ```
   Windows Defender Firewall
   → Allow an app
   → Node.js
   → Allow Private & Public
   ```

5. **Check .env File:**
   ```bash
   # In d:\Automation
   cat .env
   
   # Should have:
   PORT=3000
   GEMINI_API_KEY=...
   ```

---

## 🔍 General Debugging Steps

### Step 1: Check All Services
```bash
# Backend
curl http://localhost:3000/api/health

# Frontend
curl http://localhost:5173

# Extension
# chrome://extensions → Hamzooh Apply → Enabled?
```

### Step 2: Check Logs
```
1. Backend Terminal: npm start output
2. Extension Service Worker: chrome://extensions → Service Worker → Console
3. Job Tab: DevTools → Console
4. Dashboard: DevTools → Console
```

### Step 3: Check Data Flow
```javascript
// 1. Profile in dashboard
console.log(profileStore.get());

// 2. Profile in extension
chrome.storage.local.get(['profile'], console.log);

// 3. Profile in job tab
console.log(window.__HAMZOOH_PROFILE__);
```

### Step 4: Test Components Individually
```javascript
// Test AI Engine
curl -X POST http://localhost:3000/api/vault/infer-answer-v2 \
  -H "Content-Type: application/json" \
  -d '{"question":"test"}'

// Test Extension
window.postMessage({source:'hamzooh-app',type:'HAMZOOH_PING'},'*');

// Test Form Detection
console.log(document.querySelectorAll('input, select, textarea').length);
```

---

## 🆘 Still Having Issues?

### Collect Debug Information:

1. **Browser Console Logs:**
   - Dashboard console (http://localhost:5173)
   - Job tab console
   - Extension service worker console

2. **Backend Logs:**
   - Terminal output from `npm start`
   - Check `d:\Automation\server.log` if exists

3. **Profile Data:**
   - Export profile (anonymize if needed)
   - Include skills, experience, education

4. **Job URL:**
   - Which job site?
   - Which ATS platform?

5. **Steps to Reproduce:**
   - Exact steps you took
   - What happened vs. what expected

### Enable Debug Mode:
```javascript
// In filler.js or console
window.__HAMZOOH_DEBUG_MODE__ = true;

// This enables verbose logging
// Check console for detailed messages
```

### Create Issue Report:
```
Issue: [Brief description]

Environment:
- OS: Windows/Mac/Linux
- Browser: Chrome version X
- Backend: Running/Not running
- Extension: Loaded/Not loaded

Steps:
1. [Step 1]
2. [Step 2]
3. [Step 3]

Expected: [What should happen]
Actual: [What happened]

Logs: [Paste console logs]
Screenshots: [If applicable]
```

---

**Remember**: Most issues are configuration or connection problems. Check services, extensions, and logs first!

**Need more help?** Check:
- `QUICK_REFERENCE.md` for quick commands
- `FULL_AUTO_TESTING_GUIDE.md` for test cases
- `IMPLEMENTATION_COMPLETE.md` for feature details
