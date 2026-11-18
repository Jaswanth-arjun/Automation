import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isMongoActive, CampaignModel } from './mongodb.js';

const DATA_DIR = join(process.cwd(), 'data');
const FILE = join(DATA_DIR, 'campaigns.json');

function syncCampaignToMongo(campaign) {
  if (!isMongoActive() || !campaign?.id) return;
  CampaignModel.findOneAndUpdate(
    { id: campaign.id },
    { $set: campaign },
    { upsert: true, returnDocument: 'after' }
  ).catch((err) => console.error('MongoDB sync campaign error:', err.message));
}

export const CAMPAIGN_STATUSES = [
  'queued',
  'running',
  'paused',
  'waiting',
  'needs_attention',
  'completed',
  'failed',
  'partially_completed',
];

export const STAGE_ORDER = [
  'replied',
  'seen',
  'unseen',
  'never_messaged',
  'pending_invite',
  'not_connected',
];

export const STAGE_LABELS = {
  replied: 'Connected · Replied before',
  seen: 'Connected · Message seen, no reply',
  unseen: 'Connected · Message not seen',
  never_messaged: 'Connected · Never messaged',
  pending_invite: 'Invite pending · skipped',
  not_connected: 'Not connected · send invite',
};

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify({ campaigns: [] }, null, 2), 'utf8');
}

function read() {
  ensureFile();
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8') || '{}');
    return Array.isArray(parsed.campaigns) ? parsed : { campaigns: [] };
  } catch {
    return { campaigns: [] };
  }
}

function write(db) {
  ensureFile();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8');
      return;
    } catch {
      const until = Date.now() + 40;
      while (Date.now() < until) { /* wait out a Windows file lock */ }
    }
  }
}

function emptyStats() {
  return {
    totalEligible: 0,
    processed: 0,
    messagesSent: 0,
    invitesSent: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
  };
}

export const campaignStore = {
  list() {
    return read().campaigns.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },

  get(id) {
    if (!id) return null;
    return read().campaigns.find((item) => item.id === id) || null;
  },

  findActive() {
    return read().campaigns.find((item) => ['running', 'queued', 'waiting', 'paused', 'needs_attention'].includes(item.status)) || null;
  },

  create({ name, company, role, userId, totalEligible = 0, config = {} }) {
    const db = read();
    const now = new Date().toISOString();
    const campaign = {
      id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name || `${company} referral campaign`,
      company,
      role: role || '',
      userId: userId || null,
      status: 'queued',
      stage: 'discovery',
      currentPersonId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      lastActivity: '',
      error: '',
      errorStage: '',
      stats: { ...emptyStats(), totalEligible },
      config: config || {},
      people: [],
    };
    db.campaigns.push(campaign);
    write(db);
    syncCampaignToMongo(campaign);
    return campaign;
  },

  update(id, patch) {
    const db = read();
    const index = db.campaigns.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const next = {
      ...db.campaigns[index],
      ...patch,
      stats: patch.stats ? { ...db.campaigns[index].stats, ...patch.stats } : db.campaigns[index].stats,
      updatedAt: new Date().toISOString(),
    };
    db.campaigns[index] = next;
    write(db);
    syncCampaignToMongo(next);
    return next;
  },

  savePeople(id, people, statsPatch = {}) {
    return this.update(id, { people, stats: statsPatch });
  },

  updatePerson(id, personId, patch) {
    const db = read();
    const index = db.campaigns.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const campaign = db.campaigns[index];
    const personIndex = campaign.people.findIndex((item) => item.id === personId);
    if (personIndex < 0) return null;
    campaign.people[personIndex] = {
      ...campaign.people[personIndex],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    campaign.updatedAt = new Date().toISOString();
    db.campaigns[index] = campaign;
    write(db);
    return campaign.people[personIndex];
  },

  remove(id) {
    const db = read();
    db.campaigns = db.campaigns.filter((item) => item.id !== id);
    write(db);
  },

  /** A campaign that was mid-run when the server stopped is not running any more. */
  reconcileAfterRestart() {
    const db = read();
    let changed = false;
    db.campaigns = db.campaigns.map((campaign) => {
      if (campaign.status !== 'running' && campaign.status !== 'queued') return campaign;
      changed = true;
      return {
        ...campaign,
        status: 'paused',
        lastActivity: campaign.lastActivity || '',
        error: 'The server restarted while this campaign was running. Resume to continue from where it stopped.',
        updatedAt: new Date().toISOString(),
      };
    });
    if (changed) write(db);
    return db.campaigns;
  },
};
