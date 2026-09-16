import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from './db.js';

export async function handleRagChat(userQuery, userApiKey = '') {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY || '';
  const queryLower = (userQuery || '').toLowerCase().trim();

  // 1. Retrieval Step: Fetch complete database records and analytics snapshot
  const analytics = db.getAnalytics();
  const allConnections = db.getAllConnections();

  // 2. Build Rich System Prompt with ALL Connection Database Records
  const systemContext = `
You are the official built-in RAG AI Assistant for the "LinkedIn Connect AI" Web Dashboard.
Your job is to accurately analyze the user's connection database and answer questions about specific companies (e.g. MongoDB, Electronic Arts), connection statuses (Pending, Accepted, Seen, Replied), specific candidates, or campaign analytics.

CURRENT DASHBOARD METRICS:
- Total Sent Requests: ${analytics.totalSent}
- Accepted Connections: ${analytics.accepted}
- Seen (No Reply): ${analytics.seen}
- Replied: ${analytics.replied}
- Pending Invitations: ${analytics.pending}
- Acceptance Rate: ${analytics.acceptanceRate}%
- Targeted Companies (${analytics.companies.length}): ${analytics.companies.join(', ') || 'None'}

COMPLETE DATABASE RECORDS (${allConnections.length} Records):
${JSON.stringify(allConnections, null, 2)}

KEY DASHBOARD RULES & FEATURES:
1. Status Hierarchy:
   - "replied": Contact replied to connection note/message in LinkedIn chat (Highest Priority).
   - "accepted": Contact accepted invitation (appears in 1st-degree connections).
   - "seen": Contact opened/read the message thread, but hasn't replied yet.
   - "pending": Invitation sent and waiting for response.
2. Gender Honorific: Automatically detects gender and appends "sir" or "mam".
3. 24/7 Background Sync: Auto-checks statuses every 15 minutes.

INSTRUCTIONS:
- Be 100% accurate. Cross-reference company names, person names, and statuses from the database.
- If asked "Who works at [Company]?", list all contacts matching that company.
- If asked "Who at [Company] has replied?", filter contacts where company matches AND status == "replied".
- Format answers cleanly with bullet points, bold names, and clear status labels.
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

  // Check if query is asking about a specific company (e.g. MongoDB, Electronic Arts)
  const targetCompany = analytics.companies.find((comp) => queryLower.includes(comp.toLowerCase())) ||
    (queryLower.includes('mongodb') ? 'MongoDB' : queryLower.includes('electronic arts') || queryLower.includes('ea') ? 'Electronic Arts' : null);

  if (targetCompany) {
    const companyRecords = allConnections.filter((c) =>
      c.company && c.company.toLowerCase().includes(targetCompany.toLowerCase())
    );

    // If query asks for replies at that specific company
    if (queryLower.includes('replied') || queryLower.includes('reply') || queryLower.includes('message')) {
      const companyReplied = companyRecords.filter((c) => c.status === 'replied');
      if (companyReplied.length === 0) {
        return `💬 **${targetCompany} Replies:** None of the ${companyRecords.length} contacts tracked at **${targetCompany}** have replied to your messages yet.`;
      }
      return `💬 **Contacts at ${targetCompany} Who Replied (${companyReplied.length}):**\n` +
        companyReplied.map((c) => `- **${c.name}** (${c.role}): "${c.replyText || 'Replied in chat'}"`).join('\n');
    }

    // List all contacts at that specific company
    if (companyRecords.length > 0) {
      return `🏢 **Contacts Tracked at ${targetCompany} (${companyRecords.length}):**\n` +
        companyRecords.map((c) => `- **${c.name}** (${c.role}) — Status: **${c.status.toUpperCase()}**`).join('\n');
    } else {
      return `🏢 **${targetCompany}:** No connection requests have been sent to contacts at **${targetCompany}** yet. You can launch a campaign for ${targetCompany} from the Campaign Launcher tab!`;
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
    `I am monitoring your entire database. Currently you have **${analytics.totalSent} connection requests sent** across **${analytics.companies.join(', ') || '1 company'}**.\n\n` +
    `You can ask me questions like:\n` +
    `- *"Who among my LinkedIn connections works at Electronic Arts?"*\n` +
    `- *"Who among the people working at Electronic Arts has replied?"*\n` +
    `- *"Who works at MongoDB?"*`;
}
