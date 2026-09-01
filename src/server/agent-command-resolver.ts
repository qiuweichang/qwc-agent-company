import { accessSync, constants } from 'node:fs'
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'node:path'

const hasPathSeparator = (command: string) => command.includes('/') || command.includes('\\')

const canExecute = (path: string, platform = process.platform): boolean => {
  try {
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

const createCommandNotFoundError = (command: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${command} CLI not found in PATH`), {
    code: 'ENOENT',
    path: command,
  })

interface ResolvedSpawnCommand {
  args: string[]
  command: string
}

const getEnvValue = (
  env: NodeJS.ProcessEnv,
  key: string,
  platform = process.platform
): string | undefined => {
  if (platform !== 'win32') return env[key]
  const matchedKey = Object.keys(env).find((item) => item.toLowerCase() === key.toLowerCase())
  return matchedKey ? env[matchedKey] : undefined
}

const getWindowsExecutableNames = (
  command: string,
  env: NodeJS.ProcessEnv,
  platform = process.platform
): string[] => {
  if (extname(command)) return [command]

  const extensions = (getEnvValue(env, 'PATHEXT', platform) ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
  return [...extensions.map((extension) => `${command}${extension}`), command]
}

const getExecutableNames = (
  command: string,
  env: NodeJS.ProcessEnv,
  platform = process.platform
): string[] =>
  platform === 'win32' ? getWindowsExecutableNames(command, env, platform) : [command]

export const resolveCommandPath = (
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  platform = process.platform
): string => {
  if (hasPathSeparator(command)) {
    for (const name of getExecutableNames(command, env, platform)) {
      const candidate = isAbsolute(name) ? name : join(cwd, name)
      if (canExecute(candidate, platform)) return candidate
    }
    throw createCommandNotFoundError(command)
  }

  for (const pathEntry of (getEnvValue(env, 'PATH', platform) ?? '').split(delimiter)) {
    if (!pathEntry) continue
    for (const name of getExecutableNames(command, env, platform)) {
      const candidate = join(pathEntry, name)
      if (canExecute(candidate, platform)) return candidate
    }
  }

  throw createCommandNotFoundError(command)
}

const isWindowsBatchFile = (command: string) => {
  const extension = extname(command).toLowerCase()
  return extension === '.cmd' || extension === '.bat'
}

/**
 * Resolves Codex's npm-generated Windows shim to its JavaScript entry point.
 * The generated `codex.cmd` performs a second PATH lookup for `node`, which can
 * fail inside ConPTY even after the parent process resolved the shim correctly.
 * Launching the entry point with the Runtime's absolute Node executable removes
 * that hidden dependency while preserving every Codex argument unchanged.
 */
const resolveWindowsCodexNodeShim = (
  resolvedCommand: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  platform: NodeJS.Platform
): ResolvedSpawnCommand | null => {
  if (platform !== 'win32' || basename(resolvedCommand).toLowerCase() !== 'codex.cmd') return null

  const runtimeNode = getEnvValue(env, 'AGENT_COMPANY_NODE', platform)
  const codexEntryPoint = join(
    dirname(resolvedCommand),
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js'
  )
  if (
    !runtimeNode ||
    !canExecute(runtimeNode, platform) ||
    !canExecute(codexEntryPoint, platform)
  ) {
    return null
  }

  return {
    args: [codexEntryPoint, ...args],
    command: runtimeNode,
  }
}

export const resolveSpawnCommand = (
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[] = [],
  platform = process.platform
): ResolvedSpawnCommand => {
  const resolvedCommand = resolveCommandPath(command, cwd, env, platform)
  const codexNodeLaunch = resolveWindowsCodexNodeShim(resolvedCommand, env, args, platform)
  if (codexNodeLaunch) return codexNodeLaunch

  if (platform === 'win32' && isWindowsBatchFile(resolvedCommand)) {
    return {
      // Keep the shim and its arguments as separate argv values. node-pty owns
      // the final Windows quoting, while CALL prevents npm .CMD shims from
      // replacing the hosting command interpreter before output is attached.
      args: ['/d', '/c', 'call', resolvedCommand, ...args],
      command: getEnvValue(env, 'ComSpec', platform) ?? 'cmd.exe',
    }
  }
  return { args, command: resolvedCommand }
}

export const assertCommandIsExecutable = (
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): void => {
  resolveCommandPath(command, cwd, env)
}

export type { ResolvedSpawnCommand }
