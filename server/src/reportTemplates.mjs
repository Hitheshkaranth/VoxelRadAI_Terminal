// Validation for per-user report templates. Templates hold plain text and one raster logo;
// no HTML is accepted, so a template cannot inject markup into printed or shared reports.
export const SECTION_KEYS = ['technique', 'comparison', 'findings', 'impression', 'recommendations']
export const MAX_TEMPLATES = 20
export const TEMPLATE_BODY_LIMIT = 700 * 1024
const LOGO = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, max) => typeof value === 'string' && value.length <= max
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key))

export function validTemplate(value) {
  if (!object(value) || !only(value, ['name', 'header', 'footer', 'sectionTitles', 'layout', 'signatory', 'greeting', 'signatureLines'])) return false
  if (!text(value.name, 80) || !value.name.trim()) return false
  const { header, footer, sectionTitles } = value
  if (!object(header) || !only(header, ['logoDataUrl', 'institution', 'department', 'lines', 'align'])) return false
  if (header.logoDataUrl !== undefined && !(text(header.logoDataUrl, 600 * 1024) && LOGO.test(header.logoDataUrl))) return false
  if (!text(header.institution, 120) || !text(header.department, 120)) return false
  if (!Array.isArray(header.lines) || header.lines.length > 6 || !header.lines.every(line => text(line, 160))) return false
  if (!['left', 'center'].includes(header.align)) return false
  if (!object(footer) || !only(footer, ['text', 'showPageNumbers', 'showDisclaimer'])) return false
  if (!text(footer.text, 600) || typeof footer.showPageNumbers !== 'boolean' || typeof footer.showDisclaimer !== 'boolean') return false
  if (!object(sectionTitles) || !only(sectionTitles, SECTION_KEYS)) return false
  // Optional systematic layout (plain text only, like the rest of the template).
  if (value.layout !== undefined && !['standard', 'systematic'].includes(value.layout)) return false
  if (value.greeting !== undefined && !text(value.greeting, 80)) return false
  const { signatory } = value
  const lineList = (v, n) => v === undefined || (Array.isArray(v) && v.length <= n && v.every(line => text(line, 160)))
  if (signatory !== undefined && !(object(signatory) && only(signatory, ['name', 'qualifications', 'registration', 'lines']) &&
    text(signatory.name, 120) && text(signatory.qualifications, 160) && text(signatory.registration, 120) && lineList(signatory.lines, 4))) return false
  if (!lineList(value.signatureLines, 6)) return false
  return SECTION_KEYS.every(key => sectionTitles[key] === undefined || text(sectionTitles[key], 60))
}
