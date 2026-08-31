import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const workspaceDirs: string[] = []

afterEach(() => {
  for (const directory of workspaceDirs.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

/** Sends one authenticated lifecycle action through the same endpoint used by the desktop UI. */
const transition = (baseUrl: string, cookie: string, workspaceId: string, action: string) =>
  fetch(`${baseUrl}/api/workspaces/${workspaceId}/workflow/actions`, {
    body: JSON.stringify({ action }),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })

describe('project workflow routes', () => {
  test('keeps planning history separate and blocks development until both real artifacts are approved', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'agent-company-workflow-'))
    workspaceDirs.push(workspacePath)
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Student Admin')
      const architect = server.store.addWorker(workspace.id, { name: '架构师', role: 'custom' })
      const designer = server.store.addWorker(workspace.id, { name: 'UI 设计师', role: 'custom' })

      const userInput = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/user-input`, {
        body: JSON.stringify({
          recipient: '产品经理',
          text: '开发一个学生信息管理平台',
          thread: 'planning',
        }),
        headers: { 'content-type': 'application/json', cookie },
        method: 'POST',
      })
      expect(userInput.status).toBe(202)
      expect(
        (await transition(server.baseUrl, cookie, workspace.id, 'freeze_requirements')).status
      ).toBe(200)

      const prematureApproval = await transition(
        server.baseUrl,
        cookie,
        workspace.id,
        'approve_architecture'
      )
      expect(prematureApproval.status).toBe(409)

      await server.store.dispatchTask(workspace.id, architect.id, '输出架构方案')
      server.store.reportTask(workspace.id, architect.id, {
        artifacts: [
          '/artifacts/agent-company-runtime.html',
          'docs/architecture/student-admin.html',
        ],
        text: '架构演示图已生成',
      })
      await server.store.dispatchTask(workspace.id, designer.id, '输出 UI 方案')
      server.store.reportTask(workspace.id, designer.id, {
        artifacts: ['docs/design/student-admin.png'],
        text: '桌面 UI 设计图已生成',
      })

      expect(
        (await transition(server.baseUrl, cookie, workspace.id, 'approve_architecture')).status
      ).toBe(200)
      expect((await transition(server.baseUrl, cookie, workspace.id, 'approve_ui')).status).toBe(
        200
      )
      const development = await transition(
        server.baseUrl,
        cookie,
        workspace.id,
        'start_development'
      )
      expect(development.status).toBe(200)
      expect(await development.json()).toMatchObject({
        active_thread: 'execution',
        architecture_status: 'approved',
        stage: 'development',
        ui_status: 'approved',
      })

      const planning = await fetch(
        `${server.baseUrl}/api/workspaces/${workspace.id}/conversation?thread=planning`,
        { headers: { cookie } }
      )
      const planningEntries = (await planning.json()) as Array<{
        actor_name: string
        artifacts: string[]
        text: string
      }>
      expect(planningEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actor_name: '你', text: '开发一个学生信息管理平台' }),
          expect.objectContaining({
            actor_name: '架构师',
            artifacts: ['docs/architecture/student-admin.html'],
          }),
          expect.objectContaining({
            actor_name: 'UI 设计师',
            artifacts: ['docs/design/student-admin.png'],
          }),
        ])
      )

      const execution = await fetch(
        `${server.baseUrl}/api/workspaces/${workspace.id}/conversation?thread=execution`,
        { headers: { cookie } }
      )
      expect(await execution.json()).toEqual([
        expect.objectContaining({ actor_name: '流程系统', type: 'system' }),
      ])
    } finally {
      await server.close()
    }
  })
})
