export const emptyData = () => ({ tasksByDate: {}, currentListIdsByDate: {}, savedLists: [], finishedDays: [] })

export function projectAccount(view) {
  const data = emptyData()
  for (const [path, { metadata, tasks }] of Object.entries(view.aggregates)) {
    if (path.startsWith('days/')) {
      data.tasksByDate[metadata.dateKey] = tasks
      if (metadata.currentListId) data.currentListIdsByDate[metadata.dateKey] = metadata.currentListId
    } else if (path.startsWith('savedLists/')) data.savedLists.push({ ...metadata, tasks })
    else if (path.startsWith('finishedDays/')) data.finishedDays.push({ ...metadata, tasks })
  }
  for (const records of [data.savedLists, data.finishedDays]) records.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return data
}

function errorState(error) {
  if (error.code === 'taskly/uncertain') return ['uncertain', error.message]
  if (error.code === 'taskly/conflict') return ['conflict', 'Conflict detected. Reload account data before trying again.']
  if (error.code === 'taskly/uninitialized') return ['uninitialized', 'Operator initialization of a fresh synthetic account is required.']
  if (['unavailable', 'deadline-exceeded', 'auth/network-request-failed'].includes(error.code)
    || /offline|client is offline/i.test(error.message)) return ['offline', 'Offline or unavailable. Reconnect to the emulators, then reload account data.']
  if (/limit|exceeds|bounded/i.test(error.message)) return ['failed', 'Account or operation size limit reached. No partial operation will be attempted.']
  return ['failed', 'Save failed or account data is unavailable. Reload to check the server before trying again.']
}

// UI-independent session coordinator. No storage or SDK dependencies; injected
// account factory and guest callbacks never receive one another's state.
export function createIsolatedController({ session, createAccount, readGuest, writeGuest }) {
  let state = { kind: 'blocked', uid: null, phase: 'loading', revision: null, data: emptyData(), theme: 'plum', epoch: 0, message: 'Waiting for test Auth…' }
  let account
  let key
  let disposed = false
  const listeners = new Set()
  const publish = (patch) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener(state) }
  const current = (epoch) => !disposed && state.epoch === epoch
  function fail(error, epoch, committed = false) {
    if (!current(epoch)) return
    const [phase, message] = errorState(error)
    publish({ phase, message: committed ? 'Write was confirmed, but the view could not reload. Reload account data; do not repeat the write.' : message })
  }
  async function load(epoch, successMessage = '') {
    const source = account
    const [view, theme] = await Promise.all([source.loadAccount(), source.loadTheme()])
    if (!current(epoch)) return false
    publish({ data: projectAccount(view), revision: view.revision, theme: theme ?? 'plum',
      phase: successMessage ? 'saved' : 'ready', message: successMessage || 'Account loaded from the Firestore emulator.' })
    return true
  }
  const stop = session.subscribe((identity) => {
    const nextKey = `${identity.phase}:${identity.user?.uid ?? ''}:${Boolean(identity.pending)}`
    if (key === nextKey) return
    key = nextKey
    account?.dispose()
    account = null
    const epoch = state.epoch + 1
    // Clear synchronously before awaiting a factory, reads, or the Auth observer.
    publish({ kind: 'blocked', uid: null, epoch, phase: 'loading', data: emptyData(), revision: null,
      theme: 'plum', message: 'Waiting for test Auth…' })
    if (identity.pending || identity.phase === 'loading') return
    if (identity.phase === 'guest') {
      try {
        const guest = readGuest()
        publish({ kind: 'guest', phase: 'ready', data: guest.data, theme: guest.theme ?? 'plum', message: 'Guest workspace on this browser.' })
      } catch (error) { fail(error, epoch) }
      return
    }
    if (identity.phase !== 'authenticated') {
      publish({ phase: 'offline', message: 'Test Auth unavailable. Start the local emulators and reload.' })
      return
    }
    const uid = identity.user.uid
    publish({ kind: 'account', uid, phase: 'loading', message: 'Loading account data…' })
    void (async () => {
      let created
      try {
        created = await createAccount(uid)
        if (!current(epoch)) { created.dispose(); return }
        account = created
        await load(epoch)
      } catch (error) { fail(error, epoch) }
    })()
  })
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener) },
    async refresh() {
      if (!account || ['saving', 'loading', 'uncertain'].includes(state.phase)) return false
      const epoch = state.epoch
      publish({ phase: 'loading', message: 'Loading account data…' })
      try { return await load(epoch) } catch (error) { fail(error, epoch); return false }
    },
    async retryPending() {
      if (!account?.hasPending?.() || state.phase !== 'uncertain') return false
      const epoch = state.epoch
      publish({ phase: 'saving', message: 'Retrying the identical trusted command…' })
      let committed = false
      try {
        const result = await account.retryPending()
        if (!current(epoch)) return false
        if (result?.confirmed !== true) throw new Error('No server confirmation received.')
        committed = true
        return await load(epoch, 'Saved — confirmed by trusted service.')
      } catch (error) { fail(error, epoch, committed); return false }
    },
    async initialize() {
      if (!account || state.phase !== 'uninitialized') return false
      const epoch = state.epoch
      publish({ phase: 'saving', message: 'Initializing empty emulator account…' })
      try {
        await account.initializeEmptyAccount({ confirmedEmpty: true })
        return await load(epoch, 'Empty account confirmed by Firestore.')
      } catch (error) { fail(error, epoch); return false }
    },
    async mutate(operation, expectedEpoch = state.epoch) {
      if (!current(expectedEpoch) || state.kind !== 'account' || !['ready', 'saved'].includes(state.phase)) return false
      const source = account
      const revision = state.revision // Captured from displayed data, never refreshed to force a write.
      publish({ phase: 'saving', message: 'Saving changes…' })
      let committed = false
      try {
        const result = await operation(source, revision)
        if (!current(expectedEpoch)) return false
        if (result?.confirmed !== true) throw new Error('No server confirmation received.')
        committed = true
        return await load(expectedEpoch, 'Saved — confirmed by Firestore.')
      } catch (error) { fail(error, expectedEpoch, committed); return false }
    },
    saveGuest(data, fields, theme, expectedEpoch = state.epoch) {
      if (!current(expectedEpoch) || state.kind !== 'guest') return false
      try {
        writeGuest(data, fields, theme)
        publish({ data, ...(theme ? { theme } : {}) })
        return true
      } catch (error) { fail(error, expectedEpoch); return false }
    },
    dispose() { disposed = true; stop(); account?.dispose(); listeners.clear() },
  }
}
