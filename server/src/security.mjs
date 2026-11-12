import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCallback)
export const hashToken = token => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : ''
export function validEmail(value) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
export function validPassword(value) { return typeof value === 'string' && value.length >= 12 && value.length <= 256 }
// scrypt cost N=2^17, r=8, p=1 (OWASP). Hashes record their cost so older 'scrypt:' hashes (N=2^14) still verify and are upgraded at sign-in.
const COST = { N: 131072, r: 8, p: 1 }
const params = ({ N, r, p }) => ({ N, r, p, maxmem: 256 * N * r + 1024 * 1024 })
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64, params(COST))
  return `scrypt2:${COST.N}:${COST.r}:${COST.p}:${salt}:${key.toString('hex')}`
}
function parseHash(stored) {
  const parts = String(stored).split(':')
  if (parts[0] === 'scrypt' && parts.length === 3) return { N: 16384, r: 8, p: 1, salt: parts[1], hex: parts[2] }
  if (parts[0] === 'scrypt2' && parts.length === 6) {
    const [N, r, p] = parts.slice(1, 4).map(Number)
    if ([16384, 32768, 65536, 131072].includes(N) && r === 8 && p === 1) return { N, r, p, salt: parts[4], hex: parts[5] }
  }
  return null
}
export const needsRehash = stored => { const parsed = parseHash(stored); return !parsed || parsed.N < COST.N }
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false
  const parsed = parseHash(stored)
  if (!parsed || !/^[a-f0-9]{32}$/.test(parsed.salt) || !/^[a-f0-9]{128}$/.test(parsed.hex)) return false
  const key = await scrypt(password, parsed.salt, 64, params(parsed))
  return timingSafeEqual(key, Buffer.from(parsed.hex, 'hex'))
}
export function readSessionCookie(header = '') {
  const token = header.split(';').map(value => value.trim()).find(value => value.startsWith('skanda_session='))?.slice(15)
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}
export function sessionCookie(token, secure, maxAge = 28800) {
  return `skanda_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}
export function allowedOrigin(origin, expected) { return typeof origin === 'string' && origin === expected }
