import { validId, describeDocument, validateCollection, validateDocument } from '../js/firestore/schema.js'

// Separate approval from the HTTPS mutation pilot. Environment flags cannot open it.
export const APPROVED_READ_ONLY_STAGING = null
export function readOnlyShape(env) {
  const projectId = env.TASKLY_STAGING_PROJECT_ID
  if (env.TASKLY_STAGING_ENV !== 'staging' || typeof projectId !== 'string'
    || projectId === 'taskly-maya' || projectId.startsWith('demo-')
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
    || env.TASKLY_STAGING_AUTH_DOMAIN !== `${projectId}.firebaseapp.com`
    || !/^AIza[\w-]{35}$/.test(env.TASKLY_STAGING_API_KEY ?? '')
    || !/^1:\d+:web:[a-zA-Z0-9]+$/.test(env.TASKLY_STAGING_APP_ID ?? '')) throw new Error('Dedicated staging web configuration required.')
  const origin = new URL(env.TASKLY_STAGING_ORIGIN)
  if (origin.protocol !== 'https:' || origin.href !== `${origin.origin}/` || origin.username || origin.password
    || origin.port || origin.hostname.includes('taskly-maya')) throw new Error('Dedicated HTTPS staging origin required.')
  return Object.freeze({ projectId, authDomain: env.TASKLY_STAGING_AUTH_DOMAIN,
    apiKey: env.TASKLY_STAGING_API_KEY, appId: env.TASKLY_STAGING_APP_ID, origin: origin.origin })
}
export function assertReadOnlyActivation(env, location) {
  const config = readOnlyShape(env)
  if (!APPROVED_READ_ONLY_STAGING || Object.keys(config).some(key => config[key] !== APPROVED_READ_ONLY_STAGING[key])
    || location.origin !== config.origin) throw new Error('Read-only staging remains dormant pending source approval and separate packaging review.')
  return config
}

// No write-capable transport is accepted or exposed. All paths derive from Auth UID.
export function createReadOnlyReader({ uid, currentUid, read, list }) {
  if (!validId(uid)) throw new Error('Invalid UID.')
  let disposed = false
  const check = () => { if (disposed || currentUid() !== uid) throw new Error('Staging session changed.') }
  const allowed = path => {
    if (path.split('/').includes('imports')) throw new Error('Unsupported staging path.')
    return path
  }
  return Object.freeze({
    async read(path) {
      check(); describeDocument(allowed(path))
      const data = await read(`users/${uid}${path ? `/${path}` : ''}`)
      check(); return data === null ? null : validateDocument(uid, path, data)
    },
    async list(path) {
      check(); validateCollection(allowed(path))
      const rows = await list(`users/${uid}/${path}`)
      check()
      return rows.map(({ id, data }) => ({ id, data: validateDocument(uid, `${path}/${id}`, data) }))
    },
    dispose() { disposed = true },
  })
}
