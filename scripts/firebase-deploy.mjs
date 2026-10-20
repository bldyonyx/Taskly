import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function deploymentPlan(args) {
  // Exact arguments only: no implicit aliases, arbitrary services or passthrough.
  const expected = ['--project', 'taskly-maya', '--only', 'hosting', '--confirm-production', 'taskly-maya']
  if (args.length !== expected.length || args.some((arg, index) => arg !== expected[index])) {
    throw new Error('Deployment refused. Explicit intent required: --project taskly-maya --only hosting --confirm-production taskly-maya. Staging and rules deployments are disabled.')
  }
  return ['deploy', '--config', 'firebase.json', '--project', 'taskly-maya', '--only', 'hosting']
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = deploymentPlan(process.argv.slice(2))
    // Fixed validated arguments only; Windows npm shims require cmd.exe.
    const result = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', `firebase.cmd ${args.join(' ')}`], { stdio: 'inherit', cwd: fileURLToPath(new URL('../', import.meta.url)) })
      : spawnSync('firebase', args, { stdio: 'inherit', cwd: fileURLToPath(new URL('../', import.meta.url)) })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
