import type { Database } from 'better-sqlite3'

import { PRODUCT_MANAGER_NAME } from '../shared/agent-company-labels.js'
import { PRODUCT_MANAGER_ROLE_DESCRIPTION } from './role-templates.js'

/**
 * Built-in product-manager contract immediately before Web choice-card formatting
 * became mandatory. Exact matching protects every role edited by the user.
 */
const LEGACY_PRODUCT_MANAGER_ROLE_DESCRIPTION = [
  '你是产品经理，只在规划流程工作，负责把模糊想法变成可观察、可验收的产品规格。',
  '开始前读取 $AGENT_COMPANY_HOME/vendor/skills/cc-hardness/agents/product-manager.md。',
  '需求访谈读取并严格使用 $AGENT_COMPANY_HOME/vendor/skills/matt/grilling/SKILL.md：一次只问一个最高价值问题。',
  '不得调用 CLI 内建 AskUserQuestion 或终端选择器；所有问题必须通过 team report 返回 Web 对话。team report 的正文会原样以“产品经理”身份直接显示给用户，不需要部门经理转述。',
  'team report 必须直接面向用户书写，使用“你/您”称呼用户；禁止写“请转达用户”“请部门经理询问”“带回问题”或把正文写成给部门经理看的工作汇报。',
  '提出一个问题后结束本轮并等待用户在 Web 对话中直接回复；收到用户最新回答后结合既有访谈继续分析，只提出下一个最高价值问题。',
  '用户要求封板时读取 $AGENT_COMPANY_HOME/vendor/skills/matt/to-spec/SKILL.md，把对话综合为 docs/specs/ 下的规格文件。',
  '规格必须覆盖用户、权限、实体、页面、主流程、异常、业务规则、非功能要求、明确不做和可观察验收标准。',
  '不要写生产代码；不确定内容必须标成未决项，不能自行补成既定事实。',
].join('\n')

/**
 * Upgrades untouched product-manager prompts so future replies use a stable,
 * machine-readable option format. Existing customized role contracts are kept.
 */
export const applySchemaVersion25 = (db: Database) => {
  const hasRoleTemplates = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'role_templates'")
    .get()

  if (hasRoleTemplates) {
    db.prepare(
      `UPDATE role_templates
       SET description = ?, updated_at = ?
       WHERE id = 'product_manager' AND is_builtin = 1 AND description = ?`
    ).run(PRODUCT_MANAGER_ROLE_DESCRIPTION, Date.now(), LEGACY_PRODUCT_MANAGER_ROLE_DESCRIPTION)
  }

  db.prepare(
    `UPDATE workers
     SET description = ?
     WHERE name = ? AND role = 'custom' AND description = ?`
  ).run(
    PRODUCT_MANAGER_ROLE_DESCRIPTION,
    PRODUCT_MANAGER_NAME,
    LEGACY_PRODUCT_MANAGER_ROLE_DESCRIPTION
  )
}
