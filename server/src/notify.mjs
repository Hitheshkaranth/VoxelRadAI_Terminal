// Email notifications for new early-access requests, sent through an SMTP mailbox (Google Workspace by default).
// Off unless SMTP_USER, SMTP_PASS and ACCESS_NOTIFY_TO are all set. Sending runs after the request is stored, so a
// mail failure never loses a request: it stays in Administration → Access requests either way.
import nodemailer from 'nodemailer'

const oneLine = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** SMTP settings from the environment, or null when notifications are not configured. */
export function mailConfig(env = process.env) {
  const user = oneLine(env.SMTP_USER, 254)
  const pass = typeof env.SMTP_PASS === 'string' ? env.SMTP_PASS.replace(/\s+/g, '') : ''
  const to = oneLine(env.ACCESS_NOTIFY_TO, 1000).split(',').map(s => s.trim()).filter(Boolean)
  if (!user || !pass || !to.length) return null
  const port = Number(env.SMTP_PORT) || 465
  return {
    host: oneLine(env.SMTP_HOST, 253) || 'smtp.gmail.com',
    port,
    secure: port === 465,
    user,
    pass,
    to,
    from: oneLine(env.SMTP_FROM, 300) || `RadGenis <${user}>`,
  }
}

/** Plain-text notification for one stored access request. Plain text only, so submitted fields cannot inject markup. */
export function accessRequestMessage(request, { to, from, origin }) {
  const name = oneLine(request.name, 120)
  const organization = oneLine(request.organization, 160)
  const lines = [
    'A new early-access request was submitted on RadGenis.',
    '',
    `Name:         ${name}`,
    `Email:        ${request.email}`,
    `Organization: ${organization}`,
    `Role:         ${oneLine(request.role, 80) || '(not given)'}`,
    '',
    'How they would use it:',
    String(request.useCase ?? '').slice(0, 1000),
    '',
    `Review and approve it in Administration → Access requests: ${origin}/workspace`,
    'Reply to this email to answer the requester directly.',
  ]
  return {
    from,
    to,
    replyTo: { name, address: request.email },
    subject: `Early access request: ${name} (${organization})`,
    text: lines.join('\n'),
  }
}

/** `accessRequest(value)` resolves true when sent, false when notifications are off; it rejects on SMTP errors. */
export function createNotifier({ env = process.env, origin, transport } = {}) {
  const config = mailConfig(env)
  if (!config) return { enabled: false, accessRequest: async () => false }
  const mailer = transport ?? nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })
  return {
    enabled: true,
    accessRequest: async request => {
      await mailer.sendMail(accessRequestMessage(request, { to: config.to, from: config.from, origin }))
      return true
    },
  }
}
