// Emulator-only endpoint; staging uses the shared command protocol independently.
import { createCommandAccount } from '../shared/trusted-account.js'
export function createTrustedAccount(options) {
  return createCommandAccount({ ...options, endpoint: '/__trusted/mutate' })
}
