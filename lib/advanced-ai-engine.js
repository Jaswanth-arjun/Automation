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
      const location = (profile.location || profile.country || '').toLowerCase();
      const workAuth = (profile.workAuthorization || profile.workAuthorized || '').toLowerCase();
      const questionCountry = this.extractCountryFromQuestion(q);
      
      // Explicit work authorization field
      if (/yes|authorized|citizen|green card|permanent/i.test(workAuth)) {
        return {
          answer: 'Yes',
          confidence: 0.95,
          source: 'profile-explicit',
          reasoning: 'Work authorization confirmed in profile'
        };
      }
      
      if (questionCountry) {
        const userCountry = this.extractCountry(location);
        if (userCountry && userCountry === questionCountry) {
          return {
            answer: 'Yes',
            confidence: 0.95,
            source: 'profile-location',
            reasoning: `Location matches: ${userCountry}`
          };
        }
      }

      // Safe assumption for domestic applications
      return {
        answer: 'Yes',
        confidence: 0.75,
        source: 'profile-assumption',
        reasoning: 'Assuming work authorization in application country'
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
      
      // Not explicitly set - assume No if US citizen/green card
      const workAuth = (profile.workAuthorization || profile.workAuthorized || '').toLowerCase();
      if (/us citizen|green card/i.test(workAuth)) {
        return {
          answer: 'No',
          confidence: 0.9,
          source: 'profile-inference',
          reasoning: 'No sponsorship needed (work authorization status)'
        };
      }
      
      return {
        answer: 'No',
        confidence: 0.8,
        source: 'profile-assumption',
        reasoning: 'Assuming no sponsorship needed if authorized'
      };
    }

    // Notice Period / Availability
    if (/notice period|availability|when.*start|start date/i.test(q)) {
      const isEmployed = (profile.experience || []).some(e => 
        e.current || /present|current/i.test(e.dates || e.duration || '')
      );
      
      if (!isEmployed) {
        const answer = this.selectOption(options, ['immediate', 'immediately', '0 days', 'asap']);
        return {
          answer: answer || 'Immediate',
          confidence: 0.9,
          source: 'profile-employment',
          reasoning: 'Not currently employed'
        };
      }

      const expYears = this.calculateExperienceYears(profile.experience || []);
      if (expYears < 2) {
        const answer = this.selectOption(options, ['15 days', '30 days', '2 weeks', '1 month']);
        return {
          answer: answer || '30 days',
          confidence: 0.85,
          source: 'profile-experience',
          reasoning: 'Junior level - standard notice'
        };
      } else {
        const answer = this.selectOption(options, ['60 days', '2 months', '45 days']);
        return {
          answer: answer || '60 days',
          confidence: 0.85,
          source: 'profile-experience',
          reasoning: 'Senior level - extended notice'
        };
      }
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

    // Salary Expectation
    if (/salary|compensation|ctc|expected.*pay|pay expectation/i.test(q)) {
      const salary = this.calculateExpectedSalary(profile);
      return {
        answer: salary.range,
        confidence: salary.confidence,
        source: 'profile-calculated',
        reasoning: salary.reasoning
      };
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
      // Call OpenAI-compatible API (BYNARA/RADOX with GPT-6-Luna)
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an AI assistant that helps fill job application forms. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AI Engine] API error (${response.status}):`, errorText);
        return this.enhancedRuleBasedReasoning(context);
      }

      const data = await response.json();
      const responseText = data.choices?.[0]?.message?.content || '';
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        console.error('[AI Engine] AI did not return valid JSON:', responseText);
        return this.enhancedRuleBasedReasoning(context);
      }

      const parsedResponse = JSON.parse(jsonMatch[0]);

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

    // Sponsorship - analyze profile more deeply
    if (/sponsorship|visa.*sponsor|require.*sponsor/i.test(q)) {
      const location = (profile.location || '').toLowerCase();
      const workAuth = (profile.workAuthorization || profile.workAuthorized || '').toLowerCase();
      
      // US Citizen = No sponsorship
      if (/us citizen|american|born.*us|usa.*citizen/i.test(workAuth)) {
        return {
          answer: this.selectOption(options, ['no', 'not required']) || 'No',
          confidence: 0.95,
          source: 'enhanced-reasoning',
          reasoning: 'US Citizen does not need sponsorship'
        };
      }
      
      // Green card = No sponsorship
      if (/green card|permanent.*resident|pr holder/i.test(workAuth)) {
        return {
          answer: this.selectOption(options, ['no', 'not required']) || 'No',
          confidence: 0.95,
          source: 'enhanced-reasoning',
          reasoning: 'Green card holder does not need sponsorship'
        };
      }
      
      // H1B, L1, etc = Already have sponsorship, might need future
      if (/h1b|h-1b|l1|l-1|opt|f1|f-1/i.test(workAuth)) {
        return {
          answer: this.selectOption(options, ['yes', 'required']) || 'Yes',
          confidence: 0.85,
          source: 'enhanced-reasoning',
          reasoning: 'Work visa typically needs renewal/transfer'
        };
      }
      
      // Default: assume no sponsorship if applying (optimistic)
      return {
        answer: this.selectOption(options, ['no', 'not required']) || 'No',
        confidence: 0.75,
        source: 'enhanced-reasoning',
        reasoning: 'Assuming authorized if applying to job'
      };
    }

    // Salary expectations
    if (/expected.*salary|salary.*expectation|desired.*salary|compensation/i.test(q)) {
      const exp = this.calculateExperienceYears(profile.experience || []);
      const location = (profile.location || '').toLowerCase();
      
      let salary = '';
      if (/india|bangalore|mumbai|delhi|hyderabad|chennai|pune/i.test(location)) {
        if (exp < 2) salary = '₹6-8 LPA';
        else if (exp < 5) salary = '₹12-18 LPA';
        else salary = '₹25-35 LPA';
      } else {
        // US/International
        if (exp < 2) salary = '$70,000 - $90,000';
        else if (exp < 5) salary = '$100,000 - $130,000';
        else salary = '$140,000 - $180,000';
      }
      
      return {
        answer: salary,
        confidence: 0.8,
        source: 'enhanced-reasoning',
        reasoning: `Calculated from ${exp} years experience in ${location}`
      };
    }

    // Open-ended questions
    if (options.length === 0 && /why|tell|describe|explain/i.test(q)) {
      if (/why.*company|why.*join|why.*interest/i.test(q)) {
        return {
          answer: `I'm excited about this opportunity because it aligns with my experience and career goals. I'd love to discuss how my skills can contribute to the team.`,
          confidence: 0.75,
          source: 'enhanced-reasoning',
          reasoning: 'Generic but professional response for company interest'
        };
      }
      
      if (/why.*role|why.*position/i.test(q)) {
        return {
          answer: `This role matches my skills and experience perfectly. I'm particularly interested in the challenges and growth opportunities it offers.`,
          confidence: 0.75,
          source: 'enhanced-reasoning',
          reasoning: 'Professional response for role interest'
        };
      }
      
      // Generic open-ended
      return {
        answer: 'I would be happy to discuss this in detail during the interview process.',
        confidence: 0.7,
        source: 'enhanced-reasoning',
        reasoning: 'Deflecting complex question to interview'
      };
    }

    // Fall back to safe default
    return { answer: null, confidence: 0, source: 'enhanced-reasoning-failed' };
  }

  /**
   * Build comprehensive AI prompt
   */
  buildAIPrompt(context) {
    const { question, options, profile, resumeText, jobTitle, company } = context;

    return `You are an AI assistant helping to fill job applications autonomously.

CRITICAL RULES:
1. You MUST provide an answer - never say "information not available"
2. Make REASONABLE assumptions based on context
3. Return confidence score 0.0 to 1.0 (higher = more certain)
4. Return ONLY valid JSON, no other text

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

1. WORK AUTHORIZATION:
   - If location matches job country → "Yes" (0.95)
   - If unclear → "Yes" (0.75) - assume authorized if applying

2. SPONSORSHIP:
   - If authorized → "No" (0.9)
   - If international → "Yes" (0.8)

3. NOTICE PERIOD:
   - Unemployed → "Immediate" (0.9)
   - Junior (<2yr) → "30 days" (0.85)
   - Senior → "60 days" (0.85)

4. SALARY:
   - Calculate from experience + location
   - Return range, not exact number

5. EDUCATION:
   - Match degree from profile
   - B.Tech/B.E → "Bachelor's"
   - M.Tech/MS → "Master's"

6. EXPERIENCE:
   - Count from experience array
   - If dates missing, estimate 1.5 years per role

7. WHY THIS COMPANY:
   - Mention company strengths + candidate skills match
   - Keep 2-3 sentences

8. EEO/DIVERSITY:
   - ALWAYS "Prefer not to say" (0.95)

9. YES/NO QUESTIONS:
   - Default "Yes" for positive questions (0.7)
   - "No" for negative/risky questions (0.75)

RESPONSE FORMAT (JSON only):
{
  "answer": "your answer here",
  "confidence": 0.85,
  "reasoning": "brief explanation"
}

Provide JSON response now:`;
  }

  /**
   * Safe default answer when everything else fails
   */
  safeDefaultAnswer(question, options, profile) {
    const q = question.toLowerCase();

    // Diversity questions
    if (/gender|race|ethnicity|veteran|disability|sexual orientation/.test(q)) {
      const answer = this.selectOption(options, ['prefer not to say', 'decline', 'prefer not to answer']);
      return {
        answer: answer || 'Prefer not to say',
        confidence: 0.95,
        source: 'safe-default',
        reasoning: 'EEO protection'
      };
    }

    // Yes/No questions - safe default is Yes for positive questions
    if (/\b(yes|no)\b/i.test(options.join(' ')) || /\?$/.test(question)) {
      // Check if question is negative
      const isNegative = /not|never|decline|refuse|unable/i.test(q);
      return {
        answer: isNegative ? 'No' : 'Yes',
        confidence: 0.6,
        source: 'safe-default',
        reasoning: 'Default for yes/no question'
      };
    }

    // Dropdown with options - pick middle option
    if (options.length > 0) {
      const middleIndex = Math.floor(options.length / 2);
      return {
        answer: options[middleIndex],
        confidence: 0.65,
        source: 'middle-option',
        reasoning: 'Selected middle option as safe default'
      };
    }

    // Text field - safe deflection
    return {
      answer: 'To be discussed during interview',
      confidence: 0.5,
      source: 'ultimate-fallback',
      reasoning: 'Deflection to preserve application'
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
   * Calculate expected salary
   */
  calculateExpectedSalary(profile) {
    const experienceYears = this.calculateExperienceYears(profile.experience || []);
    const location = (profile.location || '').toLowerCase();
    const skills = profile.skills || [];

    let baseSalary = 0;
    let currency = 'INR';

    // India baseline
    if (experienceYears < 1) {
      baseSalary = 400000; // 4 LPA
    } else if (experienceYears < 2) {
      baseSalary = 700000; // 7 LPA
    } else if (experienceYears < 4) {
      baseSalary = 1200000; // 12 LPA
    } else if (experienceYears < 6) {
      baseSalary = 1800000; // 18 LPA
    } else {
      baseSalary = 3000000; // 30 LPA
    }

    // Location adjustment
    if (/usa|united states|san francisco|new york|seattle/i.test(location)) {
      baseSalary = baseSalary / 80 * 1000; // Convert to USD
      currency = 'USD';
    }

    // Skills multiplier
    const highValueSkills = ['react', 'node', 'aws', 'kubernetes', 'python', 'golang', 'ml', 'ai', 'devops'];
    const matchCount = skills.filter(s => 
      highValueSkills.some(hvs => s.toLowerCase().includes(hvs))
    ).length;
    
    if (matchCount >= 3) baseSalary *= 1.2;

    const lowerBound = Math.round(baseSalary * 0.85);
    const upperBound = Math.round(baseSalary * 1.15);

    const format = (amt) => {
      if (currency === 'INR') {
        return `${Math.round(amt / 100000)} LPA`;
      } else {
        return `$${Math.round(amt / 1000)}K`;
      }
    };

    return {
      range: `${format(lowerBound)} - ${format(upperBound)}`,
      confidence: 0.8,
      reasoning: `Based on ${experienceYears} years exp in ${location || 'India'}`
    };
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
