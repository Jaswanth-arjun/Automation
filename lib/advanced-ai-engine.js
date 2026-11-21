import 'dotenv/config';

/**
 * Advanced AI Engine for 100% autonomous decision making
 * Uses multi-strategy approach with confidence scoring
 * Now supports GPT-6-Luna via BYNARA/RADOX API (OpenAI-compatible)
 */

export class AdvancedAIEngine {
  constructor() {
    // Use BYNARA or RADOX API (OpenAI-compatible endpoint)
    this.apiKey = process.env.BYNARA_API_KEY || process.env.RADOX_API_KEY;
    this.baseURL = process.env.BYNARA_BASE_URL || process.env.RADOX_BASE_URL || 'https://coarena.ai/api/v1';
    this.model = process.env.BYNARA_MODEL || process.env.RADOX_MODEL || 'gpt-6-luna';
    
    this.hasValidAPI = !!this.apiKey;
    
    if (this.hasValidAPI) {
      console.log(`[AI Engine] Using ${this.model} at ${this.baseURL}`);
      console.log('[AI Engine] AI reasoning enabled for 100% automation');
    } else {
      console.log('[AI Engine] Warning: No BYNARA_API_KEY or RADOX_API_KEY found');
      console.log('[AI Engine] AI reasoning will use enhanced rule-based fallbacks');
    }
    
    // Decision cache to avoid repeated AI calls
    this.decisionCache = new Map();
  }

  /**
   * Main decision function - NEVER returns null
   * Always provides an answer with confidence score
   */
  async makeDecision(context) {
    const {
      question,
      options = [],
      profile = {},
      resumeText = '',
      jobTitle = '',
      company = '',
      previousAnswers = {},
    } = context;

    // Step 1: Check cache
    const cacheKey = this.getCacheKey(question, options);
    if (this.decisionCache.has(cacheKey)) {
      const cached = this.decisionCache.get(cacheKey);
      return { ...cached, source: 'cache' };
    }

    // Step 2: Try exact match in previous answers
    const exactMatch = this.findExactMatch(question, previousAnswers);
    if (exactMatch) {
      this.cacheDecision(cacheKey, exactMatch);
      return exactMatch;
    }

    // Step 3: Try semantic similarity match
    const similarMatch = this.findSimilarMatch(question, previousAnswers);
    if (similarMatch && similarMatch.confidence > 0.85) {
      this.cacheDecision(cacheKey, similarMatch);
      return similarMatch;
    }

    // Sensitive personal / legal facts are never inferred or guessed.
    if (this.isSensitiveQuestion(question)) {
      const explicit = this.inferFromProfile(question, profile, options, jobTitle, company);
      if (explicit.confidence >= 0.9) {
        this.cacheDecision(cacheKey, explicit);
        return explicit;
      }
      return {
        answer: null,
        canInfer: false,
        confidence: 0,
        source: 'requires-user-confirmation',
        reasoning: 'This personal or legal fact is not stored. Ask the candidate.',
      };
    }

    // Step 4: Try profile-based inference (fast, no AI)
    const profileInference = this.inferFromProfile(question, profile, options, jobTitle, company);
    console.log(`[AI Engine] Profile inference: confidence=${profileInference.confidence}, source=${profileInference.source}`);
    if (profileInference.confidence > 0.8) {
      this.cacheDecision(cacheKey, profileInference);
      return profileInference;
    }

    // Step 5: Use AI inference (slower but accurate)
    console.log(`[AI Engine] Calling Gemini AI for question: "${question.slice(0, 60)}..."`);
    const aiResult = await this.aiInference(context);
    console.log(`[AI Engine] AI inference result: confidence=${aiResult.confidence}, source=${aiResult.source}`);
    if (aiResult.confidence > 0.7) {
      this.cacheDecision(cacheKey, aiResult);
      return aiResult;
    }

    // Step 6: Fallback to safe default (always works)
    console.log(`[AI Engine] Using safe default fallback`);
    const safeDefault = this.safeDefaultAnswer(question, options, profile);
    this.cacheDecision(cacheKey, safeDefault);
    return safeDefault;
  }

  /**
   * Find exact match in previous answers
   */
  findExactMatch(question, previousAnswers) {
    const normalized = question.toLowerCase().trim();
    
    if (previousAnswers[normalized]) {
      return {
        answer: previousAnswers[normalized],
        confidence: 1.0,
        source: 'exact-match',
        reasoning: 'Same question answered before'
      };
    }
    
    return null;
  }

  /**
   * Find semantically similar question
   */
  findSimilarMatch(question, previousAnswers) {
    const qWords = new Set(
      question.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !this.isFillerWord(w))
    );

    let bestMatch = null;
    let bestScore = 0;

    for (const [prevQuestion, answer] of Object.entries(previousAnswers)) {
      const prevWords = new Set(
        prevQuestion.toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3 && !this.isFillerWord(w))
      );

      const overlap = [...qWords].filter(w => prevWords.has(w)).length;
      const similarity = overlap / Math.max(qWords.size, prevWords.size, 1);

      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = {
          answer,
          confidence: similarity,
          source: 'semantic-match',
          reasoning: `Similar to: "${prevQuestion.slice(0, 60)}"`
        };
      }
    }

    return bestMatch;
  }

  /**
   * Profile-based inference with intelligent assumptions
   */
  inferFromProfile(question, profile, options, jobTitle, company) {
    const q = question.toLowerCase();

    // Work Authorization
    if (/authorized to work|work authorization|eligible to work|legal.*work/.test(q)) {
      const workAuth = (profile.workAuthorization || profile.workAuthorized || '').toLowerCase();
      
      // Explicit work authorization field
      if (/yes|authorized|citizen|green card|permanent/i.test(workAuth)) {
        return {
          answer: 'Yes',
          confidence: 0.95,
          source: 'profile-explicit',
          reasoning: 'Work authorization confirmed in profile'
        };
      }
      
      return {
        answer: null,
        confidence: 0,
        source: 'profile-insufficient',
        reasoning: 'Work authorization is not stored; ask the candidate.'
      };
    }

    // Sponsorship
    if (/sponsorship|visa sponsorship|require.*sponsor/.test(q)) {
      // Check multiple possible field names
      const requiresSponsorship = profile.requireSponsorship || profile.sponsorshipRequired || profile.requiresSponsorship || profile.needsSponsorship;
      
      if (requiresSponsorship === false || requiresSponsorship === 'No' || requiresSponsorship === 'no') {
        return {
          answer: 'No',
          confidence: 0.95,
          source: 'profile-explicit',
          reasoning: 'No sponsorship needed per profile'
        };
      }
      
      if (requiresSponsorship === true || requiresSponsorship === 'Yes' || requiresSponsorship === 'yes') {
        return {
          answer: 'Yes',
          confidence: 0.95,
          source: 'profile-explicit',
          reasoning: 'Sponsorship required per profile'
        };
      }
      
      return {
        answer: null,
        confidence: 0,
        source: 'profile-insufficient',
        reasoning: 'Sponsorship requirement is not stored; ask the candidate.'
      };
    }

    // Notice period / start date — only an explicitly stored preference.
    if (/notice period|availability|when.*start|start date/i.test(q)) {
      const explicit = profile.noticePeriod || profile.availability || profile.availableFrom || profile.preferences?.noticePeriod;
      if (explicit) {
        return {
          answer: this.selectOption(options, [String(explicit)]) || String(explicit),
          confidence: 0.95,
          source: 'profile-explicit',
          reasoning: 'Notice period / availability stored in profile'
        };
      }
      return { answer: null, confidence: 0, source: 'profile-insufficient', reasoning: 'Notice period is not stored; ask the candidate.' };
    }

    // Education Level
    if (/highest.*education|education level|degree.*completed|highest qualification/i.test(q)) {
      const degree = (profile.education?.[0]?.degree || '').toLowerCase();
      
      if (/ph\.?d|doctorate/i.test(degree)) {
        const answer = this.selectOption(options, ['phd', 'doctorate', 'doctoral']);
        return {
          answer: answer || "Doctorate/PhD",
          confidence: 0.95,
          source: 'profile-education',
          reasoning: 'PhD from profile'
        };
      }
      
      if (/m\.?tech|m\.?s|master|mba|m\.?sc/i.test(degree)) {
        const answer = this.selectOption(options, ['master', 'masters', 'postgraduate', 'm.tech', 'm.s', 'mba']);
        return {
          answer: answer || "Master's degree",
          confidence: 0.95,
          source: 'profile-education',
          reasoning: 'Masters from profile'
        };
      }
      
      if (/b\.?tech|b\.?e|bachelor|b\.?s|b\.?sc|under.*grad/i.test(degree)) {
        const answer = this.selectOption(options, ['bachelor', 'bachelors', 'undergraduate', 'b.tech', 'b.e']);
        return {
          answer: answer || "Bachelor's degree",
          confidence: 0.95,
          source: 'profile-education',
          reasoning: 'Bachelors from profile'
        };
      }
    }

    // Years of Experience
    if (/years?.*(of )?experience|experience.*years|total experience/i.test(q)) {
      const years = this.calculateExperienceYears(profile.experience || []);
      const answer = this.selectOption(options, [
        `${years}`, `${years} years`, `${years}-${years+1}`, 
        years < 1 ? 'less than 1' : null,
        years >= 5 ? '5+' : null
      ].filter(Boolean));
      
      return {
        answer: answer || `${years} years`,
        confidence: 0.9,
        source: 'profile-calculated',
        reasoning: `Calculated from ${(profile.experience || []).length} roles`
      };
    }

    // Salary Expectation — explicit profile value only.
    if (/salary|compensation|ctc|expected.*pay|pay expectation/i.test(q)) {
      const salary = profile.expectedSalary || profile.salary || profile.salaryExpectation;
      if (salary) {
        return { answer: this.selectOption(options, [String(salary)]) || String(salary), confidence: 0.95, source: 'profile-explicit', reasoning: 'Salary expectation stored in profile' };
      }
      return { answer: null, confidence: 0, source: 'profile-insufficient', reasoning: 'Salary expectation is not stored; ask the candidate.' };
    }

    // Currently Employed
    if (/currently employed|current employment|working now/i.test(q)) {
      const isEmployed = (profile.experience || []).some(e => 
        e.current || /present|current/i.test(e.dates || e.duration || '')
      );
      return {
        answer: isEmployed ? 'Yes' : 'No',
        confidence: 0.9,
        source: 'profile-employment',
        reasoning: 'Determined from experience dates'
      };
    }

    // Diversity/EEO Questions - Always decline
    if (/gender|race|ethnicity|veteran|disability|sexual orientation|diversity/i.test(q)) {
      const answer = this.selectOption(options, [
        'prefer not to say', 'decline', 'prefer not to answer', 
        'do not wish to answer', 'i prefer not to answer'
      ]);
      return {
        answer: answer || 'Prefer not to say',
        confidence: 0.95,
        source: 'eeo-protection',
        reasoning: 'Legal protection for candidate'
      };
    }

    return { answer: null, confidence: 0, source: 'profile-insufficient' };
  }

  /**
   * AI inference using GPT-6-Luna via BYNARA/RADOX (OpenAI-compatible API)
   */
  async aiInference(context) {
    const { question, options, profile, resumeText, jobTitle, company } = context;

    // If API is not available, use enhanced rule-based reasoning
    if (!this.hasValidAPI) {
      return this.enhancedRuleBasedReasoning(context);
    }

    const prompt = this.buildAIPrompt(context);
    
    try {
      // Every model call goes through the central router so usage, cost,
      // per-task budgets, provider fallback and route cooldowns all apply here
      // too. Calling a provider directly used to bypass all of that.
      const { executeModel, parseModelJson, roleForTask } = await import('./model-router.js');
      const result = await executeModel({
        role: roleForTask('answer_inference'),
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that helps fill job application forms. Always respond with valid JSON only.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        maxTokens: 500,
        json: true,
        userId: context.userId || '',
        taskId: context.taskId || '',
        budget: context.budget || {},
      });

      const parsedResponse = parseModelJson(result.text) || {};
      if (!parsedResponse.answer) {
        return this.enhancedRuleBasedReasoning(context);
      }

      if (parsedResponse.answer) {
        return {
          answer: parsedResponse.answer,
          confidence: parseFloat(parsedResponse.confidence || 0.85),
          source: 'ai-reasoning',
          reasoning: parsedResponse.reasoning || 'AI generated answer'
        };
      }
    } catch (error) {
      console.error('[AI Engine] API error:', error.message);
      return this.enhancedRuleBasedReasoning(context);
    }

    return this.enhancedRuleBasedReasoning(context);
  }

  /**
   * Enhanced rule-based reasoning when Gemini is unavailable
   * More intelligent than safe defaults
   */
  enhancedRuleBasedReasoning(context) {
    const { question, options, profile, resumeText } = context;
    const q = question.toLowerCase();

    // Sponsorship / work authorization: only an explicit stored flag is a
    // valid source. Citizenship or a visa type does not by itself tell us what
    // this employer's sponsorship question is asking.
    if (/sponsorship|visa.*sponsor|require.*sponsor|authori[sz]ed to work|eligible to work/i.test(q)) {
      return {
        answer: null,
        confidence: 0,
        source: 'requires-user-confirmation',
        reasoning: 'Work authorization and sponsorship are not stored as explicit facts.',
      };
    }

    // Salary expectations: never calculate or invent a number.
    if (/expected.*salary|salary.*expectation|desired.*salary|compensation/i.test(q)) {
      return {
        answer: null,
        confidence: 0,
        source: 'requires-user-confirmation',
        reasoning: 'Salary expectation is not stored in the profile.',
      };
    }

    // Open-ended or persuasive text must be written by the candidate, not
    // invented by a fallback rule.
    return { answer: null, confidence: 0, source: 'requires-user-confirmation' };
  }

  /**
   * Build comprehensive AI prompt
   */
  buildAIPrompt(context) {
    const { question, options, profile, resumeText, jobTitle, company } = context;

    return `You are an AI assistant helping to fill job applications autonomously.

CRITICAL RULES:
1. Use ONLY facts explicitly present in the profile or options. Never invent personal, legal, visa, salary, disability, criminal or EEO facts.
2. If the answer is not supported, return {"answer": null, "canInfer": false, "confidence": 0}.
3. Return confidence score 0.0 to 1.0 (higher = more certain).
4. Return ONLY valid JSON, no other text.

QUESTION: "${question}"
${options.length ? `OPTIONS: ${options.join(' | ')}` : ''}

CANDIDATE PROFILE:
- Name: ${profile.fullName || 'Not provided'}
- Email: ${profile.email || 'Not provided'}
- Phone: ${profile.phone || 'Not provided'}
- Location: ${profile.location || 'Not provided'}
- Skills: ${(profile.skills || []).join(', ') || 'Not provided'}
- Education: ${profile.education?.[0]?.degree || 'Not provided'} from ${profile.education?.[0]?.institution || 'Not provided'}
- Experience: ${(profile.experience || []).length} roles, ${this.calculateExperienceYears(profile.experience || [])} years total
- Current Role: ${profile.experience?.[0]?.title || 'Not provided'} at ${profile.experience?.[0]?.company || 'Not provided'}

RESUME SUMMARY:
${resumeText.slice(0, 2000)}

TARGET JOB:
- Title: ${jobTitle}
- Company: ${company}

DECISION GUIDELINES:
1. Answer only from the profile, resume or options above.
2. Never infer work authorization, sponsorship, salary, notice period, age,
   disability, criminal history or EEO facts. Return null instead.
3. Education, skills and experience may only quote stored facts; do not
   estimate missing dates, years or degrees.
4. If options are provided, return the exact text of one listed option.
5. For open-ended questions, return null unless the answer already exists in
   the profile/resume; the candidate must write personal statements.
6. Yes/no questions are not guessed. Return null when the fact is not stored.
7. EEO questions may use an explicit "Prefer not to say" option when one is
   present; otherwise return null.

RESPONSE FORMAT (JSON only):
{
  "answer": "your answer here",
  "confidence": 0.85,
  "reasoning": "brief explanation"
}

Provide JSON response now:`;
  }

  isSensitiveQuestion(question) {
    return /authori[sz]ed to work|work authorization|eligible to work|sponsor|visa|salary|compensation|\bctc\b|disabilit|medical condition|criminal|convicted|felony|date of birth|social security|\bssn\b|passport|gender|race\b|ethnicity|veteran|sexual orientation|your age|over 18/i.test(String(question || ''));
  }

  /**
   * Safe default answer when everything else fails
   */
  safeDefaultAnswer(question, options, profile) {
    // There is no safe generic answer for a real application. Selecting a
    // random option or inventing "to be discussed" would put false facts on a
    // candidate's application, so the engine always asks the user instead.
    return {
      answer: null,
      canInfer: false,
      confidence: 0,
      source: 'requires-user-confirmation',
      reasoning: 'No stored fact supports this answer; ask the candidate.',
    };
  }

  /**
   * Helper: Select best matching option from dropdown
   */
  selectOption(options, preferences) {
    if (!options.length) return null;
    
    const normalized = options.map(o => o.toLowerCase().trim());
    
    for (const pref of preferences) {
      if (!pref) continue;
      const prefLower = pref.toLowerCase();
      
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
   * Calculate years of experience
   */
  calculateExperienceYears(experience) {
    if (!experience || !experience.length) return 0;
    
    let totalMonths = 0;
    experience.forEach(exp => {
      const duration = exp.duration || exp.dates || '';
      const years = duration.match(/(\d+)\s*year/i)?.[1] || 0;
      const months = duration.match(/(\d+)\s*month/i)?.[1] || 0;
      totalMonths += (parseInt(years) * 12) + parseInt(months);
    });

    return Math.max(Math.floor(totalMonths / 12), experience.length * 1.5);
  }

  /**
   * Extract country from question
   */
  extractCountryFromQuestion(question) {
    const countries = {
      'india': /\bindia\b|\bindian\b/i,
      'usa': /\busa\b|\bunited states\b|\bus\b|\bamerica\b/i,
      'uk': /\buk\b|\bunited kingdom\b|\bbritain\b/i,
      'canada': /\bcanada\b|\bcanadian\b/i,
      'germany': /\bgermany\b|\bgerman\b/i,
    };

    for (const [country, pattern] of Object.entries(countries)) {
      if (pattern.test(question)) return country;
    }
    return null;
  }

  /**
   * Extract country from location string
   */
  extractCountry(locationString) {
    const patterns = {
      'india': /india|bangalore|mumbai|delhi|hyderabad|pune|chennai/i,
      'usa': /usa|united states|california|new york|texas|seattle|san francisco/i,
      'uk': /uk|united kingdom|london|manchester/i,
    };

    for (const [country, pattern] of Object.entries(patterns)) {
      if (pattern.test(locationString)) return country;
    }
    return null;
  }

  /**
   * Check if word is filler word
   */
  isFillerWord(word) {
    const fillers = new Set([
      'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'can', 'this', 'that',
      'with', 'from', 'for', 'and', 'but', 'you', 'your'
    ]);
    return fillers.has(word.toLowerCase());
  }

  /**
   * Cache helpers
   */
  getCacheKey(question, options) {
    return `${question.toLowerCase().slice(0, 100)}|${options.join('|').slice(0, 100)}`;
  }

  cacheDecision(key, result) {
    // Keep cache size limited
    if (this.decisionCache.size > 1000) {
      const firstKey = this.decisionCache.keys().next().value;
      this.decisionCache.delete(firstKey);
    }
    this.decisionCache.set(key, result);
  }
}

// Singleton instance
export const aiEngine = new AdvancedAIEngine();
