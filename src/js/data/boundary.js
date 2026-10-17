// This source-level gate cannot be enabled by URL, localStorage or Vite env vars.
// Activation requires a reviewed code change in a later phase.
export const CLOUD_SYNC_ENABLED = false

export function createDataBoundary({ session, guestRepository }) {
  let context
  let generation = 0
  const listeners = new Set()
  const stop = session.subscribe((state) => {
    const uid = state.phase === 'authenticated' && !state.pending ? state.user?.uid : null
    const kind = uid ? 'account-disabled' : state.phase === 'guest' || state.phase === 'unavailable' ? 'guest' : 'blocked'
    if (context?.kind === kind && context.uid === uid) return
    // Account contexts deliberately contain no guest repository or task state.
    context = Object.freeze({ kind, uid, generation: ++generation,
      repository: kind === 'guest' ? guestRepository : null, cloudEnabled: CLOUD_SYNC_ENABLED })
    for (const listener of listeners) listener(context)
  })
  return Object.freeze({
    getContext: () => context,
    requireRepository() {
      if (!context.repository) throw new Error('Account data is unavailable while cloud synchronization is disabled.')
      return context.repository
    },
    subscribe(listener) { listeners.add(listener); listener(context); return () => listeners.delete(listener) },
    dispose() { stop(); listeners.clear() },
  })
}
