/**
 * Enhanced Filler Functions for 100% Automation
 * This file extends filler.js with advanced AI decision-making
 * 
 * To integrate: Add these functions to filler.js or include this file
 */

// Track field confidence scores for auto-submit decision
window.__HAMZOOH_FIELD_CONFIDENCES__ = [];

/**
 * Enhanced askOrSkip that NEVER blocks in auto mode
 * Uses advanced AI endpoint for better decisions
 */
async function askOrSkipEnhanced(question, index, total, options, reason, autoSubmit) {
  if (!autoSubmit) {
    // Manual mode - show overlay as before
    return askHamzoohQuestion(question, index, total, options, reason);
  }

  // AUTO MODE - Never show overlay, use enhanced AI
  sendProgress('ai_deciding', `🤖 AI analyzing: "${question.slice(0, 50)}..."`);
  
  try {
    // Call enhanced AI endpoint (v2)
    const profile = window.__HAMZOOH_PROFILE__ || {};
    const resumeText = window.__HAMZOOH_RESUME_TEXT__ || '';
    const jobTitle = window.__HAMZOOH_JOB_TITLE__ || '';
    const company = window.__HAMZOOH_COMPANY__ || '';
    const previousAnswers = window.__HAMZOOH_ANSWERS__ || {};

    const aiResponse = await proxyFetch('/api/vault/infer-answer-v2', {
      question,
      options,
      profile,
      resumeText,
      jobTitle,
      company,
      previousAnswers
    });

    if (aiResponse && aiResponse.data) {
      const decision = aiResponse.data;
      
      // Track confidence for auto-submit decision
      window.__HAMZOOH_FIELD_CONFIDENCES__.push(decision.confidence || 0.5);
      
      if (decision.canInfer && decision.answer) {
        const confidencePct = ((decision.confidence || 0) * 100).toFixed(0);
        sendProgress('ai_answered', `✨ AI: ${question.slice(0, 35)} → ${String(decision.answer).slice(0, 25)} (${confidencePct}%)`);
        
        // Save to vault for future
        await syncAnswerToServer(question, decision.answer, true);
        
        return {
          answer: decision.answer,
          remember: true,
          confidence: decision.confidence,
          reasoning: decision.reasoning
        };
      }
    }
  } catch (error) {
    hamzoohLog('error', 'Enhanced AI failed, using fallback', error.message);
  }

  // Fallback to original askOrSkip logic
  sendProgress('ai_fallback', `⚙️ Using fallback for: ${question.slice(0, 40)}`);
  
  // Try profile inference
  const profileAnswer = chooseFromProfile(question, window.__HAMZOOH_PROFILE__ || {}, window.__HAMZOOH_COMPANY__ || '');
  if (profileAnswer) {
    window.__HAMZOOH_FIELD_CONFIDENCES__.push(0.7);
    return {
      answer: profileAnswer,
      remember: false,
      confidence: 0.7,
      reasoning: 'Profile inference'
    };
  }

  // Safe default answer
  const safeDefault = getSafeDefaultAnswer(question, options);
  window.__HAMZOOH_FIELD_CONFIDENCES__.push(safeDefault.confidence);
  
  sendProgress('ai_default', `⚠️ Using safe default: ${safeDefault.answer} (${(safeDefault.confidence * 100).toFixed(0)}%)`);
  
  return {
    answer: safeDefault.answer,
    remember: false,
    confidence: safeDefault.confidence,
    reasoning: 'Safe default'
  };
}

/**
 * Safe default answer generator
 */
function getSafeDefaultAnswer(question, options) {
  const q = question.toLowerCase();

  // EEO/Diversity questions
  if (/gender|race|ethnicity|veteran|disability|sexual orientation|diversity/i.test(q)) {
    const answer = selectBestOption(options, ['prefer not to say', 'decline', 'prefer not to answer', 'i prefer not to answer']);
    return {
      answer: answer || 'Prefer not to say',
      confidence: 0.95,
      reasoning: 'EEO protection'
    };
  }

  // Yes/No questions - safe positive default
  if (/\b(yes|no)\b/i.test(options.join(' ')) || question.endsWith('?')) {
    const isNegative = /not|never|decline|refuse|unable|cannot/i.test(q);
    return {
      answer: isNegative ? 'No' : 'Yes',
      confidence: 0.6,
      reasoning: 'Default yes/no'
    };
  }

  // Dropdown - pick middle option
  if (options.length > 0) {
    const middleIndex = Math.floor(options.length / 2);
    return {
      answer: options[middleIndex],
      confidence: 0.65,
      reasoning: 'Middle option'
    };
  }

  // Text field - safe deflection
  return {
    answer: 'To be discussed',
    confidence: 0.5,
    reasoning: 'Deflection'
  };
}

/**
 * Select best matching option from dropdown
 */
function selectBestOption(options, preferences) {
  if (!options || !options.length) return null;
  
  const normalized = options.map(o => String(o).toLowerCase().trim());
  
  for (const pref of preferences) {
    if (!pref) continue;
    const prefLower = String(pref).toLowerCase();
    
    // Exact match
    const exactIndex = normalized.indexOf(prefLower);
    if (exactIndex >= 0) return options[exactIndex];
    
    // Contains match
    const containsIndex = normalized.findIndex(o => 
      o.includes(prefLower) || prefLower.includes(o)
    );
    if (containsIndex >= 0) return options[containsIndex];
  }
  
  return null;
}

/**
 * Enhanced fillUnknownField that tracks confidence
 */
async function fillUnknownFieldEnhanced(input, question, options, answers, profile, pending, index, total) {
  // Step 1: Check vault
  let savedAnswer = findBestAnswer(question, answers);
  if (savedAnswer) {
    setNativeValue(input, savedAnswer);
    sendProgress('vault_filled', `💾 Vault: "${question.slice(0, 40)}"`);
    window.__HAMZOOH_FIELD_CONFIDENCES__.push(1.0);
    return { filled: true, confidence: 1.0 };
  }

  // Step 2: Enhanced AI decision
  const decision = await askOrSkipEnhanced(question, index, total, options, '', pending.autoSubmit);
  
  if (decision?.answer) {
    const success = setNativeValue(input, decision.answer);
    return { 
      filled: success, 
      confidence: decision.confidence || 0.7,
      reasoning: decision.reasoning 
    };
  }

  // This should rarely happen with new AI engine
  skipped.push({ 
    field: question.slice(0, 80), 
    reason: 'AI decision failed unexpectedly' 
  });
  window.__HAMZOOH_FIELD_CONFIDENCES__.push(0);
  return { filled: false, confidence: 0 };
}

/**
 * Auto-submit decision engine
 */
async function shouldAutoSubmit(filledCount, totalRequired, skippedFields, resumeAttached, platform) {
  const confidences = window.__HAMZOOH_FIELD_CONFIDENCES__ || [];
  
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0;

  const fillRate = totalRequired > 0 ? filledCount / totalRequired : 0;

  // Thresholds
  const CONFIDENCE_THRESHOLD = 0.85;
  const FILL_RATE_THRESHOLD = 0.95;

  // Must-have conditions
  if (!resumeAttached) {
    return {
      shouldSubmit: false,
      reason: 'Resume not attached',
      metrics: { avgConfidence, fillRate }
    };
  }

  if (filledCount < 5) {
    return {
      shouldSubmit: false,
      reason: `Only ${filledCount} fields filled`,
      metrics: { avgConfidence, fillRate }
    };
  }

  // Check critical fields
  const criticalFieldsSkipped = skippedFields.filter(f => 
    /email|phone|\bname\b/i.test(f.field || '')
  );

  if (criticalFieldsSkipped.length > 0) {
    return {
      shouldSubmit: false,
      reason: `Critical fields missing: ${criticalFieldsSkipped.map(f => f.field).join(', ')}`,
      metrics: { avgConfidence, fillRate }
    };
  }

  // Quality checks
  const checks = {
    fillRate: fillRate >= FILL_RATE_THRESHOLD,
    confidence: avgConfidence >= CONFIDENCE_THRESHOLD,
    criticalFields: criticalFieldsSkipped.length === 0
  };

  const allPass = Object.values(checks).every(v => v === true);

  if (allPass) {
    return {
      shouldSubmit: true,
      reason: 'All quality checks passed',
      metrics: {
        avgConfidence: (avgConfidence * 100).toFixed(1) + '%',
        fillRate: (fillRate * 100).toFixed(1) + '%',
        filledFields: filledCount,
        totalFields: totalRequired
      }
    };
  }

  return {
    shouldSubmit: false,
    reason: 'Quality checks failed: ' + Object.entries(checks)
      .filter(([_, passed]) => !passed)
      .map(([name, _]) => name)
      .join(', '),
    metrics: {
      avgConfidence: (avgConfidence * 100).toFixed(1) + '%',
      fillRate: (fillRate * 100).toFixed(1) + '%'
    }
  };
}

/**
 * Initialize context for AI engine
 */
function initializeAIContext(profile, resumeText, jobTitle, company, answers) {
  window.__HAMZOOH_PROFILE__ = profile || {};
  window.__HAMZOOH_RESUME_TEXT__ = resumeText || '';
  window.__HAMZOOH_JOB_TITLE__ = jobTitle || '';
  window.__HAMZOOH_COMPANY__ = company || '';
  window.__HAMZOOH_ANSWERS__ = answers || {};
  window.__HAMZOOH_FIELD_CONFIDENCES__ = [];
}

// Export for use in filler.js
if (typeof window !== 'undefined') {
  window.__HAMZOOH_ENHANCED__ = {
    askOrSkipEnhanced,
    fillUnknownFieldEnhanced,
    shouldAutoSubmit,
    initializeAIContext,
    getSafeDefaultAnswer,
    selectBestOption
  };
}
