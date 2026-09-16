import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from './db.js';
import { searchLiveConnections, findCompanyMessageReplies } from './tracker-engine.js';

function extractQueryKeyword(userQuery, knownCompanies = []) {
  const queryLower = (userQuery || '').toLowerCase().trim();

  // 1. Check known analytics companies
  for (const comp of knownCompanies) {
    if (queryLower.includes(comp.toLowerCase())) return comp;
  }

  // 2. Tech companies dictionary
  const techCompanies = ['microsoft', 'google', 'mongodb', 'amazon', 'meta', 'facebook', 'apple', 'netflix', 'uber', 'oracle', 'salesforce', 'adobe', 'ibm', 'cisco', 'intel', 'nvidia', 'electronic arts', 'ea'];
  for (const tc of techCompanies) {
    if (queryLower.includes(tc)) {
      return tc === 'ea' ? 'Electronic Arts' : tc.charAt(0).toUpperCase() + tc.slice(1);
    }
  }

  // 3. Regex match for "at [Company]" or "works at [Company]"
  const match = queryLower.match(/(?:at|for|works\s+at|working\s+at|company)\s+([a-z0-9\s.]+?)(?:\s+currently|\s+has|\s+who|\?|$)/i);
  if (match && match[1]) {
    const cleanStr = match[1].replace(/my|linkedin|connections|currently|working|works|people|who|among/gi, '').trim();
    if (cleanStr.length >= 2) {
      return cleanStr.charAt(0).toUpperCase() + cleanStr.slice(1);
    }
  }

  return null;
}

export async function handleRagChat(userQuery, userApiKey = '', existingBrowser = null) {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY || '';
  const queryLower = (userQuery || '').toLowerCase().trim();

  // 1. Retrieval Step: Fetch complete database records and analytics snapshot
  const analytics = db.getAnalytics();
  const allConnections = db.getAllConnections();

  // Dynamically extract target company/keyword from user query
  const targetCompany = extractQueryKeyword(userQuery, analytics.companies);

  // Perform Real-Time LinkedIn Account Search if company is queried!
  let liveConnections = [];
  let liveSearchError = null;
  let liveReplies = [];
  let repliesError = null;
  const asksAboutReplies = /repl|inbox|message|messaged|dm\b|chat/i.test(queryLower);

  if (targetCompany) {
    try {
      const liveResult = await searchLiveConnections(targetCompany, existingBrowser);
      liveConnections = liveResult.results || [];
      liveSearchError = liveResult.error || null;
      if (liveSearchError) console.warn('Live LinkedIn search warning:', liveSearchError);
    } catch (e) {
      liveSearchError = e.message;
      console.warn('Live LinkedIn search failed:', e.message);
    }

    // Replies questions: scan messaging history for messages FROM these connections
    if (asksAboutReplies && liveConnections.length > 0) {
      try {
        const replyResult = await findCompanyMessageReplies(
          liveConnections.map((c) => c.name).slice(0, 20),
          existingBrowser
        );
        liveReplies = replyResult.replies || [];
        repliesError = replyResult.error || null;
        if (repliesError) console.warn('Live messaging reply scan warning:', repliesError);
      } catch (e) {
        repliesError = e.message;
        console.warn('Live messaging reply scan failed:', e.message);
      }
    }
  }

  // 2. Build Rich System Prompt with ALL Connection Database Records & Live LinkedIn Search Results
  const systemContext = `
You are the official built-in RAG AI Assistant for the "LinkedIn Connect AI" Web Dashboard.
Your job is to accurately analyze both local campaign records and real-time live LinkedIn account searches to answer user questions about connections at target companies (e.g. Microsoft, MongoDB, Electronic Arts), connection statuses (Pending, Accepted, Seen, Replied), or campaign analytics.

CURRENT DASHBOARD METRICS:
- Total Sent Requests: ${analytics.totalSent}
- Accepted Connections: ${analytics.accepted}
- Seen (No Reply): ${analytics.seen}
- Replied: ${analytics.replied}
- Pending Invitations: ${analytics.pending}
- Acceptance Rate: ${analytics.acceptanceRate}%
- Targeted Companies (${analytics.companies.length}): ${analytics.companies.join(', ') || 'None'}

LOCAL CAMPAIGN DATABASE RECORDS (${allConnections.length} Records):
${JSON.stringify(allConnections, null, 2)}

LIVE REAL-TIME LINKEDIN ACCOUNT SEARCH RESULTS FOR "${targetCompany || 'Query'}" (${liveConnections.length} 1st-degree connections found on user's real LinkedIn account):
${JSON.stringify(liveConnections, null, 2)}

LIVE REPLY CHECK (scanned from user's LinkedIn messaging history just now — for the "${targetCompany || 'Query'}" connections):
${asksAboutReplies ? JSON.stringify(liveReplies, null, 2) : '(not fetched — question is not about messages/replies)'}

HOW TO DETERMINE WHO REPLIED (very important):
- Each entry in LIVE REPLY CHECK has "replied": true/false. "theirMessage" contains the actual message the connection sent (null if no message found from them).
- If "replied" is true, that person HAS replied to your messages — list them with their profile link (from the LIVE search results, matched by name) and quote "theirMessage" (or "snippet" stripped of any leading "Name:" prefix).
- If "replied" is false, that person has NOT replied (the last message in the thread is from you, and no message from them was found in history).
- If LIVE REPLY CHECK is empty for a question about replies, say the messaging history could not be read right now — do NOT invent replies.

IMPORTANT ACCURACY RULE:
${liveConnections.length > 0
    ? `- The live search DID find connections — list them by name from the LIVE results above.`
    : `- The live LinkedIn check could NOT be completed right now${liveSearchError ? ` (${liveSearchError})` : ''}. Do NOT claim the user has 0 connections at ${targetCompany || 'the company'} as a fact. Say the live check could not be completed and share this reason briefly. Suggest: if a campaign/tracker is currently running, try again after it finishes; otherwise re-run the Campaign Launcher once to refresh the LinkedIn session. Never invent names.`}
${asksAboutReplies && liveReplies.length === 0 ? `- The live messaging check could NOT be completed${repliesError ? ` (${repliesError})` : ''}. If asked about replies, say the messaging history could not be read right now — do NOT invent replies.` : ''}

KEY DASHBOARD RULES & INSTRUCTIONS:
1. Priority on Real-Time LinkedIn Search:
   - If LIVE REAL-TIME LINKEDIN ACCOUNT SEARCH RESULTS contains connections, list those actual 1st-degree connections found on the user's LinkedIn profile!
   - For EVERY connection from the LIVE results, render the name as a clickable markdown link: **[Name](url)** using the exact "url" field — e.g. [Devam Ghose](https://www.linkedin.com/in/devam-ghose-952482131). The interface hides URLs behind the name text, so NEVER print a URL as visible text, and NEVER shorten, extend or modify the url field.
   - Format each connection as a bullet: - **[Name](url)** — Headline (Location)
2. Local Database Cross-reference:
   - Also mention any campaign history if applicable.
3. Be 100% accurate, helpful, friendly, and format using markdown bullet points.
4. NEVER invent people, companies, messages, campaigns or statistics that are not in the data above.
`;

  // 3. Query Gemini AI if API key is active
  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const modelNames = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-3.6-flash'];
      for (const mName of modelNames) {
        try {
          const model = genAI.getGenerativeModel({ model: mName });
          const prompt = `${systemContext}\n\nUSER QUERY: "${userQuery}"\n\nACCURATE RAG RESPONSE:`;
          const result = await model.generateContent(prompt);
          const text = result.response.text();
          if (text) return text.trim();
        } catch (e) {
          // Try next model
        }
      }
    } catch (err) {
      console.warn('Gemini RAG Chat fallback:', err.message);
    }
  }

  // 4. Smart Multi-Attribute Fallback Engine (Offline Mode - Zero API Key Needed)

  if (targetCompany) {
    const companyRecords = allConnections.filter((c) =>
      c.company && c.company.toLowerCase().includes(targetCompany.toLowerCase())
    );

    // Reply queries first — they need the connections × messages cross-reference
    if (queryLower.includes('replied') || queryLower.includes('reply') || queryLower.includes('message')) {
      // Live cross-reference: connections × messaging history scan
      if (liveReplies.length > 0) {
        const urlByName = (name) => {
          const hit = liveConnections.find((c) => c.name.toLowerCase() === name.toLowerCase());
          return hit ? hit.url : '';
        };

        const repliers = liveReplies.filter((r) => r.replied);
        if (repliers.length > 0) {
          return `💬 **People at ${targetCompany} Who Replied to Your Messages (${repliers.length}):**\n\n` +
            repliers.map((r) => {
              const url = urlByName(r.connectionName);
              const msg = (r.theirMessage || (r.snippet || '').replace(/^[^:]{0,60}:\s*/, '')).trim();
              const nameText = url ? `**[${r.connectionName}](${url})**` : `**${r.connectionName}**`;
              return `- ${nameText}${msg ? `\n  ↳ *"${msg.slice(0, 200)}"*` : ''}`;
            }).join('\n') +
            `\n\n*(Matched live from your LinkedIn messaging history — click a name to open their profile)*`;
        }

        const awaiting = liveReplies.filter((r) => !r.replied);
        return `💬 **${targetCompany} Replies:** You have message threads with ${liveReplies.length} of your ${targetCompany} connections, but **none of them have replied yet** — the last message in every thread is from you.\n\n` +
          awaiting.map((r) => {
            const url = urlByName(r.connectionName);
            return `- ${url ? `**[${r.connectionName}](${url})**` : `**${r.connectionName}**`} — awaiting reply`;
          }).join('\n');
      }

      if (liveConnections.length > 0 && asksAboutReplies && repliesError) {
        return `💬 **${targetCompany} Replies:** I found your ${liveConnections.length} 1st-degree connections at **${targetCompany}**, but couldn't read your messaging history right now${repliesError ? ` — ${repliesError}` : ''}. Please try again in a moment.`;
      }

      const companyReplied = companyRecords.filter((c) => c.status === 'replied');
      if (companyReplied.length === 0) {
        return `💬 **${targetCompany} Replies:** None of the ${companyRecords.length} contacts tracked at **${targetCompany}** in your local campaigns have replied to your messages yet.`;
      }
      return `💬 **Contacts at ${targetCompany} Who Replied (${companyReplied.length}):**\n` +
        companyReplied.map((c) => `- **${c.name}** (${c.role}): "${c.replyText || 'Replied in chat'}"`).join('\n');
    }

    // If live connections were found on their real LinkedIn account, display them!
    if (liveConnections.length > 0) {
      return `🌐 **Live 1st-Degree Connections Found at ${targetCompany} (${liveConnections.length}):**\n\n` +
        liveConnections.map((c) => `- **[${c.name}](${c.url})** — ${c.headline || 'LinkedIn 1st-Degree Connection'} (${c.location || 'India'})`).join('\n') +
        `\n\n*(Click a name to open their LinkedIn profile — scraped live from your active LinkedIn account)*`;
    }

    if (companyRecords.length > 0) {
      return `🏢 **Contacts Tracked at ${targetCompany} (${companyRecords.length}):**\n` +
        companyRecords.map((c) => `- **${c.name}** (${c.role}) — Status: **${c.status.toUpperCase()}**`).join('\n');
    } else {
      return `🏢 **${targetCompany}:** I could not verify connections at **${targetCompany}** right now — the live LinkedIn search returned no readable results, and there are no campaign records in your local database.\n\n` +
        `Please re-run the Campaign Launcher once to refresh the LinkedIn session, then ask me again. You can also launch a campaign for ${targetCompany} from the Campaign Launcher tab!`;
    }
  }

  // Handle general "who replied" queries across all companies
  if (queryLower.includes('who replied') || queryLower.includes('replies') || queryLower.includes('reply')) {
    const repliedList = allConnections.filter((c) => c.status === 'replied');
    if (repliedList.length === 0) {
      return '💬 **Replied Contacts:** No contacts have replied yet. The 24/7 background tracker runs every 15 minutes and will notify you instantly when someone replies!';
    }
    return `💬 **Contacts Who Replied (${repliedList.length}):**\n` +
      repliedList.map((c) => `- **${c.name}** (${c.company} - ${c.role}): "${c.replyText || 'Replied in message thread'}"`).join('\n');
  }

  // Specific person lookup
  if (queryLower.includes('sushmitha')) {
    const sushmitha = allConnections.find((c) => c.name && c.name.toLowerCase().includes('sushmitha'));
    if (sushmitha) {
      return `👤 **Sushmitha Vantaku Record:**\n` +
        `- **Company:** ${sushmitha.company}\n` +
        `- **Role:** ${sushmitha.role}\n` +
        `- **Status:** 💬 **REPLIED**\n` +
        `- **Latest Reply:** "${sushmitha.replyText || 'Sir?'}"\n` +
        `- **Sent Date:** ${sushmitha.timestamp || sushmitha.sentDate}`;
    }
  }

  // Summary and analytics queries
  if (queryLower.includes('status') || queryLower.includes('summary') || queryLower.includes('analytics') || queryLower.includes('how many')) {
    return `📊 **LinkedIn Connect AI Dashboard Summary:**\n` +
      `- 📤 **Total Sent Requests:** ${analytics.totalSent}\n` +
      `- ✅ **Accepted Connections:** ${analytics.accepted}\n` +
      `- 💬 **Replied:** ${analytics.replied}\n` +
      `- 👁️ **Seen (No Reply):** ${analytics.seen}\n` +
      `- ⏳ **Pending Invitations:** ${analytics.pending}\n` +
      `- 📈 **Acceptance Rate:** ${analytics.acceptanceRate}%\n` +
      `- 🏢 **Companies Targeted:** ${analytics.companies.join(', ') || 'Electronic Arts'}`;
  }

  return `🤖 **RAG AI Assistant:**\n` +
    `I am monitoring your local campaign database and can search your real LinkedIn account live!\n\n` +
    `You can ask me questions like:\n` +
    `- *"Who among my LinkedIn connections works at Microsoft?"*\n` +
    `- *"Who among my LinkedIn connections works at Electronic Arts?"*`;
}
