import type { IncomingMessage } from 'node:http'
import { mkdirSync } from 'node:fs'
import { workflowThreads } from '../shared/workflow-types.js'
import { DEPARTMENT_MANAGER_NAME } from '../shared/agent-company-labels.js'
import {
  resolveCommandPresetLaunchConfig,
  resolveStartupCommandLaunchConfig,
} from './agent-launch-resolver.js'
import { autostartAgent, autostartOrchestrator } from './orchestrator-autostart.js'
import { seedOrchestratorLaunchConfig } from './orchestrator-launch.js'
import { ConflictError } from './http-errors.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type {
  CreateWorkerBody,
  CreateWorkspaceBody,
  RouteDefinition,
  UserInputBody,
} from './route-types.js'
import type { RuntimeStore } from './runtime-store.js'
import { authenticateCliAgent, requireCommandForRole } from './team-authz.js'
import { enrichTeamList } from './team-list-enrichment.js'
import { serializeTeamListItem } from './team-list-serializer.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'
import { validateWorkspacePath } from './workspace-path-validation.js'
import { getOrchestratorId } from './workspace-store-support.js'

const getSerializedWorker = (workspaceId: string, workerId: string, store: RuntimeStore) => {
  const worker = store.listWorkers(workspaceId).find((item) => item.id === workerId)
  if (!worker) {
    throw new Error(`Worker not found: ${workerId}`)
  }
  const [enriched] = enrichTeamList(workspaceId, store, [worker])
  if (!enriched) throw new Error(`Worker enrichment failed: ${workerId}`)
  return serializeTeamListItem(enriched)
}

const getRuntimePort = (request: IncomingMessage) => String(request.socket.localPort ?? '')

export const workspaceRoutes: RouteDefinition[] = [
  route('GET', '/api/workspaces', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(response, 200, store.listWorkspaces())
  }),
  route('POST', '/api/workspaces', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const body = await readJsonBody<CreateWorkspaceBody>(request)
    const startupCommand = typeof body.startup_command === 'string' ? body.startup_command : null
    if (typeof body.path === 'string' && body.path.trim()) {
      // New personal projects are allowed to target a not-yet-created directory. Creating the exact
      // requested path here keeps path validation strict while supporting the default workspace root.
      mkdirSync(body.path.trim(), { recursive: true })
    }
    const workspacePath = validateWorkspacePath(body.path)
    const workspace = store.createWorkspace(workspacePath, body.name)
    seedOrchestratorLaunchConfig(
      store,
      store.settings,
      workspace.id,
      body.command_preset_id ?? null,
      startupCommand
    )

    const autostart = body.autostart_orchestrator !== false
    if (!autostart) {
      sendJson(response, 201, {
        ...workspace,
        orchestrator_start: { ok: false, error: null, run_id: null },
      })
      return
    }

    // Spawn failure must NOT block workspace creation — see AGENTS.md §1
    // (no try/catch fallbacks in production code, but `autostartOrchestrator`
    // captures the failure as a structured result instead of throwing).
    const orchestratorStart = await autostartOrchestrator(
      store,
      workspace.id,
      getOrchestratorId(workspace.id),
      getRuntimePort(request)
    )
    sendJson(response, 201, { ...workspace, orchestrator_start: orchestratorStart })
  }),
  route('PATCH', '/api/workspaces/:workspaceId', async ({ params, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) return
    const body = await readJsonBody<{ name?: string }>(request)
    if (typeof body.name !== 'string') {
      sendJson(response, 400, { error: 'name is required' })
      return
    }
    sendJson(response, 200, store.renameWorkspace(workspaceId, body.name))
  }),
  route('DELETE', '/api/workspaces/:workspaceId', async ({ params, request, response, store }) => {
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) {
      return
    }

    requireUiTokenFromRequest(request, store.validateUiToken)
    const deleteFiles =
      new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('delete_files') === 'true'
    await store.deleteWorkspace(workspaceId, { deleteFiles })
    response.statusCode = 204
    response.end()
  }),
  route('GET', '/api/ui/workspaces/:workspaceId/team', ({ params, request, response, store }) => {
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) {
      return
    }

    requireUiTokenFromRequest(request, store.validateUiToken)

    sendJson(
      response,
      200,
      enrichTeamList(workspaceId, store, store.listWorkers(workspaceId)).map(serializeTeamListItem)
    )
  }),
  route('GET', '/api/workspaces/:workspaceId/team', ({ params, request, response, store }) => {
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) {
      return
    }

    const agentId = request.headers['x-hive-agent-id']
    const token = request.headers['x-hive-agent-token']
    const agent = authenticateCliAgent({
      fromAgentId: typeof agentId === 'string' ? agentId : undefined,
      getAgent: store.getAgent,
      token: typeof token === 'string' ? token : undefined,
      validateToken: store.validateAgentToken,
      workspaceId,
    })
    requireCommandForRole(agent, 'list')

    sendJson(
      response,
      200,
      enrichTeamList(workspaceId, store, store.listWorkers(workspaceId)).map(serializeTeamListItem)
    )
  }),
  route(
    'POST',
    '/api/workspaces/:workspaceId/workers',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)

      const body = await readJsonBody<CreateWorkerBody>(request)
      const presetId = body.command_preset_id ?? null
      const startupCommand = typeof body.startup_command === 'string' ? body.startup_command : null
      const launchConfig = startupCommand?.trim()
        ? resolveStartupCommandLaunchConfig(store.settings, startupCommand, presetId)
        : presetId
          ? resolveCommandPresetLaunchConfig(store.settings, presetId)
          : undefined
      if (presetId && !startupCommand?.trim() && !launchConfig) {
        throw new Error(`Command preset not found: ${presetId}`)
      }
      const worker = store.addWorker(workspaceId, body)
      if (launchConfig) {
        try {
          store.configureAgentLaunch(workspaceId, worker.id, launchConfig)
        } catch (error) {
          store.deleteWorker(workspaceId, worker.id)
          throw error
        }
      }

      const agentStart =
        body.autostart === true
          ? await autostartAgent(store, workspaceId, worker.id, getRuntimePort(request), {
              missingConfigError: 'No worker launch config available',
            })
          : { ok: false, error: null, run_id: null }

      sendJson(response, 201, {
        ...getSerializedWorker(workspaceId, worker.id, store),
        agent_start: agentStart,
      })
    }
  ),
  route(
    'DELETE',
    '/api/workspaces/:workspaceId/workers/:workerId',
    ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id and worker id are required'
      )
      const workerId = getRequiredParam(
        response,
        params,
        'workerId',
        'Workspace id and worker id are required'
      )
      if (!workspaceId || !workerId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)
      store.deleteWorker(workspaceId, workerId)
      response.statusCode = 204
      response.end()
    }
  ),
  route(
    'PATCH',
    '/api/workspaces/:workspaceId/workers/:workerId',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id and worker id are required'
      )
      const workerId = getRequiredParam(
        response,
        params,
        'workerId',
        'Workspace id and worker id are required'
      )
      if (!workspaceId || !workerId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<{ name?: string }>(request)
      if (typeof body.name !== 'string') {
        sendJson(response, 400, { error: 'name is required' })
        return
      }
      store.renameWorker(workspaceId, workerId, body.name)
      sendJson(response, 200, getSerializedWorker(workspaceId, workerId, store))
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/user-input',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)

      const body = await readJsonBody<UserInputBody>(request)
      const thread = workflowThreads.includes(body.thread ?? 'planning')
        ? (body.thread ?? 'planning')
        : 'planning'
      const recipient =
        typeof body.recipient === 'string' && body.recipient.trim()
          ? body.recipient.trim()
          : DEPARTMENT_MANAGER_NAME
      const threadLabel = thread === 'planning' ? '规划流程' : '执行流程'
      const workspace = store.getWorkspaceSnapshot(workspaceId).summary
      if (recipient === DEPARTMENT_MANAGER_NAME) {
        const orchestratorId = getOrchestratorId(workspaceId)
        if (!store.getActiveRunByAgentId(workspaceId, orchestratorId)) {
          if (!store.peekAgentLaunchConfig(workspaceId, orchestratorId)) {
            seedOrchestratorLaunchConfig(store, store.settings, workspaceId)
          }
          const start = await autostartOrchestrator(
            store,
            workspaceId,
            orchestratorId,
            getRuntimePort(request)
          )
          if (!start.ok) {
            throw new ConflictError(`部门经理启动失败：${start.error ?? '未知错误'}`)
          }
        }
      }
      const directWorkerInstructions = recipient.includes('产品')
        ? [
            `[${threadLabel} · 用户直接回复产品经理]`,
            '任务内容：基于用户最新回答继续需求澄清，并返回下一个最高价值问题。',
            `项目：${workspace.name}`,
            `工作目录：${workspace.path}`,
            `用户消息：${body.text}`,
            '请基于项目名称与已有对话先做具体分析，再继续需求澄清。一次只问一个最高价值问题。',
            '不得调用 CLI 内建 AskUserQuestion 或终端选择器；需要用户回答的问题必须通过 team report 返回 Web 对话。',
            'team report 正文会原样以“产品经理”身份直接显示给用户。请直接对用户说，不要请求部门经理转达，不要写成发给部门经理的汇报。',
          ].join('\n')
        : [
            `[${threadLabel} · 用户直接交办给 @${recipient}]`,
            '任务内容：处理用户的直接交办，持续报告步骤并把最终结果返回 Web 对话。',
            `项目：${workspace.name}`,
            `工作目录：${workspace.path}`,
            `用户消息：${body.text}`,
            '请直接处理，并通过 team status 持续报告当前步骤，完成后通过 team report 返回 Web 对话。',
            '不得调用 CLI 内建 AskUserQuestion 或终端选择器。',
          ].join('\n')
      await store.routeUserInput(
        workspaceId,
        `${workspaceId}:orchestrator`,
        recipient,
        body.text,
        thread,
        recipient === DEPARTMENT_MANAGER_NAME
          ? `[${threadLabel} · 用户希望由 @${DEPARTMENT_MANAGER_NAME} 处理]\n${body.text}\n不得调用 CLI 内建 AskUserQuestion 或终端选择器；需要追问时请把问题直接写回 Web 对话。`
          : directWorkerInstructions,
        getRuntimePort(request)
      )
      sendJson(response, 202, { ok: true })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/agents/:agentId/start',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id and agent id are required'
      )
      const agentId = getRequiredParam(
        response,
        params,
        'agentId',
        'Workspace id and agent id are required'
      )
      if (!workspaceId || !agentId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)

      if (
        agentId === getOrchestratorId(workspaceId) &&
        !store.peekAgentLaunchConfig(workspaceId, agentId)
      ) {
        seedOrchestratorLaunchConfig(store, store.settings, workspaceId)
      }
      const run = await store.startAgent(workspaceId, agentId, {
        hivePort: getRuntimePort(request),
      })
      sendJson(response, 201, { run_id: run.runId })
    }
  ),
]
