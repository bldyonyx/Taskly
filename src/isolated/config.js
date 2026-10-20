export const ISOLATED_PROJECT = 'demo-taskly-isolated'
export const ISOLATED_AUTH_PORT = 9099
export const ISOLATED_FIRESTORE_PORT = 8085

export function assertIsolatedRuntime({ enabled, dev, mode, hostname }) {
  if (enabled !== true || dev !== true || mode !== 'cloud-test'
    || !['127.0.0.1', 'localhost'].includes(hostname)) {
    throw new Error('Isolated cloud testing requires the explicit loopback development server.')
  }
}
