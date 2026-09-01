import type { MemberPlan, MemberPlanItem } from '../shared/project-operations.js'
import type { AgentSummary } from '../shared/types.js'
import type { ProjectWorkflowState } from '../shared/workflow-types.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'

const PLAN_LINE_PREFIX = /^\s*(?:[-*•]\s+|\d{1,2}[.)、]\s*|计划项\s*\d{1,2}\s*[:：-]\s*)/
const DISPLAY_PLAN_PATTERN =
  /(?:^|\n)\s*(?:展示计划|计划标题|卡片计划)\s*[:：]\s*([^\r\n]{2,32})/u
const HIVE_DISPATCH_PREFIX = /^\s*\[Hive\s+派单[^\r\n]*?\]\s*/u
/** Hard display bound for member cards; detailed instructions remain available in context history. */
const MAX_DISPLAY_PLAN_LENGTH = 20

/** Cleans one card label without changing the full dispatch delivered to the worker. */
const cleanPlanLabel = (value: string) =>
  value
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[。；;，,：:]\s*$/u, '')
    .trim()

/** Derives a short compatibility label for dispatches created before display titles existed. */
const deriveLegacyDisplayPlan = (text: string): string => {
  const withoutPrefix = text.replace(HIVE_DISPATCH_PREFIX, '').trim()
  const segments = withoutPrefix
    .split('·')
    .map((segment) => cleanPlanLabel(segment))
    .filter(Boolean)
  let label = segments.at(-1) ?? cleanPlanLabel(withoutPrefix)
  if (/架构方案$/u.test(label) && !label.endsWith('方案设计')) label = `${label}设计`
  return label.slice(0, MAX_DISPLAY_PLAN_LENGTH)
}

/** Extracts the actual ordered checklist written into a dispatch instead of using role templates. */
const extractDispatchPlan = (text: string) => {
  const displayPlan = cleanPlanLabel(text.match(DISPLAY_PLAN_PATTERN)?.[1] ?? '')
  if (displayPlan) return [displayPlan.slice(0, MAX_DISPLAY_PLAN_LENGTH)]

  const explicitItems = text
    .split(/\r?\n/)
    .filter((line) => PLAN_LINE_PREFIX.test(line))
    .map((line) =>
      line
        .replace(PLAN_LINE_PREFIX, '')
        .replace(/[*_`#]/g, '')
        .trim()
    )
    .filter((line) => line.length >= 2 && line.length <= 48)
    .map((line) => line.slice(0, MAX_DISPLAY_PLAN_LENGTH))
    .slice(0, 6)
  if (explicitItems.length > 0) return explicitItems

  const normalized = text
    .replace(/^你是本项目的[^。.!！]*[。.!！]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const taskMatch = normalized.match(/(?:任务内容|目标|请立即|请)[:：]?\s*([^。；;]{2,48})/)
  const summary = (taskMatch?.[1] ?? deriveLegacyDisplayPlan(normalized)).trim()
  return summary ? [summary.slice(0, MAX_DISPLAY_PLAN_LENGTH)] : []
}

/**
 * Builds a compact execution plan from durable dispatch/report state. This keeps
 * the team board truthful without asking the browser to infer progress from prose.
 */
export const buildMemberPlan = (
  agent: AgentSummary,
  dispatches: DispatchRecord[],
  workflow: ProjectWorkflowState
): MemberPlan => {
  const ownDispatches = dispatches.filter((dispatch) => dispatch.toAgentId === agent.id)
  // A coordinator creates many dispatches but does not own those tasks. Reusing the
  // global ledger for its card made the department manager display the worker's plan.
  // Every card must therefore be derived only from work explicitly addressed to it.
  const latestDispatch = ownDispatches.at(-1)

  // Plans represent work that was actually assigned for this project. A newly configured role has
  // no plan yet; showing a role template here would incorrectly imply that work was already scoped.
  if (!latestDispatch) {
    return { agentId: agent.id, items: [] }
  }
  const labels = extractDispatchPlan(latestDispatch.text)
  const isComplete = latestDispatch.status === 'reported' || workflow.stage === 'complete'
  const isOpen = ['queued', 'submitted'].includes(latestDispatch.status)

  const items: MemberPlanItem[] = labels.map((label, index) => {
    let status: MemberPlanItem['status'] = 'pending'
    if (isComplete) status = 'completed'
    else if (latestDispatch.status === 'cancelled' && index === 0) status = 'error'
    else if (isOpen && index === 0) status = 'active'
    return { id: `${agent.id}:${index}`, label, status }
  })

  return { agentId: agent.id, items }
}
