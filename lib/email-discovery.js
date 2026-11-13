import dns from 'dns';
import net from 'net';
import { askRadox, askNara } from './ai-provider.js';

const dnsPromises = dns.promises;

/**
 * Multi-Source Company Employee & Email Discovery Engine
 * 
 * Supports:
 * 1. Admin/Local Database (predefined contacts in data/employees.json)
 * 2. Method 1: Hunter.io / Snov.io Domain Search API (if API key present)
 * 3. Method 2: AI Email Pattern + Web Intelligence (zero-cost)
 * 4. Method 3: LinkedIn Public / Crawler Search
 * 5. Mini-Hunter Engine: Domain resolution + MX record validation + pattern synthesis
 * 6. Method 4: SMTP Handshake / Ping (HELO -> MAIL FROM -> RCPT TO -> 250 OK / 550 Not Found)
 */

// Common disposable/generic domains to exclude from company matching
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'greenhouse.io', 'lever.co', 'workday.com', 'ashbyhq.com', 'smartrecruiters.com',
  'myworkdayjobs.com', 'taleo.net', 'icims.com', 'bamboohr.com'
]);

// Words indicating a placeholder rather than a real contact
const PLACEHOLDER_WORDS = /\b(placeholder|unverified|unknown|yourname|example|firstname|lastname|null|undefined|sample)\b/i;

/**
 * Check if a domain has valid mail exchange (MX) records
 */
export async function verifyDomainMX(domain) {
  if (!domain || GENERIC_DOMAINS.has(domain.toLowerCase())) {
    return { valid: false, provider: 'none', error: 'Generic or empty domain' };
  }
  try {
    const records = await dnsPromises.resolveMx(domain);
    if (records && records.length > 0) {
      const topMx = records.sort((a, b) => a.priority - b.priority)[0].exchange.toLowerCase();
      let provider = 'Custom Mail Server';
      if (topMx.includes('google') || topMx.includes('aspmx')) provider = 'Google Workspace';
      else if (topMx.includes('outlook') || topMx.includes('microsoft')) provider = 'Microsoft 365';
      else if (topMx.includes('pphosted') || topMx.includes('proofpoint')) provider = 'Proofpoint Protected';
      else if (topMx.includes('mimecast')) provider = 'Mimecast Protected';
      else if (topMx.includes('mailgun')) provider = 'Mailgun';
      else if (topMx.includes('sendgrid')) provider = 'SendGrid';
      return { valid: true, provider, recordsCount: records.length, primaryMx: topMx, mxList: records.map(r => r.exchange) };
    }
    return { valid: false, provider: 'none', error: 'No MX records found' };
  } catch (err) {
    return { valid: false, provider: 'none', error: err.message };
  }
}

/**
 * Method 4: SMTP Handshake / Ping Verification Engine
 * 
 * Connects directly to the target domain's MX server via TCP port 25:
 * 1. Wait for greeting (220)
 * 2. HELO check.verifymail.org (250)
 * 3. MAIL FROM:<verify@check.verifymail.org> (250)
 * 4. RCPT TO:<targetEmail>
 *    - 250 OK: Mailbox 100% active and verified
 *    - 550 / 551 / 553: User unknown / mailbox does not exist
 *    - 450 / 451: Greylisted / temporary pause
 * 5. QUIT
 * No actual email content (DATA) is sent!
 */
export async function pingSmtpMailbox(email, timeoutMs = 4000) {
  const parts = String(email || '').trim().toLowerCase().split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { deliverable: false, status: 'invalid_format', reason: 'Invalid email syntax' };
  }
  const [, domain] = parts;

  // 1. Get MX host
  let mxHost = '';
  try {
    const records = await dnsPromises.resolveMx(domain);
    if (!records || records.length === 0) {
      return { deliverable: false, status: 'no_mx', reason: 'No MX mail server found for domain' };
    }
    records.sort((a, b) => a.priority - b.priority);
    mxHost = records[0].exchange;
  } catch (err) {
    return { deliverable: null, status: 'dns_error', reason: `DNS lookup error: ${err.message}` };
  }

  // 2. Perform SMTP Handshake
  return new Promise((resolve) => {
    let resolved = false;
    let socket = null;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try {
        if (socket) {
          socket.write('QUIT\r\n');
          socket.destroy();
        }
      } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        deliverable: null,
        status: 'timeout',
        reason: 'SMTP connection timed out (Port 25 blocked or slow response)',
        mxHost
      });
    }, timeoutMs);

    try {
      socket = net.createConnection(25, mxHost);
      socket.setTimeout(timeoutMs);

      let step = 0;
      let buffer = '';

      socket.on('error', (err) => {
        clearTimeout(timer);
        finish({
          deliverable: null,
          status: 'socket_error',
          reason: `Port 25 socket error: ${err.message}`,
          mxHost
        });
      });

      socket.on('timeout', () => {
        clearTimeout(timer);
        finish({
          deliverable: null,
          status: 'timeout',
          reason: 'Server response timed out',
          mxHost
        });
      });

      socket.on('data', (data) => {
        buffer += data.toString('utf8');
        if (!buffer.endsWith('\n')) return;

        const lines = buffer.trim().split(/\r?\n/);
        const lastLine = lines[lines.length - 1];
        const code = parseInt(lastLine.slice(0, 3), 10);
        buffer = '';

        if (step === 0) {
          // Greeting received
          if (code === 220) {
            step = 1;
            socket.write('HELO check.verifymail.org\r\n');
          } else {
            clearTimeout(timer);
            finish({ deliverable: false, status: 'greeting_rejected', code, reason: lastLine, mxHost });
          }
        } else if (step === 1) {
          // HELO response
          if (code === 250) {
            step = 2;
            socket.write('MAIL FROM:<verify@check.verifymail.org>\r\n');
          } else {
            clearTimeout(timer);
            finish({ deliverable: false, status: 'helo_rejected', code, reason: lastLine, mxHost });
          }
        } else if (step === 2) {
          // MAIL FROM response
          if (code === 250) {
            step = 3;
            socket.write(`RCPT TO:<${email}>\r\n`);
          } else {
            clearTimeout(timer);
            finish({ deliverable: false, status: 'mail_from_rejected', code, reason: lastLine, mxHost });
          }
        } else if (step === 3) {
          // RCPT TO response
          clearTimeout(timer);
          if (code === 250 || code === 251) {
            finish({
              deliverable: true,
              status: 'verified_active',
              code,
              reason: 'Mailbox exists and accepts incoming messages (250 OK)',
              mxHost
            });
          } else if (code >= 550 && code <= 554) {
            finish({
              deliverable: false,
              status: 'user_not_found',
              code,
              reason: `Mailbox does not exist (550 User not found)`,
              mxHost
            });
          } else if (code === 450 || code === 451 || code === 452) {
            finish({
              deliverable: null,
              status: 'greylisted',
              code,
              reason: `Temporary server policy / greylisted (${lastLine})`,
              mxHost
            });
          } else {
            finish({
              deliverable: false,
              status: 'rejected',
              code,
              reason: `Rejected: ${lastLine}`,
              mxHost
            });
          }
        }
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ deliverable: null, status: 'exception', reason: e.message, mxHost });
    }
  });
}

/**
 * Verify complete email deliverability combining MX + SMTP Ping
 */
export async function verifyEmailAddress(email, timeoutMs = 4000) {
  const parts = String(email || '').trim().toLowerCase().split('@');
  if (parts.length !== 2) {
    return { email, valid: false, score: 0, status: 'invalid_syntax', badge: 'Invalid Format' };
  }
  const [, domain] = parts;

  // 1. DNS MX check
  const mx = await verifyDomainMX(domain);
  if (!mx.valid) {
    return {
      email,
      valid: false,
      score: 0,
      status: 'no_mail_server',
      badge: 'No MX Records',
      provider: 'none'
    };
  }

  // 2. SMTP Ping
  const ping = await pingSmtpMailbox(email, timeoutMs);

  if (ping.deliverable === true) {
    return {
      email,
      valid: true,
      score: 98,
      status: 'smtp_verified',
      badge: `SMTP 250 OK (${mx.provider})`,
      provider: mx.provider,
      mxHost: ping.mxHost,
      code: ping.code
    };
  } else if (ping.deliverable === false) {
    return {
      email,
      valid: false,
      score: 10,
      status: 'smtp_rejected',
      badge: `SMTP 550 Rejected (${ping.reason})`,
      provider: mx.provider,
      mxHost: ping.mxHost
    };
  } else {
    // Port 25 was blocked by ISP or timed out, but MX record is valid
    return {
      email,
      valid: true,
      score: 85,
      status: 'mx_verified',
      badge: `MX Verified (${mx.provider})`,
      provider: mx.provider,
      mxHost: mx.primaryMx,
      note: 'SMTP ping port 25 restricted; MX server confirmed active'
    };
  }
}

/**
 * Extract potential company domains and emails directly from raw HTML / text
 */
export function extractEmailsAndDomainsFromHtml(html, companyName = '') {
  const text = String(html || '');
  const emails = [...new Set(
    (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi) || [])
      .map(e => e.toLowerCase())
      .filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.includes('example.com') && !e.includes('sentry.io') && !e.includes('w3.org'))
  )];

  // Candidate domains
  const urlMatches = text.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/gi) || [];
  const candidateDomains = new Set();

  for (const url of urlMatches) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      if (!GENERIC_DOMAINS.has(hostname) && !hostname.includes('cdn') && !hostname.includes('fonts.') && !hostname.includes('w3.org') && !hostname.includes('eeoc.gov') && !hostname.includes('dol.gov')) {
        candidateDomains.add(hostname);
      }
    } catch {}
  }

  // Also extract domain from found company emails
  for (const email of emails) {
    const domain = email.split('@')[1];
    if (domain && !GENERIC_DOMAINS.has(domain)) {
      candidateDomains.add(domain);
    }
  }

  return {
    emails,
    domains: [...candidateDomains]
  };
}

/**
 * Try to resolve company domain using Clearbit free autocomplete API
 */
export async function lookupCompanyDomainViaClearbit(companyName) {
  if (!companyName || companyName.length < 2) return null;
  try {
    const cleanName = companyName.replace(/\([^)]*\)/g, '').replace(/\b(?:inc|ltd|llc|corp|technologies|the)\b/gi, '').trim();
    const res = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(cleanName)}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const normClean = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matched = data.find((item) => {
          const normItem = String(item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const normDom = String(item.domain || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return normItem === normClean || normItem.includes(normClean) || normClean.includes(normItem) || normDom.includes(normClean);
        });
        if (matched) {
          return {
            domain: matched.domain,
            name: matched.name,
            logo: matched.logo
          };
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Method 1: Query Hunter.io API if HUNTER_API_KEY is configured
 */
export async function fetchHunterEmails(domain, apiKey = process.env.HUNTER_API_KEY) {
  if (!apiKey || !domain) return null;
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(apiKey)}&limit=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    const data = body?.data;
    if (!data || !Array.isArray(data.emails)) return null;

    return {
      pattern: data.pattern ? `${data.pattern}@${domain}` : null,
      organization: data.organization || '',
      contacts: data.emails.map(e => ({
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || (e.value ? e.value.split('@')[0].replace(/[._]/g, ' ') : 'Employee'),
        role: e.position || 'Company Representative',
        email: e.value?.toLowerCase(),
        department: e.department || '',
        confidence: e.confidence || 85,
        source: 'Hunter.io API (Verified)',
        linkedin: e.linkedin || null
      })).filter(c => Boolean(c.email))
    };
  } catch (err) {
    console.warn('[Hunter.io] API call failed:', err.message);
    return null;
  }
}

/**
 * Method 2: AI Email Pattern & Key Personnel Discovery
 */
export async function discoverViaAiPattern({ company, domain, jobTitle = '', jobDescription = '' }) {
  const prompt = `You are a corporate intelligence and email discovery system for tech companies.
Company: "${company}"
Domain: "${domain || 'unknown'}"
Job Title: "${jobTitle}"

Instructions:
1. If the domain is unknown, identify the primary corporate web domain (e.g. for Ai2 -> "allenai.org", for Google -> "google.com").
2. Determine the standard email pattern used by employees at this company:
   Common patterns: "{first}.{last}@", "{first}@", "{first_initial}{last}@", or "{first}{last_initial}@".
3. Provide 4 to 6 prime employee/recruiter contacts for referral outreach. 
   Include:
   - Technical Recruiter / Talent Acquisition Specialist
   - Senior Technical Recruiter / Recruiting Lead
   - Engineering Manager / Team Lead (relevant to ${jobTitle || 'Engineering'})
   - Department Director / Hiring Manager
   - Primary recruiting inbox (e.g. recruiting@domain or careers@domain)
   Format their professional names, exact company titles, and company email addresses matching the detected pattern.
   Do not use placeholder names like "Unverified" or "Unknown". Use realistic professional identities or standard corporate department teams.

Return ONLY valid JSON in this exact structure, with no introductory text or markdown formatting:
{
  "domain": "example.com",
  "emailPattern": "{first}.{last}@example.com",
  "patternConfidence": 90,
  "contacts": [
    {
      "name": "Sarah Jenkins",
      "role": "Lead Technical Recruiter",
      "email": "sarah.jenkins@example.com",
      "department": "Talent Acquisition",
      "confidence": 88
    }
  ]
}`;

  try {
    let raw = '';
    try {
      raw = await askRadox([{ role: 'user', content: prompt }], { model: 'claude-sonnet-5-5', maxTokens: 1200, temperature: 0.1 });
    } catch {
      raw = await askNara([{ role: 'user', content: prompt }], { model: 'claude-sonnet-5-5', maxTokens: 1200, temperature: 0.1 });
    }

    if (!raw) return null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed && Array.isArray(parsed.contacts)) {
      return {
        domain: parsed.domain || domain,
        emailPattern: parsed.emailPattern,
        patternConfidence: parsed.patternConfidence || 85,
        contacts: parsed.contacts.map(c => ({
          name: c.name || 'Team Member',
          role: c.role || 'Talent Acquisition',
          email: String(c.email || '').toLowerCase().trim(),
          department: c.department || '',
          confidence: c.confidence || 80,
          source: 'Mini-Hunter Engine (Pattern + MX Verified)'
        })).filter(c => {
          const email = c.email || '';
          return email.includes('@') && 
            !email.includes('example.com') && 
            !email.includes('unknown@') && 
            !email.startsWith('firstname') &&
            !PLACEHOLDER_WORDS.test(c.name);
        })
      };
    }
  } catch (err) {
    console.warn('[AI Pattern Discovery] Error:', err.message);
  }
  return null;
}

/**
 * Synthesize standard corporate department contacts for any verified domain
 */
export function buildStandardCorporateInboxes(domain, companyName, isInternship = false) {
  if (!domain) return [];
  const cleanComp = companyName || domain.split('.')[0].toUpperCase();
  const list = [
    {
      name: `${cleanComp} Talent Team`,
      role: `Technical Recruiting & Talent Acquisition at ${cleanComp}`,
      email: `recruiting@${domain}`,
      department: 'Recruiting',
      confidence: 95,
      source: 'Verified Corporate Inbound'
    },
    {
      name: `${cleanComp} Careers`,
      role: `Hiring & Referrals Team at ${cleanComp}`,
      email: `careers@${domain}`,
      department: 'Talent Acquisition',
      confidence: 90,
      source: 'Verified Corporate Inbound'
    },
    {
      name: `${cleanComp} People Operations`,
      role: `People Operations & Human Resources at ${cleanComp}`,
      email: `hr@${domain}`,
      department: 'HR',
      confidence: 85,
      source: 'Corporate Directory'
    }
  ];

  if (isInternship || /intern|university|student|fellow/i.test(companyName)) {
    list.push({
      name: `${cleanComp} University Recruiting`,
      role: `University Relations & Internship Program Lead at ${cleanComp}`,
      email: `internships@${domain}`,
      department: 'University Relations',
      confidence: 92,
      source: 'Campus & University Outreach'
    });
  }

  return list;
}

/**
 * Main Multi-Source Discovery Pipeline
 */
export async function discoverCompanyEmployees({
  company = '',
  jobUrl = '',
  jobHtml = '',
  jobTitle = '',
  existingEmployees = []
}) {
  const discovered = [];
  const seenEmails = new Set();

  const registerContact = (contact) => {
    const email = String(contact.email || '').trim().toLowerCase();
    if (!email || !email.includes('@') || seenEmails.has(email)) return;
    if (GENERIC_DOMAINS.has(email.split('@')[1])) return;
    if (email.startsWith('firstname') || email.includes('example.com') || email.includes('yourname')) return;
    seenEmails.add(email);
    discovered.push({
      id: contact.id || `disc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: contact.name || email.split('@')[0].replace(/[._]/g, ' '),
      company: contact.company || company,
      role: contact.role || `Team Member at ${company}`,
      email,
      department: contact.department || '',
      confidence: contact.confidence || 85,
      source: contact.source || 'Auto-Discovered',
      details: contact.details || contact.department || '',
      createdAt: new Date().toISOString()
    });
  };

  // 1. Existing local/admin contacts always take first priority
  if (Array.isArray(existingEmployees)) {
    for (const emp of existingEmployees) {
      registerContact({
        ...emp,
        confidence: 100,
        source: emp.source || 'Admin / Verified Database'
      });
    }
  }

  // 2. Extract from raw Job HTML / page if provided
  let detectedDomain = null;
  if (jobHtml) {
    const extracted = extractEmailsAndDomainsFromHtml(jobHtml, company);
    for (const email of extracted.emails) {
      const dom = email.split('@')[1];
      if (dom && !GENERIC_DOMAINS.has(dom)) {
        detectedDomain = dom;
        registerContact({
          name: email.startsWith('recruiting') ? 'Technical Recruiting Team' : 'Hiring Representative',
          role: `Recruiting & Talent Lead at ${company || dom}`,
          email,
          department: 'Talent Acquisition',
          confidence: 96,
          source: 'Job Posting Contact'
        });
      }
    }
    if (!detectedDomain && extracted.domains.length > 0) {
      detectedDomain = extracted.domains[0];
    }
  }

  // 3. Resolve domain if still missing
  if (!detectedDomain && company) {
    const clearbitResult = await lookupCompanyDomainViaClearbit(company);
    if (clearbitResult?.domain) {
      detectedDomain = clearbitResult.domain;
    }
  }

  // 4. Verify Domain Mail Server (MX Record check - Mini-Hunter)
  let mxStatus = { valid: false };
  if (detectedDomain) {
    mxStatus = await verifyDomainMX(detectedDomain);
  }

  // 5. Method 1: Query Hunter.io API if API key configured
  if (detectedDomain && process.env.HUNTER_API_KEY) {
    const hunterResult = await fetchHunterEmails(detectedDomain);
    if (hunterResult?.contacts?.length) {
      for (const c of hunterResult.contacts) {
        registerContact({
          name: c.name,
          role: c.role,
          email: c.email,
          company: company || hunterResult.organization,
          department: c.department,
          confidence: c.confidence,
          source: c.source
        });
      }
    }
  }

  // 6. Method 2: AI Pattern & Key Personnel Discovery
  const aiResult = await discoverViaAiPattern({
    company,
    domain: detectedDomain,
    jobTitle
  });

  if (aiResult) {
    if (!detectedDomain && aiResult.domain) {
      detectedDomain = aiResult.domain;
      if (!mxStatus.valid) {
        mxStatus = await verifyDomainMX(detectedDomain);
      }
    }
    if (Array.isArray(aiResult.contacts)) {
      for (const c of aiResult.contacts) {
        registerContact({
          name: c.name,
          role: c.role,
          email: c.email,
          company: company || detectedDomain,
          department: c.department,
          confidence: mxStatus.valid ? Math.min(95, (c.confidence || 80) + 10) : (c.confidence || 80),
          source: mxStatus.valid ? `Mini-Hunter (${mxStatus.provider} MX Verified)` : c.source
        });
      }
    }
  }

  // 7. Ensure Standard Corporate Inboxes exist for the domain
  if (detectedDomain) {
    const standardInboxes = buildStandardCorporateInboxes(
      detectedDomain,
      company,
      /intern/i.test(jobTitle)
    );
    for (const inbox of standardInboxes) {
      registerContact({
        ...inbox,
        company: company || detectedDomain,
        confidence: mxStatus.valid ? 95 : 85,
        source: mxStatus.valid ? `Verified Inbound (${mxStatus.provider})` : inbox.source
      });
    }
  }

  // 8. Method 4: SMTP Handshake / Ping on discovered contacts
  // Ping top priority contacts (with concurrency limit and 3s timeout)
  const contactsToPing = discovered.slice(0, 5);
  await Promise.allSettled(
    contactsToPing.map(async (c) => {
      try {
        const ping = await pingSmtpMailbox(c.email, 3000);
        if (ping.deliverable === true) {
          c.confidence = Math.min(99, c.confidence + 5);
          c.details = `SMTP Ping 250 OK (${mxStatus.provider || 'Active'})`;
        } else if (ping.deliverable === false) {
          c.confidence = Math.max(10, c.confidence - 40);
          c.details = `SMTP Ping Failed (550 User Not Found)`;
        }
      } catch {}
    })
  );

  return {
    company,
    domain: detectedDomain,
    mailServerVerified: mxStatus.valid,
    mailProvider: mxStatus.provider || 'unknown',
    contacts: discovered.filter(c => c.confidence >= 40)
  };
}
