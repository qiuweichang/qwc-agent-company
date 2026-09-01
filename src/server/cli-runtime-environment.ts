import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Finds an environment value without losing Windows' case-insensitive key semantics. */
const readEnvironmentValue = (
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform
): string | undefined => {
  if (platform !== 'win32') return env[key]
  const matchedKey = Object.keys(env).find((item) => item.toLowerCase() === key.toLowerCase())
  return matchedKey ? env[matchedKey] : undefined
}

/**
 * Writes one environment value and removes differently-cased duplicates first.
 * ConPTY can otherwise receive both `Path` and `PATH` and select the stale value.
 */
const writeEnvironmentValue = (
  env: NodeJS.ProcessEnv,
  key: string,
  value: string | undefined,
  platform: NodeJS.Platform
) => {
  if (platform === 'win32') {
    for (const existingKey of Object.keys(env)) {
      if (existingKey !== key && existingKey.toLowerCase() === key.toLowerCase()) {
        delete env[existingKey]
      }
    }
  }
  if (value === undefined) delete env[key]
  else env[key] = value
}

/**
 * Lists local Windows directories commonly used by npm and standalone CLI installers.
 * Agent Company adds only directories that exist, keeping the spawned environment small
 * while allowing a desktop Runtime started before a PATH refresh to discover Codex.
 */
const listKnownWindowsCliDirectories = (env: NodeJS.ProcessEnv): string[] => {
  const appData = readEnvironmentValue(env, 'APPDATA', 'win32')
  const localAppData = readEnvironmentValue(env, 'LOCALAPPDATA', 'win32')
  const userProfile = readEnvironmentValue(env, 'USERPROFILE', 'win32')

  return [
    appData ? join(appData, 'npm') : null,
    localAppData ? join(localAppData, 'Programs', 'nodejs') : null,
    userProfile ? join(userProfile, '.local', 'bin') : null,
  ].filter((directory): directory is string => Boolean(directory && existsSync(directory)))
}

/**
 * Returns directories required by npm-generated Windows CLI shims. In particular,
 * Codex may resolve to `codex.cmd`, whose first command is `node`; using the active
 * Runtime executable directory prevents a stale desktop PATH from breaking that shim.
 */
const listRequiredWindowsRuntimeDirectories = (runtimeExecutablePath: string): string[] => {
  const runtimeDirectory = dirname(runtimeExecutablePath)
  return existsSync(runtimeDirectory) ? [runtimeDirectory] : []
}

/**
 * Builds the environment shared by CLI availability checks and real PTY launches.
 * Explicit PATH overrides remain authoritative for user-selected tools. The active
 * Node directory is still appended on Windows because npm CLI shims require it;
 * otherwise known local CLI directories are appended so detection and execution
 * cannot disagree.
 *
 * @param inputEnv Per-agent environment overrides merged over the Runtime environment.
 * @param platform Target PTY platform; injectable so Windows behavior can be tested elsewhere.
 * @param runtimeExecutablePath Node executable currently hosting the Runtime process.
 * @returns A normalized environment safe to pass to command detection and the real PTY.
 */
export const createCliRuntimeEnvironment = (
  inputEnv?: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  runtimeExecutablePath: string = process.execPath
): NodeJS.ProcessEnv => {
  const env = { ...process.env }
  const inputHasPath = Object.keys(inputEnv ?? {}).some((key) => key.toLowerCase() === 'path')

  for (const [key, value] of Object.entries(inputEnv ?? {})) {
    writeEnvironmentValue(env, key, value, platform)
  }

  if (platform === 'win32') {
    const currentPath = readEnvironmentValue(env, 'PATH', platform) ?? ''
    const pathEntries = currentPath.split(';').filter(Boolean)
    const comparableEntries = new Set(pathEntries.map((entry) => entry.toLowerCase()))

    for (const directory of listRequiredWindowsRuntimeDirectories(runtimeExecutablePath)) {
      if (comparableEntries.has(directory.toLowerCase())) continue
      pathEntries.push(directory)
      comparableEntries.add(directory.toLowerCase())
    }

    if (!inputHasPath) {
      for (const directory of listKnownWindowsCliDirectories(env)) {
        if (comparableEntries.has(directory.toLowerCase())) continue
        pathEntries.push(directory)
        comparableEntries.add(directory.toLowerCase())
      }
    }

    writeEnvironmentValue(env, 'PATH', pathEntries.join(';'), platform)
  }

  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  return env
}
