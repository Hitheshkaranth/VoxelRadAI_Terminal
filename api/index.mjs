import { handler } from '../server/src/index.mjs'
import { modelRoute } from '../server/src/modelProxy.mjs'

export default async function api(req, res) {
  const url = new URL(req.url, 'https://voxelradai.com')
  const route = url.searchParams.get('__route')
  if (route !== null) {
    if (!/^[a-zA-Z0-9/_-]*$/.test(route)) { res.statusCode = 400; res.end('Invalid route'); return }
    // /lmstudio/* goes to the ZeroGPU bridge only when it is configured; otherwise it stays unconfigured.
    const target = modelRoute(route, process.env)
    url.pathname = target === 'healthz' ? '/healthz' : target.startsWith('lmstudio/') ? `/${target}` : `/api/${target}`
    url.searchParams.delete('__route')
    req.url = url.pathname + url.search
  }
  await handler(req, res)
}
