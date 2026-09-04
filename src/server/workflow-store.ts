import type { Database } from 'better-sqlite3'

import type {
  ApprovalStatus,
  ProjectWorkflowState,
  WorkflowAction,
  WorkflowStage,
  WorkflowThread,
} from '../shared/workflow-types.js'
import { ConflictError } from './http-errors.js'

interface WorkflowRow {
  active_thread: WorkflowThread
  architecture_status: ApprovalStatus
  requirements_frozen: number
  stage: WorkflowStage
  ui_status: ApprovalStatus
  updated_at: number
  workspace_id: string
}

export interface WorkflowTransition {
  eventText: string
  state: ProjectWorkflowState
  thread: WorkflowThread
}

const toState = (row: WorkflowRow): ProjectWorkflowState => ({
  activeThread: row.active_thread,
  architectureStatus: row.architecture_status,
  requirementsFrozen: row.requirements_frozen === 1,
  stage: row.stage,
  uiStatus: row.ui_status,
  updatedAt: row.updated_at,
  workspaceId: row.workspace_id,
})

const initialState = (workspaceId: string): ProjectWorkflowState => ({
  activeThread: 'planning',
  architectureStatus: 'not_ready',
  requirementsFrozen: false,
  stage: 'requirements',
  uiStatus: 'not_ready',
  updatedAt: Date.now(),
  workspaceId,
})

/**
 * Owns lifecycle transitions for a project. Every transition validates its
 * prerequisites here so browser actions and future automation share one policy.
 */
export const createWorkflowStore = (db: Database) => {
  const save = (state: ProjectWorkflowState) => {
    db.prepare(
      `INSERT INTO project_workflows (
         workspace_id, stage, active_thread, requirements_frozen,
         architecture_status, ui_status, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         stage = excluded.stage,
         active_thread = excluded.active_thread,
         requirements_frozen = excluded.requirements_frozen,
         architecture_status = excluded.architecture_status,
         ui_status = excluded.ui_status,
         updated_at = excluded.updated_at`
    ).run(
      state.workspaceId,
      state.stage,
      state.activeThread,
      state.requirementsFrozen ? 1 : 0,
      state.architectureStatus,
      state.uiStatus,
      state.updatedAt
    )
    return state
  }

  /** Returns the durable state, creating the initial requirements stage on first access. */
  const get = (workspaceId: string): ProjectWorkflowState => {
    const row = db
      .prepare(
        `SELECT workspace_id, stage, active_thread, requirements_frozen,
                architecture_status, ui_status, updated_at
         FROM project_workflows WHERE workspace_id = ?`
      )
      .get(workspaceId) as WorkflowRow | undefined
    return row ? toState(row) : save(initialState(workspaceId))
  }

  /**
   * Applies one user-visible gate action and returns the exact system event that
   * should be appended to the corresponding conversation thread.
   */
  const transition = (workspaceId: string, action: WorkflowAction): WorkflowTransition => {
    const current = get(workspaceId)
    const next = { ...current, updatedAt: Date.now() }
    let eventText = ''
    let thread: WorkflowThread = current.activeThread

    switch (action) {
      case 'freeze_requirements':
        if (current.stage !== 'requirements') throw new ConflictError('需求阶段已经结束')
        next.requirementsFrozen = true
        next.stage = 'solution'
        next.architectureStatus = 'pending'
        next.uiStatus = 'pending'
        next.activeThread = 'planning'
        thread = 'planning'
        eventText =
          '需求已由用户确认封板。产品经理正在整理最终规格；部门经理收到其封板汇报后，须读取规格，并行派发架构师和 UI 设计师产出可供用户确认的方案。'
        break
      case 'approve_architecture':
        if (!current.requirementsFrozen) throw new ConflictError('请先封板需求')
        next.architectureStatus = 'approved'
        thread = 'planning'
        eventText = '用户已确认架构方案。'
        break
      case 'request_architecture_revision':
        if (!current.requirementsFrozen) throw new ConflictError('请先封板需求')
        next.architectureStatus = 'revision_requested'
        thread = 'planning'
        eventText = '用户要求修改架构方案；部门经理须立即把反馈重新派给架构师。'
        break
      case 'approve_ui':
        if (!current.requirementsFrozen) throw new ConflictError('请先封板需求')
        next.uiStatus = 'approved'
        thread = 'planning'
        eventText = '用户已确认 UI 设计方案。'
        break
      case 'request_ui_revision':
        if (!current.requirementsFrozen) throw new ConflictError('请先封板需求')
        next.uiStatus = 'revision_requested'
        thread = 'planning'
        eventText = '用户要求修改 UI 设计方案；部门经理须立即把反馈重新派给 UI 设计师。'
        break
      case 'start_development':
        if (current.architectureStatus !== 'approved' || current.uiStatus !== 'approved') {
          throw new ConflictError('架构方案和 UI 方案都确认后才能开始开发')
        }
        next.stage = 'development'
        next.activeThread = 'execution'
        thread = 'execution'
        eventText =
          '方案已全部确认，执行流程已开启。部门经理须立即制定开发计划并并行派发前后端开发任务。只有前端工程师和后端工程师分别提交 status: success 的完成汇报后，才能进入验收。'
        break
      case 'start_acceptance':
        if (current.stage !== 'development') throw new ConflictError('项目尚未处于开发阶段')
        next.stage = 'acceptance'
        next.activeThread = 'execution'
        thread = 'execution'
        eventText =
          '开发完成，进入全流程验收。部门经理须立即派发测试人员执行真实点击与功能测试；只有测试工程师提交 status: success 汇报并登记测试报告或截图后，才能完成项目。'
        break
      case 'complete_project':
        if (current.stage !== 'acceptance') throw new ConflictError('只有验收阶段可以完成项目')
        next.stage = 'complete'
        next.activeThread = 'execution'
        thread = 'execution'
        eventText = '全流程验收通过，项目已完成。'
        break
    }

    return { eventText, state: save(next), thread }
  }

  /** Removes lifecycle data when its owning workspace is deleted. */
  const remove = (workspaceId: string) => {
    db.prepare('DELETE FROM project_workflows WHERE workspace_id = ?').run(workspaceId)
  }

  return { get, remove, transition }
}
