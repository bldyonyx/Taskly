import { authSession } from '../auth/index.js'

function button(text, secondary = false) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = `dialog-button${secondary ? ' is-secondary' : ''}`
  element.textContent = text
  return element
}

export function createAccountSection(session = authSession) {
  let mode = null
  let email = ''
  const section = document.createElement('section')
  section.className = 'settings-theme-section settings-account-section'
  section.setAttribute('aria-labelledby', 'settings-account-title')
  const title = document.createElement('h3')
  title.id = 'settings-account-title'
  title.className = 'settings-section-title'
  title.textContent = 'Account'
  const content = document.createElement('div')
  content.className = 'account-content'
  content.tabIndex = -1
  section.append(title, content)
  const render = (state) => {
    const hadFocus = content.contains(document.activeElement)
    const previousUser = content.dataset.uid
    content.dataset.uid = state.user?.uid ?? ''
    if (previousUser !== undefined && previousUser !== content.dataset.uid) {
      email = ''
      mode = null
    }
    content.replaceChildren()
    content.setAttribute('aria-busy', String(Boolean(state.pending) || state.phase === 'loading'))
    const status = document.createElement('p')
    status.className = 'dialog-copy'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    if (state.phase === 'loading') status.textContent = 'Checking account…'
    else if (state.pending) status.textContent = {
      login: 'Logging in…', signup: 'Creating your account…', logout: 'Logging out…', reset: 'Requesting a reset link…',
    }[state.pending]
    else status.textContent = state.notice
    status.hidden = !status.textContent
    content.append(status)
    const error = document.createElement('p')
    error.className = 'dialog-error'
    error.setAttribute('role', 'alert')
    error.textContent = state.error
    error.hidden = !state.error
    content.append(error)

    if (state.phase === 'authenticated') {
      const identity = document.createElement('p')
      identity.className = 'dialog-copy account-email'
      identity.textContent = state.user.email || 'Your Taskly account'
      const copy = document.createElement('p')
      copy.className = 'dialog-copy account-device-note'
      copy.textContent = 'Tasks are saved on this device.'
      const logout = button(state.pending === 'logout' ? 'Logging out…' : 'Log out')
      logout.disabled = Boolean(state.pending)
      logout.addEventListener('click', () => { void session.perform('logout') })
      const actions = document.createElement('div')
      actions.className = 'dialog-actions'
      actions.append(logout)
      content.append(identity, copy, actions)
    } else if (state.phase === 'guest' && !mode) {
      const welcome = document.createElement('p')
      welcome.className = 'dialog-copy'
      welcome.textContent = 'Welcome! Use Taskly as a guest, or sign in.'
      const actions = document.createElement('div')
      actions.className = 'dialog-actions'
      for (const [nextMode, label] of [['login', 'Log in'], ['signup', 'Create account']]) {
        const action = button(label, nextMode === 'signup')
        action.disabled = Boolean(state.pending)
        action.addEventListener('click', () => {
          mode = nextMode
          render({ ...session.getState(), error: '', notice: '' })
          content.querySelector('input')?.focus()
        })
        actions.append(action)
      }
      content.append(welcome, actions)
    } else if (state.phase === 'guest') {
      const form = document.createElement('form')
      form.className = 'taskly-dialog-form account-form'
      form.setAttribute('aria-label', { login: 'Log in', signup: 'Create account', reset: 'Reset password' }[mode])
      const emailLabel = document.createElement('label')
      emailLabel.htmlFor = 'account-email'
      emailLabel.textContent = 'Email'
      const emailInput = document.createElement('input')
      emailInput.id = 'account-email'
      emailInput.name = 'email'
      emailInput.type = 'email'
      emailInput.autocomplete = 'email'
      emailInput.required = true
      emailInput.value = email
      emailInput.disabled = Boolean(state.pending)
      emailInput.addEventListener('input', () => { email = emailInput.value })
      form.append(emailLabel, emailInput)
      let passwordInput
      let confirmInput
      if (mode !== 'reset') {
        const passwordLabel = document.createElement('label')
        passwordLabel.htmlFor = 'account-password'
        passwordLabel.textContent = 'Password'
        passwordInput = document.createElement('input')
        passwordInput.id = 'account-password'
        passwordInput.name = 'password'
        passwordInput.type = 'password'
        passwordInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password'
        passwordInput.required = true
        passwordInput.disabled = Boolean(state.pending)
        if (mode === 'signup') passwordInput.minLength = 6
        form.append(passwordLabel, passwordInput)
        if (mode === 'signup') {
          const confirmLabel = document.createElement('label')
          confirmLabel.htmlFor = 'account-confirm-password'
          confirmLabel.textContent = 'Confirm password'
          confirmInput = document.createElement('input')
          confirmInput.id = 'account-confirm-password'
          confirmInput.name = 'confirm-password'
          confirmInput.type = 'password'
          confirmInput.autocomplete = 'new-password'
          confirmInput.required = true
          confirmInput.disabled = Boolean(state.pending)
          form.append(confirmLabel, confirmInput)
        }
      }
      const submit = button({ login: 'Log in', signup: 'Create account', reset: 'Send reset link' }[mode])
      submit.type = 'submit'
      submit.disabled = Boolean(state.pending)
      form.append(submit)
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        if (state.pending || !form.reportValidity()) return
        if (confirmInput && confirmInput.value !== passwordInput.value) {
          error.textContent = 'The passwords do not match.'
          error.hidden = false
          confirmInput.setAttribute('aria-invalid', 'true')
          confirmInput.focus()
          return
        }
        const password = passwordInput?.value ?? ''
        email = emailInput.value
        if (passwordInput) passwordInput.value = ''
        if (confirmInput) confirmInput.value = ''
        void session.perform(mode, { email: emailInput.value, password })
      })
      const navigation = document.createElement('div')
      navigation.className = 'dialog-actions'
      for (const [nextMode, label] of [['login', 'Log in'], ['signup', 'Create account'], ['reset', 'Forgot password?'], [null, 'Back']]) {
        if (mode === nextMode) continue
        const link = button(label, true)
        link.disabled = Boolean(state.pending)
        link.addEventListener('click', () => {
          mode = nextMode
          render({ ...session.getState(), error: '', notice: '' })
          content.querySelector('input, button')?.focus()
        })
        navigation.append(link)
      }
      content.append(form, navigation)
    }
    if (hadFocus) content.focus()
  }
  const dispose = session.subscribe(render)
  return { section, dispose }
}
