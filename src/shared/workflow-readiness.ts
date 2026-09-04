/** Minimal report shape used to evaluate development and acceptance evidence. */
export interface WorkflowEvidenceEntry {
  actorName: string
  artifacts: string[]
  status?: string | null
  text: string
  type: string
}

/** Explains whether a user-visible lifecycle button may advance the project. */
export interface WorkflowGateReadiness {
  blockers: string[]
  ready: boolean
}

const SUCCESS_STATUSES = new Set(['complete', 'completed', 'passed', 'success', '通过', '已完成'])
const STATUS_LINE_PATTERN = /(?:^|\n)\s*状态\s*[:：]\s*([^\s（(]+)/iu

/**
 * Treats only an explicit successful report as completion evidence. This avoids
 * advancing a project from an ordinary progress update or a `partial` report.
 */
const isSuccessfulReport = (entry: WorkflowEvidenceEntry): boolean => {
  if (entry.type !== 'report') return false
  const explicitStatus = entry.status?.trim().toLowerCase()
  if (explicitStatus) return SUCCESS_STATUSES.has(explicitStatus)
  const textStatus = entry.text.match(STATUS_LINE_PATTERN)?.[1]?.trim().toLowerCase()
  return textStatus ? SUCCESS_STATUSES.has(textStatus) : false
}

/** Returns the most recent final report produced by a member name pattern. */
const findLatestRoleReport = (
  entries: WorkflowEvidenceEntry[],
  rolePattern: RegExp
): WorkflowEvidenceEntry | undefined =>
  [...entries].reverse().find((entry) => entry.type === 'report' && rolePattern.test(entry.actorName))

/** Requires successful completion reports from both implementation owners. */
export const evaluateDevelopmentReadiness = (
  entries: WorkflowEvidenceEntry[]
): WorkflowGateReadiness => {
  const frontendReport = findLatestRoleReport(entries, /前端|front[ -]?end/iu)
  const backendReport = findLatestRoleReport(entries, /后端|back[ -]?end/iu)
  const blockers = [
    ...(!frontendReport || !isSuccessfulReport(frontendReport)
      ? ['前端工程师尚未提交 status: success 完成汇报']
      : []),
    ...(!backendReport || !isSuccessfulReport(backendReport)
      ? ['后端工程师尚未提交 status: success 完成汇报']
      : []),
  ]
  return { blockers, ready: blockers.length === 0 }
}

/**
 * Requires the tester's latest report to be successful and to register at least
 * one durable result file, such as a test report, screenshot, or trace.
 */
export const evaluateAcceptanceReadiness = (
  entries: WorkflowEvidenceEntry[]
): WorkflowGateReadiness => {
  const testReport = findLatestRoleReport(entries, /测试|test|qa/iu)
  const blockers: string[] = []
  if (!testReport || !isSuccessfulReport(testReport)) {
    blockers.push('测试工程师尚未提交 status: success 验收汇报')
  } else if (testReport.artifacts.length === 0) {
    blockers.push('测试工程师尚未登记测试报告、截图或其他验收证据')
  }
  return { blockers, ready: blockers.length === 0 }
}
