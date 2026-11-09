import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedOrigin, hashPassword, hashToken, newToken, normalizeEmail, readSessionCookie, sessionCookie, validPassword, verifyPassword } from '../src/security.mjs'
test('passwords salted and verified without storing plaintext', async () => {
  const one = await hashPassword('a strong test password')
  const two = await hashPassword('a strong test password')
  assert.notEqual(one, two); assert.equal(await verifyPassword('a strong test password', one), true)
  assert.equal(await verifyPassword('wrong', one), false); assert.equal(await verifyPassword('wrong', 'broken'), false)
  assert.equal(validPassword('short'), false); assert.equal(validPassword('x'.repeat(257)), false)
})
test('opaque session tokens, strict cookie attributes and parser', () => {
  const token = newToken(); assert.equal(readSessionCookie(`other=a; skanda_session=${token}`), token)
  assert.equal(readSessionCookie('skanda_session=bad'), null)
  assert.notEqual(hashToken(token), token); assert.equal(hashToken(token).length, 64)
  assert.match(sessionCookie(token, true), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/)
  assert.match(sessionCookie('', true, 0), /Max-Age=0/)
})
test('origin checks reject missing and cross-origin mutation requests', () => {
  assert.equal(allowedOrigin(undefined, 'https://skanda.example'), false)
  assert.equal(allowedOrigin('https://evil.example', 'https://skanda.example'), false)
  assert.equal(allowedOrigin('https://skanda.example', 'https://skanda.example'), true)
  assert.equal(normalizeEmail(' Reader@Example.com '), 'reader@example.com')
})
