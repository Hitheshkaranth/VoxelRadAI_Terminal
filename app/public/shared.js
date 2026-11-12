// Share links carry their token in the URL fragment (#…), which browsers never send to the server,
// so it cannot appear in request logs. The token goes to the API in a POST body instead.
const status = document.getElementById('status')
const frame = document.getElementById('report')
const token = location.hash.slice(1)
const fail = (message) => { status.textContent = message; frame.hidden = true }
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail('This share link is incomplete. Copy the full link, including everything after “#”.')
else {
  fetch('/api/shared', { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
    .then(async (response) => {
      const data = (response.headers.get('content-type') || '').includes('json') ? await response.json().catch(() => ({})) : {}
      if (!response.ok || typeof data.html !== 'string') throw new Error(typeof data.error === 'string' ? data.error : 'This share link is unavailable or expired.')
      // The snapshot renders in a fully sandboxed frame: no scripts, no same-origin access, its own strict CSP.
      frame.srcdoc = data.html
      frame.hidden = false
      status.hidden = true
    })
    .catch((error) => fail(error instanceof Error ? error.message : 'This share link is unavailable or expired.'))
}
// Pasting a different link into the same tab only changes the fragment; reload so it is read.
addEventListener('hashchange', () => location.reload())
