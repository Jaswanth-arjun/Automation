/**
 * Keyed mutex: one critical section at a time per key (Phase A: per user).
 *
 * Auto Apply must never run twice for the same candidate. The database check
 * alone is racy - two clicks in the same millisecond both see "no active task"
 * and both create one - so the check+create block runs inside `acquire(userId)`.
 *
 * Different users never block each other. The returned release function is
 * idempotent, so calling it twice (or from a `finally` after an early return)
 * cannot unlock someone else's section.
 *
 * Phase B replaces the Map with Redis SET NX PX; the API stays the same.
 */
export function createKeyedLock() {
  /** key -> tail promise of the queue */
  const tails = new Map();

  function acquire(key) {
    const id = String(key || 'anonymous');
    const prior = tails.get(id) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = prior.then(() => gate, () => gate);
    tails.set(id, tail);

    const unlock = () => {
      release();
      // Only clear the map when nobody queued behind this section.
      if (tails.get(id) === tail) tails.delete(id);
    };

    return prior.then(() => unlock, () => unlock);
  }

  return {
    acquire,
    /** Number of keys currently held or queued (diagnostics/tests). */
    size: () => tails.size,
    /** True when this key has a holder or waiter. */
    isBusy: (key) => tails.has(String(key || 'anonymous')),
  };
}

/** The process-wide lock used by the Auto Apply start endpoint. */
export const userApplyLock = createKeyedLock();
