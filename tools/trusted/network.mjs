import net from 'node:net'

const blocked = []
let installed = false
export function installLoopbackGuard() {
  if (installed) return
  installed = true
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args) {
    const values = Array.isArray(args[0]) ? args[0] : args
    const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: typeof values[1] === 'string' ? values[1] : undefined }
    const host = options?.host ?? 'localhost'
    if (host !== '127.0.0.1' || options.path || ![8087, 9100, 8787].includes(Number(options.port))) {
      blocked.push({ host, port: options.port })
      throw new Error('Trusted prototype blocked an outbound socket outside its fixed loopback ports.')
    }
    return connect.apply(this, args)
  }
}
export function blockedConnections() { return structuredClone(blocked) }
