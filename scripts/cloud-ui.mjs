import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

// Run only with the dedicated demo emulators and a disposable browser profile.
assert.equal(process.env.GCLOUD_PROJECT, 'demo-taskly-isolated')
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085')
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099')
const root = path.resolve('.firebase', `cloud-ui-${Date.now()}`)
await mkdir(root, { recursive: true })
const browserCandidates = [process.env.TASKLY_TEST_BROWSER,
  path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1234/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)
let executable
for (const candidate of browserCandidates) { try { await access(candidate); executable = candidate; break } catch {} }
assert.ok(executable, 'Set TASKLY_TEST_BROWSER to an installed Chromium/Chrome/Edge executable.')
const server = await createServer({ configFile: 'vite.config.js', mode: 'cloud-test' })
await server.listen()
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${root}`,
  '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const report = { passed: [], blockedRequests: [], errors: [] }
const clients = []
async function until(fn, message, timeout = 25000) {
  const start = Date.now()
  let value
  while (Date.now() - start < timeout) { value = await fn(); if (value) return value; await pause(80) }
  throw new Error(`Timed out: ${message}; last value=${JSON.stringify(value)}`)
}
function pass(name) { report.passed.push(name); process.stdout.write(`PASS ${name}\n`) }
async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  const handlers = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    } else handlers.get(message.method)?.(message.params)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
  })
  const api = { send, on: (event, fn) => handlers.set(event, fn), close: () => ws.close(),
    async eval(expression) {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
      return response.result.value
    },
  }
  clients.push(api)
  return api
}
let c
try {
  const port = await until(async () => {
    try { return Number((await readFile(path.join(root, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) } catch { return false }
  }, 'browser debug port')
  const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  c = await connect(target.webSocketDebuggerUrl)
  async function instrument(client) {
    await client.send('Network.enable')
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false })
    client.on('Runtime.exceptionThrown', (event) => report.errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text))
    await client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    client.on('Fetch.requestPaused', (event) => {
      const url = new URL(event.request.url)
      const allowed = ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1'
        && ['5174', '8085', '9099'].includes(url.port)
      if (!allowed && !['data:', 'blob:'].includes(url.protocol)) {
        report.blockedRequests.push(event.request.url)
        void client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })
      } else void client.send('Fetch.continueRequest', { requestId: event.requestId })
    })
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  }
  await instrument(c)
  const expr = (fn, ...args) => `(${fn.toString()})(${args.map((value) => JSON.stringify(value)).join(',')})`
  const query = (selector) => c.eval(expr((s) => Boolean(document.querySelector(s)), selector))
  const click = async (selector) => {
    await until(() => query(selector), `selector ${selector}`)
    await c.eval(expr((s) => { const el = document.querySelector(s); if (el.disabled) throw new Error(`Disabled: ${s}`); el.click() }, selector))
  }
  const textClick = async (text, scope = '.taskly-modal') => {
    await until(() => c.eval(expr((t, s) => [...document.querySelectorAll(`${s} button`)].some((el) => el.textContent.trim() === t), text, scope)), `button ${text}`)
    await c.eval(expr((t, s) => { const el = [...document.querySelectorAll(`${s} button`)].find((item) => item.textContent.trim() === t); if (el.disabled) throw new Error(`Disabled ${t}`); el.click() }, text, scope))
  }
  const fill = (selector, value) => c.eval(expr((s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }, selector, value))
  const submit = (selector) => c.eval(expr((s) => document.querySelector(s).requestSubmit(), selector))
  const phase = () => c.eval(`document.querySelector('[data-cloud-test]')?.dataset.phase`)
  const ready = () => until(async () => ['ready', 'saved'].includes(await phase()), 'ready account/guest')
  const saved = () => until(async () => (await phase()) === 'saved', 'server-confirmed saved state')
  const taskText = () => c.eval(`[...document.querySelectorAll('#task-list .task-text')].map(el=>el.textContent)`)
  const closeModal = async () => { if (await query('.taskly-modal')) { await click('[aria-label="Close dialog"]'); await until(async () => !await query('.taskly-modal'), 'modal closed') } }
  const settings = async () => { await closeModal(); await click('.settings-button') }
  async function signup(email) {
    await settings(); await textClick('Create account')
    await fill('#account-email', email); await fill('#account-password', 'isolated-password-123'); await fill('#account-confirm-password', 'isolated-password-123')
    await submit('.account-form')
    await until(async () => (await phase()) === 'uninitialized', 'new emulator account')
    assert.deepEqual(await taskText(), [])
    await click('[data-cloud-test] button:last-child'); await saved()
  }
  async function logout() { await settings(); await textClick('Log out'); await ready(); assert.equal(await c.eval(`document.querySelector('[data-cloud-test]').dataset.kind`), 'guest') }
  async function login(email) {
    await settings(); await textClick('Log in'); await fill('#account-email', email); await fill('#account-password', 'isolated-password-123')
    await submit('.account-form'); await ready()
    await until(() => c.eval(`document.querySelector('[data-cloud-test]').dataset.kind==='account'`), 'account login')
  }
  async function add(text) { await fill('#new-task', text); await submit('#task-form'); await saved() }
  const origin = 'http://127.0.0.1:5174'
  await c.send('Page.navigate', { url: origin })
  await ready()
  // Seed only disposable-profile guest data and preserve its exact raw strings.
  const guestKeys = ['taskly.tasks.v1', 'taskly.tasksByDate.v1', 'taskly.currentListByDate.v1',
    'taskly.savedLists.v1', 'taskly.currentListId.v1', 'taskly.finishedDays.v1', 'taskly.theme.v1']
  const guestValues = await c.eval(expr((keys) => {
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    localStorage.setItem('taskly.tasksByDate.v1', JSON.stringify({ [today]: [{ id: 'private-guest', text: 'Guest sentinel', completed: false }] }))
    localStorage.setItem('taskly.theme.v1', 'forest')
    return keys.map((key) => [key, localStorage.getItem(key)])
  }, guestKeys))
  await c.send('Page.reload'); await ready()
  assert.deepEqual(await taskText(), ['Guest sentinel']); pass('guest local context restored from disposable storage')
  const suffix = Date.now()
  const alice = `alice-${suffix}@example.test`; const bob = `bob-${suffix}@example.test`
  await signup(alice); pass('test Auth signup, explicit initialization, empty account with no guest migration')
  await add('First account task'); await add('Second account task'); pass('create tasks through UI with server confirmation')
  await click('#task-list .edit-task'); await fill('.task-edit-input', 'Edited account task')
  await c.eval(`document.querySelector('.task-edit-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  await saved(); assert.equal((await taskText())[0], 'Edited account task'); pass('edit task through UI')
  await click('#task-list .task-item'); await saved()
  assert.equal(await c.eval(`document.querySelector('#task-list .task-item').classList.contains('is-done')`), true); pass('complete task through UI')
  // Exercise Sortable's browser pointer path, not a direct repository call.
  const positions = await c.eval(`[...document.querySelectorAll('#task-list .task-item')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})`)
  const beforeDrag = await taskText()
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...positions[0] })
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...positions[0], button: 'left', clickCount: 1 })
  for (let i = 1; i <= 10; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: positions[0].x, y: positions[0].y + (positions[1].y - positions[0].y + 25) * i / 10, buttons: 1 })
    await pause(35)
  }
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: positions[1].x, y: positions[1].y + 25, button: 'left', clickCount: 1 })
  await until(async () => JSON.stringify(await taskText()) !== JSON.stringify(beforeDrag), 'task reorder')
  await saved(); pass('drag reorder through Sortable and revision-aware server commit')
  await click('#save-list'); await fill('#saved-list-name', 'Emulator list'); await submit('.taskly-dialog-form'); await saved(); pass('save Saved List and dated reference atomically')
  await click('#task-list .remove-task'); await until(async () => (await taskText()).length === 1, 'task deletion'); await saved(); pass('delete task through UI')
  await click('#saved-lists'); await textClick('Load list')
  await textClick('Replace current tasks'); await saved(); assert.equal((await taskText()).length, 2); pass('load Saved List through UI')
  await settings(); await click('[data-theme-option="rose"]'); await saved()
  assert.equal(await c.eval(`document.documentElement.dataset.theme`), 'rose'); pass('account theme saved without touching guest theme')
  await c.send('Page.reload'); await ready()
  assert.equal((await taskText()).length, 2); assert.equal(await c.eval(`document.documentElement.dataset.theme`), 'rose'); pass('browser refresh restores test Auth, tasks, and theme')
  await click('#finish-day'); await textClick('Finish day'); await saved()
  assert.equal(await c.eval(`document.querySelector('#new-task').disabled`), true)
  await click('#saved-lists'); await textClick('Finished days')
  assert.equal(await query('.finished-day-row'), true); await closeModal(); pass('atomic Finish Day and Finished Days UI view; archive editing blocked')
  await click('#date-card')
  await c.eval(`{const selected=document.querySelector('.calendar-day.is-selected'); const next=selected.nextElementSibling; next.click()}`)
  await closeModal(); assert.deepEqual(await taskText(), []); pass('calendar date navigation selects a separate dated task context')
  // A second browser tab shares test Auth, but keeps an independent displayed revision.
  const created = await c.send('Target.createTarget', { url: 'about:blank' })
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const other = await connect(targets.find((item) => item.id === created.targetId).webSocketDebuggerUrl)
  await instrument(other)
  await other.send('Page.navigate', { url: origin })
  await until(() => other.eval(`document.querySelector('[data-cloud-test]')?.dataset.phase==='ready'`), 'second tab account ready')
  await other.eval(`document.querySelector('.settings-button').click()`)
  await other.eval(`document.querySelector('[data-theme-option="ocean"]').click()`)
  await until(() => other.eval(`document.querySelector('[data-cloud-test]')?.dataset.phase==='saved'`), 'other tab preference confirmed')
  // Preference writes do not advance the manifest, so add a task on a separate active date.
  await other.eval(`document.querySelector('#date-card').click()`)
  await other.eval(`document.querySelector('.calendar-day.is-selected').nextElementSibling.click()`)
  await until(() => other.eval(`!document.querySelector('.taskly-modal')`), 'other tab calendar closed')
  await other.eval(`document.querySelector('#new-task').value='Concurrent task';document.querySelector('#task-form').requestSubmit()`)
  await until(() => other.eval(`document.querySelector('[data-cloud-test]')?.dataset.phase==='saved'`), 'other tab task confirmed')
  await fill('#new-task', 'Stale view task'); await submit('#task-form')
  await until(async () => (await phase()) === 'conflict', 'visible stale revision conflict')
  assert.equal(await c.eval(`document.querySelector('#new-task').disabled`), true)
  await click('[data-cloud-test] button'); await ready()
  assert.deepEqual(await taskText(), ['Concurrent task']); pass('two-tab conflict rejected without automatic retry; explicit reload restores authoritative data')
  await c.send('Target.closeTarget', { targetId: created.targetId }); other.close()
  await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await fill('#new-task', 'Offline must not persist'); await submit('#task-form')
  await until(async () => ['offline', 'failed'].includes(await phase()), 'offline save failure', 40000)
  assert.equal((await taskText()).includes('Offline must not persist'), false)
  await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await click('[data-cloud-test] button'); await ready()
  assert.equal((await taskText()).includes('Offline must not persist'), false); pass('browser offline save fails without success or replay after reconnect')
  await logout(); assert.deepEqual(await taskText(), ['Guest sentinel']); pass('logout restores untouched guest data')
  await signup(bob); assert.deepEqual(await taskText(), []); await add('Bob only'); pass('second test account starts empty and stores isolated tasks')
  await logout(); await login(alice)
  assert.equal((await taskText()).includes('Bob only'), false); pass('login to first account never displays second-account tasks')
  const after = await c.eval(expr((keys) => keys.map((key) => [key, localStorage.getItem(key)]), guestKeys))
  assert.deepEqual(after, guestValues); pass('all seven guest keys remain byte-for-byte unchanged by account workflows')
  const png = await c.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(root, 'verified-ui.png'), Buffer.from(png.data, 'base64'))
  assert.deepEqual(report.blockedRequests, [], 'Unexpected non-loopback browser request attempted')
  assert.deepEqual(report.errors, [], 'Browser runtime exceptions')
  pass('no production/non-loopback requests or browser runtime exceptions')
} catch (error) {
  report.failure = error.stack
  if (c) {
    try { report.page = await c.eval('document.body.innerText'); report.phase = await c.eval(`document.querySelector('[data-cloud-test]')?.dataset.phase`) } catch {}
  }
  throw error
} finally {
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  process.stdout.write(`UI report: ${path.join(root, 'report.json')}\n`)
  for (const client of clients) client.close()
  browser.kill()
  await server.close()
}
