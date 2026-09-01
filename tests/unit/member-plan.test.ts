import { describe, expect, test } from 'vitest'
import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'
import { buildMemberPlan } from '../../src/server/member-plan.js'
import type { AgentSummary } from '../../src/shared/types.js'
import type { ProjectWorkflowState } from '../../src/shared/workflow-types.js'

const architect: AgentSummary = {
  description: '负责架构设计',
  id: 'architect-1',
  name: '架构师',
  pendingTaskCount: 1,
  role: 'custom',
  status: 'working',
  workspaceId: 'workspace-1',
}

const workflow: ProjectWorkflowState = {
  activeThread: 'planning',
  architectureStatus: 'pending',
  requirementsFrozen: true,
  stage: 'solution',
  uiStatus: 'pending',
  updatedAt: 1,
  workspaceId: 'workspace-1',
}

/** Builds one durable open dispatch while allowing each test to vary only its task text. */
const createDispatch = (text: string): DispatchRecord => ({
  artifacts: [],
  createdAt: 1,
  deliveredAt: 1,
  fromAgentId: 'workspace-1:orchestrator',
  id: 'dispatch-1',
  reportedAt: null,
  reportText: null,
  sequence: 1,
  status: 'submitted',
  submittedAt: 1,
  text,
  toAgentId: architect.id,
  workspaceId: 'workspace-1',
})

describe('buildMemberPlan', () => {
  test('uses the explicit display title instead of detailed dispatch instructions', () => {
    const plan = buildMemberPlan(
      architect,
      [
        createDispatch(
          [
            '展示计划：技术架构方案设计',
            '任务内容：为唐代诗集展示设计完整技术架构，不写实现代码。',
            '计划项：1. 明确边界',
          ].join('\n')
        ),
      ],
      workflow
    )

    expect(plan.items).toEqual([
      expect.objectContaining({ label: '技术架构方案设计', status: 'active' }),
    ])
  })

  test('shortens legacy Hive dispatch text that does not contain a display title', () => {
    const plan = buildMemberPlan(
      architect,
      [
        createDispatch(
          '[Hive 派单 · 架构师] 唐代诗集展示 · 技术架构方案（规划阶段，只出方案，不写实现代码）'
        ),
      ],
      workflow
    )

    expect(plan.items[0]).toMatchObject({ label: '技术架构方案设计', status: 'active' })
  })
})
