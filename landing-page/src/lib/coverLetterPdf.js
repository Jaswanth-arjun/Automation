// Shared Cover Letter PDF helpers. The Apply screen's cover letter row and the
// Cover Letter modal both use these so Download / View always produce the same
// document, rendered by the backend from the current edited letter.

const RENDER_ENDPOINT = '/api/cover-letter/render-pdf';

function safePart(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function coverLetterFileName(coverLetter = {}, company = '') {
  const name = safePart(coverLetter?.applicantName, 'Applicant');
  const comp = safePart(coverLetter?.companyName || company, 'Company');
  return `${name}-${comp}-Cover-Letter.pdf`;
}

export function base64PdfObjectUrl(base64) {
  if (!base64) return '';
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export async function renderCoverLetterPdfBase64(coverLetter, { company = '', jobTitle = '' } = {}) {
  if (!coverLetter) throw new Error('No cover letter to render yet.');
  const res = await fetch(RENDER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coverLetter, company, jobTitle }),
  }).then((r) => r.json());

  if (!res?.pdfBase64) throw new Error(res?.error || 'The server did not return a PDF.');
  return res.pdfBase64;
}

export async function downloadCoverLetterPdf(coverLetter, options = {}) {
  const base64 = await renderCoverLetterPdfBase64(coverLetter, options);
  const url = base64PdfObjectUrl(base64);
  const link = document.createElement('a');
  link.href = url;
  link.download = coverLetterFileName(coverLetter, options.company);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Opens the rendered letter as a real PDF in a new tab, the same way the
// tailored resume's View button does. The tab is grabbed during the click
// gesture so popup blockers do not reject it while the PDF renders.
export async function openCoverLetterPdf(coverLetter, options = {}) {
  if (!coverLetter) return;
  let win = null;
  try {
    win = window.open('', '_blank');
  } catch {
    win = null;
  }

  try {
    const base64 = await renderCoverLetterPdfBase64(coverLetter, options);
    const url = base64PdfObjectUrl(base64);
    if (win && !win.closed) {
      win.location.href = url;
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    if (win && !win.closed) win.close();
    throw err;
  }
}

export default { coverLetterFileName, renderCoverLetterPdfBase64, downloadCoverLetterPdf, openCoverLetterPdf };
