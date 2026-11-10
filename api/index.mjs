import { handler } from '../server/src/index.mjs'

export default async function api(req, res) {
  const url = new URL(req.url, 'https://voxelradai.com')
  const route = url.searchParams.get('__route')
  if (route !== null) {
    if (!/^[a-zA-Z0-9/_-]*$/.test(route)) { res.statusCode = 400; res.end('Invalid route'); return }
    url.pathname = route === 'healthz' ? '/healthz' : `/api/${route}`
    url.searchParams.delete('__route')
    req.url = url.pathname + url.search
  }
  await handler(req, res)
}
