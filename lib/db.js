import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function extractCompanyName(str) {
  if (!str) return 'Unknown';
  let s = str.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    const linkedinMatch = s.match(/\/company\/([^/\?]+)/i);
    if (linkedinMatch && linkedinMatch[1]) {
      s = linkedinMatch[1];
    } else {
      try {
        const parsedUrl = new URL(s);
        const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
        const ignoreWords = new Set(['jobs', 'job', 'careers', 'people', 'about', 'index', 'view', 'apply', 'v']);

        let foundSegment = '';
        for (const seg of pathSegments) {
          if (/^\d+$/.test(seg) || ignoreWords.has(seg.toLowerCase())) continue;
          foundSegment = seg;
          break;
        }

        if (foundSegment) {
          s = foundSegment;
        } else {
          const hostParts = parsedUrl.hostname.replace(/^www\./, '').split('.');
          s = hostParts[0] || s;
        }
      } catch {
        const parts = s.replace(/\/$/, '').split('/');
        s = parts[parts.length - 1] || parts[parts.length - 2] || s;
      }
    }
  }
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

class ConnectionDatabase {
  constructor() {
    this.dataDir = join(process.cwd(), 'data');
    this.dbFile = join(this.dataDir, 'connections.json');
    this.init();
  }

  init() {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    if (!existsSync(this.dbFile)) {
      this.saveFile([]);
    } else {
      // Auto sanitize existing records in file
      const raw = this.readFile();
      let changed = false;
      const sanitized = raw.map((item) => {
        const cleanComp = extractCompanyName(item.company);
        if (cleanComp !== item.company) {
          changed = true;
          return { ...item, company: cleanComp };
        }
        return item;
      });
      if (changed) {
        this.saveFile(sanitized);
      }
    }
  }

  readFile() {
    try {
      const content = readFileSync(this.dbFile, 'utf-8');
      const list = JSON.parse(content || '[]');
      return list.map((item) => ({
        ...item,
        company: extractCompanyName(item.company),
      }));
    } catch {
      return [];
    }
  }

  saveFile(records) {
    try {
      writeFileSync(this.dbFile, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving connections database:', err);
    }
  }

  saveConnection(record) {
    const list = this.readFile();
    const urlKey = (record.url || record.profileUrl || '').split('?')[0].replace(/\/$/, '').toLowerCase();
    const existingIndex = list.findIndex((item) => {
      const itemKey = (item.url || item.profileUrl || '').split('?')[0].replace(/\/$/, '').toLowerCase();
      return (urlKey && itemKey === urlKey) || (item.name && item.name.toLowerCase() === (record.name || '').toLowerCase());
    });

    const nowIso = new Date().toISOString();
    const cleanCompany = extractCompanyName(record.company);

    const newRecord = {
      id: urlKey || `conn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: record.name || 'LinkedIn User',
      company: cleanCompany,
      role: record.role || 'Outreach',
      profileUrl: record.url || record.profileUrl || '',
      headline: record.headline || '',
      note: record.note || '',
      sentDate: record.sentDate || nowIso,
      timestamp: record.timestamp || new Date().toLocaleTimeString('en-IN', { hour12: true }),
      status: record.status || 'pending', // 'pending' | 'accepted' | 'seen' | 'replied' | 'declined'
      lastChecked: nowIso,
      replyText: record.replyText || '',
    };

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...newRecord };
    } else {
      list.push(newRecord);
    }

    this.saveFile(list);
    return newRecord;
  }

  updateConnectionStatus(identifier, newStatus, extraData = {}) {
    const list = this.readFile();
    const cleanId = (identifier || '').split('?')[0].replace(/\/$/, '').toLowerCase();
    let updated = null;

    const newList = list.map((item) => {
      const itemUrl = (item.profileUrl || item.url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
      const match = (cleanId && itemUrl === cleanId) || (item.name && item.name.toLowerCase() === cleanId);

      if (match) {
        updated = {
          ...item,
          company: extractCompanyName(item.company),
          status: newStatus,
          lastChecked: new Date().toISOString(),
          ...extraData,
        };
        return updated;
      }
      return item;
    });

    if (updated) {
      this.saveFile(newList);
    }
    return updated;
  }

  getAllConnections(filter = {}) {
    let list = this.readFile();

    if (filter.company && filter.company !== 'all') {
      const targetCompany = filter.company.toLowerCase().trim();
      list = list.filter((item) => (item.company || '').toLowerCase().includes(targetCompany));
    }

    if (filter.status && filter.status !== 'all') {
      list = list.filter((item) => item.status === filter.status);
    }

    if (filter.search) {
      const query = filter.search.toLowerCase().trim();
      list = list.filter((item) =>
        (item.name || '').toLowerCase().includes(query) ||
        (item.headline || '').toLowerCase().includes(query) ||
        (item.role || '').toLowerCase().includes(query)
      );
    }

    // Sort newest sent first
    return list.sort((a, b) => new Date(b.sentDate || 0) - new Date(a.sentDate || 0));
  }

  getAnalytics(companyFilter = 'all') {
    const list = this.getAllConnections({ company: companyFilter });

    let sent = list.length;
    let accepted = 0;
    let seen = 0; // Seen but no reply
    let replied = 0; // Replied
    let pending = 0;
    let declined = 0;

    const companiesSet = new Set();
    const companyStatsMap = {};

    list.forEach((item) => {
      const comp = extractCompanyName(item.company) || 'Unknown';
      companiesSet.add(comp);

      if (!companyStatsMap[comp]) {
        companyStatsMap[comp] = { company: comp, sent: 0, accepted: 0, seen: 0, replied: 0, pending: 0 };
      }
      companyStatsMap[comp].sent++;

      if (item.status === 'accepted') {
        accepted++;
        companyStatsMap[comp].accepted++;
      } else if (item.status === 'seen') {
        seen++;
        companyStatsMap[comp].seen++;
      } else if (item.status === 'replied') {
        replied++;
        companyStatsMap[comp].replied++;
      } else if (item.status === 'declined') {
        declined++;
      } else {
        pending++;
        companyStatsMap[comp].pending++;
      }
    });

    const acceptanceRate = sent > 0 ? Math.round(((accepted + seen + replied) / sent) * 100) : 0;

    return {
      totalSent: sent,
      accepted,
      seen,
      replied,
      pending,
      declined,
      acceptanceRate,
      companies: Array.from(companiesSet).sort(),
      byCompany: companyStatsMap,
    };
  }
}

export const db = new ConnectionDatabase();
