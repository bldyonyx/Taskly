import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTrustedService } from './service.mjs'

// Tooling process only. Vite proxies same-origin requests; no CORS or cookies.
export async function startTrustedServer() {
  const service = createTrustedService()
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)) }
    if (req.headers.host !== '127.0.0.1:8787' || (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:5514') || req.method !== 'POST'
      || req.url !== '/mutate' || req.headers['content-type'] !== 'application/json') {
      send(400, { ok: false, code: 'invalid-input', confirmed: false }); return
    }
    let bytes = 0
    const chunks = []
    try {
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 262144) { send(413, { ok: false, code: 'limit', confirmed: false }); return }
        chunks.push(chunk)
      }
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
      const result = await service.execute(token, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      send(result.ok ? 200 : ({ unauthenticated: 401, forbidden: 403, conflict: 409,
        'idempotency-conflict': 409, unavailable: 503 }[result.code] ?? 400), result)
    } catch { if (!res.headersSent) send(400, { ok: false, code: 'invalid-input', confirmed: false }) }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8787, '127.0.0.1', resolve) }) }
  catch (error) { await service.close(); throw error }
  return { close: async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections() })
    await service.close()
  } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startTrustedServer()
  console.log('Local trusted commands: http://127.0.0.1:8787/mutate (operator initialization required).')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
}
