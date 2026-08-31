export const memberPlanStatuses = ['completed', 'active', 'pending', 'error'] as const

export type MemberPlanStatus = (typeof memberPlanStatuses)[number]

/** One role-specific implementation step displayed on the Hive member card. */
export interface MemberPlanItem {
  id: string
  label: string
  status: MemberPlanStatus
}

/** Stable per-member plan derived from the durable dispatch ledger and runtime state. */
export interface MemberPlan {
  agentId: string
  items: MemberPlanItem[]
}

export const archiveCategories = [
  'ui_design',
  'architecture',
  'documents',
  'frontend',
  'backend',
  'tests',
  'scripts',
  'other',
] as const

export type ArchiveCategory = (typeof archiveCategories)[number]

/** Workspace-relative file metadata returned by the project archive index. */
export interface ArchivedProjectFile {
  category: ArchiveCategory
  path: string
  size: number
  updatedAt: number
}

/** Local deployment state for one delivered project. */
export interface ProjectDeployment {
  backendPort: number
  backendUrl: string
  frontendPort: number
  frontendUrl: string
  launchedAt: number
  status: 'running' | 'stopped' | 'error'
  workspaceId: string
}
