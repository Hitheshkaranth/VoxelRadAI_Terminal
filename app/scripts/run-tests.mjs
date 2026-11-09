import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
for (const file of readdirSync(new URL('.', import.meta.url)).filter(name => /^test-.*\.ts$/.test(name)).sort()) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL(file, import.meta.url))], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
