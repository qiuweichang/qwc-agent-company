import { execFile, execFileSync, spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { dirname, join } from 'node:path'

import type { ProjectDeployment } from '../shared/project-operations.js'

interface DeploymentRecord extends ProjectDeployment {
  /** Absent when the delivered workspace is a frontend-only application. */
  backendPid: number | null
  frontendPid: number
}

interface PackageManifest {
  scripts?: Record<string, string>
}

interface PackageScriptInvocation {
  args: string[]
  executable: string
  workingDirectory: string
}

interface DeploymentCommands {
  backendCommand: string
  backendInvocation: PackageScriptInvocation | null
  buildCommand: string
  buildInvocation: PackageScriptInvocation | null
  frontendCommand: string
  frontendDirectory: string
  frontendInvocation: PackageScriptInvocation
  hasBackend: boolean
}

const deployments = new Map<string, DeploymentRecord>()

const powershellString = (value: string) => `'${value.replaceAll("'", "''")}'`

const fileExists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const readManifest = async (path: string): Promise<PackageManifest | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
  } catch {
    return null
  }
}

const resolvePackageManager = async (workspacePath: string) => {
  if (await fileExists(join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm' as const
  if (await fileExists(join(workspacePath, 'yarn.lock'))) return 'yarn' as const
  return 'npm' as const
}

const packageScriptCommand = (
  packageManager: 'npm' | 'pnpm' | 'yarn',
  script: string,
  directory?: string,
  trailingArgs = ''
) => {
  const nodeDirectory = dirname(process.execPath)
  const runner =
    packageManager === 'npm'
      ? `"${process.execPath}" "${join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')}"`
      : `call "${join(nodeDirectory, 'corepack.cmd')}" ${packageManager}`
  if (packageManager === 'pnpm') {
    return `${runner}${directory ? ` --dir ${directory}` : ''} ${script}${trailingArgs}`
  }
  if (packageManager === 'yarn') {
    return `${runner}${directory ? ` --cwd ${directory}` : ''} ${script}${trailingArgs}`
  }
  return `${runner} run ${script}${directory ? ` --prefix ${directory}` : ''}${trailingArgs}`
}

/**
 * Builds a structured package-manager invocation for the runtime API. Keeping the executable and
 * arguments separate avoids cmd.exe re-quoting absolute Windows paths that contain spaces.
 */
const packageScriptInvocation = (
  packageManager: 'npm' | 'pnpm' | 'yarn',
  workspacePath: string,
  script: string,
  directory?: string,
  trailingArgs: string[] = []
): PackageScriptInvocation => {
  const nodeDirectory = dirname(process.execPath)
  const executable =
    packageManager === 'npm' ? process.execPath : join(nodeDirectory, 'corepack.cmd')
  const managerPrefix =
    packageManager === 'npm'
      ? [join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : [packageManager]
  const managerDirectoryArgs =
    packageManager === 'pnpm'
      ? directory
        ? ['--dir', directory]
        : []
      : packageManager === 'yarn' && directory
        ? ['--cwd', directory]
        : []
  const npmDirectoryArgs = packageManager === 'npm' && directory ? ['--prefix', directory] : []
  return {
    args: [
      ...managerPrefix,
      ...managerDirectoryArgs,
      ...(packageManager === 'npm' ? ['run'] : []),
      script,
      ...npmDirectoryArgs,
      ...trailingArgs,
    ],
    executable,
    workingDirectory: workspacePath,
  }
}

/**
 * Detects conventional frontend/backend package scripts without executing project code.
 * A root Vite project is treated as a valid frontend-only delivery instead of inventing a backend.
 */
const detectDeploymentCommands = async (workspacePath: string): Promise<DeploymentCommands> => {
  const packageManager = await resolvePackageManager(workspacePath)
  const rootManifest = await readManifest(join(workspacePath, 'package.json'))
  const nestedFrontendDirectory = (
    await Promise.all(
      ['web', 'frontend', 'client'].map(async (directory) => ({
        directory,
        exists: await fileExists(join(workspacePath, directory, 'package.json')),
      }))
    )
  ).find((candidate) => candidate.exists)?.directory
  const rootViteConfig = (
    await Promise.all(
      ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'].map(async (name) =>
        fileExists(join(workspacePath, name))
      )
    )
  ).some(Boolean)
  const frontendDirectory = nestedFrontendDirectory ?? (rootViteConfig ? '.' : null)
  const frontendManifest = nestedFrontendDirectory
    ? await readManifest(join(workspacePath, nestedFrontendDirectory, 'package.json'))
    : rootViteConfig
      ? rootManifest
      : null

  const backendScript = rootManifest?.scripts?.start
    ? 'start'
    : rootManifest?.scripts?.['dev:server']
      ? 'dev:server'
      : rootManifest?.scripts?.server
        ? 'server'
        : null
  const frontendScript = frontendManifest?.scripts?.dev ? 'dev' : null
  if (!frontendDirectory || !frontendScript)
    throw new Error('未检测到根目录或 web/frontend/client 的 Vite dev 脚本')

  const buildCommand = rootManifest?.scripts?.build
    ? packageScriptCommand(packageManager, 'build')
    : ''
  return {
    backendCommand: backendScript ? packageScriptCommand(packageManager, backendScript) : '',
    backendInvocation: backendScript
      ? packageScriptInvocation(packageManager, workspacePath, backendScript)
      : null,
    buildCommand,
    buildInvocation: rootManifest?.scripts?.build
      ? packageScriptInvocation(packageManager, workspacePath, 'build')
      : null,
    frontendCommand: packageScriptCommand(
      packageManager,
      frontendScript,
      frontendDirectory,
      ' -- --config vite.agent-company.config.ts --host 127.0.0.1 --strictPort'
    ),
    frontendInvocation: packageScriptInvocation(
      packageManager,
      workspacePath,
      frontendScript,
      frontendDirectory,
      ['--', '--config', 'vite.agent-company.config.ts', '--host', '127.0.0.1', '--strictPort']
    ),
    frontendDirectory,
    hasBackend: Boolean(backendScript),
  }
}

const buildPortDetectorScript = () => `param(
  [int]$PreferredPort = 0,
  [int]$ExcludedPort = 0
)

function Test-PortAvailable {
  param([int]$Port)
  if ($Port -le 0 -or $Port -gt 65535) { return $false }
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($null -ne $listener) { $listener.Stop() }
  }
}

if ($PreferredPort -ne $ExcludedPort -and (Test-PortAvailable -Port $PreferredPort)) {
  Write-Output $PreferredPort
  exit 0
}

do {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $candidate = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
} while ($candidate -eq $ExcludedPort)

Write-Output $candidate
`

const buildDeployScript = (input: {
  backendCommand: string
  buildCommand: string
  frontendCommand: string
  hasBackend: boolean
}) => `param(
  [int]$FrontendPort = 0,
  [int]$BackendPort = 0,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PortDetector = Join-Path $PSScriptRoot 'find-free-port.ps1'
$HasBackend = ${input.hasBackend ? '$true' : '$false'}
if ($HasBackend) {
  $BackendPort = [int](& $PortDetector -PreferredPort $BackendPort)
} else {
  $BackendPort = 0
}
$FrontendPort = [int](& $PortDetector -PreferredPort $FrontendPort -ExcludedPort $BackendPort)

$env:PORT = [string]$BackendPort
$env:BACKEND_PORT = [string]$BackendPort
$env:NO_BROWSER = '1'
$env:FRONTEND_PORT = [string]$FrontendPort
$env:VITE_API_BASE_URL = "http://127.0.0.1:$BackendPort"
$env:NEXT_PUBLIC_API_BASE_URL = $env:VITE_API_BASE_URL
$env:REACT_APP_API_BASE_URL = $env:VITE_API_BASE_URL

$LogDirectory = Join-Path $ProjectRoot '.agent-company/logs'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

$BuildCommand = ${powershellString(input.buildCommand)}
if (-not $SkipBuild -and $BuildCommand) {
  Push-Location $ProjectRoot
  try { & cmd.exe /d /s /c $BuildCommand }
  finally { Pop-Location }
}

$BackendCommand = ${powershellString(input.backendCommand)}
$FrontendCommand = ${powershellString(input.frontendCommand)}
function Wait-LocalPort {
  param([int]$Port, [System.Diagnostics.Process]$Process, [string]$Label)
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    if ($Process.HasExited) { throw "$Label process exited before opening port $Port" }
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $task = $client.ConnectAsync('127.0.0.1', $Port)
      if ($task.Wait(200) -and $client.Connected) { return }
    } catch {
      # The service is still starting; retry until the bounded deadline.
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 200
  }
  throw "$Label did not open port $Port within 12 seconds"
}

$Backend = $null
$Frontend = $null
try {
  if ($HasBackend) {
    $Backend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/s', '/c', $BackendCommand) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogDirectory 'backend.log') -RedirectStandardError (Join-Path $LogDirectory 'backend.error.log')
    Wait-LocalPort -Port $BackendPort -Process $Backend -Label 'Backend'
  }
  $Frontend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/s', '/c', $FrontendCommand) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogDirectory 'frontend.log') -RedirectStandardError (Join-Path $LogDirectory 'frontend.error.log')
  Wait-LocalPort -Port $FrontendPort -Process $Frontend -Label 'Frontend'
} catch {
  if ($null -ne $Frontend -and -not $Frontend.HasExited) { Stop-Process -Id $Frontend.Id -Force }
  if ($null -ne $Backend -and -not $Backend.HasExited) { Stop-Process -Id $Backend.Id -Force }
  throw
}

@{
  backend_pid = if ($null -ne $Backend) { $Backend.Id } else { $null }
  backend_port = $BackendPort
  frontend_pid = $Frontend.Id
  frontend_port = $FrontendPort
} | ConvertTo-Json -Compress
`

/** Builds the temporary Vite config, adding an API proxy only when a backend was detected. */
const buildViteDeploymentConfig = (baseConfigName: string, hasBackend: boolean) => {
  const proxyConfig = hasBackend
    ? "    proxy: { '/api': { target: `http://127.0.0.1:" +
      '$' +
      '{backendPort}`, changeOrigin: false } },'
    : ''
  return `import { mergeConfig } from 'vite'
import baseConfig from './${baseConfigName}'

const resolvedBase =
  typeof baseConfig === 'function'
    ? baseConfig({ command: 'serve', mode: 'development', isPreview: false, isSsrBuild: false })
    : baseConfig
const backendPort = Number(process.env.BACKEND_PORT)
const frontendPort = Number(process.env.FRONTEND_PORT)

export default mergeConfig(resolvedBase, {
  server: {
    host: '127.0.0.1',
    port: frontendPort,
    strictPort: true,
${proxyConfig}
  },
})
`
}

/** Writes the Windows one-click deployment assets required by every delivered project. */
export const ensureWindowsDeploymentScripts = async (workspacePath: string) => {
  const commands = await detectDeploymentCommands(workspacePath)
  const scriptsDirectory = join(workspacePath, 'scripts')
  await mkdir(scriptsDirectory, { recursive: true })
  await writeFile(join(scriptsDirectory, 'find-free-port.ps1'), buildPortDetectorScript(), 'utf8')
  await writeFile(join(scriptsDirectory, 'deploy-windows.ps1'), buildDeployScript(commands), 'utf8')

  const viteConfigNames = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']
  const baseConfigName = (
    await Promise.all(
      viteConfigNames.map(async (name) => ({
        exists: await fileExists(join(workspacePath, commands.frontendDirectory, name)),
        name,
      }))
    )
  ).find((candidate) => candidate.exists)?.name
  if (!baseConfigName) throw new Error('前端项目缺少 Vite 配置，无法注入随机后端端口代理')
  await writeFile(
    join(workspacePath, commands.frontendDirectory, 'vite.agent-company.config.ts'),
    buildViteDeploymentConfig(baseConfigName, commands.hasBackend),
    'utf8'
  )
  return join(scriptsDirectory, 'deploy-windows.ps1')
}

const execFileText = (file: string, args: string[], cwd?: string) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, maxBuffer: 4_000_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }
        resolve(stdout)
      }
    )
  })

/** Calls the generated project-local detector for every deployment port assignment. */
const findDeploymentPort = async (scriptPath: string, preferred: number, excluded = 0) => {
  const output = await execFileText('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-PreferredPort',
    String(preferred),
    '-ExcludedPort',
    String(excluded),
  ])
  const port = Number(output.trim().split(/\r?\n/).at(-1))
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`端口检测脚本返回了无效端口：${output.trim()}`)
  }
  return port
}

const canConnectToPort = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = new Socket()
    const finish = (connected: boolean) => {
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(250)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
    socket.connect(port, '127.0.0.1')
  })

/** Waits for a spawned service to bind its promised port before reporting deployment success. */
const waitForServicePort = async (port: number, child: ReturnType<typeof spawn>, label: string) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited before opening port ${port}`)
    if (await canConnectToPort(port)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${label} did not open port ${port} within 12 seconds`)
}

const spawnDeploymentService = (
  invocation: PackageScriptInvocation,
  env: NodeJS.ProcessEnv,
  outputPath: string,
  errorPath: string
) => {
  const output = openSync(outputPath, 'w')
  const error = openSync(errorPath, 'w')
  const child = spawn(invocation.executable, invocation.args, {
    cwd: invocation.workingDirectory,
    // A detached console process can make Windows Terminal create a visible host window even when
    // windowsHide is requested. Deployment belongs to the local Runtime lifecycle, so keeping it
    // attached is both quieter for the user and easier to stop as one process tree.
    detached: false,
    env,
    stdio: ['ignore', output, error],
    windowsHide: true,
  })
  child.unref()
  return child
}

const stopProcessTree = (pid: number) => {
  if (!isProcessRunning(pid)) return
  execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

const isProcessRunning = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Generates project-local scripts, assigns free ports and launches every detected service. */
export const startWorkspaceDeployment = async (
  workspaceId: string,
  workspacePath: string,
  input: { backendPort?: number; frontendPort?: number } = {}
): Promise<ProjectDeployment> => {
  if (process.platform !== 'win32') throw new Error('当前一键部署仅支持 Windows')
  const current = deployments.get(workspaceId)
  if (
    current &&
    ((current.backendPid !== null && isProcessRunning(current.backendPid)) ||
      isProcessRunning(current.frontendPid))
  ) {
    return current
  }
  await ensureWindowsDeploymentScripts(workspacePath)
  const commands = await detectDeploymentCommands(workspacePath)
  const detectorPath = join(workspacePath, 'scripts', 'find-free-port.ps1')
  const backendPort = commands.hasBackend
    ? await findDeploymentPort(detectorPath, input.backendPort ?? 0)
    : null
  const frontendPort = await findDeploymentPort(
    detectorPath,
    input.frontendPort ?? 0,
    backendPort ?? 0
  )
  const logsDirectory = join(workspacePath, '.agent-company', 'logs')
  await mkdir(logsDirectory, { recursive: true })
  if (commands.buildInvocation) {
    await execFileText(
      commands.buildInvocation.executable,
      commands.buildInvocation.args,
      commands.buildInvocation.workingDirectory
    )
  }
  const env = {
    ...process.env,
    BACKEND_PORT: backendPort === null ? '' : String(backendPort),
    FRONTEND_PORT: String(frontendPort),
    NEXT_PUBLIC_API_BASE_URL: backendPort === null ? '' : `http://127.0.0.1:${backendPort}`,
    // Agent Company owns the user-facing deployment link. Suppress project-level
    // auto-open hooks so a deployment never creates surprise browser windows.
    NO_BROWSER: '1',
    PORT: backendPort === null ? '' : String(backendPort),
    REACT_APP_API_BASE_URL: backendPort === null ? '' : `http://127.0.0.1:${backendPort}`,
    VITE_API_BASE_URL: backendPort === null ? '' : `http://127.0.0.1:${backendPort}`,
  }
  const backend = commands.backendInvocation
    ? spawnDeploymentService(
        commands.backendInvocation,
        env,
        join(logsDirectory, 'backend.log'),
        join(logsDirectory, 'backend.error.log')
      )
    : null
  let frontend: ReturnType<typeof spawn> | null = null
  try {
    if (backend && backendPort !== null) await waitForServicePort(backendPort, backend, 'Backend')
    frontend = spawnDeploymentService(
      commands.frontendInvocation,
      env,
      join(logsDirectory, 'frontend.log'),
      join(logsDirectory, 'frontend.error.log')
    )
    await waitForServicePort(frontendPort, frontend, 'Frontend')
  } catch (error) {
    if (frontend?.pid) stopProcessTree(frontend.pid)
    if (backend?.pid) stopProcessTree(backend.pid)
    throw error
  }
  if ((commands.hasBackend && !backend?.pid) || !frontend.pid)
    throw new Error('部署进程没有返回有效 PID')
  const deployment: DeploymentRecord = {
    backendPid: backend?.pid ?? null,
    backendPort,
    backendUrl: backendPort === null ? null : `http://127.0.0.1:${backendPort}`,
    frontendPid: frontend.pid,
    frontendPort,
    frontendUrl: `http://127.0.0.1:${frontendPort}`,
    launchedAt: Date.now(),
    status: 'running',
    workspaceId,
  }
  deployments.set(workspaceId, deployment)
  return deployment
}

/** Returns the latest deployment state after checking the exact recorded child process ids. */
export const getWorkspaceDeployment = (workspaceId: string): ProjectDeployment | null => {
  const deployment = deployments.get(workspaceId)
  if (!deployment) return null
  const status =
    (deployment.backendPid === null || isProcessRunning(deployment.backendPid)) &&
    isProcessRunning(deployment.frontendPid)
      ? 'running'
      : 'stopped'
  deployment.status = status
  return deployment
}

/** Stops only the two process ids returned by this workspace's own deployment script. */
export const stopWorkspaceDeployment = (workspaceId: string): ProjectDeployment | null => {
  const deployment = deployments.get(workspaceId)
  if (!deployment) return null
  for (const pid of [deployment.frontendPid, deployment.backendPid]) {
    if (pid === null) continue
    try {
      stopProcessTree(pid)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  deployment.status = 'stopped'
  return deployment
}

/** Stops and forgets deployment process metadata when its owning project is permanently deleted. */
export const deleteWorkspaceDeployment = (workspaceId: string): void => {
  stopWorkspaceDeployment(workspaceId)
  deployments.delete(workspaceId)
}
