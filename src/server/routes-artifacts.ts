import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

import { BadRequestError } from './http-errors.js'
import { getRequiredParam, route } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

/**
 * Resolves a reported artifact under the real workspace root. Both paths use
 * realpath so a symlink cannot escape the local project trust boundary.
 */
const resolveWorkspaceArtifact = async (workspacePath: string, requestedPath: string) => {
  if (!requestedPath.trim()) throw new BadRequestError('Artifact path is required')
  const workspaceRoot = await realpath(workspacePath)
  // Older CLI reports could persist an absolute filename returned by a generator.
  // Resolve both forms, then apply the same realpath containment check so an
  // in-workspace legacy record remains viewable without weakening the boundary.
  const candidatePath = isAbsolute(requestedPath)
    ? requestedPath
    : resolve(workspaceRoot, requestedPath)
  const artifactPath = await realpath(candidatePath)
  const relativePath = relative(workspaceRoot, artifactPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new BadRequestError('Artifact path is outside the workspace')
  }
  const metadata = await stat(artifactPath)
  if (!metadata.isFile()) throw new BadRequestError('Artifact path is not a file')
  return artifactPath
}

/** Serves only allow-listed visual artifact formats from the selected workspace. */
export const artifactRoutes: RouteDefinition[] = [
  route(
    'GET',
    '/api/workspaces/:workspaceId/artifact',
    async ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const requestedPath = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('path')
      if (!requestedPath) throw new BadRequestError('Artifact path is required')
      const workspace = store.getWorkspaceSnapshot(workspaceId).summary
      const artifactPath = await resolveWorkspaceArtifact(workspace.path, requestedPath)
      const contentType = CONTENT_TYPES[extname(artifactPath).toLowerCase()]
      if (!contentType) throw new BadRequestError('Unsupported artifact format')
      const body = await readFile(artifactPath)
      response.statusCode = 200
      response.setHeader('content-type', contentType)
      response.setHeader('content-length', body.byteLength)
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      response.end(body)
    }
  ),
]
