// Email through an SMTP mailbox (Google Workspace by default): early-access and sign-up notices to the team, and
// sign-up confirmation and approval emails to users. Off unless SMTP_USER, SMTP_PASS and ACCESS_NOTIFY_TO are all set.
// Sending runs after the record is stored, so a mail failure never loses a request or an account.
import nodemailer from 'nodemailer'
import { emailHtml } from './emailTemplate.mjs'

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

/** Notification for one stored access request: plain text plus the branded HTML; every submitted field is escaped. */
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
    html: emailHtml({
      origin,
      preheader: `${name} from ${organization} asked for early access.`,
      heading: 'New early-access request',
      paragraphs: ['Someone asked for access to RadGenis. Reply to this email to answer them directly.'],
      rows: [['Name', name], ['Email', request.email], ['Organization', organization], ['Role', oneLine(request.role, 80) || 'Not given'], ['Use case', String(request.useCase ?? '').slice(0, 1000)]],
      button: { label: 'Review in RadGenis', href: `${origin}/workspace` },
    }),
  }
}

/** Confirmation link for a password sign-up. The token travels in the fragment, so link scanners never consume it. */
export function signupVerificationMessage(user, token, { from, origin }) {
  const name = oneLine(user.name, 120)
  return {
    from,
    to: user.email,
    subject: 'Confirm your email for RadGenis',
    text: [
      `Hello ${name || 'there'},`,
      '',
      'Confirm your email address to finish creating your RadGenis account:',
      `${origin}/workspace#verify=${token}`,
      '',
      'The link works once and expires in 24 hours. After you confirm, an administrator reviews the account and we email you when it is approved.',
      '',
      'If you did not sign up, ignore this email and no account will be activated.',
    ].join('\n'),
    html: emailHtml({
      origin,
      preheader: 'Confirm your email address to finish creating your RadGenis account.',
      heading: 'Confirm your email',
      paragraphs: [`Hello ${name || 'there'},`, 'Confirm your email address to finish creating your RadGenis account. After you confirm, an administrator reviews the account and we email you when it is approved.'],
      button: { label: 'Confirm email', href: `${origin}/workspace#verify=${token}` },
      footnote: 'This link works once and expires in 24 hours. If you did not sign up, you can ignore this email and no account will be activated.',
    }),
  }
}

/** Notice to the team that a confirmed sign-up is waiting for approval. */
export function signupPendingMessage(user, { to, from, origin }) {
  const name = oneLine(user.name, 120)
  return {
    from,
    to,
    replyTo: { name, address: user.email },
    subject: `New sign-up awaiting approval: ${name || user.email}${user.organization ? ` (${oneLine(user.organization, 160)})` : ''}`,
    text: [
      'A new RadGenis account is waiting for your approval.',
      '',
      `Name:         ${name || '(not given)'}`,
      `Email:        ${user.email}`,
      `Organization: ${oneLine(user.organization, 160) || '(not given)'}`,
      `Role:         ${oneLine(user.role, 80) || '(not given)'}`,
      `Signed up:    ${user.source === 'google' ? 'with Google' : 'with email and password (email confirmed)'}`,
      '',
      `Approve or disable it in Administration → Users: ${origin}/workspace`,
    ].join('\n'),
    html: emailHtml({
      origin,
      preheader: `${name || user.email} is waiting for approval.`,
      heading: 'New sign-up awaiting approval',
      paragraphs: ['A new RadGenis account is waiting for your approval. Approve it, or disable it to decline, in Administration → Users.'],
      rows: [['Name', name || 'Not given'], ['Email', user.email], ['Organization', oneLine(user.organization, 160) || 'Not given'], ['Role', oneLine(user.role, 80) || 'Not given'], ['Signed up', user.source === 'google' ? 'With Google' : 'With email and password (email confirmed)']],
      button: { label: 'Review sign-up', href: `${origin}/workspace` },
    }),
  }
}

/** Tells a user their account was approved. */
export function signupApprovedMessage(user, { from, origin }) {
  return {
    from,
    to: user.email,
    subject: 'Your RadGenis account is approved',
    text: [
      `Hello ${oneLine(user.name, 120) || 'there'},`,
      '',
      'Your RadGenis account has been approved. Sign in here:',
      `${origin}/workspace`,
      '',
      'RadGenis is research and review-support software, not a medical device. Findings are drafts for clinician review.',
    ].join('\n'),
    html: emailHtml({
      origin,
      preheader: 'Your RadGenis account has been approved.',
      heading: 'Your account is approved',
      paragraphs: [`Hello ${oneLine(user.name, 120) || 'there'},`, 'An administrator approved your RadGenis account. You can sign in and open the reading workspace now.'],
      button: { label: 'Open RadGenis', href: `${origin}/workspace` },
    }),
  }
}

/** Each method resolves true when sent, false when email is off; it rejects on SMTP errors. */
export function createNotifier({ env = process.env, origin, transport } = {}) {
  const config = mailConfig(env)
  if (!config) return { enabled: false, accessRequest: async () => false, signupVerification: async () => false, signupPending: async () => false, signupApproved: async () => false }
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
  const deliver = async message => { await mailer.sendMail(message); return true }
  return {
    enabled: true,
    accessRequest: request => deliver(accessRequestMessage(request, { to: config.to, from: config.from, origin })),
    signupVerification: (user, token) => deliver(signupVerificationMessage(user, token, { from: config.from, origin })),
    signupPending: user => deliver(signupPendingMessage(user, { to: config.to, from: config.from, origin })),
    signupApproved: user => deliver(signupApprovedMessage(user, { from: config.from, origin })),
  }
}
