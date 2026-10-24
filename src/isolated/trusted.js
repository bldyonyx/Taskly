// Browser-only adapter. No Admin imports, client UID payloads or direct writes.
export function createTrustedAccount({ reader, user, check, send = fetch, requestId = () => crypto.randomUUID() }) {
  let active = true
  let pending = null
  let view
  const controllers = new Set()
  const assertActive = () => { if (!active) throw new Error('Account session changed.'); check() }
  const tasksOnly = (tasks) => tasks.map(({ id, text, completed }) => ({ id, text, completed }))
  async function deliver() {
    assertActive()
    const abort = new AbortController()
    controllers.add(abort)
    const timeout = setTimeout(() => abort.abort(), 15000)
    try {
      const token = await user.getIdToken()
      assertActive()
      const response = await send('/__trusted/mutate', { method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(pending) })
      const result = await response.json()
      assertActive()
      if (!result.ok || result.confirmed !== true) {
        if (result.code !== 'unavailable') pending = null
        throw Object.assign(new Error(result.message ?? 'Trusted command failed.'), { code: `taskly/${result.code}` })
      }
      pending = null
      return result
    } catch (error) {
      assertActive()
      if (pending) throw Object.assign(new Error('Outcome unconfirmed. Retry the identical command before further edits. Reload abandons this in-memory retry; inspect server data before new work.'), { code: 'taskly/uncertain' })
      throw error
    } finally { clearTimeout(timeout); controllers.delete(abort) }
  }
  function command(type, payload, expectedRevision) {
    assertActive()
    if (pending) throw new Error('Resolve the pending command before editing.')
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Displayed revision required.')
    const next = { requestId: requestId(), expectedRevision, type, payload }
    if (new TextEncoder().encode(JSON.stringify(next)).length > 262144) throw new Error('Request exceeds size limit.')
    pending = next
    return deliver()
  }
  const blocked = async () => { throw new Error('Unsupported trusted workflow; operator initialization and a reviewed command are required.') }
  return {
    async loadAccount() { assertActive(); const result = await reader.loadAccount(); assertActive(); view = result; return result },
    loadTheme: () => reader.loadTheme(),
    initializeEmptyAccount: blocked, saveTheme: blocked,
    retryPending: () => pending ? deliver() : Promise.reject(new Error('No pending command.')),
    hasPending: () => pending !== null,
    replaceDatedTasks: (dateKey, tasks, currentListId, revision) => command('replaceDay', { dateKey, tasks: tasksOnly(tasks), currentListId }, revision),
    reorderTasks(dateKey, ids, revision) {
      const day = view?.aggregates[`days/${dateKey}`]
      if (view?.revision !== revision || !day || ids.length !== day.tasks.length || new Set(ids).size !== ids.length
        || !ids.every((id) => day.tasks.some((t) => t.id === id))) throw new Error('Invalid or stale reorder membership.')
      return command('replaceDay', { dateKey, tasks: tasksOnly(ids.map((id) => day.tasks.find((t) => t.id === id))), currentListId: day.metadata.currentListId }, revision)
    },
    saveListForDate: (list, dateKey, revision) => command('saveList', { dateKey, id: list.id, name: list.name }, revision),
    replaceSavedList: (list, revision) => command('saveList', { id: list.id, name: list.name, tasks: tasksOnly(list.tasks), replace: true }, revision),
    finishDay: (dateKey, input, revision) => command('finishDay', { dateKey, id: input.id }, revision),
    deleteSavedList: (id, revision) => command('deleteParent', { collection: 'savedLists', id }, revision),
    deleteFinishedDay: (id, revision) => command('deleteParent', { collection: 'finishedDays', id }, revision),
    deleteDay: (id, revision) => command('deleteParent', { collection: 'days', id }, revision),
    dispose() { active = false; pending = null; for (const abort of controllers) abort.abort(); reader.dispose() },
  }
}
