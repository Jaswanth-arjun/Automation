import React, { useEffect, useState } from 'react';
import { Wrench, X } from 'lucide-react';
import { MAINTENANCE_EVENT } from '../lib/maintenance';

/**
 * Shown only when the backend reports a masked AI API-key/provider failure.
 * Users see a maintenance notice instead of the provider's rate-limit text.
 */
export default function MaintenanceNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(MAINTENANCE_EVENT, show);
    return () => window.removeEventListener(MAINTENANCE_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="mnt-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mnt-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
    >
      <div className="mnt-card">
        <span className="mnt-icon"><Wrench size={19} /></span>
        <div className="mnt-copy">
          <h2 id="mnt-title">The application is under maintenance</h2>
          <p>Please try again later. Your saved work is safe.</p>
        </div>
        <button type="button" className="mnt-close" onClick={() => setOpen(false)} aria-label="Close">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
