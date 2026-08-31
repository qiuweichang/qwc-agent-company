import { join } from 'node:path'
import { BadRequestError } from './http-errors.js'
import { readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { createStitchMcpClient } from './stitch-mcp-client.js'
import { authenticateCliAgent } from './team-authz.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

const STITCH_ENDPOINT_KEY = 'stitch_mcp_endpoint'
const STITCH_API_KEY_KEY = 'stitch_api_key'

/** Resolves the local settings override while retaining environment variables as defaults. */
const resolveStitchClient = (store: Parameters<RouteDefinition['handler']>[0]['store']) => {
  const endpoint = store.settings.getAppState(STITCH_ENDPOINT_KEY)?.value
  const apiKey = store.settings.getAppState(STITCH_API_KEY_KEY)?.value
  return createStitchMcpClient({ apiKey: apiKey ?? null, endpoint: endpoint ?? null })
}

/** Exposes real Stitch readiness and CLI-authenticated desktop generation. */
export const stitchRoutes: RouteDefinition[] = [
  route('GET', '/api/integrations/stitch/status', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const stitch = resolveStitchClient(store)
    sendJson(response, 200, { configured: stitch.configured, endpoint_origin: stitch.endpoint })
  }),
  route('PUT', '/api/integrations/stitch/config', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const body = await readJsonBody<{
      api_key?: string
      clear_api_key?: boolean
      endpoint?: string
    }>(request)
    const endpoint = body.endpoint?.trim() ?? ''
    if (endpoint && !URL.canParse(endpoint)) {
      throw new BadRequestError('Stitch MCP endpoint must be a valid URL')
    }
    store.settings.setAppState(STITCH_ENDPOINT_KEY, endpoint || null)
    if (body.clear_api_key) {
      store.settings.setAppState(STITCH_API_KEY_KEY, null)
    } else if (body.api_key?.trim()) {
      // Agent Company is local-only; the credential remains in the local Runtime SQLite store.
      store.settings.setAppState(STITCH_API_KEY_KEY, body.api_key.trim())
    }
    const stitch = resolveStitchClient(store)
    sendJson(response, 200, { configured: stitch.configured, endpoint_origin: stitch.endpoint })
  }),
  route('POST', '/api/integrations/stitch/generate', async ({ request, response, store }) => {
    const body = await readJsonBody<{
      from_agent_id?: string
      project_id?: string
      project_title?: string
      prompt?: string
      token?: string
    }>(request)
    if (!body.project_id || !body.from_agent_id || !body.token) {
      throw new BadRequestError('Missing CLI agent identity')
    }
    authenticateCliAgent({
      fromAgentId: body.from_agent_id,
      getAgent: store.getAgent,
      token: body.token,
      validateToken: store.validateAgentToken,
      workspaceId: body.project_id,
    })
    if (!body.project_title?.trim() || !body.prompt?.trim()) {
      throw new BadRequestError('project_title and prompt are required')
    }
    const stitch = resolveStitchClient(store)
    const workspace = store.getWorkspaceSnapshot(body.project_id).summary
    const result = await stitch.generate({
      outputDirectory: join(workspace.path, 'docs', 'design'),
      projectTitle: body.project_title.trim(),
      prompt: body.prompt.trim(),
    })
    sendJson(response, 201, {
      artifacts: result.artifacts,
      project_id: result.projectId,
      screen_id: result.screenId,
    })
  }),
  route('POST', '/api/integrations/stitch/revise', async ({ request, response, store }) => {
    const body = await readJsonBody<{
      from_agent_id?: string
      project_id?: string
      prompt?: string
      screen_id?: string
      stitch_project_id?: string
      token?: string
    }>(request)
    if (!body.project_id || !body.from_agent_id || !body.token) {
      throw new BadRequestError('Missing CLI agent identity')
    }
    authenticateCliAgent({
      fromAgentId: body.from_agent_id,
      getAgent: store.getAgent,
      token: body.token,
      validateToken: store.validateAgentToken,
      workspaceId: body.project_id,
    })
    if (!body.stitch_project_id?.trim() || !body.screen_id?.trim() || !body.prompt?.trim()) {
      throw new BadRequestError('stitch_project_id, screen_id and prompt are required')
    }
    const stitch = resolveStitchClient(store)
    const workspace = store.getWorkspaceSnapshot(body.project_id).summary
    const result = await stitch.revise({
      outputDirectory: join(workspace.path, 'docs', 'design'),
      projectId: body.stitch_project_id.trim(),
      prompt: body.prompt.trim(),
      screenId: body.screen_id.trim(),
    })
    sendJson(response, 201, {
      artifacts: result.artifacts,
      project_id: result.projectId,
      screen_id: result.screenId,
    })
  }),
]
