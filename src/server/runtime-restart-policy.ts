import type { ProjectWorkflowState } from '../shared/workflow-types.js'
import type { AgentRunStorePort } from './agent-runtime-ports.js'
import type { MessageLogHandle, MessageLogRecord, RecoveryMessage } from './message-log-store.js'
import { createRestartPolicy } from './restart-policy.js'
import type { TasksFileService } from './tasks-file.js'
import type { WorkspaceStore } from './workspace-store.js'

// Narrow helper keeps runtime-store under the hard line cap.
export const buildRuntimeRestartPolicy = ({
  agentRunStore,
  messageLogStore,
  tasksFileService,
  workspaceStore,
  workflowStore,
}: {
  agentRunStore: Pick<AgentRunStorePort, 'listAgentRuns'>
  messageLogStore: {
    deleteMessage: (handle: MessageLogHandle) => void
    insertMessage: (record: MessageLogRecord) => MessageLogHandle
    listMessagesForRecovery: (workspaceId: string, sinceMs: number) => RecoveryMessage[]
  }
  tasksFileService: Pick<TasksFileService, 'readTasks'>
  workspaceStore: Pick<WorkspaceStore, 'getWorkspaceSnapshot'>
  workflowStore: { get: (workspaceId: string) => ProjectWorkflowState }
}) =>
  createRestartPolicy({
    deleteMessage: messageLogStore.deleteMessage,
    getWorkspaceSnapshot: workspaceStore.getWorkspaceSnapshot,
    getWorkflowState: workflowStore.get,
    insertMessage: messageLogStore.insertMessage,
    listAgentRuns: agentRunStore.listAgentRuns,
    listMessagesForRecovery: messageLogStore.listMessagesForRecovery,
    readTasks: tasksFileService.readTasks,
  })
