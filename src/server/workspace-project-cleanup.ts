import { lstat, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, parse, relative, resolve } from 'node:path'

import { ConflictError } from './http-errors.js'

const DEFAULT_PROJECT_ROOT = resolve('D:\\project\\agent-company-workspace')

const comparablePath = (path: string) =>
  process.platform === 'win32' ? resolve(path).toLocaleLowerCase('en-US') : resolve(path)

const isSamePath = (left: string, right: string) => comparablePath(left) === comparablePath(right)

/** Returns true when candidate is the same directory as parent or is nested anywhere below it. */
const isPathInside = (parent: string, candidate: string) => {
  const relation = relative(resolve(parent), resolve(candidate))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

/**
 * Validates broad-path and sibling-project boundaries before any process or database state changes.
 * This is intentionally separate from removal so an unsafe target leaves the project fully intact.
 */
export const assertWorkspaceProjectDeletionSafe = (
  workspacePath: string,
  protectedWorkspacePaths: string[]
) => {
  const target = resolve(workspacePath)
  const forbiddenTargets = [parse(target).root, homedir(), process.cwd(), DEFAULT_PROJECT_ROOT]
  if (forbiddenTargets.some((forbidden) => isSamePath(target, forbidden))) {
    throw new ConflictError(`拒绝删除共享或系统级目录：${target}`)
  }
  if (isSamePath(target, resolve(target, '..'))) {
    throw new ConflictError(`拒绝删除磁盘根目录：${target}`)
  }
  const nestedWorkspace = protectedWorkspacePaths.find((path) => isPathInside(target, path))
  if (nestedWorkspace) {
    throw new ConflictError(`项目目录包含另一个已登记项目，无法递归删除：${nestedWorkspace}`)
  }
}

/** Permanently removes one project directory after the caller has stopped its owned processes. */
export const deleteWorkspaceProjectFiles = async (
  workspacePath: string,
  protectedWorkspacePaths: string[]
) => {
  assertWorkspaceProjectDeletionSafe(workspacePath, protectedWorkspacePaths)
  const target = resolve(workspacePath)

  try {
    const metadata = await lstat(target)
    if (!metadata.isDirectory() && !metadata.isSymbolicLink()) {
      throw new ConflictError(`项目路径不是目录：${target}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  await rm(target, { force: true, maxRetries: 3, recursive: true, retryDelay: 150 })
  console.info(`[agent-company] 已永久删除项目目录：${target}`)
}
