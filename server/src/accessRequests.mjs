import { normalizeEmail, validEmail } from './security.mjs'

export const ACCESS_STATUSES = ['new', 'approved', 'declined']
const LIMITS = { name: 120, organization: 160, role: 80, useCase: 1000 }
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : ''

/**
 * Validates a public access request. Returns { spam: true } when the hidden honeypot field is filled,
 * { error } for invalid input, or { value } with trimmed fields ready to store.
 */
export function parseAccessRequest(data) {
  if (!data || typeof data !== 'object') return { error: 'Request must contain a JSON object.' }
  if (clean(data.website)) return { spam: true }
  const value = { name: clean(data.name), email: normalizeEmail(data.email), organization: clean(data.organization), role: clean(data.role), useCase: clean(data.useCase) }
  if (!value.name) return { error: 'Enter your name.' }
  if (!validEmail(value.email)) return { error: 'Enter a valid work email address.' }
  if (!value.organization) return { error: 'Enter your organization.' }
  if (value.useCase.length < 10) return { error: 'Tell us briefly how you would use VoxelRad AI (at least 10 characters).' }
  for (const [field, max] of Object.entries(LIMITS)) if (value[field].length > max) return { error: `${field === 'useCase' ? 'Use case' : field[0].toUpperCase() + field.slice(1)} must be ${max} characters or fewer.` }
  return { value }
}
