import type { Database } from 'better-sqlite3'

import { PRODUCT_MANAGER_NAME } from '../shared/agent-company-labels.js'
import {
  ORCHESTRATOR_ROLE_DESCRIPTION,
  PRODUCT_MANAGER_ROLE_DESCRIPTION,
} from './role-templates.js'

/**
 * Exact product-manager prompt used before direct Web conversation semantics.
 * Matching the complete legacy value prevents the migration from overwriting a
 * user-customized member that merely kept the built-in display name.
 */
const LEGACY_PRODUCT_MANAGER_ROLE_DESCRIPTION = [
  '你是产品经理，只在规划流程工作，负责把模糊想法变成可观察、可验收的产品规格。',
  '开始前读取 $AGENT_COMPANY_HOME/vendor/skills/cc-hardness/agents/product-manager.md。',
  '需求访谈读取并严格使用 $AGENT_COMPANY_HOME/vendor/skills/matt/grilling/SKILL.md：一次只问一个最高价值问题。',
  '不得调用 CLI 内建 AskUserQuestion 或终端选择器；所有问题必须通过 team report 返回 Web 对话。',
  '用户要求封板时读取 $AGENT_COMPANY_HOME/vendor/skills/matt/to-spec/SKILL.md，把对话综合为 docs/specs/ 下的规格文件。',
  '规格必须覆盖用户、权限、实体、页面、主流程、异常、业务规则、非功能要求、明确不做和可观察验收标准。',
  '不要写生产代码；不确定内容必须标成未决项，不能自行补成既定事实。',
].join('\n')

/**
 * Refreshes built-in coordination prompts for direct product-manager conversations.
 * The role-template updates affect future team members, while the exact-match worker
 * update upgrades existing built-in product managers without touching customized roles.
 */
export const applySchemaVersion23 = (db: Database) => {
  const now = Date.now()
  // Legacy and partially repaired databases can legitimately lack role_templates even
  // though their schema-version ledger is ahead. Keep worker prompt repair independent
  // from the optional template table so startup remains forward-compatible.
  const hasRoleTemplates = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'role_templates'")
    .get()
  if (hasRoleTemplates) {
    const updateTemplate = db.prepare(
      `UPDATE role_templates
       SET description = ?, updated_at = ?
       WHERE id = ? AND is_builtin = 1`
    )
    updateTemplate.run(ORCHESTRATOR_ROLE_DESCRIPTION, now, 'orchestrator')
    updateTemplate.run(PRODUCT_MANAGER_ROLE_DESCRIPTION, now, 'product_manager')
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
