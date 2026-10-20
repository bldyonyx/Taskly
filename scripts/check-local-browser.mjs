import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

// Disposable profile; every non-loopback request is blocked before transmission.
const root = path.resolve('.firebase', `local-safety-${Date.now()}`)
await mkdir(root, { recursive: true })
const candidates = [process.env.TASKLY_TEST_BROWSER,
  path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1234/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)
let executable
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break } catch {} }
assert.ok(executable, 'Set TASKLY_TEST_BROWSER to a Chromium browser.')
const server = await createServer({ mode: 'development', server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.firebase/**'] } },
  // Valid synthetic production-shaped config proves the default development gate,
  // independently of any malformed/missing local credentials. No Auth opt-in.
  define: {
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify('synthetic-key'),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify('taskly-maya'),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify('taskly-maya.firebaseapp.com'),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify('1:123:web:abc'),
    'import.meta.env.VITE_ALLOW_PRODUCTION_AUTH': JSON.stringify('false'),
  },
})
let browser, ws
const report = { firebaseRequests: [], blockedExternal: [], errors: [] }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn) {
  const end = Date.now() + 25000
  while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(100) }
  throw new Error('Browser safety check timed out.')
}
try {
  await server.listen()
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${root}`,
    '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' })
  const port = await until(async () => {
    try { return Number((await readFile(path.join(root, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) } catch { return false }
  })
  const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value) }, reject(error) { clearTimeout(timer); reject(error) } })
    ws.send(JSON.stringify({ id, method, params }))
  })
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const entry = pending.get(message.id); pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result)
    } else if (message.method === 'Fetch.requestPaused') {
      const { request, requestId } = message.params
      const url = new URL(request.url)
      if (/firebase|firestore|identitytoolkit|securetoken/i.test(url.hostname)
        || (url.hostname.endsWith('googleapis.com') && /projects|accounts/.test(url.pathname))
        || (url.hostname === '127.0.0.1' && ['8080', '8085', '9099'].includes(url.port))) report.firebaseRequests.push(request.url)
      if (url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol)) void send('Fetch.continueRequest', { requestId })
      else { report.blockedExternal.push(request.url); void send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }) }
    } else if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails.text)
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined)
    return result.result.value
  }
  await send('Page.enable'); await send('Runtime.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  const keys = ['taskly.tasks.v1', 'taskly.tasksByDate.v1', 'taskly.currentListByDate.v1', 'taskly.savedLists.v1', 'taskly.currentListId.v1', 'taskly.finishedDays.v1', 'taskly.theme.v1']
  await send('Page.navigate', { url: server.resolvedUrls.local[0] })
  await until(() => evaluate(`Boolean(document.querySelector('.settings-button'))`))
  await until(() => evaluate(`import('/src/js/auth/index.js').then(m=>m.authSession.getState().phase==='unavailable')`))
  const before = await evaluate(`JSON.stringify(${JSON.stringify(keys)}.map(k=>[k,localStorage.getItem(k)]))`)
  await evaluate(`document.querySelector('.settings-button').click()`)
  await until(() => evaluate(`Boolean(document.querySelector('.taskly-modal'))`))
  await send('Page.reload')
  await until(() => evaluate(`import('/src/js/auth/index.js').then(m=>m.authSession.getState().phase==='unavailable')`))
  const after = await evaluate(`JSON.stringify(${JSON.stringify(keys)}.map(k=>[k,localStorage.getItem(k)]))`)
  assert.equal(after, before)
  assert.deepEqual(report.firebaseRequests, [])
  assert.deepEqual(report.errors, [])
  report.passed = true
  console.log('PASS development startup, Settings and reload: Auth unavailable without opt-in; zero Firebase requests; seven guest values unchanged.')
} finally {
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  ws?.close(); browser?.kill(); await server.close()
  console.log(`Browser report: ${path.join(root, 'report.json')}`)
}
