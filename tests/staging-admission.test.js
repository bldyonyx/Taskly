import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { admissionRules } from '../scripts/staging-admission.mjs'

test('admission candidate gates every canonical owner permission without changing integrity rules', async () => {
  const source = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
  const result = admissionRules(source)
  assert.equal(result.match(/allow [^;]+owner\(uid\)/g).length, source.match(/allow [^;]+owner\(uid\)/g).length)
  assert.ok(result.includes('request.auth.uid == uid && admitted(uid)'))
  assert.ok(result.includes('request.time < get(p).data.expiresAt'))
  assert.match(result, /match \/\{document=\*\*\} \{ allow read, write: if false; \}\s*\}\s*\}\s*$/)
  assert.throws(() => admissionRules('different rules'), /owner gate changed/)
  assert.throws(() => admissionRules(source + source), /owner gate changed/)
})
