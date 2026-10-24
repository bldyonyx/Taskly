import { assertStagingActivation } from './config.js'
import { createCommandAccount } from '../shared/trusted-account.js'

// Dormant integration seam, no entry/import from normal UI and no Firebase init.
// Future reader must be UID-bound and reject all direct write plans. Future Auth
// UI must be login/logout only for precreated synthetic testers (no signup).
export function createStagingAccount({ env, ...options }) {
  const config = assertStagingActivation(env)
  return prepareStagingAccount({ ...options, config })
}

// Dependency-injected protocol adapter for offline local tests and future wiring.
export function prepareStagingAccount({ config, user, reader, check, onState = () => {}, send = fetch, ...options }) {
  if (user.auth?.app?.options?.projectId !== config.projectId || user.auth?.emulatorConfig
    || !config.endpoint.startsWith('https://') || config.projectId === 'taskly-maya') throw new Error('Staging Auth project mismatch.')
  const account = createCommandAccount({ ...options, reader, user, check, endpoint: config.endpoint, send })
  const report = phase => { check(); onState(phase) }
  const wraps = new Set(['replaceDatedTasks', 'reorderTasks', 'saveListForDate', 'replaceSavedList',
    'finishDay', 'deleteSavedList', 'deleteFinishedDay', 'deleteDay', 'retryPending'])
  let active = true
  for (const key of ['loadAccount', ...wraps]) {
    const original = account[key]
    account[key] = async (...args) => {
      if (!active) throw new Error('Account session changed.')
      report(key === 'loadAccount' ? 'loading' : 'saving')
      try {
        const result = await original(...args)
        if (!active) throw new Error('Account session changed.')
        check()
        if (wraps.has(key)) {
          if (result?.confirmed !== true) throw new Error('Server confirmation required.')
          await account.loadAccount() // authoritative reload before confirmed UI
        }
        report(wraps.has(key) ? 'confirmed' : 'ready')
        return result
      } catch (error) {
        if (active) report(error.code === 'taskly/conflict' ? 'conflict'
          : error.code === 'taskly/uncertain' ? 'offline' : 'error')
        throw error
      }
    }
  }
  const dispose = account.dispose
  account.dispose = () => { active = false; dispose() }
  return account
}
