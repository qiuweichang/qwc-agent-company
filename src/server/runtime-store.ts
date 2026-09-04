import type { AgentSummary, TeamListItem, WorkspaceSummary } from '../shared/types.js'
import type {
  ConversationEntry,
  ProjectWorkflowState,
  WorkflowAction,
  WorkflowThread,
} from '../shared/workflow-types.js'
import {
  evaluateAcceptanceReadiness,
  evaluateDevelopmentReadiness,
  type WorkflowEvidenceEntry,
} from '../shared/workflow-readiness.js'
import type { AgentManager } from './agent-manager.js'
import type { AgentLaunchConfigInput, PersistedAgentRun } from './agent-run-store.js'
import type { LiveAgentRun } from './agent-runtime-types.js'
import type { DispatchRecord, ListDispatchesOptions } from './dispatch-ledger-store.js'
import { ConflictError } from './http-errors.js'
import type { RecoveryMessage } from './message-log-store.js'
import type { PtyOutputBus } from './pty-output-bus.js'
import { isReportedArtifactAvailable } from './reported-artifact-paths.js'
import { createSystemWorkflowMessage } from './runtime-message-builders.js'
import { createRuntimeStoreLifecycle, createRuntimeStoreServices } from './runtime-store-helpers.js'
import type { SettingsStore } from './settings-store.js'
import type {
  CancelTaskInput,
  DispatchTaskInput,
  ReportTaskInput,
  ReportTaskResult,
  StatusTaskInput,
} from './team-operations.js'
import type { TerminalRunSummary } from './terminal-input-profile.js'
import { deleteWorkspaceDeployment, stopWorkspaceDeployment } from './workspace-deployment.js'
import {
  assertWorkspaceProjectDeletionSafe,
  deleteWorkspaceProjectFiles,
} from './workspace-project-cleanup.js'
import type { WorkerInput, WorkspaceRecord } from './workspace-store.js'

interface RuntimeStore {
  close: () => Promise<void>
  createWorkspace: (path: string, name: string) => WorkspaceSummary
  /** Stops owned resources and deletes project records, optionally including its guarded directory. */
  deleteWorkspace: (workspaceId: string, input?: { deleteFiles?: boolean }) => Promise<void>
  listWorkspaces: () => WorkspaceSummary[]
  renameWorkspace: (workspaceId: string, name: string) => WorkspaceSummary
  addWorker: (workspaceId: string, input: WorkerInput) => AgentSummary
  deleteWorker: (workspaceId: string, workerId: string) => void
  renameWorker: (workspaceId: string, workerId: string, name: string) => AgentSummary
  recordUserInput: (
    workspaceId: string,
    orchestratorId: string,
    text: string,
    thread?: WorkflowThread,
    promptText?: string
  ) => void
  /** Routes a Web reply to the selected CLI member while retaining it in the selected workflow. */
  routeUserInput: (
    workspaceId: string,
    orchestratorId: string,
    recipientName: string,
    text: string,
    thread?: WorkflowThread,
    promptText?: string,
    hivePort?: string
  ) => Promise<void>
  /** Sends an internal lifecycle prompt to the active Orchestrator without forging a user message. */
  notifyOrchestrator: (workspaceId: string, text: string) => void
  getWorkflowState: (workspaceId: string) => ProjectWorkflowState
  transitionWorkflow: (workspaceId: string, action: WorkflowAction) => ProjectWorkflowState
  listConversationEntries: (workspaceId: string, thread: WorkflowThread) => ConversationEntry[]
  dispatchTask: (
    workspaceId: string,
    workerId: string,
    text: string,
    input?: DispatchTaskInput
  ) => Promise<DispatchRecord>
  dispatchTaskByWorkerName: (
    workspaceId: string,
    workerName: string,
    text: string,
    input?: DispatchTaskInput
  ) => Promise<DispatchRecord>
  reportTask: (workspaceId: string, workerId: string, input?: ReportTaskInput) => ReportTaskResult
  statusTask: (workspaceId: string, workerId: string, input?: StatusTaskInput) => ReportTaskResult
  cancelTask: (workspaceId: string, dispatchId: string, input: CancelTaskInput) => ReportTaskResult
  listDispatches: (workspaceId: string, options?: ListDispatchesOptions) => DispatchRecord[]
  listWorkers: (workspaceId: string) => TeamListItem[]
  getLastPtyLineForAgent: (workspaceId: string, agentId: string) => string | null
  getWorkspaceSnapshot: (workspaceId: string) => WorkspaceRecord
  getWorker: (workspaceId: string, workerId: string) => AgentSummary
  getAgent: (workspaceId: string, agentId: string) => AgentSummary
  getPtyOutputBus: () => PtyOutputBus
  listTerminalRuns: (workspaceId: string) => TerminalRunSummary[]
  closeWorkspaceShell: (workspaceId: string, runId: string) => boolean
  startWorkspaceShell: (workspaceId: string) => Promise<LiveAgentRun>
  configureAgentLaunch: (
    workspaceId: string,
    agentId: string,
    input: AgentLaunchConfigInput
  ) => void
  peekAgentLaunchConfig: (
    workspaceId: string,
    agentId: string
  ) => AgentLaunchConfigInput | undefined
  startAgent: (
    workspaceId: string,
    agentId: string,
    input: StartAgentOptions
  ) => Promise<LiveAgentRun>
  autostartConfiguredAgents: (input: StartAgentOptions) => Promise<
    Array<{
      agent_id: string
      error: string | null
      ok: boolean
      run_id: string | null
      workspace_id: string
    }>
  >
  startWorkspaceWatch: (workspaceId: string) => Promise<void>
  getLiveRun: (runId: string) => LiveAgentRun
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => LiveAgentRun | undefined
  registerTasksListener: (listener: (workspaceId: string, content: string) => void) => () => void
  listAgentRuns: (agentId: string) => PersistedAgentRun[]
  listMessagesForRecovery: (workspaceId: string, sinceMs: number) => RecoveryMessage[]
  peekAgentToken: (agentId: string) => string | undefined
  pauseTerminalRun: (runId: string) => void
  resizeAgentRun: (runId: string, cols: number, rows: number) => void
  resumeTerminalRun: (runId: string) => void
  settings: SettingsStore
  writeRunInput: (runId: string, input: Buffer | string) => void
  getUiToken: () => string
  stopAgentRun: (runId: string) => void
  validateAgentToken: (agentId: string, token: string | undefined) => boolean
  validateUiToken: (token: string | undefined) => boolean
}

interface RuntimeStoreOptions {
  dataDir?: string
  agentManager?: AgentManager
}

interface StartAgentOptions {
  hivePort: string
}

export type { RuntimeStore }

export const createRuntimeStore = (options: RuntimeStoreOptions = {}): RuntimeStore => {
  const services = createRuntimeStoreServices(options)
  const lifecycle = createRuntimeStoreLifecycle(
    options.agentManager ? { agentManager: options.agentManager, services } : { services }
  )
  const runDataMutation = (mutation: () => void) => {
    if (!services.db) {
      mutation()
      return
    }
    services.db.transaction(mutation)()
  }
  return {
    close: lifecycle.close,
    createWorkspace: (path, name) => {
      const workspace = services.workspaceStore.createWorkspace(path, name)
      void lifecycle.startWorkspaceWatch(workspace.id)
      return workspace
    },
    listWorkspaces: () => services.workspaceStore.listWorkspaces(),
    renameWorkspace: (workspaceId, name) =>
      services.workspaceStore.renameWorkspace(workspaceId, name),
    deleteWorkspace: async (workspaceId, input = {}) => {
      const workspace = services.workspaceStore.getWorkspaceSnapshot(workspaceId)
      const protectedWorkspacePaths = services.workspaceStore
        .listWorkspaces()
        .filter((item) => item.id !== workspaceId)
        .map((item) => item.path)
      if (input.deleteFiles === true) {
        assertWorkspaceProjectDeletionSafe(workspace.summary.path, protectedWorkspacePaths)
      }
      stopWorkspaceDeployment(workspaceId)
      lifecycle.deleteWorkspaceShell(workspaceId)
      for (const agent of workspace.agents) {
        const activeRun = services.agentRuntime.getActiveRunByAgentId(workspaceId, agent.id)
        if (activeRun) services.agentRuntime.stopAgentRun(activeRun.runId)
      }
      await services.tasksFileWatcher.stop(workspaceId)
      if (input.deleteFiles === true) {
        await deleteWorkspaceProjectFiles(workspace.summary.path, protectedWorkspacePaths)
      }
      deleteWorkspaceDeployment(workspaceId)
      for (const agent of workspace.agents) {
        services.agentRuntime.deleteAgentLaunchConfig(workspaceId, agent.id)
      }
      runDataMutation(() => {
        services.dispatchLedgerStore.deleteWorkspaceDispatches(workspaceId)
        services.workflowStore.remove(workspaceId)
        services.workspaceStore.deleteWorkspace(workspaceId)
      })
      if (services.settings.getAppState('active_workspace_id')?.value === workspaceId) {
        services.settings.setAppState('active_workspace_id', null)
      }
    },
    addWorker: (workspaceId, input) => services.workspaceStore.addWorker(workspaceId, input),
    renameWorker: (workspaceId, workerId, name) =>
      services.workspaceStore.renameWorker(workspaceId, workerId, name),
    deleteWorker: (workspaceId, workerId) => {
      const activeRun = services.agentRuntime.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) services.agentRuntime.stopAgentRun(activeRun.runId)
      services.agentRuntime.deleteAgentLaunchConfig(workspaceId, workerId)
      runDataMutation(() => {
        services.dispatchLedgerStore.deleteWorkerDispatches(workspaceId, workerId)
        services.workspaceStore.deleteWorker(workspaceId, workerId)
      })
    },
    recordUserInput: services.teamOps.recordUserInput,
    routeUserInput: services.teamOps.routeUserInput,
    notifyOrchestrator: services.teamOps.notifyOrchestrator,
    getWorkflowState: (workspaceId) => services.workflowStore.get(workspaceId),
    transitionWorkflow: (workspaceId, action) => {
      const workspace = services.workspaceStore.getWorkspaceSnapshot(workspaceId)
      if (action === 'approve_architecture' || action === 'approve_ui') {
        const roleHint = action === 'approve_architecture' ? '架构' : 'UI'
        const hasArtifact = services.messageLogStore
          .listConversationMessages(workspaceId, 'planning')
          .some((message) => {
            if (message.type !== 'report' || message.artifacts.length === 0) return false
            const actor = workspace.agents.find(
              (agent) => agent.id === (message.fromAgentId ?? message.workerId)
            )
            return actor?.name.includes(roleHint) === true
          })
        if (!hasArtifact) throw new ConflictError(`${roleHint}方案尚未提交可确认产物`)
      }
      if (action === 'start_acceptance' || action === 'complete_project') {
        const evidence = services.messageLogStore
          .listConversationMessages(workspaceId, 'execution')
          .map((message): WorkflowEvidenceEntry => {
            const actorId = message.fromAgentId ?? message.workerId
            return {
              actorName:
                workspace.agents.find((agent) => agent.id === actorId)?.name ?? actorId,
              artifacts: message.artifacts.filter((artifact) =>
                isReportedArtifactAvailable(workspace.summary.path, artifact)
              ),
              status: message.status,
              text: message.text,
              type: message.type === 'system_workflow' ? 'system' : message.type,
            }
          })
        const readiness =
          action === 'start_acceptance'
            ? evaluateDevelopmentReadiness(evidence)
            : evaluateAcceptanceReadiness(evidence)
        if (!readiness.ready) throw new ConflictError(readiness.blockers.join('；'))
      }
      const transition = services.workflowStore.transition(workspaceId, action)
      services.messageLogStore.insertMessage(
        createSystemWorkflowMessage(workspaceId, transition.eventText, transition.thread)
      )
      services.teamOps.notifyOrchestrator(
        workspaceId,
        `[Agent Company 流程事件] ${transition.eventText}`
      )
      return transition.state
    },
    listConversationEntries: (workspaceId, thread) =>
      services.messageLogStore.listConversationMessages(workspaceId, thread).map((message) => {
        if (message.type === 'user_input') {
          return {
            actorId: null,
            actorName: '你',
            actorRole: 'user',
            artifacts: message.artifacts,
            createdAt: message.createdAt,
            id: message.sequence,
            status: message.status,
            text: message.text,
            thread: message.thread,
            type: 'user_input' as const,
          }
        }

        if (message.type === 'system_workflow') {
          return {
            actorId: null,
            actorName: '流程系统',
            actorRole: 'system',
            artifacts: message.artifacts,
            createdAt: message.createdAt,
            id: message.sequence,
            status: message.status,
            text: message.text,
            thread: message.thread,
            type: 'system' as const,
          }
        }

        const actorId = message.fromAgentId ?? message.workerId
        const actor = services.workspaceStore.getAgent(workspaceId, actorId)
        const recipient = message.toAgentId
          ? services.workspaceStore.getAgent(workspaceId, message.toAgentId)
          : null
        return {
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          artifacts: message.artifacts,
          createdAt: message.createdAt,
          id: message.sequence,
          ...(recipient ? { recipientName: recipient.name } : {}),
          status: message.status,
          text: message.text,
          thread: message.thread,
          type:
            message.type === 'send'
              ? ('dispatch' as const)
              : message.type === 'status'
                ? ('status' as const)
                : ('report' as const),
        }
      }),
    cancelTask: services.teamOps.cancelTask,
    dispatchTask: services.teamOps.dispatchTask,
    dispatchTaskByWorkerName: services.teamOps.dispatchTaskByWorkerName,
    reportTask: services.teamOps.reportTask,
    statusTask: services.teamOps.statusTask,
    listDispatches: services.dispatchLedgerStore.listWorkspaceDispatches,
    listWorkers: (workspaceId) => services.workspaceStore.listWorkers(workspaceId),
    getLastPtyLineForAgent: (workspaceId, agentId) =>
      services.workerOutputTracker?.getLastPtyLine(workspaceId, agentId) ?? null,
    getWorkspaceSnapshot: (workspaceId) =>
      services.workspaceStore.getWorkspaceSnapshot(workspaceId),
    getWorker: (workspaceId, workerId) => services.workspaceStore.getWorker(workspaceId, workerId),
    getAgent: (workspaceId, agentId) => services.workspaceStore.getAgent(workspaceId, agentId),
    getPtyOutputBus: lifecycle.getPtyOutputBus,
    listTerminalRuns: lifecycle.listTerminalRuns,
    closeWorkspaceShell: lifecycle.closeWorkspaceShell,
    configureAgentLaunch: lifecycle.configureAgentLaunch,
    peekAgentLaunchConfig: lifecycle.peekAgentLaunchConfig,
    startAgent: lifecycle.startAgent,
    autostartConfiguredAgents: lifecycle.autostartConfiguredAgents,
    startWorkspaceWatch: lifecycle.startWorkspaceWatch,
    startWorkspaceShell: lifecycle.startWorkspaceShell,
    getLiveRun: lifecycle.getLiveRun,
    getActiveRunByAgentId: (workspaceId, agentId) =>
      services.agentRuntime.getActiveRunByAgentId(workspaceId, agentId),
    registerTasksListener: lifecycle.registerTasksListener,
    listAgentRuns: (agentId) => services.agentRuntime.listAgentRuns(agentId),
    listMessagesForRecovery: (workspaceId, sinceMs) =>
      services.messageLogStore.listMessagesForRecovery(workspaceId, sinceMs),
    peekAgentToken: (agentId) => services.agentRuntime.peekAgentToken(agentId),
    pauseTerminalRun: lifecycle.pauseTerminalRun,
    resizeAgentRun: lifecycle.resizeTerminalRun,
    resumeTerminalRun: lifecycle.resumeTerminalRun,
    settings: services.settings,
    writeRunInput: lifecycle.writeRunInput,
    getUiToken: () => services.uiAuth.getToken(),
    stopAgentRun: lifecycle.stopTerminalRun,
    validateAgentToken: (agentId, token) =>
      services.agentRuntime.validateAgentToken(agentId, token),
    validateUiToken: (token) => services.uiAuth.validate(token),
  }
}
