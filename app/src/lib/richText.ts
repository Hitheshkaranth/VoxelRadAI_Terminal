// Rich-text helpers for report sections. Only a small set of formatting tags survives sanitizing,
// and every attribute is dropped, so stored HTML cannot carry scripts, links, styles or images.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'BR', 'UL', 'OL', 'LI', 'H3', 'H4'])
const RENAME: Record<string, string> = { DIV: 'P', H1: 'H3', H2: 'H3', H5: 'H4', H6: 'H4' }
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'HEAD', 'TITLE', 'META', 'LINK'])

function clean(source: Node, target: Node, doc: Document) {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const tag = (child as Element).tagName.toUpperCase()
    if (DROP_WITH_CONTENT.has(tag)) continue
    const name = RENAME[tag] ?? tag
    if (ALLOWED.has(name)) {
      const el = doc.createElement(name.toLowerCase())
      clean(child, el, doc)
      target.appendChild(el)
    } else {
      // Unknown wrappers (span, font, a, …) are unwrapped: keep their text, lose the tag and attributes.
      clean(child, target, doc)
    }
  }
}

export function sanitizeReportHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = document.implementation.createHTMLDocument('')
  const root = out.createElement('div')
  clean(doc.body, root, out)
  return root.innerHTML.replace(/<p><\/p>/g, '').trim()
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Plain text (one paragraph per line) to the editor's HTML form. */
export function plainToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${line.trim() ? escapeHtml(line) : '<br>'}</p>`)
    .join('')
}

function walk(node: Node, lines: string[], current: { text: string }, list?: { ordered: boolean; n: number }) {
  const flush = () => {
    if (current.text.trim() || lines.length) lines.push(current.text.replace(/\s+$/, ''))
    current.text = ''
  }
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      current.text += (child.textContent ?? '').replace(/\s+/g, ' ')
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const tag = (child as Element).tagName
    if (tag === 'BR') { flush(); continue }
    if (tag === 'UL' || tag === 'OL') {
      if (current.text.trim()) flush()
      walk(child, lines, current, { ordered: tag === 'OL', n: 0 })
      continue
    }
    if (tag === 'LI') {
      if (current.text.trim()) flush()
      const marker = list?.ordered ? `${++list.n}. ` : '- '
      current.text = marker
      walk(child, lines, current)
      flush()
      continue
    }
    if (tag === 'P' || /^H\d$/.test(tag) || tag === 'DIV') {
      if (current.text.trim()) flush()
      walk(child, lines, current, list)
      flush()
      continue
    }
    walk(child, lines, current, list)
  }
}

/** Plain-text form of sanitized HTML: paragraphs become lines, list items get "- " or "1. ". */
export function htmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const lines: string[] = []
  const current = { text: '' }
  walk(doc.body, lines, current)
  if (current.text.trim()) lines.push(current.text.trim())
  return lines.map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** CSS string literal for @page margin boxes (escapes quotes, backslashes and line breaks). */
export function cssString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' \\A ').replace(/[<>]/g, '')}"`
}
