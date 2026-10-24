import { parseCommand, requireThat } from '../trusted/commands.mjs'

const statuses = { unauthenticated: 401, forbidden: 403, conflict: 409, 'idempotency-conflict': 409,
  'invalid-input': 400, 'not-found': 400, limit: 413, 'rate-limit': 429, unavailable: 503,
  uninitialized: 403, integrity: 503 }

// Framework-neutral Request -> Response boundary, behind future managed TLS.
// Requests use bearer tokens only: cookies are neither read nor accepted as auth.
export function createHttpsAdapter({ config, verifyIdentity, executeVerified, assertRuntime, now = Date.now }) {
  let inFlight = 0, windowStart = now(), attempts = 0
  const users = new Map()
  return async function handle(request) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff' }
    const send = (status, body) => new Response(JSON.stringify(body), { status, headers })
    const fail = code => send(statuses[code] ?? 503, { ok: false, code, confirmed: false })
    let entered = false
    try {
      assertRuntime()
      const url = new URL(request.url)
      requireThat(url.href === config.endpoint, 'invalid-input')
      requireThat(request.headers.get('origin') === config.origin, 'forbidden')
      headers['Access-Control-Allow-Origin'] = config.origin
      if (request.method === 'OPTIONS') {
        requireThat(request.headers.get('access-control-request-method') === 'POST', 'invalid-input')
        const requested = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map(s => s.trim())
        requireThat(requested.every(h => ['authorization', 'content-type'].includes(h)), 'invalid-input')
        return new Response(null, { status: 204, headers: { ...headers,
          'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } })
      }
      requireThat(request.method === 'POST', 'invalid-input')
      requireThat(/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
        && !request.headers.has('content-encoding'), 'invalid-input')
      // Per-process limits; distributed ingress enforcement remains a prerequisite.
      if (now() - windowStart >= 60000) { windowStart = now(); attempts = 0; users.clear() }
      requireThat(++attempts <= 120 && inFlight < 4, 'rate-limit')
      inFlight++; entered = true
      const token = /^Bearer (\S{1,16384})$/.exec(request.headers.get('authorization') ?? '')?.[1]
      const uid = await verifyIdentity(token)
      const used = (users.get(uid) ?? 0) + 1
      users.set(uid, used)
      requireThat(used <= 30, 'rate-limit')
      const declared = request.headers.get('content-length')
      requireThat(!declared || (/^\d+$/.test(declared) && Number(declared) <= 262144), 'limit')
      requireThat(request.body, 'invalid-input')
      const reader = request.body.getReader(), chunks = []
      let bytes = 0, timedOut = false
      const deadline = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}) }, 10000)
      try {
        while (true) {
          const { done, value } = await reader.read()
          requireThat(!timedOut, 'unavailable')
          if (done) break
          bytes += value.byteLength
          if (bytes > 262144) { await reader.cancel(); requireThat(false, 'limit') }
          chunks.push(value)
        }
      } finally { clearTimeout(deadline); reader.releaseLock() }
      let command
      try { command = parseCommand(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { if (error.trustedCode) throw error; requireThat(false, 'invalid-input') }
      // Admission is checked transactionally on every command and receipt replay.
      const result = await executeVerified(uid, command)
      return send(200, result)
    } catch (error) {
      // Never return internal errors, paths, payloads, tokens or account state.
      return fail(Object.hasOwn(statuses, error.trustedCode) ? error.trustedCode : 'unavailable')
    } finally { if (entered) inFlight-- }
  }
}
