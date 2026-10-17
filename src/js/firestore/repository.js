import { validId, describeDocument, validateCollection, validateDocument, validateTransition } from './schema.js'

// Explicitly bound to one authenticated session; never reused after sign-out or
// account switching. No local repository or guest-data fallback is accepted.
export function createFirestoreRepository({ uid, session, transport }) {
  if (!validId(uid)) throw new Error('A valid account UID is required.')
  let active = true
  let stopSession = () => {}
  const subscriptions = new Set()
  const matches = () => {
    const state = session.getState()
    return state.phase === 'authenticated' && state.user?.uid === uid && !state.pending
  }
  function assertActive() {
    if (!active || !matches()) throw new Error('The authenticated account session has changed or is not ready.')
  }
  assertActive()
  function invalidate() {
    active = false
    for (const stop of [...subscriptions]) stop()
    stopSession()
  }
  stopSession = session.subscribe(() => { if (!matches()) invalidate() })
  if (!active) stopSession()
  const documentPath = (path) => {
    describeDocument(path)
    return `users/${uid}${path ? `/${path}` : ''}`
  }
  async function atomic(paths, plan, { cascade = false } = {}) {
    assertActive()
    if (!transport.transact) throw new Error('Server transactions are required for account writes.')
    const unique = [...new Set(paths)]
    unique.forEach(documentPath)
    // Bounded, all-or-nothing operations; never split snapshots into partial batches.
    if (unique.length > 400) throw new Error('Operation exceeds the safe transaction limit.')
    await transport.transact(unique.map(documentPath), (values) => {
      assertActive()
      const previous = Object.fromEntries(unique.map((path, i) => [path,
        values[i] === null ? null : validateDocument(uid, path, values[i])]))
      const changes = plan(structuredClone(previous))
      if (!Array.isArray(changes)) throw new Error('Expected a synchronous transaction plan.')
      const seen = new Set()
      return changes.map(({ path, data }) => {
        if (!unique.includes(path) || seen.has(path)) throw new Error('Unplanned or duplicate transaction path.')
        seen.add(path)
        if (data === null) {
          if (describeDocument(path).kind === 'lifecycle') throw new Error('Lifecycle history cannot be deleted.')
          if (!cascade) assertLeaf(path)
          else if (['day', 'savedList', 'finishedDay'].includes(describeDocument(path).kind)) {
            const manifest = previous['lifecycle/state']
            const nextManifest = changes.find((item) => item.path === 'lifecycle/state')?.data
            const ids = manifest?.parents[path]
            if (!ids || !nextManifest || Object.hasOwn(nextManifest.parents, path)
              || ids.some((id) => !changes.some((item) => item.path === `${path}/tasks/${id}` && item.data === null))) {
              throw new Error('Cascade must remove all manifest children and parent membership atomically.')
            }
          } else if (describeDocument(path).kind === 'user') assertLeaf(path)
        }
        else validateTransition(uid, path, previous[path], data)
        return { path: documentPath(path), data: structuredClone(data) }
      })
    })
    assertActive()
    return { confirmed: true }
  }
  function assertLeaf(path) {
    if (['user', 'day', 'savedList', 'finishedDay'].includes(describeDocument(path).kind)) {
      throw new Error('Parent deletion is disabled: nested tasks and references require coordinated cleanup.')
    }
  }
  return {
    uid,
    assertActive,
    atomic,
    async list(path) {
      assertActive()
      validateCollection(path)
      const records = await transport.list(`users/${uid}/${path}`)
      assertActive()
      return records.map(({ id, data }) => ({ id, data: validateDocument(uid, `${path}/${id}`, data) }))
    },
    async read(path) {
      assertActive()
      const data = await transport.read(documentPath(path))
      assertActive()
      return data === null ? null : validateDocument(uid, path, data)
    },
    async write(path, data) {
      assertActive()
      // Detach caller state before handing it to an asynchronous transport.
      const copy = structuredClone(validateDocument(uid, path, data))
      return atomic([path], () => [{ path, data: copy }])
    },
    async remove(path) {
      assertActive()
      assertLeaf(path)
      return atomic([path], () => [{ path, data: null }])
    },
    subscribe(path, onData, onError = () => {}) {
      assertActive()
      validateCollection(path)
      let stopped = false
      const unsubscribe = transport.subscribe(`users/${uid}/${path}`, (records) => {
        if (stopped || !active || !matches()) return
        try {
          const checked = records.map(({ id, data }) => ({ id, data: validateDocument(uid, `${path}/${id}`, data) }))
          onData(checked)
        } catch (error) { onError(error) }
      }, (error) => { if (!stopped && active && matches()) onError(error) })
      const stop = () => {
        if (stopped) return
        stopped = true
        subscriptions.delete(stop)
        unsubscribe()
      }
      subscriptions.add(stop)
      if (!active) stop()
      return stop
    },
    dispose() {
      invalidate()
      stopSession()
    },
  }
}
