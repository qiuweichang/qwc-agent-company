import type { OpenTargetId, OpenWorkspaceErrorCode } from '../../src/shared/open-targets.js'
import type {
  ArchivedProjectFile,
  MemberPlan,
  ProjectDeployment,
} from '../../src/shared/project-operations.js'
import type {
  AgentSummary,
  TeamListItem,
  TeamListItemPayload,
  WorkerRole,
  WorkspaceSummary,
} from '../../src/shared/types.js'
import type {
  ConversationEntry,
  ProjectWorkflowState,
  WorkflowAction,
  WorkflowThread,
} from '../../src/shared/workflow-types.js'

export type { OpenTargetId, OpenWorkspaceErrorCode }

const fromPayload = (payload: TeamListItemPayload): TeamListItem => ({
  id: payload.id,
  name: payload.name,
  role: payload.role,
  status: payload.status,
  pendingTaskCount: payload.pending_task_count,
  ...(payload.last_pty_line ? { lastPtyLine: payload.last_pty_line } : {}),
  ...(payload.command_preset_id ? { commandPresetId: payload.command_preset_id } : {}),
})

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Keep the original fallback when the server did not send a JSON error body.
  }
  return fallback
}

const isStaleUiSession = async (response: Response): Promise<boolean> => {
  if (response.status !== 403) return false
  try {
    const body = (await response.clone().json()) as { error?: unknown }
    return body.error === 'UI endpoint requires valid UI token'
  } catch {
    return false
  }
}

export const initializeUiSession = async (): Promise<void> => {
  const response = await fetch('/api/ui/session', { mode: 'same-origin' })
  if (!response.ok) {
    throw new Error('Failed to initialize UI session')
  }
  await response.json()
}

let uiSessionRefreshPromise: Promise<void> | null = null

const refreshUiSession = (): Promise<void> => {
  uiSessionRefreshPromise ??= initializeUiSession().finally(() => {
    uiSessionRefreshPromise = null
  })
  return uiSessionRefreshPromise
}

const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await fetch(input, init)
  if (!(await isStaleUiSession(response))) return response

  await refreshUiSession()
  return fetch(input, init)
}

export const listWorkspaces = async (): Promise<WorkspaceSummary[]> => {
  const response = await apiFetch('/api/workspaces')

  if (!response.ok) {
    throw new Error('Failed to load workspaces')
  }

  return (await response.json()) as WorkspaceSummary[]
}

/** Renames one local project without changing its workspace path or workflow history. */
export const renameWorkspace = async (
  workspaceId: string,
  name: string
): Promise<WorkspaceSummary> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}`, {
    body: JSON.stringify({ name }),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to rename project'))
  return (await response.json()) as WorkspaceSummary
}

/** Loads the server-derived implementation checklist for every team member. */
export const listMemberPlans = async (workspaceId: string): Promise<MemberPlan[]> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/member-plans`)
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load member plans'))
  return (await response.json()) as MemberPlan[]
}

/** Indexes project-owned requirements, designs, code, tests and delivery scripts. */
export const listProjectArchive = async (workspaceId: string): Promise<ArchivedProjectFile[]> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/archive`)
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load archive'))
  return (await response.json()) as ArchivedProjectFile[]
}

/** Opens the containing folder for one archived file in the native Windows Explorer. */
export const openArchivedFileLocation = async (workspaceId: string, path: string) => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/archive/open`, {
    body: JSON.stringify({ path }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to open Explorer'))
}

/** Reads the latest local deployment state for one delivered project. */
export const getProjectDeployment = async (
  workspaceId: string
): Promise<ProjectDeployment | null> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/deployment`)
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load deployment'))
  return (await response.json()) as ProjectDeployment | null
}

/** Generates Windows scripts and starts frontend/backend on free or requested ports. */
export const deployProject = async (
  workspaceId: string,
  input: { backendPort?: number; frontendPort?: number } = {}
): Promise<ProjectDeployment> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/deployment`, {
    body: JSON.stringify({
      backend_port: input.backendPort,
      frontend_port: input.frontendPort,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to deploy project'))
  return (await response.json()) as ProjectDeployment
}

/** Stops only the frontend/backend processes recorded for this workspace deployment. */
export const stopProjectDeployment = async (workspaceId: string) => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/deployment`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to stop deployment'))
  return (await response.json()) as ProjectDeployment | null
}

export interface VersionInfo {
  currentVersion: string
  installHint: string
  latestVersion: string
  packageName: string
  releaseUrl: string
  updateAvailable: boolean
}

interface VersionInfoPayload {
  current_version: string
  install_hint: string
  latest_version: string
  package_name: string
  release_url: string
  update_available: boolean
}

export const getVersionInfo = async (): Promise<VersionInfo> => {
  const response = await apiFetch('/api/version')

  if (!response.ok) {
    throw new Error('Failed to load version info')
  }

  const payload = (await response.json()) as VersionInfoPayload
  return {
    currentVersion: payload.current_version,
    installHint: payload.install_hint,
    latestVersion: payload.latest_version,
    packageName: payload.package_name,
    releaseUrl: payload.release_url,
    updateAvailable: payload.update_available,
  }
}

export interface OrchestratorStartResult {
  ok: boolean
  error: string | null
  run_id: string | null
}

export interface CommandPreset {
  args: string[]
  available: boolean
  command: string
  displayName: string
  id: string
}

export interface RoleTemplate {
  /** Executable name associated with the role's preferred CLI preset. */
  defaultCommand?: string
  description: string
  id: string
  isBuiltin: boolean
  name: string
  roleType: WorkerRole | 'orchestrator'
}

export interface RoleTemplateInput {
  /** Executable name selected as the role's default CLI; legacy callers fall back to Claude. */
  defaultCommand?: string
  description: string
  name: string
  roleType: WorkerRole | 'orchestrator'
}

interface CommandPresetPayload {
  args: string[]
  available: boolean
  command: string
  display_name: string
  id: string
}

interface RoleTemplatePayload {
  default_command: string
  description: string
  id: string
  is_builtin: boolean
  name: string
  role_type: WorkerRole | 'orchestrator'
}

const fromRoleTemplatePayload = (payload: RoleTemplatePayload): RoleTemplate => ({
  defaultCommand: payload.default_command,
  description: payload.description,
  id: payload.id,
  isBuiltin: payload.is_builtin,
  name: payload.name,
  roleType: payload.role_type,
})

const toRoleTemplateBody = (input: RoleTemplateInput) => ({
  name: input.name,
  role_type: input.roleType,
  description: input.description,
  default_command: input.defaultCommand ?? 'claude',
  default_args: [],
  default_env: {},
})

export interface AgentStartResult {
  error: string | null
  ok: boolean
  runId: string | null
}

interface AgentStartPayload {
  error: string | null
  ok: boolean
  run_id: string | null
}

export interface CreateWorkerResult {
  agentStart: AgentStartResult
  worker: TeamListItem
}

type CreateWorkerPayload = TeamListItemPayload & { agent_start?: AgentStartPayload }

export interface CreateWorkspaceResponse extends WorkspaceSummary {
  orchestrator_start: OrchestratorStartResult
}

export const createWorkspace = async (input: {
  name: string
  path: string
  autostart_orchestrator?: boolean
  command_preset_id?: string | null
  startup_command?: string | null
}): Promise<CreateWorkspaceResponse> => {
  const response = await apiFetch('/api/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create workspace'))
  }

  return (await response.json()) as CreateWorkspaceResponse
}

/** Starts real project-specific PM discovery through the already-running department manager. */
export const startProjectPlanning = async (workspaceId: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/planning-kickoff`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to start planning'))
}

interface ProjectWorkflowStatePayload {
  active_thread: ProjectWorkflowState['activeThread']
  architecture_status: ProjectWorkflowState['architectureStatus']
  requirements_frozen: boolean
  stage: ProjectWorkflowState['stage']
  ui_status: ProjectWorkflowState['uiStatus']
  updated_at: number
  workspace_id: string
}

interface ConversationEntryPayload {
  actor_id: string | null
  actor_name: string
  actor_role: string
  artifacts: string[]
  created_at: number
  id: number
  recipient_name: string | null
  status: string | null
  text: string
  thread: WorkflowThread
  type: ConversationEntry['type']
}

const fromWorkflowPayload = (payload: ProjectWorkflowStatePayload): ProjectWorkflowState => ({
  activeThread: payload.active_thread,
  architectureStatus: payload.architecture_status,
  requirementsFrozen: payload.requirements_frozen,
  stage: payload.stage,
  uiStatus: payload.ui_status,
  updatedAt: payload.updated_at,
  workspaceId: payload.workspace_id,
})

/** Loads the durable lifecycle gates for one project workspace. */
export const getProjectWorkflow = async (workspaceId: string): Promise<ProjectWorkflowState> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workflow`)
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load workflow'))
  return fromWorkflowPayload((await response.json()) as ProjectWorkflowStatePayload)
}

/** Loads one planning or execution conversation without mixing thread history. */
export const listConversation = async (
  workspaceId: string,
  thread: WorkflowThread
): Promise<ConversationEntry[]> => {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/conversation?thread=${encodeURIComponent(thread)}`
  )
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load conversation'))
  return ((await response.json()) as ConversationEntryPayload[]).map((entry) => ({
    actorId: entry.actor_id,
    actorName: entry.actor_name,
    actorRole: entry.actor_role,
    artifacts: entry.artifacts,
    createdAt: entry.created_at,
    id: entry.id,
    ...(entry.recipient_name ? { recipientName: entry.recipient_name } : {}),
    status: entry.status,
    text: entry.text,
    thread: entry.thread,
    type: entry.type,
  }))
}

/** Applies one validated lifecycle action and returns the resulting server state. */
export const transitionProjectWorkflow = async (
  workspaceId: string,
  action: WorkflowAction
): Promise<ProjectWorkflowState> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workflow/actions`, {
    body: JSON.stringify({ action }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to update workflow'))
  return fromWorkflowPayload((await response.json()) as ProjectWorkflowStatePayload)
}

/** Sends user text to the department manager while preserving its visible recipient and thread. */
export const sendProjectMessage = async (
  workspaceId: string,
  input: { recipient: string; text: string; thread: WorkflowThread }
): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/user-input`, {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to send message'))
}

/** Builds the authenticated artifact URL served from inside the project workspace. */
export const getWorkspaceArtifactUrl = (workspaceId: string, path: string) =>
  `/api/workspaces/${workspaceId}/artifact?path=${encodeURIComponent(path)}`

export interface StitchStatus {
  configured: boolean
  endpointOrigin: string | null
}

export interface StitchConfigurationInput {
  apiKey?: string
  clearApiKey?: boolean
  endpoint: string
}

/** Reads whether the Runtime has real Stitch MCP credentials configured. */
export const getStitchStatus = async (): Promise<StitchStatus> => {
  const response = await apiFetch('/api/integrations/stitch/status')
  if (!response.ok)
    throw new Error(await readErrorMessage(response, 'Failed to load Stitch status'))
  const payload = (await response.json()) as {
    configured: boolean
    endpoint_origin: string | null
  }
  return { configured: payload.configured, endpointOrigin: payload.endpoint_origin }
}

/** Persists local Stitch MCP credentials without returning the API key to the browser. */
export const saveStitchConfiguration = async (
  input: StitchConfigurationInput
): Promise<StitchStatus> => {
  const response = await apiFetch('/api/integrations/stitch/config', {
    body: JSON.stringify({
      api_key: input.apiKey,
      clear_api_key: input.clearApiKey ?? false,
      endpoint: input.endpoint,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'PUT',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to save Stitch configuration'))
  }
  const payload = (await response.json()) as {
    configured: boolean
    endpoint_origin: string | null
  }
  return { configured: payload.configured, endpointOrigin: payload.endpoint_origin }
}

/** Permanently removes an Agent Company project together with its dedicated local directory. */
export const deleteWorkspace = async (workspaceId: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}?delete_files=true`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete workspace'))
  }
}

export const startAgentRun = async (
  workspaceId: string,
  agentId: string
): Promise<{ runId: string }> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/agents/${agentId}/start`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to start agent run'))
  }
  const body = (await response.json()) as { run_id: string }
  return { runId: body.run_id }
}

export const stopAgentRun = async (runId: string): Promise<void> => {
  const response = await apiFetch(`/api/runtime/runs/${runId}/stop`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Failed to stop agent run')
  }
}

export const restartAgentRun = async (
  workspaceId: string,
  agentId: string,
  runId: string
): Promise<{ runId: string }> => {
  // Best-effort stop: a 404 here often means the run already exited on its
  // own; either way we proceed to start a fresh one. Swallowed errors land in
  // the dev console for diagnosis.
  await stopAgentRun(runId).catch((error: unknown) => {
    console.error('[hive] swallowed:restartAgentRun.stop', error)
  })
  return startAgentRun(workspaceId, agentId)
}

export const getActiveWorkspaceId = async (): Promise<string | null> => {
  const response = await apiFetch('/api/settings/app-state/active_workspace_id')

  if (!response.ok) {
    throw new Error('Failed to load active workspace')
  }

  const payload = (await response.json()) as { key: string; value: string | null }
  return payload.value
}

export const saveActiveWorkspaceId = async (workspaceId: string | null): Promise<void> => {
  const response = await apiFetch('/api/settings/app-state/active_workspace_id', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: workspaceId }),
  })

  if (!response.ok) {
    throw new Error('Failed to save active workspace')
  }
}

export const listWorkers = async (workspaceId: string): Promise<TeamListItem[]> => {
  const response = await apiFetch(`/api/ui/workspaces/${workspaceId}/team`, {
    mode: 'same-origin',
  })

  if (!response.ok) {
    throw new Error('Failed to load workers')
  }

  const payload = (await response.json()) as TeamListItemPayload[]
  return payload.map(fromPayload)
}

export const listCommandPresets = async (): Promise<CommandPreset[]> => {
  const response = await apiFetch('/api/settings/command-presets')

  if (!response.ok) {
    throw new Error('Failed to load command presets')
  }

  return ((await response.json()) as CommandPresetPayload[]).map((preset) => ({
    args: preset.args,
    available: preset.available,
    command: preset.command,
    displayName: preset.display_name,
    id: preset.id,
  }))
}

export type TerminalInputProfile = 'default' | 'opencode'

export interface TerminalRunSummary {
  agent_id: string
  agent_name: string
  run_id: string
  status: string
  terminal_input_profile?: TerminalInputProfile
}

export interface TerminalRunDetails {
  agentId: string
  exitCode: number | null
  output: string
  pid: number | null
  runId: string
  status: string
}

export interface HistoricalTerminalRun {
  agentId: string
  endedAt: number | null
  exitCode: number | null
  output: string
  pid: number | null
  runId: string
  startedAt: number
  status: string
}

export interface MemberProcessContext {
  dispatches: Array<{
    artifacts: string[]
    createdAt: number
    id: string
    reportText: string | null
    reportedAt: number | null
    status: DispatchSummary['status']
    text: string
    toAgentId: string
  }>
  messages: ConversationEntry[]
  runs: HistoricalTerminalRun[]
}

export interface DispatchSummary {
  artifacts: string[]
  createdAt: number
  id: string
  reportText: string | null
  reportedAt: number | null
  status: 'queued' | 'submitted' | 'reported' | 'cancelled'
  text: string
  toAgentId: string
}

interface DispatchSummaryPayload {
  artifacts: string[]
  created_at: number
  id: string
  report_text: string | null
  reported_at: number | null
  state: DispatchSummary['status']
  text: string
  to_agent_id: string
}

/** Loads durable assignments so a member drawer can show full hidden task instructions. */
export const listDispatches = async (workspaceId: string): Promise<DispatchSummary[]> => {
  const response = await apiFetch(`/api/ui/workspaces/${workspaceId}/dispatches?limit=100`)
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load dispatches'))
  return ((await response.json()) as DispatchSummaryPayload[]).map((dispatch) => ({
    artifacts: dispatch.artifacts,
    createdAt: dispatch.created_at,
    id: dispatch.id,
    reportText: dispatch.report_text,
    reportedAt: dispatch.reported_at,
    status: dispatch.state,
    text: dispatch.text,
    toAgentId: dispatch.to_agent_id,
  }))
}

/** Reads the complete buffered PTY transcript for one currently live CLI run. */
export const getTerminalRun = async (runId: string): Promise<TerminalRunDetails> => {
  const response = await apiFetch(`/api/runtime/runs/${runId}`)
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load CLI context'))
  const payload = (await response.json()) as {
    agentId: string
    exitCode: number | null
    output: string
    pid: number | null
    runId: string
    status: string
  }
  return payload
}

/** Loads every durable run transcript plus assignments and reports for one member. */
export const getMemberProcessContext = async (
  workspaceId: string,
  agentId: string
): Promise<MemberProcessContext> => {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${encodeURIComponent(agentId)}/context`
  )
  if (!response.ok)
    throw new Error(await readErrorMessage(response, 'Failed to load member context'))
  return (await response.json()) as MemberProcessContext
}

export const workspaceShellAgentId = (workspaceId: string): string => `${workspaceId}:shell`

export const isWorkspaceShellRun = (run: TerminalRunSummary, workspaceId: string): boolean =>
  run.agent_id === workspaceShellAgentId(workspaceId)

export const startWorkspaceShell = async (workspaceId: string): Promise<TerminalRunSummary> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/shell/start`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to start workspace terminal'))
  }

  return (await response.json()) as TerminalRunSummary
}

export const closeWorkspaceShell = async (workspaceId: string, runId: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/shell/${runId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to close workspace terminal'))
  }
}

export const listRoleTemplates = async (): Promise<RoleTemplate[]> => {
  const response = await apiFetch('/api/settings/role-templates', {
    mode: 'same-origin',
  })

  if (!response.ok) {
    throw new Error('Failed to load role templates')
  }

  const payload = (await response.json()) as RoleTemplatePayload[]
  return payload.map(fromRoleTemplatePayload)
}

export const createRoleTemplate = async (input: RoleTemplateInput): Promise<RoleTemplate> => {
  const response = await apiFetch('/api/settings/role-templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toRoleTemplateBody(input)),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create role template'))
  }

  return fromRoleTemplatePayload((await response.json()) as RoleTemplatePayload)
}

export const updateRoleTemplate = async (
  templateId: string,
  input: RoleTemplateInput
): Promise<RoleTemplate> => {
  const response = await apiFetch(`/api/settings/role-templates/${templateId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toRoleTemplateBody(input)),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to update role template'))
  }

  return fromRoleTemplatePayload((await response.json()) as RoleTemplatePayload)
}

export const deleteRoleTemplate = async (templateId: string): Promise<void> => {
  const response = await apiFetch(`/api/settings/role-templates/${templateId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete role template'))
  }
}

export type MarketplaceLanguage = 'en' | 'zh'

export interface MarketplaceAgentEntry {
  path: string
  category: string
  name: string
  displayName?: string
  nameOverflows?: boolean
  description: string
  emoji: string | null
  color: string | null
  vibe: string | null
}

export interface MarketplaceManifest {
  source: {
    repo: string
    commit: string
    fetched_at: string
  }
  language: MarketplaceLanguage
  categories: string[]
  agents: MarketplaceAgentEntry[]
}

export interface MarketplaceAgentDetail {
  path: string
  frontmatter: Record<string, unknown>
  body: string
}

export const fetchMarketplaceManifest = async (
  lang: MarketplaceLanguage
): Promise<MarketplaceManifest> => {
  const response = await apiFetch(`/api/marketplace/manifest?lang=${lang}`, {
    mode: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load marketplace manifest'))
  }
  return (await response.json()) as MarketplaceManifest
}

export const fetchMarketplaceAgent = async (
  lang: MarketplaceLanguage,
  path: string
): Promise<MarketplaceAgentDetail> => {
  const response = await apiFetch(
    `/api/marketplace/agent?lang=${lang}&path=${encodeURIComponent(path)}`,
    { mode: 'same-origin' }
  )
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load marketplace agent'))
  }
  return (await response.json()) as MarketplaceAgentDetail
}

export const listTerminalRuns = async (workspaceId: string): Promise<TerminalRunSummary[]> => {
  const response = await apiFetch(`/api/ui/workspaces/${workspaceId}/runs`, {
    mode: 'same-origin',
  })

  if (!response.ok) {
    throw new Error('Failed to load terminal runs')
  }

  return (await response.json()) as TerminalRunSummary[]
}

export const createWorker = async (
  workspaceId: string,
  input: Pick<AgentSummary, 'name'> & {
    autostart?: boolean
    command_preset_id?: string | null
    description?: string
    role: WorkerRole
    startup_command?: string | null
  }
): Promise<CreateWorkerResult> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create worker'))
  }

  const payload = (await response.json()) as CreateWorkerPayload
  return {
    agentStart: {
      error: payload.agent_start?.error ?? null,
      ok: payload.agent_start?.ok ?? false,
      runId: payload.agent_start?.run_id ?? null,
    },
    worker: fromPayload(payload),
  }
}

export const deleteWorker = async (workspaceId: string, workerId: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workers/${workerId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete worker'))
  }
}

export const renameWorker = async (
  workspaceId: string,
  workerId: string,
  name: string
): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workers/${workerId}`, {
    body: JSON.stringify({ name }),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to rename worker'))
  }
}

export const getWorkspaceTasks = async (workspaceId: string): Promise<{ content: string }> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/tasks`)

  if (!response.ok) {
    throw new Error('Failed to load tasks')
  }

  return (await response.json()) as { content: string }
}

export const saveWorkspaceTasks = async (
  workspaceId: string,
  input: { content: string }
): Promise<{ content: string }> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error('Failed to save tasks')
  }

  return (await response.json()) as { content: string }
}

export interface FsBrowseEntryPayload {
  is_dir: true
  is_git_repository: boolean
  name: string
  path: string
}

export interface FsBrowseResponse {
  current_path: string
  entries: FsBrowseEntryPayload[]
  error: string | null
  ok: boolean
  parent_path: string | null
  root_path: string
}

export interface FsProbeResponse {
  current_branch: string | null
  exists: boolean
  is_dir: boolean
  is_git_repository: boolean
  ok: boolean
  path: string
  suggested_name: string
}

export const browseFs = async (path: string): Promise<FsBrowseResponse> => {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  const response = await apiFetch(`/api/fs/browse${query}`, { mode: 'same-origin' })
  const body = (await response.json()) as FsBrowseResponse
  return body
}

export const probeFs = async (path: string): Promise<FsProbeResponse> => {
  const response = await apiFetch(`/api/fs/probe?path=${encodeURIComponent(path)}`, {
    mode: 'same-origin',
  })
  return (await response.json()) as FsProbeResponse
}

export interface PickFolderResponse {
  canceled: boolean
  error: string | null
  path: string | null
  probe: FsProbeResponse | null
  supported: boolean
}

export const pickFolder = async (): Promise<PickFolderResponse> => {
  const response = await apiFetch('/api/fs/pick-folder', {
    method: 'POST',
    mode: 'same-origin',
  })
  return (await response.json()) as PickFolderResponse
}

export type OpenWorkspaceResult =
  | { ok: true; effectiveTargetId: OpenTargetId }
  | { ok: false; effectiveTargetId: OpenTargetId; errorCode: OpenWorkspaceErrorCode }

interface OpenWorkspaceSuccessPayload {
  ok: true
  effective_target_id: OpenTargetId
}

interface OpenWorkspaceFailurePayload {
  ok: false
  effective_target_id: OpenTargetId
  error_code: OpenWorkspaceErrorCode
}

export const openWorkspaceInEditor = async (
  workspaceId: string,
  targetId: OpenTargetId
): Promise<OpenWorkspaceResult> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/open`, {
    body: JSON.stringify({ target_id: targetId }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  // 200 success and 502 service failure both return structured JSON we can
  // surface; only true transport / 4xx failures (workspace gone, target id
  // tampered) throw.
  if (response.status === 200) {
    const body = (await response.json()) as OpenWorkspaceSuccessPayload
    return { ok: true, effectiveTargetId: body.effective_target_id }
  }
  if (response.status === 502) {
    const body = (await response.json()) as OpenWorkspaceFailurePayload
    return {
      ok: false,
      effectiveTargetId: body.effective_target_id,
      errorCode: body.error_code,
    }
  }
  throw new Error(await readErrorMessage(response, 'Failed to open workspace'))
}
