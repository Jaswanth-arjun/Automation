import { useEffect, useState } from 'react';
import { api } from './api';

// Shared, cached connection health for the two automation channels.
// One fetch serves the sidebar dots and the onboarding card, so opening the
// dashboard never fires duplicate requests.
const TTL = 60 * 1000;
let cache = null; // { userId, at, data }
let inflight = null; // { userId, promise }
const listeners = new Set();

function normalize(cfg, account) {
  // A stale session can still report `connected: true` while LinkedIn wants a
  // fresh sign-in, so the explicit status wins over the boolean flag.
  const status = account?.status || (account?.connected ? 'connected' : 'disconnected');
  let linkedinState = 'disconnected';
  if (status === 'requires_login' || status === 'expired') linkedinState = 'expired';
  else if (status === 'pending_login') linkedinState = 'pending';
  else if (status === 'connected' || account?.connected) linkedinState = 'connected';

  const mailConnected = Boolean(cfg?.configured && cfg?.connected !== false);

  return {
    error: !cfg && !account,
    mail: {
      state: mailConnected ? 'connected' : 'disconnected',
      email: cfg?.email || '',
      method: cfg?.method || '',
    },
    linkedin: {
      state: linkedinState,
      name: account?.memberName || account?.name || '',
      status,
    },
  };
}

export function refreshConnectStatus(userId, { force = false } = {}) {
  if (!userId) return Promise.resolve(null);
  if (!force && cache && cache.userId === userId && Date.now() - cache.at < TTL) {
    return Promise.resolve(cache.data);
  }
  if (inflight && inflight.userId === userId) return inflight.promise;

  const promise = Promise.all([
    api.getGmailConfig().catch(() => null),
    api.getLinkedInAccount(userId).catch(() => null),
  ]).then(([cfg, account]) => {
    const data = normalize(cfg, account);
    cache = { userId, at: Date.now(), data };
    listeners.forEach((fn) => fn(data));
    return data;
  });

  inflight = { userId, promise };
  promise.finally(() => {
    if (inflight && inflight.promise === promise) inflight = null;
  });
  return promise;
}

export function useConnectStatus(userId) {
  const [data, setData] = useState(() =>
    cache && cache.userId === userId && Date.now() - cache.at < TTL ? cache.data : null,
  );

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    const onUpdate = (next) => {
      if (!cancelled) setData(next);
    };
    listeners.add(onUpdate);
    refreshConnectStatus(userId)
      .then((next) => {
        if (!cancelled && next) setData(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      listeners.delete(onUpdate);
    };
  }, [userId]);

  return {
    loading: !data,
    error: Boolean(data?.error),
    mail: data?.mail || null,
    linkedin: data?.linkedin || null,
    refresh: () => refreshConnectStatus(userId, { force: true }),
  };
}
