import type { WorkflowThread } from '../shared/workflow-types.js'
import type { MessageLogRecord } from './message-log-store.js'

export const createUserInputMessage = (
  workspaceId: string,
  orchestratorId: string,
  text: string,
  thread: WorkflowThread = 'planning'
): MessageLogRecord => ({
  createdAt: Date.now(),
  text,
  thread,
  type: 'user_input',
  workerId: orchestratorId,
  workspaceId,
})

export const createSendMessage = (
  workspaceId: string,
  workerId: string,
  text: string,
  fromAgentId?: string,
  thread: WorkflowThread = 'planning'
): MessageLogRecord => {
  const message: MessageLogRecord = {
    createdAt: Date.now(),
    text,
    thread,
    toAgentId: workerId,
    type: 'send',
    workerId,
    workspaceId,
  }

  if (fromAgentId) {
    message.fromAgentId = fromAgentId
  }

  return message
}

export const createReportMessage = (
  workspaceId: string,
  workerId: string,
  text: string,
  status: string | undefined,
  artifacts: string[],
  thread: WorkflowThread = 'planning'
): MessageLogRecord => {
  const message: MessageLogRecord = {
    artifacts,
    createdAt: Date.now(),
    fromAgentId: workerId,
    text,
    thread,
    type: 'report',
    workerId,
    workspaceId,
  }
  if (status) message.status = status
  return message
}

export const createStatusMessage = (
  workspaceId: string,
  workerId: string,
  text: string,
  artifacts: string[],
  thread: WorkflowThread = 'planning'
): MessageLogRecord => ({
  artifacts,
  createdAt: Date.now(),
  fromAgentId: workerId,
  text,
  thread,
  type: 'status',
  workerId,
  workspaceId,
})

export const createSystemEnvSyncMessage = (
  workspaceId: string,
  agentId: string,
  text: string
): MessageLogRecord => ({
  createdAt: Date.now(),
  text,
  thread: 'planning',
  toAgentId: agentId,
  type: 'system_env_sync',
  workerId: agentId,
  workspaceId,
})

export const createSystemRecoverySummaryMessage = (
  workspaceId: string,
  agentId: string,
  text: string
): MessageLogRecord => ({
  createdAt: Date.now(),
  text,
  thread: 'planning',
  toAgentId: agentId,
  type: 'system_recovery_summary',
  workerId: agentId,
  workspaceId,
})

/** Creates a durable system entry for a lifecycle transition. */
export const createSystemWorkflowMessage = (
  workspaceId: string,
  text: string,
  thread: WorkflowThread
): MessageLogRecord => ({
  createdAt: Date.now(),
  text,
  thread,
  type: 'system_workflow',
  workerId: `${workspaceId}:orchestrator`,
  workspaceId,
})
