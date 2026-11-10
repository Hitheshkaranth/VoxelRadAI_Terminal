// Builds a static authenticated frontend with same-origin external API rewrites.
// Output is isolated from source, test fixtures and local credentials.
import { spawnSync } from 'node:child_process'
import { mkdir, cp, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const backendInput = process.env.VOXELRAD_BACKEND_ORIGIN
if (!backendInput) throw new Error('Set VOXELRAD_BACKEND_ORIGIN to your deployed HTTPS API origin. Authenticated deployment cannot proceed without it.')
const backend = new URL(backendInput)
if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/' || ['localhost','127.0.0.1','voxelradai.com','www.voxelradai.com'].includes(backend.hostname)) throw new Error('Backend must be a distinct HTTPS origin without credentials, path, query or fragment.')
const health = await fetch(new URL('/healthz', backend), { redirect: 'error', signal: AbortSignal.timeout(15000) })
if (!health.ok || (await health.json()).status !== 'ok') throw new Error('Backend readiness check failed.')
const session = await fetch(new URL('/api/session', backend), { redirect: 'error', signal: AbortSignal.timeout(15000) })
if (!session.ok || (await session.json()).user !== null) throw new Error('Backend must expose an anonymous session check without granting access.')
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run','build'], { cwd: path.join(root,'app'), env: { ...process.env, VITE_SERVER_MODE: 'true' }, stdio: 'inherit', shell: process.platform === 'win32' })
if (result.status !== 0) throw new Error('Authenticated build failed.')
const output = path.join(root,'.tmp',`voxelradai-deploy-${Date.now()}`)
await mkdir(output, { recursive: true })
await cp(path.join(root,'app','dist'), output, { recursive: true })
await writeFile(path.join(output,'vercel.json'), JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null,
  headers: [{ source: '/(.*)', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ] }],
  rewrites: [
    ...['api','lmstudio','txrv','maira'].map(route => ({ source: `/${route}/:path*`, destination: `${backend.origin}/${route}/:path*` })),
  ],
}, null, 2))
console.log(`Authenticated Vercel deployment directory: ${output}`)
console.log('Deploy this directory with: npx vercel --prod --yes --name voxelradai')
