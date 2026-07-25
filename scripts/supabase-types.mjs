import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRef = 'crfhiumxzmaszkapanrb'
const targetPath = fileURLToPath(new URL('../src/supabase/database.types.ts', import.meta.url))
const checkOnly = process.argv.includes('--check')
const accessToken = process.env.SUPABASE_ACCESS_TOKEN

if (!accessToken) {
  console.error(
    'SUPABASE_ACCESS_TOKEN is required. The type script will not read credentials from macOS Keychain.',
  )
  process.exit(1)
}

const workingDirectory = mkdtempSync(join(tmpdir(), 'hamster-supabase-types-'))
let result

try {
  result = spawnSync(
    'supabase',
    ['gen', 'types', 'typescript', '--project-id', projectRef, '--schema', 'public'],
    {
      cwd: workingDirectory,
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
} finally {
  rmSync(workingDirectory, { recursive: true, force: true })
}

if (result.error) {
  console.error(`Failed to run Supabase CLI: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

if (!result.stdout.trim()) {
  console.error('Supabase CLI returned an empty type definition.')
  process.exit(1)
}

const generated = result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`

if (checkOnly) {
  const current = readFileSync(targetPath, 'utf8')

  if (current !== generated) {
    console.error('Database types are stale. Run `npm run db:types:generate` and commit the result.')
    process.exit(1)
  }

  console.log('Database types match the production public schema.')
  process.exit(0)
}

writeFileSync(targetPath, generated)
console.log(`Generated database types from project ${projectRef}.`)
