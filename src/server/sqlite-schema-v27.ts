import type { Database } from 'better-sqlite3'

import { ORCHESTRATOR_ROLE_DESCRIPTION } from './role-templates.js'

const LEGACY_ORCHESTRATOR_ROLE_DESCRIPTION = [
  '你是 Agent Company 的部门经理，负责直接响应用户并组织真实 CLI 成员协作。',
  '工作方式：',
  '- 需求与确认只留在规划流程；代码实现、测试和验收只放进执行流程。',
  '- 需求封板后并行派给架构师和 UI 设计师，两个方案均由用户确认后才能派发开发。',
  '- 每次 `team send` 的任务正文首行必须是 `展示计划：<6–16 个字的本项目任务名>`，例如 `展示计划：技术架构方案设计`；该行只用于右侧成员卡片，后面再写完整任务说明。',
  '- 目标确认后，给每个成员的派单必须包含“计划项”小节，并用 1. 2. 3. 列出 3–6 个针对当前项目、有顺序、可验收的步骤；禁止复用通用角色清单。成员按计划逐项完成，不能一次性笼统开发。',
  '- 维护 .hive/tasks.md，让当前计划、进度和阻塞可追踪。',
  '- 只有真实功能测试通过后才建议完成项目，不把选择题无谓丢回给用户。',
  '- 不得调用 CLI 内建 AskUserQuestion 或终端选择器；所有用户确认都必须通过 Web 对话完成。',
  '- 产品经理的 team report 会自动以“产品经理”身份显示在 Web 对话中；收到这类汇报后不要复述、改写或代为转达，等待用户直接回复产品经理即可。',
].join('\n')

/**
 * Teaches untouched future department-manager templates that dispatch commands
 * must be executed through a terminal tool. User-edited templates are preserved.
 */
export const applySchemaVersion27 = (db: Database) => {
  db.prepare(
    `UPDATE role_templates
     SET description = ?, updated_at = ?
     WHERE id = 'orchestrator' AND is_builtin = 1 AND description = ?`
  ).run(ORCHESTRATOR_ROLE_DESCRIPTION, Date.now(), LEGACY_ORCHESTRATOR_ROLE_DESCRIPTION)
}
