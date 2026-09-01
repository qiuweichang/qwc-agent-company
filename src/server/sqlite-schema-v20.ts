import type { Database } from 'better-sqlite3'
import { DEPARTMENT_MANAGER_NAME, PRODUCT_MANAGER_NAME } from '../shared/agent-company-labels.js'

import {
  ARCHITECT_ROLE_DESCRIPTION,
  BACKEND_ENGINEER_ROLE_DESCRIPTION,
  FRONTEND_ENGINEER_ROLE_DESCRIPTION,
  ORCHESTRATOR_ROLE_DESCRIPTION,
  PRODUCT_MANAGER_ROLE_DESCRIPTION,
  TEST_ENGINEER_ROLE_DESCRIPTION,
  UI_DESIGNER_ROLE_DESCRIPTION,
} from './role-templates.js'

const BUILTIN_ROLES = [
  ['orchestrator', DEPARTMENT_MANAGER_NAME, 'orchestrator', ORCHESTRATOR_ROLE_DESCRIPTION, 'claude'],
  ['product_manager', PRODUCT_MANAGER_NAME, 'custom', PRODUCT_MANAGER_ROLE_DESCRIPTION, 'claude'],
  ['architect', '架构师', 'custom', ARCHITECT_ROLE_DESCRIPTION, 'claude'],
  ['ui_designer', 'UI 设计师', 'custom', UI_DESIGNER_ROLE_DESCRIPTION, 'codex'],
  ['frontend_engineer', '前端工程师', 'coder', FRONTEND_ENGINEER_ROLE_DESCRIPTION, 'codex'],
  ['backend_engineer', '后端工程师', 'coder', BACKEND_ENGINEER_ROLE_DESCRIPTION, 'claude'],
  ['test_engineer', '测试工程师', 'tester', TEST_ENGINEER_ROLE_DESCRIPTION, 'claude'],
] as const

/** Replaces generic Hive presets with Agent Company's focused personal software team. */
export const applySchemaVersion20 = (db: Database) => {
  const now = Date.now()
  /** Legacy migration tests and partially upgraded databases may not yet own every settings table. */
  const hasTable = (name: string) =>
    Boolean(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
    )

  if (hasTable('command_presets')) {
    db.prepare("DELETE FROM command_presets WHERE id NOT IN ('claude', 'codex')").run()
  }
  if (!hasTable('role_templates')) return

  db.prepare(
    "DELETE FROM role_templates WHERE id IN ('coder', 'reviewer', 'tester') AND is_builtin = 1"
  ).run()

  const upsert = db.prepare(
    `INSERT INTO role_templates (
       id, name, role_type, description, default_command, default_args, default_env,
       is_builtin, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, '[]', '{}', 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role_type = excluded.role_type,
       description = excluded.description,
       default_command = excluded.default_command,
       default_args = excluded.default_args,
       default_env = excluded.default_env,
       is_builtin = 1,
       updated_at = excluded.updated_at`
  )
  for (const [id, name, roleType, description, defaultCommand] of BUILTIN_ROLES) {
    upsert.run(id, name, roleType, description, defaultCommand, now, now)
  }
}
