// Dormant entry: Vite rejects staging modes and normal builds exclude this tree.
import { createReadOnlyRuntime } from './read-only-runtime.js'
const root = document.createElement('main')
document.body.replaceChildren(root)
root.innerHTML = `<h1>Taskly synthetic staging — READ ONLY</h1>
<p>No synchronization, guest import, initialization or account mutations.</p>
<form><label>Email <input name="email" type="email" required></label>
<label>Password <input name="password" type="password" required></label><button>Sign in</button></form>
<button id="logout" disabled>Sign out</button><button id="reload" disabled>Read synthetic days</button>
<fieldset disabled><legend>Unavailable in read-only staging</legend><button>Create / edit / delete tasks</button><button>Finish day</button><button>Save list</button><button>Import guest data</button><button>Change theme</button></fieldset>
<p role="status"></p><pre></pre>`
const status = root.querySelector('[role=status]'), output = root.querySelector('pre')
let epoch = 0, reader
try {
  const runtime = await createReadOnlyRuntime(import.meta.env, window.location)
  runtime.subscribe(user => {
    epoch++; reader?.dispose(); reader = null; output.textContent = ''
    root.querySelector('#reload').disabled = root.querySelector('#logout').disabled = !user
    status.textContent = user ? 'Authenticated. Reads require current UID admission.' : 'Signed out.'
    if (user) reader = runtime.reader()
  })
  root.querySelector('form').onsubmit = async event => {
    event.preventDefault()
    const form = event.currentTarget
    try { await runtime.login(form.elements.email.value, form.elements.password.value) }
    catch { status.textContent = 'Sign-in failed.' }
    finally { form.elements.password.value = '' }
  }
  root.querySelector('#logout').onclick = () => {
    epoch++; reader?.dispose(); reader = null; output.textContent = ''
    void runtime.logout().catch(() => { status.textContent = 'Sign-out failed; reload this isolated page.' })
  }
  root.querySelector('#reload').onclick = async () => {
    const ticket = ++epoch
    output.textContent = ''; status.textContent = 'Reading…'
    try {
      const rows = await reader.list('days')
      if (ticket === epoch) { output.textContent = JSON.stringify(rows, null, 2); status.textContent = 'Server read complete. No writes available.' }
    } catch { if (ticket === epoch) status.textContent = 'Read denied or unavailable. Check admission and connection.' }
  }
} catch (error) {
  root.querySelectorAll('button, input').forEach(element => { element.disabled = true })
  status.textContent = error.message
}
