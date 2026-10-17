export function readFirebaseConfig(env = {}) {
  const fields = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }
  if (Object.values(fields).some((value) => typeof value !== 'string' || !value.trim())) return null
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]))
}
