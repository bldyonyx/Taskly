import { defineConfig } from "vite";

export default defineConfig(({ mode, command }) => {
  if (!['development', 'production', 'github', 'cloud-test'].includes(mode)) {
    throw new Error('Unsupported Taskly mode. Staging is inactive; use development, production, github or cloud-test.')
  }
  const isolated = command === 'serve' && mode === 'cloud-test'
  return {
    base: mode === 'github' ? '/Taskly/' : '/',
    define: { __TASKLY_ISOLATED_CLOUD__: JSON.stringify(isolated) },
    plugins: [{ name: 'taskly-build-boundary',
      generateBundle() {
        for (const id of this.getModuleIds()) {
          if (/\/(?:src\/(?:isolated|staging)|tools\/trusted|node_modules\/firebase-admin|scripts\/staging-contract)(?:\/|\.)/.test(id.replaceAll('\\', '/'))) {
            this.error('Isolated or staging runtime entered a normal build.')
          }
        }
      },
    }],
    ...(isolated ? {
      // Do not expose ordinary VITE_FIREBASE_* values from .env.local here.
      envPrefix: 'TASKLY_ISOLATED_',
      server: { host: '127.0.0.1', port: 5174, strictPort: true, watch: { ignored: ['**/.firebase/**'] }, headers: {
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:9099 http://127.0.0.1:8085 ws://127.0.0.1:5174;",
      } },
      plugins: [{ name: 'taskly-isolated-entry', enforce: 'pre',
        transformIndexHtml(html) { return html.replace('/src/main.js', '/src/isolated/main.js') },
        transform(code, id) {
          if (id.replaceAll('\\', '/').split('?')[0].endsWith('/src/styles/base.css')) {
            return code.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);?\r?\n/, '')
          }
        },
      }],
    } : {}),
  }
});
