export const ISOLATED_PROJECT = 'demo-taskly-trusted'
export const ISOLATED_AUTH_PORT = 9100
export const ISOLATED_FIRESTORE_PORT = 8087

export const ISOLATED_CONFIG = Object.freeze({
  environment: 'emulator', projectId: ISOLATED_PROJECT,
  authHost: '127.0.0.1', authPort: ISOLATED_AUTH_PORT,
  firestoreHost: '127.0.0.1', firestorePort: ISOLATED_FIRESTORE_PORT,
})

export function assertEmulatorConfig(config) {
  if (!config || Object.entries(ISOLATED_CONFIG).some(([key, value]) => config[key] !== value)) {
    throw new Error('Missing or invalid loopback emulator configuration; real Firebase fallback is forbidden.')
  }
  return config
}

export function assertSyntheticEmail(email) {
  if (typeof email !== 'string' || !/^[^\s@]+@example\.test$/i.test(email)) {
    throw new Error('Emulator accounts must use synthetic @example.test addresses.')
  }
  return email
}

export function assertIsolatedRuntime({ enabled, dev, mode, hostname }) {
  if (enabled !== true || dev !== true || mode !== 'cloud-test'
    || !['127.0.0.1', 'localhost'].includes(hostname)) {
    throw new Error('Isolated cloud testing requires the explicit loopback development server.')
  }
}
