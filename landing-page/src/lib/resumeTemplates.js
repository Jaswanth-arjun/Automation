/**
 * Resume templates for tailoring. `classic` is the layout HAMZOOH has always
 * rendered, so it is the default whenever the user has not picked one.
 * New templates go into this list — the tailor backend maps ids to layouts.
 */
const STORAGE_KEY = 'hamzooh_resume_template';

export const RESUME_TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'The default HAMZOOH one-page layout. Clean sections, ATS-friendly, accepted everywhere.',
    isDefault: true,
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Centered navy name with contact icons, navy section headings with rules, bulleted experience and a three-column skills grid.',
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Dense one-page fit that keeps every detail of a long resume.',
  },
];

export const DEFAULT_TEMPLATE_ID = RESUME_TEMPLATES.find((t) => t.isDefault)?.id || RESUME_TEMPLATES[0].id;

export function isValidTemplateId(id) {
  return RESUME_TEMPLATES.some((t) => t.id === id);
}

export function getSelectedTemplateId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isValidTemplateId(saved)) return saved;
  } catch {}
  return DEFAULT_TEMPLATE_ID;
}

export function setSelectedTemplateId(id) {
  const next = isValidTemplateId(id) ? id : DEFAULT_TEMPLATE_ID;
  try {
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent('resume_template_changed', { detail: next }));
  } catch {}
  return next;
}
