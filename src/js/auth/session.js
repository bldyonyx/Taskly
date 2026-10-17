export function authErrorMessage(error) {
  switch (error?.code) {
    case 'auth/invalid-email': return 'Please enter a valid email address.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Could not log in with those details. Check your email and password.'
    case 'auth/email-already-in-use': return 'Could not create this account. Try logging in or resetting your password.'
    case 'auth/weak-password':
    case 'auth/invalid-password':
    case 'auth/password-does-not-meet-requirements': return 'Choose a stronger password that meets this project’s password policy.'
    case 'auth/too-many-requests': return 'Too many attempts. Please wait before trying again.'
    case 'auth/network-request-failed': return 'Could not connect. Check your connection and try again.'
    case 'auth/user-disabled': return 'This account is unavailable. Please contact support.'
    case 'auth/operation-not-allowed': return 'Email/password accounts are not available right now. You can continue as a guest.'
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
    case 'auth/unauthorized-domain': return 'Accounts are not configured correctly for this site. You can continue as a guest.'
    default: return 'The account request could not be completed. Please try again. Your local tasks are unchanged.'
  }
}

// This module owns identity only. It never receives a Taskly repository, local
// task state, tokens, or an implicit guest-to-account import callback.
export function createAuthSession(loadClient) {
  let state = Object.freeze({ phase: 'loading', user: null, pending: null, error: '', notice: '' })
  let client
  let started
  let unsubscribe
  let revision = 0
  let disposed = false
  const listeners = new Set()
  const update = (patch) => {
    if (disposed) return
    state = Object.freeze({ ...state, ...patch })
    for (const listener of listeners) listener(state)
  }

  function start() {
    if (disposed) return Promise.resolve()
    if (!started) started = (async () => {
      try {
        client = await loadClient()
        if (disposed) return
        if (!client) {
          update({ phase: 'unavailable', error: 'Accounts are not configured for this build. You can keep using Taskly as a guest.' })
          return
        }
        unsubscribe = client.subscribe((user) => {
          revision++
          update({
            phase: user ? 'authenticated' : 'guest',
            user: user ? Object.freeze({ uid: user.uid, email: user.email ?? '', emailVerified: Boolean(user.emailVerified) }) : null,
            error: '', notice: '',
          })
        }, () => {
          revision++
          update({ phase: 'unavailable', user: null, error: 'Account status could not be loaded. Your local tasks are still available.' })
        })
      } catch {
        update({ phase: 'unavailable', user: null, error: 'Accounts could not be initialized. You can keep using Taskly as a guest.' })
      }
    })()
    return started
  }

  async function perform(action, { email = '', password = '' } = {}) {
    if (disposed || state.pending || !client || !['guest', 'authenticated'].includes(state.phase)) return false
    if (!['signup', 'login', 'logout', 'reset'].includes(action)) return false
    if ((action === 'logout') !== (state.phase === 'authenticated')) return false
    const currentRevision = revision
    update({ pending: action, error: '', notice: '' })
    try {
      // Identity is changed only by the Auth observer, never by an optimistic
      // operation result. Cross-tab sign-out/account switching uses the same path.
      if (action === 'logout') await client.logout()
      else if (action === 'reset') await client.reset(email.trim())
      else await client[action](email.trim(), password)
      if (action === 'reset' && revision === currentRevision) {
        update({ notice: 'If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.' })
      }
      return true
    } catch (error) {
      if (revision === currentRevision) {
        if (action === 'reset' && error?.code === 'auth/user-not-found') {
          update({ notice: 'If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.' })
        } else update({ error: authErrorMessage(error) })
      }
      return false
    } finally {
      update({ pending: null })
    }
  }

  return {
    start, perform,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      unsubscribe?.()
      listeners.clear()
    },
  }
}
