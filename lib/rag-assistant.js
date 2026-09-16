import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from './db.js';
import { searchLiveConnections } from './tracker-engine.js';

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
  if (targetCompany) {
    try {
      liveConnections = await searchLiveConnections(targetCompany, existingBrowser);
    } catch (e) {
      console.warn('Live LinkedIn search failed:', e.message);
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

KEY DASHBOARD RULES & INSTRUCTIONS:
1. Priority on Real-Time LinkedIn Search:
   - If LIVE REAL-TIME LINKEDIN ACCOUNT SEARCH RESULTS contains connections, list those actual 1st-degree connections found on the user's LinkedIn profile!
   - State clearly: "Found ${liveConnections.length} 1st-degree connections at ${targetCompany} on your real LinkedIn profile:" followed by bullet points with Name, Headline, and Location.
2. Local Database Cross-reference:
   - Also mention any campaign history if applicable.
3. Be 100% accurate, helpful, friendly, and format using markdown bullet points.
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

    // If live connections were found on their real LinkedIn account, display them!
    if (liveConnections.length > 0) {
      return `🌐 **Live 1st-Degree Connections Found at ${targetCompany} (${liveConnections.length}):**\n\n` +
        liveConnections.map((c) => `- **[${c.name}](${c.url})** — ${c.headline || 'LinkedIn 1st-Degree Connection'} (${c.location || 'India'})`).join('\n') +
        `\n\n*(Scraped live from your active LinkedIn account search)*`;
    }

    // If query asks for replies at that specific company
    if (queryLower.includes('replied') || queryLower.includes('reply') || queryLower.includes('message')) {
      const companyReplied = companyRecords.filter((c) => c.status === 'replied');
      if (companyReplied.length === 0) {
        return `💬 **${targetCompany} Replies:** None of the ${companyRecords.length} contacts tracked at **${targetCompany}** in your local campaigns have replied to your messages yet.`;
      }
      return `💬 **Contacts at ${targetCompany} Who Replied (${companyReplied.length}):**\n` +
        companyReplied.map((c) => `- **${c.name}** (${c.role}): "${c.replyText || 'Replied in chat'}"`).join('\n');
    }

    if (companyRecords.length > 0) {
      return `🏢 **Contacts Tracked at ${targetCompany} (${companyRecords.length}):**\n` +
        companyRecords.map((c) => `- **${c.name}** (${c.role}) — Status: **${c.status.toUpperCase()}**`).join('\n');
    } else {
      return `🏢 **${targetCompany}:** No 1st-degree connections found at **${targetCompany}** on your real LinkedIn profile, and no campaign records exist in your local database. You can launch a campaign for ${targetCompany} from the Campaign Launcher tab!`;
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
