export const workflowStages = [
  'requirements',
  'solution',
  'development',
  'acceptance',
  'complete',
] as const

export const workflowThreads = ['planning', 'execution'] as const

export const approvalStatuses = ['not_ready', 'pending', 'approved', 'revision_requested'] as const

export type WorkflowStage = (typeof workflowStages)[number]
export type WorkflowThread = (typeof workflowThreads)[number]
export type ApprovalStatus = (typeof approvalStatuses)[number]

/**
 * Persisted lifecycle state for one project workspace. Planning approvals are
 * deliberately separate so implementation cannot start from an ambiguous UI flag.
 */
export interface ProjectWorkflowState {
  activeThread: WorkflowThread
  architectureStatus: ApprovalStatus
  requirementsFrozen: boolean
  stage: WorkflowStage
  uiStatus: ApprovalStatus
  updatedAt: number
  workspaceId: string
}

export const workflowActions = [
  'freeze_requirements',
  'approve_architecture',
  'request_architecture_revision',
  'approve_ui',
  'request_ui_revision',
  'start_development',
  'start_acceptance',
  'complete_project',
] as const

export type WorkflowAction = (typeof workflowActions)[number]

/**
 * Conversation record returned to the browser after server-side actor enrichment.
 * Artifacts are workspace-relative paths reported by real CLI agents.
 */
export interface ConversationEntry {
  actorId: string | null
  actorName: string
  actorRole: string
  artifacts: string[]
  createdAt: number
  id: number
  /** Recipient of a dispatch; omitted for ordinary conversation rows. */
  recipientName?: string
  status: string | null
  text: string
  thread: WorkflowThread
  type: 'user_input' | 'dispatch' | 'report' | 'status' | 'system'
}
