// Release step: apply pending migrations, then exit. Pair with MIGRATE_ON_START=false on the API and workers.
import pg from 'pg'
import { migrate } from './migrate.mjs'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const { Pool } = process.env.DATABASE_DRIVER === 'neon' ? await import('@neondatabase/serverless') : pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
try { await migrate(pool); console.log('Migrations applied.') } finally { await pool.end() }
