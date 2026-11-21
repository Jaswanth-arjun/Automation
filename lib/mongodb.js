import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

let isConnected = false;

export async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('ℹ️ No MONGODB_URI found in environment; using local JSON file persistence.');
    return false;
  }
  if (isConnected) return true;

  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    console.log('🍃 Connected to MongoDB Atlas Cloud Database.');

    mongoose.connection.on('error', (err) => {
      console.error('🍃 MongoDB Atlas error:', err.message);
    });
    mongoose.connection.on('disconnected', () => {
      console.warn('🍃 MongoDB Atlas disconnected. Retrying...');
      isConnected = false;
    });

    return true;
  } catch (err) {
    console.error('⚠️ Could not connect to MongoDB Atlas:', err.message);
    console.log('ℹ️ Falling back safely to local JSON file persistence.');
    isConnected = false;
    return false;
  }
}

export function isMongoActive() {
  return isConnected && mongoose.connection.readyState === 1;
}

// ─── Schemas ───

const CandidateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, unique: true, index: true },
  fullName: { type: String, default: '' },
  phone: { type: String, default: '' },
  batch: { type: String, default: '', index: true },
  institution: { type: String, default: '' },
  skills: { type: [String], default: [] },
  registeredAt: { type: String, default: () => new Date().toISOString() },
  lastActiveAt: { type: String, default: () => new Date().toISOString() },
}, { timestamps: true, strict: false });

const CampaignSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: '' },
  company: { type: String, default: '', index: true },
  role: { type: String, default: '' },
  userId: { type: String, default: null, index: true },
  status: { type: String, default: 'queued', index: true },
  stage: { type: String, default: '' },
  currentPersonId: { type: String, default: null },
  createdAt: { type: String },
  updatedAt: { type: String },
  startedAt: { type: String, default: null },
  finishedAt: { type: String, default: null },
  lastActivity: { type: String, default: '' },
  error: { type: String, default: '' },
  errorStage: { type: String, default: '' },
  stats: { type: mongoose.Schema.Types.Mixed, default: {} },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  people: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true, strict: false });

const ConnectionSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  profileUrl: { type: String, default: '', index: true },
  headline: { type: String, default: '' },
  company: { type: String, default: '', index: true },
  status: { type: String, default: 'pending', index: true },
  notesSent: { type: String, default: '' },
  lastChecked: { type: String, default: () => new Date().toISOString() },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },
  source: { type: String, default: '' },
  category: { type: String, default: '' },
}, { timestamps: true, strict: false });

const JobSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: '' },
  company: { type: String, default: '', index: true },
  location: { type: String, default: '' },
  description: { type: String, default: '' },
  applyLink: { type: String, default: '' },
  sourceUrl: { type: String, default: '' },
  mustHaveSkills: { type: [String], default: [] },
  goodToHaveSkills: { type: [String], default: [] },
  postedBy: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: String, default: () => new Date().toISOString() },
}, { timestamps: true, strict: false });

const BroadcastSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  batch: { type: String, default: '' },
  subject: { type: String, default: '' },
  totalRecipients: { type: Number, default: 0 },
  sentAt: { type: String, default: () => new Date().toISOString() },
  recipients: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true, strict: false });

const AnswerMemorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  question: { type: String, required: true },
  normalizedQuestion: { type: String, required: true, index: true },
  category: { type: String, default: 'general', index: true },
  answer: { type: String, default: '' },
  encryptedAnswer: { type: String, default: '' },
  source: { type: String, default: 'user' },
  confirmed: { type: Boolean, default: true },
  sensitive: { type: Boolean, default: false },
  consentAt: { type: String, default: '' },
  options: { type: [String], default: [] },
  answerType: { type: String, default: 'text' },
  context: { type: String, default: '' },
  reviewAfter: { type: String, default: '' },
  createdAt: { type: String },
  updatedAt: { type: String },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true, strict: false });

const ApplicationTaskSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  userEmail: { type: String, default: '' },
  tokenHash: { type: String, required: true },
  job: { type: mongoose.Schema.Types.Mixed, default: {} },
  url: { type: String, default: '' },
  status: { type: String, default: 'initializing', index: true },
  stage: { type: String, default: 'initializing' },
  steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
  profile: { type: mongoose.Schema.Types.Mixed, default: {} },
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  selectedResume: { type: mongoose.Schema.Types.Mixed, default: null },
  resumeSelection: { type: mongoose.Schema.Types.Mixed, default: {} },
  questions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  review: { type: mongoose.Schema.Types.Mixed, default: null },
  approval: { type: mongoose.Schema.Types.Mixed, default: {} },
  checkpoint: { type: mongoose.Schema.Types.Mixed, default: {} },
  retries: { type: Number, default: 0 },
  limits: { type: mongoose.Schema.Types.Mixed, default: {} },
  usage: { type: mongoose.Schema.Types.Mixed, default: {} },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  lastHeartbeatAt: { type: String, default: '' },
  createdAt: { type: String },
  updatedAt: { type: String },
  endedAt: { type: String, default: '' },
}, { timestamps: true, strict: false });

const AiUsageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, default: '', index: true },
  taskId: { type: String, default: '', index: true },
  role: { type: String, default: '' },
  model: { type: String, default: '' },
  provider: { type: String, default: '' },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  reasoningTokens: { type: Number, default: 0 },
  cachedTokens: { type: Number, default: 0 },
  costUsd: { type: Number, default: 0 },
  latencyMs: { type: Number, default: 0 },
  escalated: { type: Boolean, default: false },
  at: { type: String },
}, { timestamps: true, strict: false });

export const CandidateModel = mongoose.models.Candidate || mongoose.model('Candidate', CandidateSchema);
export const AnswerMemoryModel = mongoose.models.AnswerMemory || mongoose.model('AnswerMemory', AnswerMemorySchema);
export const ApplicationTaskModel = mongoose.models.ApplicationTask || mongoose.model('ApplicationTask', ApplicationTaskSchema);
export const AiUsageModel = mongoose.models.AiUsage || mongoose.model('AiUsage', AiUsageSchema);
export const CampaignModel = mongoose.models.Campaign || mongoose.model('Campaign', CampaignSchema);
export const ConnectionModel = mongoose.models.Connection || mongoose.model('Connection', ConnectionSchema);
export const JobModel = mongoose.models.Job || mongoose.model('Job', JobSchema);
export const BroadcastModel = mongoose.models.Broadcast || mongoose.model('Broadcast', BroadcastSchema);
