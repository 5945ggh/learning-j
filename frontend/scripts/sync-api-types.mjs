import { existsSync, readFileSync, unlinkSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const checkOnly = process.argv.includes('--check')
const root = resolve(import.meta.dirname, '..')
const input = resolve(root, '../backend/fixtures/openapi.json')
const output = resolve(root, 'src/lib/api-types.d.ts')
const temporary = `${output}.tmp-${process.pid}`
const executable = resolve(root, 'node_modules/.bin/openapi-typescript')

if (!existsSync(input)) {
  console.error(`OpenAPI artifact not found: ${input}`)
  process.exit(1)
}

const generated = spawnSync(executable, [input, '-o', temporary], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
})

if (generated.status !== 0) {
  if (existsSync(temporary)) unlinkSync(temporary)
  process.exit(generated.status ?? 1)
}

if (checkOnly) {
  const current = existsSync(output) ? readFileSync(output, 'utf8') : null
  const next = readFileSync(temporary, 'utf8')
  unlinkSync(temporary)
  if (current !== next) {
    console.error(`Generated API types drifted from ${input}; run pnpm types:sync`)
    process.exit(1)
  }
  console.log('Generated API types are in sync with backend/fixtures/openapi.json')
  process.exit(0)
}

renameSync(temporary, output)
console.log(`Generated ${output}`)
