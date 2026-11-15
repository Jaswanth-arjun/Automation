export function timeAgo(value) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '—';
  const diff = Date.now() - time;
  if (diff < 0) return 'just now';
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}
