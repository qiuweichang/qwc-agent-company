import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { ensureWindowsDeploymentScripts } from '../../src/server/workspace-deployment.js'
import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

/** Creates a minimal Vite/Node project that exercises deployment-script generation. */
const createDeployableWorkspace = () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'agent-company-project-ops-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, 'web'), { recursive: true })
  mkdirSync(join(workspacePath, 'docs', 'architecture'), { recursive: true })
  mkdirSync(join(workspacePath, 'server', 'src'), { recursive: true })
  writeFileSync(
    join(workspacePath, 'package.json'),
    JSON.stringify({ scripts: { build: 'echo build', start: 'node server/src/index.js' } })
  )
  writeFileSync(
    join(workspacePath, 'web', 'package.json'),
    JSON.stringify({ scripts: { dev: 'vite' } })
  )
  writeFileSync(join(workspacePath, 'web', 'vite.config.ts'), 'export default {}\n')
  writeFileSync(join(workspacePath, 'web', 'src.ts'), 'export const ui = true\n')
  writeFileSync(join(workspacePath, 'server', 'src', 'index.js'), 'console.log("server")\n')
  writeFileSync(join(workspacePath, 'docs', 'architecture', 'runtime.html'), '<html></html>')
  return workspacePath
}

describe('project operation routes', () => {
  test('renames projects and exposes role-specific member plan progress', async () => {
    const workspacePath = createDeployableWorkspace()
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Old name')
      const backend = server.store.addWorker(workspace.id, {
        name: '后端工程师',
        role: 'coder',
      })
      server.store.getWorker(workspace.id, backend.id).status = 'idle'
      await server.store.dispatchTask(workspace.id, backend.id, '实现学生接口')

      const rename = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}`, {
        body: JSON.stringify({ name: '学生平台' }),
        headers: { 'content-type': 'application/json', cookie },
        method: 'PATCH',
      })
      expect(rename.status).toBe(200)
      await expect(rename.json()).resolves.toMatchObject({ name: '学生平台' })

      const plans = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/member-plans`, {
        headers: { cookie },
      })
      expect(plans.status).toBe(200)
      await expect(plans.json()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            agentId: backend.id,
            items: expect.arrayContaining([
              expect.objectContaining({ label: '实现学生接口', status: 'active' }),
            ]),
          }),
        ])
      )

      server.store.configureAgentLaunch(workspace.id, backend.id, {
        args: ['-e', 'console.log("Thinking: design schema\\nTool: writeFile")'],
        command: process.execPath,
      })
      await server.store.startAgent(workspace.id, backend.id, { hivePort: '4010' })
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (server.store.listAgentRuns(backend.id)[0]?.status === 'exited') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const context = await fetch(
        `${server.baseUrl}/api/workspaces/${workspace.id}/agents/${backend.id}/context`,
        { headers: { cookie } }
      )
      expect(context.status).toBe(200)
      await expect(context.json()).resolves.toMatchObject({
        runs: [expect.objectContaining({ output: expect.stringContaining('Tool: writeFile') })],
      })
    } finally {
      await server.close()
    }
  })

  test('indexes archive categories and opens only the containing workspace folder', async () => {
    const workspacePath = createDeployableWorkspace()
    const openedPaths: string[] = []
    const server = await startTestServer({
      openWorkspaceService: async (input) => {
        openedPaths.push(input.path)
        return { effectiveTargetId: 'finder', ok: true }
      },
    })
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Archive')
      const archive = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/archive`, {
        headers: { cookie },
      })
      expect(archive.status).toBe(200)
      await expect(archive.json()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'architecture',
            path: 'docs/architecture/runtime.html',
          }),
          expect.objectContaining({ category: 'frontend', path: 'web/src.ts' }),
          expect.objectContaining({ category: 'backend', path: 'server/src/index.js' }),
        ])
      )

      const open = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/archive/open`, {
        body: JSON.stringify({ path: 'docs/architecture/runtime.html' }),
        headers: { 'content-type': 'application/json', cookie },
        method: 'POST',
      })
      expect(open.status).toBe(200)
      expect(openedPaths[0]).toBe(join(workspacePath, 'docs', 'architecture'))
    } finally {
      await server.close()
    }
  })

  test('writes Windows port detection, one-click deployment and random API proxy scripts', async () => {
    const workspacePath = createDeployableWorkspace()

    await ensureWindowsDeploymentScripts(workspacePath)

    const detector = readFileSync(join(workspacePath, 'scripts', 'find-free-port.ps1'), 'utf8')
    const deploy = readFileSync(join(workspacePath, 'scripts', 'deploy-windows.ps1'), 'utf8')
    const vite = readFileSync(join(workspacePath, 'web', 'vite.agent-company.config.ts'), 'utf8')
    expect(detector).toContain('TcpListener')
    expect(deploy).toContain('FrontendPort')
    expect(deploy).toContain('BackendPort')
    expect(deploy).toContain("$env:NO_BROWSER = '1'")
    expect(deploy).toContain('-WindowStyle Hidden')
    expect(vite).toContain("proxy: { '/api'")
    expect(vite).toContain('process.env.BACKEND_PORT')
  })
})
