import { DEPARTMENT_MANAGER_NAME } from '../shared/agent-company-labels.js'
import type { WorkflowThread } from '../shared/workflow-types.js'
import { mergeReportedArtifactPaths } from './reported-artifact-paths.js'
import type { AgentRuntime } from './agent-runtime.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import { ConflictError } from './http-errors.js'
import type { MessageLogHandle, MessageLogRecord } from './message-log-store.js'
import {
  createReportMessage,
  createSendMessage,
  createStatusMessage,
  createUserInputMessage,
} from './runtime-message-builders.js'
import type { WorkspaceStore } from './workspace-store.js'

export interface TeamOperationsInput {
  agentRuntime: AgentRuntime
  createDispatch: (input: {
    fromAgentId?: string
    text: string
    toAgentId: string
    workspaceId: string
  }) => DispatchRecord
  deleteDispatch: (dispatchId: string) => void
  deleteMessage: (handle: MessageLogHandle) => void
  findOpenDispatch: (
    workspaceId: string,
    toAgentId: string,
    dispatchId?: string
  ) => DispatchRecord | undefined
  findOpenDispatchById: (workspaceId: string, dispatchId: string) => DispatchRecord | undefined
  insertMessage: (record: MessageLogRecord) => MessageLogHandle
  getActiveThread: (workspaceId: string) => WorkflowThread
  markDispatchCancelled: (input: {
    dispatchId: string
    reason: string
    workspaceId: string
  }) => DispatchRecord | undefined
  markDispatchReportedByWorker: (input: {
    artifacts: string[]
    dispatchId?: string
    reportText: string
    toAgentId: string
    workspaceId: string
  }) => DispatchRecord | undefined
  markDispatchSubmitted: (dispatchId: string) => void
  workspaceStore: WorkspaceStore
}

export interface DispatchTaskInput {
  fromAgentId?: string
  hivePort?: string
}

export interface ReportTaskInput {
  artifacts?: string[]
  dispatchId?: string
  requireActiveRun?: boolean
  status?: string
  text?: string
}

export interface StatusTaskInput {
  artifacts?: string[]
  requireActiveRun?: boolean
  text?: string
}

export interface CancelTaskInput {
  fromAgentId: string
  reason: string
}

export interface ReportTaskResult {
  dispatch: DispatchRecord | null
  forwardError: string | null
  forwarded: boolean
}

const reportForwardErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const createTeamOperations = ({
  agentRuntime,
  createDispatch,
  deleteDispatch,
  deleteMessage,
  findOpenDispatch,
  findOpenDispatchById,
  insertMessage,
  getActiveThread,
  markDispatchCancelled,
  markDispatchReportedByWorker,
  markDispatchSubmitted,
  workspaceStore,
}: TeamOperationsInput) => {
  const ensureWorkerRun = async (workspaceId: string, workerId: string, hivePort: string) => {
    if (agentRuntime.getActiveRunByAgentId(workspaceId, workerId)) {
      return
    }

    const config = agentRuntime.peekAgentLaunchConfig(workspaceId, workerId)
    if (!config) {
      throw new ConflictError('No worker launch config available')
    }

    workspaceStore.markAgentStarted(workspaceId, workerId)
    try {
      const run = await agentRuntime.startAgent(
        workspaceStore.getWorkspaceSnapshot(workspaceId).summary,
        workerId,
        { hivePort }
      )
      if (run.status === 'error') {
        workspaceStore.markAgentStopped(workspaceId, workerId)
        throw new ConflictError(`${config.command} failed to start`)
      }
    } catch (error) {
      workspaceStore.markAgentStopped(workspaceId, workerId)
      throw error
    }
  }

  const dispatchTask = async (
    workspaceId: string,
    workerId: string,
    text: string,
    input: DispatchTaskInput = {}
  ) => {
    const message = createSendMessage(
      workspaceId,
      workerId,
      text,
      input.fromAgentId,
      getActiveThread(workspaceId)
    )
    const messageHandle = insertMessage(message)
    let dispatch: DispatchRecord | undefined

    try {
      const dispatchInput: {
        fromAgentId?: string
        text: string
        toAgentId: string
        workspaceId: string
      } = {
        text,
        toAgentId: workerId,
        workspaceId,
      }
      if (input.fromAgentId) dispatchInput.fromAgentId = input.fromAgentId
      dispatch = createDispatch(dispatchInput)

      if (input.fromAgentId) {
        const sender = workspaceStore.getAgent(workspaceId, input.fromAgentId)
        await ensureWorkerRun(workspaceId, workerId, input.hivePort ?? '')
        const worker = workspaceStore.getWorker(workspaceId, workerId)
        markDispatchSubmitted(dispatch.id)
        agentRuntime.writeSendPrompt(
          workspaceId,
          workerId,
          dispatch.id,
          sender.name,
          worker.description,
          text
        )
      }

      workspaceStore.markTaskDispatched(workspaceId, workerId)
      return dispatch
    } catch (error) {
      if (dispatch) deleteDispatch(dispatch.id)
      deleteMessage(messageHandle)
      throw error
    }
  }

  return {
    cancelTask(workspaceId: string, dispatchId: string, input: CancelTaskInput) {
      workspaceStore.getAgent(workspaceId, input.fromAgentId)
      const openDispatch = findOpenDispatchById(workspaceId, dispatchId)
      if (!openDispatch) {
        throw new ConflictError(`No open dispatch: ${dispatchId}`)
      }
      const dispatch = markDispatchCancelled({
        dispatchId,
        reason: input.reason,
        workspaceId,
      })
      if (!dispatch) {
        throw new ConflictError(`No open dispatch: ${dispatchId}`)
      }
      workspaceStore.markTaskCancelled(workspaceId, dispatch.toAgentId)
      let forwardError: string | null = null
      let forwarded = false
      try {
        agentRuntime.writeCancelPrompt(workspaceId, dispatch.toAgentId, dispatch.id, input.reason)
        forwarded = true
      } catch (error) {
        forwardError = reportForwardErrorMessage(error)
        console.error('[hive] swallowed:teamCancel.forward', error)
      }
      return { dispatch, forwardError, forwarded }
    },
    dispatchTask,
    dispatchTaskByWorkerName(
      workspaceId: string,
      workerName: string,
      text: string,
      input: DispatchTaskInput = {}
    ) {
      const worker = workspaceStore.getWorkerByName(workspaceId, workerName)
      return dispatchTask(workspaceId, worker.id, text, input)
    },
    recordUserInput(
      workspaceId: string,
      orchestratorId: string,
      text: string,
      thread: WorkflowThread = 'planning',
      promptText: string = text
    ) {
      workspaceStore.getAgent(workspaceId, orchestratorId)
      agentRuntime.writeUserInputPrompt(workspaceId, promptText)
      insertMessage(createUserInputMessage(workspaceId, orchestratorId, text, thread))
    },
    /**
     * Persists one Web conversation message and delivers it to the explicitly selected CLI member.
     * Direct worker replies intentionally bypass the Orchestrator PTY so a failed or busy coordinator
     * cannot swallow a user's answer. The Orchestrator still owns the dispatch for audit and reporting.
     */
    async routeUserInput(
      workspaceId: string,
      orchestratorId: string,
      recipientName: string,
      text: string,
      thread: WorkflowThread = 'planning',
      promptText: string = text,
      hivePort: string = ''
    ) {
      workspaceStore.getAgent(workspaceId, orchestratorId)
      const messageHandle = insertMessage(
        createUserInputMessage(workspaceId, orchestratorId, text, thread)
      )
      try {
        if (recipientName === DEPARTMENT_MANAGER_NAME) {
          agentRuntime.writeUserInputPrompt(workspaceId, promptText)
          return
        }
        const worker = workspaceStore.getWorkerByName(workspaceId, recipientName)
        await dispatchTask(workspaceId, worker.id, promptText, {
          fromAgentId: orchestratorId,
          hivePort,
        })
      } catch (error) {
        deleteMessage(messageHandle)
        throw error
      }
    },
    /** Sends a lifecycle/system notice to the orchestrator without duplicating it as user input. */
    notifyOrchestrator(workspaceId: string, text: string) {
      agentRuntime.writeUserInputPrompt(workspaceId, text)
    },
    statusTask(workspaceId: string, workerId: string, input: StatusTaskInput = {}) {
      const text = input.text ?? ''
      const workspacePath = workspaceStore.getWorkspaceSnapshot(workspaceId).summary.path
      const artifacts = mergeReportedArtifactPaths(
        workspacePath,
        input.artifacts ?? [],
        text
      )
      const worker = workspaceStore.getWorker(workspaceId, workerId)
      const messageHandle = insertMessage(
        createStatusMessage(workspaceId, workerId, text, artifacts, getActiveThread(workspaceId))
      )
      try {
        let forwardError: string | null = null
        let forwarded = false
        if (input.requireActiveRun === true) {
          try {
            agentRuntime.writeStatusPrompt(workspaceId, worker.name, workerId, text, artifacts, {
              requireActiveRun: input.requireActiveRun,
            })
            forwarded = true
          } catch (error) {
            forwardError = reportForwardErrorMessage(error)
            console.error('[hive] swallowed:teamStatus.forward', error)
          }
        }
        return { dispatch: null, forwardError, forwarded }
      } catch (error) {
        deleteMessage(messageHandle)
        throw error
      }
    },
    reportTask(workspaceId: string, workerId: string, input: ReportTaskInput = {}) {
      const text = input.text ?? ''
      const status = input.status
      const workspacePath = workspaceStore.getWorkspaceSnapshot(workspaceId).summary.path
      const artifacts = mergeReportedArtifactPaths(
        workspacePath,
        input.artifacts ?? [],
        text
      )
      const worker = workspaceStore.getWorker(workspaceId, workerId)
      const openDispatch = findOpenDispatch(workspaceId, workerId, input.dispatchId)
      if (!openDispatch && input.dispatchId) {
        throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
      }
      if (!openDispatch) {
        throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
      }
      const messageHandle = insertMessage(
        createReportMessage(
          workspaceId,
          workerId,
          text,
          status,
          artifacts,
          getActiveThread(workspaceId)
        )
      )
      try {
        const dispatch = markDispatchReportedByWorker({
          artifacts,
          ...(input.dispatchId ? { dispatchId: input.dispatchId } : {}),
          reportText: text,
          toAgentId: workerId,
          workspaceId,
        })
        if (!dispatch) {
          throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
        }
        workspaceStore.markTaskReported(workspaceId, workerId)
        let forwardError: string | null = null
        let forwarded = false
        if (input.requireActiveRun === true) {
          try {
            agentRuntime.writeReportPrompt(workspaceId, worker.name, workerId, text, artifacts, {
              requireActiveRun: input.requireActiveRun,
            })
            forwarded = true
          } catch (error) {
            forwardError = reportForwardErrorMessage(error)
            console.error('[hive] swallowed:teamReport.forward', error)
          }
        }
        return { dispatch, forwardError, forwarded }
      } catch (error) {
        deleteMessage(messageHandle)
        throw error
      }
    },
  }
}
