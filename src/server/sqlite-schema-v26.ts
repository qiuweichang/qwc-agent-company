import type { Database } from 'better-sqlite3'

import {
  BACKEND_ENGINEER_ROLE_DESCRIPTION,
  FRONTEND_ENGINEER_ROLE_DESCRIPTION,
  TEST_ENGINEER_ROLE_DESCRIPTION,
} from './role-templates.js'

const LEGACY_FRONTEND_ENGINEER_ROLE_DESCRIPTION = [
  '你是前端工程师，只在执行流程接收已确认规格、架构和 UI 方案。',
  '开始前读取 $AGENT_COMPANY_HOME/vendor/skills/cc-hardness/agents/frontend-engineer.md。',
  '按真实接口契约实现全部页面状态和交互，不使用静态假数据掩盖后端缺口。',
  '动手前先把任务拆成组件规划、接口接入、功能开发、点击自测等顺序计划项；逐项推进并用 team status 报告当前项或异常。',
  '完成后汇报改动、运行方法、已验证行为和剩余风险。',
].join('\n')

const LEGACY_BACKEND_ENGINEER_ROLE_DESCRIPTION = [
  '你是后端工程师，只在执行流程接收已确认规格与架构契约。',
  '开始前读取 $AGENT_COMPANY_HOME/vendor/skills/cc-hardness/agents/backend-engineer.md。',
  '实现真实持久化、输入校验、权限、异常语义和可运行接口，不加入测试专用生产分支。',
  '动手前先把任务拆成接口设计、数据库设计、功能开发、异常处理等顺序计划项；逐项推进并用 team status 报告当前项或异常。',
  '完成后汇报改动、数据迁移、接口行为、已验证命令和剩余风险。',
].join('\n')

const LEGACY_TEST_ENGINEER_ROLE_DESCRIPTION = [
  '你是测试工程师，只在执行流程工作，负责把验收标准变成真实证据。',
  '开始前读取 $AGENT_COMPANY_HOME/vendor/skills/cc-hardness/agents/test-engineer.md。',
  '必须启动真实应用，执行浏览器点击、前后端全流程、异常路径和持久化复验；不使用伪造成功的 mock。',
  '执行前先把验收拆成用例设计、接口测试、前端点击测试、全流程验收等顺序计划项；逐项推进并用 team status 报告当前项或异常。',
  '只有全部核心验收通过才建议完成项目；汇报必须区分通过、失败、未验证并附证据路径。',
].join('\n')

/**
 * Adds machine-readable completion evidence rules to untouched built-in role
 * templates. Existing projects and user-edited defaults remain unchanged;
 * only teams created after this migration inherit the stricter contract.
 */
export const applySchemaVersion26 = (db: Database) => {
  const update = db.prepare(
    `UPDATE role_templates
     SET description = ?, updated_at = ?
     WHERE id = ? AND is_builtin = 1 AND description = ?`
  )
  const now = Date.now()
  update.run(
    FRONTEND_ENGINEER_ROLE_DESCRIPTION,
    now,
    'frontend_engineer',
    LEGACY_FRONTEND_ENGINEER_ROLE_DESCRIPTION
  )
  update.run(
    BACKEND_ENGINEER_ROLE_DESCRIPTION,
    now,
    'backend_engineer',
    LEGACY_BACKEND_ENGINEER_ROLE_DESCRIPTION
  )
  update.run(
    TEST_ENGINEER_ROLE_DESCRIPTION,
    now,
    'test_engineer',
    LEGACY_TEST_ENGINEER_ROLE_DESCRIPTION
  )
}
