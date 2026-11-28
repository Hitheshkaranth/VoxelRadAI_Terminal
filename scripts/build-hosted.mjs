import { spawnSync } from 'node:child_process'
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: new URL('../app', import.meta.url), stdio: 'inherit', shell: process.platform === 'win32',
  // The hosted site reads through the Hugging Face Space, which serves only skanda-v1.
  env: { ...process.env, VITE_SERVER_MODE: 'true', VITE_STUDY_LIMIT_MB: '4', VITE_MODEL_ID: process.env.VITE_MODEL_ID || 'skanda-v1' },
})
process.exit(result.status ?? 1)
