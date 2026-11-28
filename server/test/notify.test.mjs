import test from 'node:test'
import assert from 'node:assert/strict'
import { accessRequestMessage, createNotifier, mailConfig } from '../src/notify.mjs'

const env = { SMTP_USER: 'hitheshkaranth@radgenis.com', SMTP_PASS: 'abcd efgh ijkl mnop', ACCESS_NOTIFY_TO: 'hitheshkaranth@radgenis.com' }
const request = { name: 'Dr Ray', email: 'ray@example.org', organization: 'City Hospital', role: 'Radiologist', useCase: 'Evaluate CT review for our residency teaching files.' }

test('stays off until user, password and recipient are all set', () => {
  assert.equal(mailConfig({}), null)
  assert.equal(mailConfig({ ...env, SMTP_PASS: '' }), null)
  assert.equal(mailConfig({ ...env, ACCESS_NOTIFY_TO: ' ' }), null)
  assert.equal(createNotifier({ env: {}, origin: 'https://radgenis.com' }).enabled, false)
})

test('defaults to Google Workspace SMTP over TLS and strips app-password spaces', () => {
  const config = mailConfig(env)
  assert.equal(config.host, 'smtp.gmail.com')
  assert.equal(config.port, 465)
  assert.equal(config.secure, true)
  assert.equal(config.pass, 'abcdefghijklmnop')
  assert.deepEqual(config.to, ['hitheshkaranth@radgenis.com'])
  assert.equal(config.from, 'RadGenis <hitheshkaranth@radgenis.com>')
  assert.equal(mailConfig({ ...env, SMTP_PORT: '587' }).secure, false)
})

test('builds a plain-text message that replies to the requester', () => {
  const message = accessRequestMessage(request, { to: ['team@radgenis.com'], from: 'RadGenis <team@radgenis.com>', origin: 'https://radgenis.com' })
  assert.equal(message.subject, 'Early access request: Dr Ray (City Hospital)')
  assert.deepEqual(message.replyTo, { name: 'Dr Ray', address: 'ray@example.org' })
  assert.match(message.text, /Email: +ray@example\.org/)
  assert.match(message.text, /residency teaching files/)
  assert.match(message.text, /https:\/\/radgenis\.com\/workspace/)
  assert.match(message.html, /New early-access request/)
  assert.match(message.html, /\/email\/radgenis-mark-96\.png/)
})

test('keeps line breaks out of the subject and reply-to name', () => {
  const message = accessRequestMessage({ ...request, name: 'Eve\r\nBcc: x@evil.test', organization: 'Org\nX' }, { to: ['a@b.c'], from: 'a@b.c', origin: 'https://radgenis.com' })
  assert.doesNotMatch(message.subject, /[\r\n]/)
  assert.doesNotMatch(message.replyTo.name, /[\r\n]/)
})

test('sends through the transport and surfaces SMTP errors to the caller', async () => {
  const sent = []
  const ok = createNotifier({ env, origin: 'https://radgenis.com', transport: { sendMail: async m => { sent.push(m) } } })
  assert.equal(await ok.accessRequest(request), true)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].to, ['hitheshkaranth@radgenis.com'])
  const failing = createNotifier({ env, origin: 'https://radgenis.com', transport: { sendMail: async () => { throw Object.assign(new Error('auth'), { code: 'EAUTH' }) } } })
  await assert.rejects(failing.accessRequest(request), /auth/)
})

test('HTML emails escape every submitted value', () => {
  const evil = { ...request, name: '<script>alert(1)</script>', organization: '"><img src=x onerror=1>', useCase: '<b>bold</b> use case here' }
  const html = accessRequestMessage(evil, { to: ['a@b.c'], from: 'a@b.c', origin: 'https://radgenis.com' }).html
  assert.doesNotMatch(html, /<script>|<img src=x|<b>bold/)
  assert.match(html, /&lt;script&gt;/)
})
