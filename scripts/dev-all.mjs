import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = process.cwd()
let shuttingDown = false

/** Starts one development service with the same absolute Node runtime as this parent. */
const startService = (entryPoint, args) =>
  spawn(process.execPath, [resolve(root, entryPoint), ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  })

const runtime = startService('node_modules/tsx/dist/cli.mjs', ['src/cli/hive.ts', '--port', '4010'])
const web = startService('node_modules/vite/bin/vite.js', ['--config', 'web/vite.config.ts'])
const services = [runtime, web]

/** Stops both services so one failed or interrupted side cannot leave an orphan process. */
const stopServices = () => {
  if (shuttingDown) return
  shuttingDown = true
  for (const service of services) {
    if (service.exitCode === null && service.signalCode === null) service.kill()
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopServices()
  })
}

for (const service of services) {
  service.once('exit', (code) => {
    if (!shuttingDown) {
      process.exitCode = code ?? 1
      stopServices()
    }
  })
}
