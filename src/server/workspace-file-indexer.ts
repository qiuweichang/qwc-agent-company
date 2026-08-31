import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { ArchiveCategory, ArchivedProjectFile } from '../shared/project-operations.js'
import { BadRequestError } from './http-errors.js'

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
])
const MAX_ARCHIVED_FILES = 4_000

const normalizeRelativePath = (value: string) => value.split(sep).join('/')

const categorizeFile = (path: string): ArchiveCategory => {
  const normalized = path.toLowerCase()
  if (normalized.startsWith('docs/design/') || normalized.startsWith('design/')) return 'ui_design'
  if (normalized.startsWith('docs/architecture/') || normalized.includes('/architecture/')) {
    return 'architecture'
  }
  if (normalized.startsWith('web/') || normalized.startsWith('frontend/')) return 'frontend'
  if (normalized.startsWith('server/') || normalized.startsWith('backend/')) return 'backend'
  if (normalized.startsWith('test/') || normalized.startsWith('tests/')) return 'tests'
  if (normalized.startsWith('scripts/')) return 'scripts'
  if (normalized.startsWith('docs/') || ['.md', '.pdf', '.docx'].includes(extname(normalized))) {
    return 'documents'
  }
  return 'other'
}

/** Recursively indexes project-owned files while excluding dependencies and generated build output. */
export const listArchivedProjectFiles = async (
  workspacePath: string
): Promise<ArchivedProjectFile[]> => {
  const root = await realpath(workspacePath)
  const files: ArchivedProjectFile[] = []

  /** Walks one trusted workspace directory and stops at a defensive file-count ceiling. */
  const walk = async (directory: string): Promise<void> => {
    if (files.length >= MAX_ARCHIVED_FILES) return
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (files.length >= MAX_ARCHIVED_FILES) return
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue
      const absolutePath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      const metadata = await stat(absolutePath)
      const path = normalizeRelativePath(relative(root, absolutePath))
      files.push({
        category: categorizeFile(path),
        path,
        size: metadata.size,
        updatedAt: metadata.mtimeMs,
      })
    }
  }

  await walk(root)
  return files.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'))
}

/** Resolves an archive file or folder to a containing directory inside the workspace trust boundary. */
export const resolveWorkspaceExplorerTarget = async (
  workspacePath: string,
  requestedPath: string
) => {
  if (isAbsolute(requestedPath))
    throw new BadRequestError('Archive path must be workspace-relative')
  const root = await realpath(workspacePath)
  const target = await realpath(resolve(root, requestedPath || '.'))
  const relativeTarget = relative(root, target)
  if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new BadRequestError('Archive path is outside the workspace')
  }
  const metadata = await stat(target)
  return metadata.isDirectory() ? target : dirname(target)
}
