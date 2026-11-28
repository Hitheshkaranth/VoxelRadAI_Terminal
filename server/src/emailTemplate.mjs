// Branded HTML for RadGenis emails: a centred white card with the RadGenis mark, one heading, short paragraphs,
// an optional black button with its link spelled out underneath, optional detail rows and a quiet footer.
// Table layout and inline styles only, so it renders in Gmail, Outlook and Apple Mail. Every value is escaped.

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"

/**
 * @param {object} o
 * @param {string} o.origin       site origin, for the logo and footer links
 * @param {string} o.preheader    inbox preview line (hidden in the body)
 * @param {string} o.heading
 * @param {string[]} o.paragraphs plain text, escaped here
 * @param {{label: string, href: string}} [o.button]
 * @param {[string, string][]} [o.rows] label/value pairs shown as a small table
 * @param {string} [o.footnote]   small grey text under the button
 */
export function emailHtml({ origin, preheader, heading, paragraphs = [], button, rows = [], footnote }) {
  const p = text => `<p style="margin:0 0 16px;font:14px/24px ${FONT};color:#333333;">${esc(text)}</p>`
  const href = button ? (/^https:\/\//.test(button.href) || /^http:\/\/localhost[:/]/.test(button.href) ? button.href : `${origin}/`) : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:40px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:465px;border:1px solid #eaeaea;border-radius:8px;">
<tr><td style="padding:32px 32px 8px;" align="center">
  <img src="${esc(origin)}/email/radgenis-mark-96.png" width="48" height="48" alt="RadGenis" style="display:block;border:0;width:48px;height:48px;">
</td></tr>
<tr><td style="padding:16px 32px 8px;" align="center">
  <h1 style="margin:0;font:600 22px/32px ${FONT};color:#000000;letter-spacing:-0.01em;">${esc(heading)}</h1>
</td></tr>
<tr><td style="padding:16px 32px 0;">
  ${paragraphs.map(p).join('\n  ')}
  ${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-top:1px solid #eaeaea;">${rows.map(([label, value]) => `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #eaeaea;font:13px/20px ${FONT};color:#666666;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:8px 0;border-bottom:1px solid #eaeaea;font:13px/20px ${FONT};color:#000000;vertical-align:top;">${esc(value)}</td></tr>`).join('')}</table>` : ''}
</td></tr>
${button ? `<tr><td style="padding:8px 32px 8px;" align="center">
  <a href="${esc(href)}" style="display:inline-block;padding:12px 24px;border-radius:6px;background:#000000;color:#ffffff;font:600 14px/20px ${FONT};text-decoration:none;">${esc(button.label)}</a>
</td></tr>
<tr><td style="padding:16px 32px 0;">
  <p style="margin:0;font:12px/20px ${FONT};color:#666666;">Or copy and paste this URL into your browser:<br><a href="${esc(href)}" style="color:#0068ad;text-decoration:none;word-break:break-all;">${esc(href)}</a></p>
</td></tr>` : ''}
${footnote ? `<tr><td style="padding:16px 32px 0;"><p style="margin:0;font:12px/20px ${FONT};color:#666666;">${esc(footnote)}</p></td></tr>` : ''}
<tr><td style="padding:24px 32px 32px;">
  <hr style="border:0;border-top:1px solid #eaeaea;margin:0 0 16px;">
  <p style="margin:0;font:12px/20px ${FONT};color:#8f8f8f;">RadGenis · <a href="${esc(origin)}/" style="color:#8f8f8f;">radgenis.com</a><br>Research and review-support software, not a medical device. Findings are drafts for clinician review.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`
}
