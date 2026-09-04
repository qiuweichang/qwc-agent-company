import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

/** Builds the authenticated artifact endpoint URL used by the embedded diagram frame. */
const artifactUrl = (baseUrl: string, workspaceId: string, artifactPath: string) =>
  `${baseUrl}/api/workspaces/${workspaceId}/artifact?path=${encodeURIComponent(artifactPath)}`

describe('workspace artifact route', () => {
  test('serves a legacy absolute artifact when its real path remains inside the workspace', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'agent-company-artifact-workspace-'))
    tempDirs.push(workspacePath)
    const artifactPath = join(workspacePath, 'architecture.html')
    writeFileSync(artifactPath, '<!doctype html><title>Architecture</title>', 'utf8')
    const server = await startTestServer()

    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Architecture project')
      const response = await fetch(artifactUrl(server.baseUrl, workspace.id, artifactPath), {
        headers: { cookie },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      await expect(response.text()).resolves.toContain('<title>Architecture</title>')
    } finally {
      await server.close()
    }
  })

  test('rejects an absolute artifact whose real path is outside the workspace', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'agent-company-artifact-workspace-'))
    const outsidePath = mkdtempSync(join(tmpdir(), 'agent-company-artifact-outside-'))
    tempDirs.push(workspacePath, outsidePath)
    const artifactPath = join(outsidePath, 'outside.html')
    writeFileSync(artifactPath, '<!doctype html><title>Outside</title>', 'utf8')
    const server = await startTestServer()

    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Architecture project')
      const response = await fetch(artifactUrl(server.baseUrl, workspace.id, artifactPath), {
        headers: { cookie },
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Artifact path is outside the workspace',
      })
    } finally {
      await server.close()
    }
  })
})
