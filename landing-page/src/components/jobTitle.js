/**
 * Keep flattened job descriptions out of compact result headings.
 * This is presentation-only; callers should continue storing the original value.
 */
export function shortenJobTitle(value, maxWords = 12) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const marker = /\s+(?:Department:|Location:|Employment Type:|Role\s+We\s+are\b|We\s+are\b|About\s+(?:the\s+)?(?:role|job)\b|Responsibilities:?|Requirements:?|Job\s+Description:?)/i;
  const beforeDescription = normalized.split(marker)[0].trim().replace(/[–—:-]\s*$/, '').trim();
  const words = (beforeDescription || normalized).split(' ');
  if (words.length <= maxWords) return beforeDescription || normalized;
  return `${words.slice(0, maxWords).join(' ')}…`;
}
