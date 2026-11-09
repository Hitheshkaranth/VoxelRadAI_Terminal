import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCallback)
export const hashToken = token => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : ''
export function validEmail(value) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
export function validPassword(value) { return typeof value === 'string' && value.length >= 12 && value.length <= 256 }
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64)
  return `scrypt:${salt}:${key.toString('hex')}`
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false
  const [algorithm, salt, hex] = String(stored).split(':')
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) return false
  const key = await scrypt(password, salt, 64)
  return timingSafeEqual(key, Buffer.from(hex, 'hex'))
}
export function readSessionCookie(header = '') {
  const token = header.split(';').map(value => value.trim()).find(value => value.startsWith('skanda_session='))?.slice(15)
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}
export function sessionCookie(token, secure, maxAge = 28800) {
  return `skanda_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}
export function allowedOrigin(origin, expected) { return typeof origin === 'string' && origin === expected }
