/**
 * Auto-trigger for LinkedIn Easy Apply
 * Automatically clicks Easy Apply button and triggers auto-fill
 * 100% AUTOMATION - No user interaction required!
 */

(function() {
  'use strict';

  console.log('[HAMZOOH Auto-Trigger] Loaded - 100% Automation Mode');

  let easyApplyButtonClicked = false;
  let autoFillTriggered = false;
  let lastCheck = 0;

  // Check if we're on a LinkedIn job page
  function isLinkedInJobPage() {
    const url = window.location.href;
    return url.includes('linkedin.com/jobs/view/') || 
           url.includes('linkedin.com/jobs/collections/');
  }

  // Find the Easy Apply button on the job listing
  function findEasyApplyButton() {
    const selectors = [
      // Primary Easy Apply button selectors
      'button.jobs-apply-button',
      'button[aria-label*="Easy Apply"]',
      'button.jobs-apply-button--top-card',
      '.jobs-apply-button',
      // Alternative selectors
      'button:has(.artdeco-button__text):has-text("Easy Apply")',
      'button span:contains("Easy Apply")',
      // Generic fallback
      'button[data-control-name*="apply"]'
    ];
    
    for (const selector of selectors) {
      try {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          const text = button.textContent || button.innerText || '';
          if (text.includes('Easy Apply') && button.offsetParent !== null) {
            return button;
          }
        }
      } catch (e) {
        // Selector might not be valid, continue
      }
    }
    
    // Fallback: search all buttons for "Easy Apply" text
    const allButtons = document.querySelectorAll('button');
    for (const button of allButtons) {
      const text = button.textContent || button.innerText || '';
      if (text.trim() === 'Easy Apply' && button.offsetParent !== null) {
        return button;
      }
    }
    
    return null;
  }

  // Check if Easy Apply modal is open
  function isEasyApplyModalOpen() {
    const selectors = [
      '[data-test-modal-id="easy-apply-modal"]',
      '.jobs-easy-apply-modal',
      '[aria-label*="Easy Apply"]',
      '.artdeco-modal[aria-label*="Apply"]'
    ];
    
    for (const selector of selectors) {
      const modal = document.querySelector(selector);
      if (modal && modal.offsetParent !== null) {
        return true;
      }
    }
    return false;
  }

  // Check if form is visible and ready
  function isFormReady() {
    const form = document.querySelector('form[data-test-form-element="true"], .jobs-easy-apply-form-section, form.jobs-easy-apply-form');
    return form && form.offsetParent !== null;
  }

  // Automatically click the Easy Apply button
  function autoClickEasyApplyButton() {
    if (easyApplyButtonClicked) return;
    
    const button = findEasyApplyButton();
    if (button) {
      console.log('[HAMZOOH Auto-Trigger] Easy Apply button found! Auto-clicking...');
      easyApplyButtonClicked = true;
      
      // Simulate human-like click
      button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      setTimeout(() => {
        try {
          // Try multiple click methods to ensure it works
          button.click();
          
          // Dispatch events for SPA detection
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
          });
          button.dispatchEvent(clickEvent);
          
          console.log('[HAMZOOH Auto-Trigger] Easy Apply button clicked automatically!');
        } catch (err) {
          console.error('[HAMZOOH Auto-Trigger] Error clicking button:', err);
          easyApplyButtonClicked = false; // Reset to try again
        }
      }, 500);
      
      // Reset flag after 15 seconds in case modal doesn't open
      setTimeout(() => {
        if (!isEasyApplyModalOpen()) {
          console.log('[HAMZOOH Auto-Trigger] Modal did not open, resetting button flag');
          easyApplyButtonClicked = false;
        }
      }, 15000);
    }
  }

  // Trigger auto-fill when modal opens
  async function triggerAutoFill() {
    console.log('[HAMZOOH Auto-Trigger] Triggering auto-fill...');
    
    try {
      // Send message to background to trigger fill
      chrome.runtime.sendMessage({ 
        type: 'HAMZOOH_AUTO_TRIGGER',
        url: window.location.href 
      });
      
      console.log('[HAMZOOH Auto-Trigger] Auto-trigger message sent successfully');
      
      // Also try direct boot if available
      if (window.bootApply && typeof window.bootApply === 'function') {
        console.log('[HAMZOOH Auto-Trigger] Direct boot available, calling bootApply()');
        window.bootApply();
      }
    } catch (err) {
      console.error('[HAMZOOH Auto-Trigger] Error:', err);
    }
  }

  // Main check function
  function checkAndAutomate() {
    const now = Date.now();
    if (now - lastCheck < 500) return; // Rate limiting
    lastCheck = now;

    if (!isLinkedInJobPage()) return;
    
    // Step 1: Auto-click Easy Apply button if not already clicked
    if (!easyApplyButtonClicked && !isEasyApplyModalOpen()) {
      autoClickEasyApplyButton();
    }
    
    // Step 2: Auto-fill form when modal opens
    if (isEasyApplyModalOpen() && isFormReady() && !autoFillTriggered) {
      console.log('[HAMZOOH Auto-Trigger] Easy Apply modal detected!');
      autoFillTriggered = true;
      
      // Small delay to let form fully load
      setTimeout(() => {
        triggerAutoFill();
      }, 1000);
      
      // Reset flag after 10 seconds
      setTimeout(() => {
        autoFillTriggered = false;
      }, 10000);
    }
  }

  // Observe DOM changes
  const observer = new MutationObserver(() => {
    checkAndAutomate();
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false
  });

  // Also check periodically (fallback)
  setInterval(checkAndAutomate, 2000);

  // Initial check after page loads
  setTimeout(checkAndAutomate, 2000);

  // Reset flags when page URL changes (SPA navigation)
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      console.log('[HAMZOOH Auto-Trigger] URL changed, resetting flags');
      lastUrl = window.location.href;
      easyApplyButtonClicked = false;
      autoFillTriggered = false;
    }
  }, 1000);

  console.log('[HAMZOOH Auto-Trigger] Observer started - watching for Easy Apply button');
})();
