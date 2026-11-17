import React, { useMemo, useState } from 'react';

/**
 * Company logo for a job row/card.
 *
 * Order of sources (each one falls through to the next when it fails to load):
 *   1. the employer's domain favicon, taken from the job's apply/source link
 *   2. a second favicon provider
 *   3. the logo the posting itself carried (og:image from the original page)
 *   4. the company initial
 */
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
  if (stored) list.push(stored);
  return list;
}

export default function CompanyLogo({ job, className = 'job-card-company-mark', style }) {
  const sources = useMemo(
    () => companyLogoSources(job),
    [job?.applyLink, job?.sourceUrl, job?.companyLogoUrl, job?.logo],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
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
