export const PRODUCTION_PROJECT = 'taskly-maya'

export function assertProductionConfig(config) {
  if (!config || config.projectId !== PRODUCTION_PROJECT
    || config.authDomain !== `${PRODUCTION_PROJECT}.firebaseapp.com`
    || !config.apiKey || !/^1:\d+:web:[a-zA-Z0-9]+$/.test(config.appId ?? '')) {
    throw new Error('Production Authentication requires a consistent production Firebase web configuration.')
  }
  return config
}

// Development is guest-only unless production Auth is deliberately requested.
// Production builds retain the existing optional Authentication behavior.
export function selectNormalAuthConfig(env, readConfig) {
  if (!['development', 'production', 'github', 'cloud-test'].includes(env.MODE)) {
    throw new Error('Unsupported Taskly application mode.')
  }
  if (env.MODE === 'cloud-test') return null
  if (env.DEV && env.VITE_ALLOW_PRODUCTION_AUTH !== 'true') return null
  if (env.DEV && env.VITE_FIREBASE_ENV !== 'production') {
    throw new Error('Local production Auth requires explicit production environment identity.')
  }
  if (env.VITE_FIREBASE_ENV && env.VITE_FIREBASE_ENV !== 'production') {
    throw new Error('Normal entry accepts only production Authentication identity.')
  }
  const config = readConfig(env)
  return config ? assertProductionConfig(config) : null
}
