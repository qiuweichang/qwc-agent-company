import type { ProjectWorkflowState } from '../shared/workflow-types.js'
import { workflowActions, workflowThreads } from '../shared/workflow-types.js'
import { BadRequestError, ConflictError } from './http-errors.js'
import { autostartOrchestrator } from './orchestrator-autostart.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'
import { getOrchestratorId } from './workspace-store-support.js'

/**
 * Legacy application-owned demo paths that must never appear as project output.
 * Real architecture artifacts live inside each workspace under docs/architecture.
 */
const INTERNAL_DEMO_ARTIFACT_PATHS = new Set([
  '/artifacts/agent-company-runtime.html',
  'artifacts/agent-company-runtime.html',
  'web/public/artifacts/agent-company-runtime.html',
  'web/dist/artifacts/agent-company-runtime.html',
])

/** Removes only the retired built-in demo while preserving all workspace-reported artifacts. */
const withoutInternalDemoArtifacts = (artifacts: string[]) =>
  artifacts.filter((artifact) => !INTERNAL_DEMO_ARTIFACT_PATHS.has(artifact.replaceAll('\\', '/')))

const serializeState = (state: ProjectWorkflowState) => ({
  active_thread: state.activeThread,
  architecture_status: state.architectureStatus,
  requirements_frozen: state.requirementsFrozen,
  stage: state.stage,
  ui_status: state.uiStatus,
  updated_at: state.updatedAt,
  workspace_id: state.workspaceId,
})

/** Keeps detailed worker instructions out of the public thread while naming the assigned work. */
const summarizeDispatch = (text: string, recipientName: string | undefined) => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const withoutRolePreamble = normalized.replace(/^你是本项目的[^。.!！]*[。.!！]\s*/, '')
  const taskMatch = withoutRolePreamble.match(
    /(?:任务内容|目标|请立即|请)[:：]?\s*([^。；;]{4,80})/
  )
  const task = (taskMatch?.[1] ?? withoutRolePreamble).slice(0, 72).trim()
  return `已向 ${recipientName ?? '团队成员'} 派发：${task || '开始执行新任务'}`
}

/** HTTP routes for lifecycle gates and durable planning/execution conversation history. */
export const workflowRoutes: RouteDefinition[] = [
  route('GET', '/api/workspaces/:workspaceId/workflow', ({ params, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) return
    sendJson(response, 200, serializeState(store.getWorkflowState(workspaceId)))
  }),
  route(
    'GET',
    '/api/workspaces/:workspaceId/conversation',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const requestedThread = url.searchParams.get('thread') ?? 'planning'
      if (!workflowThreads.includes(requestedThread as (typeof workflowThreads)[number])) {
        throw new BadRequestError('thread must be planning or execution')
      }
      const entries = store.listConversationEntries(
        workspaceId,
        requestedThread as (typeof workflowThreads)[number]
      )
      sendJson(
        response,
        200,
        entries.map((entry) => ({
          actor_id: entry.actorId,
          actor_name: entry.actorName,
          actor_role: entry.actorRole,
          artifacts: withoutInternalDemoArtifacts(entry.artifacts),
          created_at: entry.createdAt,
          id: entry.id,
          recipient_name: entry.recipientName ?? null,
          status: entry.status,
          text:
            entry.type === 'dispatch'
              ? summarizeDispatch(entry.text, entry.recipientName)
              : entry.text,
          thread: entry.thread,
          type: entry.type,
        }))
      )
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/planning-kickoff',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const workspace = store.getWorkspaceSnapshot(workspaceId).summary
      store.notifyOrchestrator(
        workspaceId,
        [
          '[Agent Company 新项目规划启动]',
          `项目名称：${workspace.name}`,
          `项目目录：${workspace.path}`,
          '不要让用户重新描述整个项目。先根据项目名称和当前目录做领域判断，形成 2–4 条初步假设；再派发产品经理，让产品经理向用户展示简短的项目化分析，并且一次只问一个最高价值问题。',
          '产品经理的派单必须包含针对本项目的“计划项”编号清单，禁止附带任何 Agent Company 内置示例图。',
          '不得调用 CLI 内建 AskUserQuestion 或终端选择器；所有追问必须由产品经理通过 team report 返回 Web 对话。',
          '产品经理的 team report 会自动以“产品经理”身份直接显示给用户。不要复述、改写或代为转达产品经理的问题；等待用户直接回复产品经理。',
        ].join('\n')
      )
      sendJson(response, 202, { ok: true })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/workflow/actions',
    async ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const body = await readJsonBody<{ action?: string }>(request)
      if (!workflowActions.includes(body.action as (typeof workflowActions)[number])) {
        throw new BadRequestError('Unknown workflow action')
      }
      const orchestratorId = getOrchestratorId(workspaceId)
      const launchConfig = store.peekAgentLaunchConfig(workspaceId, orchestratorId)
      if (launchConfig && !store.getActiveRunByAgentId(workspaceId, orchestratorId)) {
        const start = await autostartOrchestrator(
          store,
          workspaceId,
          orchestratorId,
          String(request.socket.localPort ?? '')
        )
        if (!start.ok) {
          throw new ConflictError(`部门经理启动失败：${start.error ?? '未知错误'}`)
        }
      }
      const state = store.transitionWorkflow(
        workspaceId,
        body.action as (typeof workflowActions)[number]
      )
      sendJson(response, 200, serializeState(state))
    }
  ),
]
