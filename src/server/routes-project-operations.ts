import { BadRequestError, ConflictError } from './http-errors.js'
import { buildMemberPlan } from './member-plan.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'
import {
  getWorkspaceDeployment,
  startWorkspaceDeployment,
  stopWorkspaceDeployment,
} from './workspace-deployment.js'
import {
  listArchivedProjectFiles,
  resolveWorkspaceExplorerTarget,
} from './workspace-file-indexer.js'

const readOptionalPort = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === 0) return undefined
  if (!Number.isInteger(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new BadRequestError(`${label} must be an integer between 1024 and 65535`)
  }
  return Number(value)
}

/** Project-level routes for member plans, archive navigation and local delivery. */
export const projectOperationRoutes: RouteDefinition[] = [
  route(
    'GET',
    '/api/workspaces/:workspaceId/agents/:agentId/context',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
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
      if (!workspaceId || !agentId) return
      store.getAgent(workspaceId, agentId)
      const messages = ['planning', 'execution'].flatMap((thread) =>
        store
          .listConversationEntries(workspaceId, thread as 'planning' | 'execution')
          .filter((entry) => entry.actorId === agentId)
      )
      const runs = store.listAgentRuns(agentId).map((run) => {
        try {
          const live = store.getLiveRun(run.runId)
          return { ...run, output: live.output, status: live.status }
        } catch {
          return run
        }
      })
      sendJson(response, 200, {
        dispatches: store.listDispatches(workspaceId).filter((item) => item.toAgentId === agentId),
        messages,
        runs,
      })
    }
  ),
  route(
    'GET',
    '/api/workspaces/:workspaceId/member-plans',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const dispatches = store.listDispatches(workspaceId)
      const workflow = store.getWorkflowState(workspaceId)
      sendJson(
        response,
        200,
        workspace.agents.map((agent) => buildMemberPlan(agent, dispatches, workflow))
      )
    }
  ),
  route(
    'GET',
    '/api/workspaces/:workspaceId/archive',
    async ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const workspace = store.getWorkspaceSnapshot(workspaceId).summary
      sendJson(response, 200, await listArchivedProjectFiles(workspace.path))
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/archive/open',
    async ({ openWorkspaceService, params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const body = await readJsonBody<{ path?: string }>(request)
      const workspace = store.getWorkspaceSnapshot(workspaceId).summary
      const target = await resolveWorkspaceExplorerTarget(workspace.path, body.path ?? '')
      const result = await openWorkspaceService({ path: target, targetId: 'finder' })
      if (!result.ok) {
        sendJson(response, 502, { error: 'Failed to open File Explorer' })
        return
      }
      sendJson(response, 200, { ok: true })
    }
  ),
  route(
    'GET',
    '/api/workspaces/:workspaceId/deployment',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      store.getWorkspaceSnapshot(workspaceId)
      sendJson(response, 200, getWorkspaceDeployment(workspaceId))
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/deployment',
    async ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const workflow = store.getWorkflowState(workspaceId)
      if (workflow.stage !== 'complete') {
        throw new ConflictError('项目完成全部验收后才能部署')
      }
      const body = await readJsonBody<{ backend_port?: unknown; frontend_port?: unknown }>(request)
      const backendPort = readOptionalPort(body.backend_port, 'backend_port')
      const frontendPort = readOptionalPort(body.frontend_port, 'frontend_port')
      const workspace = store.getWorkspaceSnapshot(workspaceId).summary
      const input = {
        ...(backendPort ? { backendPort } : {}),
        ...(frontendPort ? { frontendPort } : {}),
      }
      sendJson(response, 201, await startWorkspaceDeployment(workspaceId, workspace.path, input))
    }
  ),
  route(
    'DELETE',
    '/api/workspaces/:workspaceId/deployment',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      store.getWorkspaceSnapshot(workspaceId)
      sendJson(response, 200, stopWorkspaceDeployment(workspaceId))
    }
  ),
]
