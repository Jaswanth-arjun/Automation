import crypto from 'crypto';

/**
 * Shared employee directory rules.
 *
 * One row per human email address. The serial number (sno) is assigned once,
 * never renumbered and never reused, so "how many employees" is exactly the
 * number of distinct email ids — locally, in production, and for every user.
 * Keeping this pure makes the dedupe rules verifiable without starting the
 * server.
 */

export function normalizeCompany(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function companiesMatch(a, b) {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function normalizeEmployeeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function nextEmployeeSno(list) {
  return (Array.isArray(list) ? list : [])
    .reduce((max, row) => Math.max(max, Number(row?.sno) || 0), 0) + 1;
}

export function assignMissingEmployeeSnos(list) {
  const rows = Array.isArray(list) ? list : [];
  const missing = rows.filter((row) => !(Number(row?.sno) > 0));
  if (!missing.length) return false;
  let next = nextEmployeeSno(rows);
  // Oldest contacts keep the lowest numbers, so the order stays stable.
  missing
    .map((row) => ({ row, at: Date.parse(row?.createdAt || '') || 0 }))
    .sort((a, b) => a.at - b.at)
    .forEach(({ row }) => { row.sno = next; next += 1; });
  return true;
}

export function employeeMatchesCompany(row, company) {
  if (!row || !company) return false;
  if (companiesMatch(row.company, company)) return true;
  return Array.isArray(row.companies) && row.companies.some((alias) => companiesMatch(alias, company));
}

/**
 * Merge contacts into the shared directory without ever storing an email twice.
 * A contact already present is enriched (name/role/company/details, extra
 * company aliases) instead of duplicated.
 */
export function mergeEmployeeRecords(existing, incoming, source) {
  const list = Array.isArray(existing) ? existing : [];
  const byEmail = new Map();
  for (const row of list) {
    const key = normalizeEmployeeEmail(row?.email);
    if (key && !byEmail.has(key)) byEmail.set(key, row);
  }
  let next = nextEmployeeSno(list);
  const usedSnos = new Set(list.map((row) => Number(row?.sno)).filter((n) => n > 0));
  const saved = [];
  let merged = 0;
  for (const rec of (Array.isArray(incoming) ? incoming : [])) {
    const email = normalizeEmployeeEmail(rec?.email);
    if (!email || !email.includes('@')) continue;
    const company = String(rec.company || '').trim();
    const current = byEmail.get(email);
    if (current) {
      let touched = false;
      if (!current.name && rec.name) { current.name = String(rec.name).trim(); touched = true; }
      if (!current.role && rec.role) { current.role = String(rec.role).trim(); touched = true; }
      if (!current.company && company) { current.company = company; touched = true; }
      if (!current.details && rec.details) { current.details = String(rec.details).trim(); touched = true; }
      if (company) {
        const aliases = Array.isArray(current.companies) ? current.companies : [];
        if (!aliases.some((alias) => companiesMatch(alias, company))) {
          current.companies = [...aliases, company];
          touched = true;
        }
      }
      if (touched) merged += 1;
      continue;
    }
    // A sno carried over from another environment is kept when it is still
    // free, so the same employee keeps the same number locally and in
    // production; otherwise the next unused number is assigned.
    const wanted = Number(rec.sno) || 0;
    const sno = wanted > 0 && !usedSnos.has(wanted) ? wanted : next;
    if (sno >= next) next = sno + 1;
    usedSnos.add(sno);
    const row = {
      id: crypto.randomUUID(),
      sno,
      name: String(rec.name || email.split('@')[0].replace(/[._]/g, ' ')).trim(),
      company,
      role: String(rec.role || '').trim(),
      email,
      details: String(rec.details || '').trim(),
      source,
      companies: company ? [company] : [],
      createdAt: new Date().toISOString(),
    };
    list.unshift(row);
    byEmail.set(email, row);
    saved.push(row);
  }
  return { list, saved, added: saved.length, merged };
}
