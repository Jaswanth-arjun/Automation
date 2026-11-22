import React, { useEffect, useMemo, useState } from 'react';

/**
 * Company logo for a job row/card.
 *
 * Order of sources (each one falls through to the next when it fails to load):
 *   1. the employer's domain favicon, taken from the job's apply/source link
 *   2. a second favicon provider
 *   3. the logo the posting itself carried (og:image from the original page)
 *   4. a logo guessed from the company name (for rows with no job link)
 *   5. the company initial
 */

/** "Twilio Inc" → "twilio.com" — only used when the row carries no job link. */
function domainFromCompany(company) {
  const slug = String(company || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|technologies|technology|solutions|systems|labs|group|holdings|company)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
  // A digit in the name ("Ai2") would guess an unrelated site's domain, and a
  // wrong logo is worse than the initial.
  return slug && slug.length >= 3 && !/\d/.test(slug) ? `${slug}.com` : '';
}

const hostOf = (url) => {
  try { return new URL(url).hostname; } catch { return ''; }
};

// Clearbit's free logo API was shut down on 8 Dec 2025: those URLs never
// resolve now, and saved jobs still point at them.
const CLEARBIT_LOGO_HOST = /(^|\.)logo\.clearbit\.com$/i;

export function companyLogoSources(job = {}) {
  const list = [];
  const link = job.applyLink || job.sourceUrl || '';
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    const domain = parts.length > 2 ? parts.slice(-2).join('.') : host;
    if (domain.includes('.')) {
      list.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
      list.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
    }
  } catch {
    /* no usable link */
  }
  const stored = job.companyLogoUrl || job.logo;
  if (stored && !CLEARBIT_LOGO_HOST.test(hostOf(stored))) list.push(stored);
  // Tracker rows only know the company name, so the logo comes from the
  // employer's domain: a real brand logo first, then its site icon.
  const domain = domainFromCompany(job.company);
  if (domain) {
    list.push(`https://logos.hunter.io/${domain}`);
    list.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  }
  return list;
}

export default function CompanyLogo({ job, className = 'job-card-company-mark', style }) {
  const sources = useMemo(
    () => companyLogoSources(job),
    [job?.applyLink, job?.sourceUrl, job?.companyLogoUrl, job?.logo, job?.company],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  // The drawer re-uses this component while switching rows; a failed source
  // from the previous company must not leave the next one on its initial.
  useEffect(() => { setSourceIndex(0); }, [sources]);
  const src = sources[sourceIndex];

  if (src) {
    return (
      <img
        className={`${className} is-logo`}
        src={src}
        alt=""
        loading="lazy"
        onError={() => setSourceIndex((index) => index + 1)}
        style={style}
      />
    );
  }

  return (
    <div className={className} style={style}>
      {job?.companyMark || job?.company?.[0]?.toUpperCase() || 'J'}
    </div>
  );
}
