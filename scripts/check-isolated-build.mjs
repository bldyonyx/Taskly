import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve(process.argv[2] ?? 'dist')
let count = 0
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) await scan(file)
    else if (/\.(js|html|css)$/.test(entry.name)) {
      const content = await readFile(file, 'utf8')
      assert.doesNotMatch(content, /__trusted\/mutate|Retry identical command|demo-taskly-(?:isolated|trusted)|firebase-admin|tools\/trusted|emulator-only-key|ISOLATED TEST|src\/isolated|127\.0\.0\.1:(?:8085|8087|9100|8787)|TASKLY_STAGING_|taskly-staging|src\/staging|Staging runtime and writes/,
        `Isolated runtime leaked into production artifact ${file}`)
      count++
    }
  }
}
await scan(directory)
assert.ok(count > 0)
console.log(`PASS ${count} production artifacts contain no isolated cloud entry, demo credentials, or emulator endpoints.`)
