import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const vaultDir = join(process.cwd(), 'data');
const vaultFile = join(vaultDir, 'user_vault.json');

function ensureVaultFile() {
  if (!existsSync(vaultDir)) {
    mkdirSync(vaultDir, { recursive: true });
  }
  if (!existsSync(vaultFile)) {
    const initialVault = {
      credentials: {},   // { "amazon.jobs": { email: "...", password: "..." }, ... }
      customAnswers: {},  // { "normalized_question": { answer: "Yes", originalQuestion: "...", approvedAt: "..." } }
      defaultPassword: '',
    };
    writeFileSync(vaultFile, JSON.stringify(initialVault, null, 2), 'utf-8');
  }
}

export function getVaultData() {
  ensureVaultFile();
  try {
    const raw = readFileSync(vaultFile, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch {
    return { credentials: {}, customAnswers: {}, defaultPassword: '' };
  }
}

function writeVault(vault) {
  ensureVaultFile();
  writeFileSync(vaultFile, JSON.stringify(vault, null, 2), 'utf-8');
}

export function saveVaultCredential(domainOrKey, credentialObj) {
  const vault = getVaultData();
  if (!vault.credentials) vault.credentials = {};

  vault.credentials[domainOrKey.toLowerCase()] = {
    ...vault.credentials[domainOrKey.toLowerCase()],
    ...credentialObj,
    updatedAt: new Date().toISOString(),
  };

  if (credentialObj.password && !vault.defaultPassword) {
    vault.defaultPassword = credentialObj.password;
  }

  writeVault(vault);
  return vault;
}

// ─── Semantic Question Matching ───

const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'and', 'but', 'or', 'nor', 'not',
  'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any',
  'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very',
  'just', 'also', 'about', 'if', 'then', 'that', 'this', 'these', 'those',
  'it', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why', 'there', 'here', 'up',
  'out', 'down', 'please', 'provide', 'enter', 'specify', 'select',
  'choose', 'answer', 'following', 'question', 'below', 'us', 'we', 'me',
  'i', 'you', 'he', 'she', 'they', 'them',
]);

/**
 * Normalize a question string for comparison:
 * - lowercase, remove punctuation, remove filler words, sort remaining keywords
 */
export function normalizeQuestion(raw) {
  const words = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !FILLER_WORDS.has(w));
  return [...new Set(words)].sort().join(' ');
}

/**
 * Compute similarity score (0-1) between two normalized question strings.
 * Uses Jaccard-like overlap of keyword sets.
 */
function questionSimilarity(normA, normB) {
  if (!normA || !normB) return 0;
  const setA = new Set(normA.split(' '));
  const setB = new Set(normB.split(' '));
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const word of setA) {
    if (setB.has(word)) overlap++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? overlap / union : 0;
}

/**
 * Find the best matching saved answer for a question using semantic matching.
 * Returns { answer, score, originalQuestion } or null if no good match.
 */
export function findSimilarAnswer(question, minScore = 0.45) {
  const vault = getVaultData();
  const answers = vault.customAnswers || {};
  const normalizedInput = normalizeQuestion(question);
  if (!normalizedInput) return null;

  let best = null;
  let bestScore = 0;

  for (const [normalizedKey, entry] of Object.entries(answers)) {
    const score = questionSimilarity(normalizedInput, normalizedKey);
    if (score > bestScore && score >= minScore) {
      bestScore = score;
      const answerValue = typeof entry === 'string' ? entry : entry?.answer || entry;
      best = {
        answer: String(answerValue),
        score: bestScore,
        originalQuestion: typeof entry === 'object' ? entry.originalQuestion || normalizedKey : normalizedKey,
        normalizedKey,
      };
    }
  }

  // Also check direct exact key match (legacy format where key = raw question lowercase)
  const directKey = String(question || '').toLowerCase().trim();
  if (answers[directKey] && (!best || bestScore < 1)) {
    const val = answers[directKey];
    return {
      answer: String(typeof val === 'string' ? val : val?.answer || val),
      score: 1,
      originalQuestion: directKey,
      normalizedKey: directKey,
    };
  }

  return best;
}

/**
 * Save an answer with user consent tracking.
 * Only saves if approved === true.
 */
export function saveVaultAnswer(questionKey, answerValue, approved = true) {
  if (!approved) return null;

  const vault = getVaultData();
  if (!vault.customAnswers) vault.customAnswers = {};

  const normalizedKey = normalizeQuestion(questionKey);
  const directKey = String(questionKey || '').toLowerCase().trim();

  // Save under normalized key for semantic matching
  if (normalizedKey) {
    vault.customAnswers[normalizedKey] = {
      answer: String(answerValue),
      originalQuestion: directKey,
      approvedAt: new Date().toISOString(),
    };
  }

  // Also save under direct key for backwards compatibility
  vault.customAnswers[directKey] = {
    answer: String(answerValue),
    originalQuestion: directKey,
    approvedAt: new Date().toISOString(),
  };

  writeVault(vault);
  return vault;
}

/**
 * Get all saved answers (flat map: question -> answer string).
 * Used for bulk sync to extension storage.
 */
export function getAllAnswers() {
  const vault = getVaultData();
  const answers = vault.customAnswers || {};
  const flat = {};
  for (const [key, entry] of Object.entries(answers)) {
    flat[key] = typeof entry === 'string' ? entry : entry?.answer || String(entry);
  }
  return flat;
}

export function findVaultCredential(domainOrUrl) {
  const vault = getVaultData();
  if (!domainOrUrl) return null;
  const str = String(domainOrUrl).toLowerCase();

  for (const [key, cred] of Object.entries(vault.credentials || {})) {
    if (str.includes(key.toLowerCase()) || key.toLowerCase().includes(str)) {
      return cred;
    }
  }

  if (vault.defaultPassword) {
    return { password: vault.defaultPassword };
  }

  return null;
}
