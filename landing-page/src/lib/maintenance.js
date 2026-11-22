/**
 * Maintenance notice plumbing.
 *
 * The backend masks AI API-key failures (rate limit, quota, revoked key, provider
 * outage) as a `503` with `maintenance: true`. That flag is the ONLY thing that
 * opens the popup: ordinary errors keep their own messages and never show it.
 */
export const MAINTENANCE_EVENT = 'hamzooh:maintenance';

export const MAINTENANCE_MESSAGE = 'The application is under maintenance. Please try again later.';

export function notifyMaintenance() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT));
}

/** Patch fetch once so every API call (not just apiFetch) can surface the popup. */
export function installMaintenanceWatch() {
  if (typeof window === 'undefined' || window.__hamzoohMaintenanceWatch) return;
  window.__hamzoohMaintenanceWatch = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.headers.get('X-Hamzooh-Maintenance') === '1') {
      notifyMaintenance();
      return response;
    }
    // Fallback for a proxy/older backend that drops the header.
    if (response.status === 503) {
      try {
        const payload = await response.clone().json();
        if (payload && (payload.maintenance === true || payload.code === 'AI_MAINTENANCE')) {
          notifyMaintenance();
        }
      } catch {
        // Not a JSON maintenance response (e.g. a proxy error page).
      }
    }
    return response;
  };
}
