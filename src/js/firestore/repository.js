import { validId, describeDocument, validateCollection, validateDocument } from './schema.js'

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
  return {
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
      await transport.write(documentPath(path), copy)
      assertActive()
    },
    async remove(path) {
      assertActive()
      await transport.remove(documentPath(path))
      assertActive()
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
