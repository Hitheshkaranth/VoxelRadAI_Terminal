import test from 'node:test'
import assert from 'node:assert/strict'
import { googleSettings, parseSignup, signInBlock, validateGoogleClaims } from '../src/signup.mjs'
import { signupApprovedMessage, signupPendingMessage, signupVerificationMessage } from '../src/notify.mjs'

const form = { name: ' Dr  Ray ', email: 'Ray@Example.org', organization: 'City Hospital', role: 'Radiologist', password: 'correct horse battery' }

test('accepts and normalizes a sign-up', () => {
  const { value, error } = parseSignup(form)
  assert.equal(error, undefined)
  assert.equal(value.name, 'Dr Ray')
  assert.equal(value.email, 'ray@example.org')
})

test('rejects incomplete sign-ups and short passwords; honeypot is spam', () => {
  assert.match(parseSignup({ ...form, name: '' }).error, /name/)
  assert.match(parseSignup({ ...form, email: 'nope' }).error, /email/)
  assert.match(parseSignup({ ...form, organization: ' ' }).error, /organization/)
  assert.match(parseSignup({ ...form, password: 'short' }).error, /12 characters/)
  assert.match(parseSignup({ ...form, role: 'x'.repeat(81) }).error, /Role/)
  assert.deepEqual(parseSignup({ ...form, website: 'http://spam.test' }), { spam: true })
})

test('blocks unconfirmed email sign-ups, then pending approval; admin-created and approved accounts sign in', () => {
  assert.equal(signInBlock({ signup_source: 'password', email_verified_at: null, approval: 'pending' }).code, 'email_unverified')
  assert.equal(signInBlock({ signup_source: 'password', email_verified_at: new Date(), approval: 'pending' }).code, 'approval_pending')
  assert.equal(signInBlock({ signup_source: 'google', email_verified_at: new Date(), approval: 'pending' }).code, 'approval_pending')
  assert.equal(signInBlock({ signup_source: 'admin', email_verified_at: null, approval: 'approved' }), null)
  assert.equal(signInBlock({ signup_source: 'password', email_verified_at: new Date(), approval: 'approved' }), null)
})

test('accepts only Google-verified identities from Google', () => {
  const claims = { iss: 'https://accounts.google.com', sub: '1234567890', email: 'Ray@Gmail.com', email_verified: true, name: 'Ray\nRay' }
  assert.deepEqual(validateGoogleClaims(claims), { subject: '1234567890', email: 'ray@gmail.com', name: 'Ray Ray' })
  assert.throws(() => validateGoogleClaims({ ...claims, email_verified: false }), /confirm/)
  assert.throws(() => validateGoogleClaims({ ...claims, iss: 'https://evil.test' }), /issuer/)
  assert.throws(() => validateGoogleClaims({ ...claims, sub: '' }), /subject/)
})

test('Google sign-in stays off without a client id and secret, and needs HTTPS', () => {
  assert.equal(googleSettings({}, 'https://radgenis.com').enabled, false)
  const on = googleSettings({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }, 'https://radgenis.com')
  assert.equal(on.callbackUrl, 'https://radgenis.com/api/auth/google/callback')
  assert.throws(() => googleSettings({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }, 'http://radgenis.com'), /HTTPS/)
})

test('sign-up emails: confirmation link in the fragment, approval notice replies to the user', () => {
  const opts = { from: 'RadGenis <a@radgenis.com>', origin: 'https://radgenis.com', to: ['team@radgenis.com'] }
  const verify = signupVerificationMessage({ name: 'Dr Ray', email: 'ray@example.org' }, 'T'.repeat(43), opts)
  assert.equal(verify.to, 'ray@example.org')
  assert.match(verify.text, /https:\/\/radgenis\.com\/workspace#verify=T{43}/)
  const pending = signupPendingMessage({ name: 'Dr Ray', email: 'ray@example.org', organization: 'City', source: 'google' }, opts)
  assert.deepEqual(pending.to, ['team@radgenis.com'])
  assert.equal(pending.replyTo.address, 'ray@example.org')
  assert.match(pending.text, /with Google/)
  assert.match(signupApprovedMessage({ name: 'Dr Ray', email: 'ray@example.org' }, opts).text, /approved/)
})
