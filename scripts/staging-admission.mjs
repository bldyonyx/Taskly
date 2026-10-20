// Local candidate only. No SDK, credentials, account creation or deployment.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ownerRule = 'function owner(uid) { return request.auth != null && request.auth.uid == uid; }'
export function admissionRules(source) {
  if (source.split(ownerRule).length !== 2) throw new Error('Canonical owner gate changed; review admission coverage.')
  return source.replace(ownerRule, `function owner(uid) {
      return request.auth != null && request.auth.uid == uid && admitted(uid);
    }
    function admitted(uid) {
      let p = /databases/$(database)/documents/stagingTesters/$(uid);
      return exists(p) && get(p).data.enabled == true
        && get(p).data.expiresAt is timestamp && request.time < get(p).data.expiresAt;
    }`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
  const directory = new URL('../.firebase/', import.meta.url)
  await mkdir(directory, { recursive: true })
  await writeFile(new URL('staging-admission.rules', directory), admissionRules(source))
  console.log('Generated local admission candidate. No deployment or remote access.')
}
