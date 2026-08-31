import type { Database } from 'better-sqlite3'

import { DEPARTMENT_MANAGER_NAME } from '../shared/agent-company-labels.js'
import { ORCHESTRATOR_ROLE_DESCRIPTION } from './role-templates.js'

/**
 * Renames the built-in coordinator template in an open runtime database.
 * The migration updates only its user-facing name and prompt; the stable
 * `orchestrator` id and role type remain unchanged for record compatibility.
 */
export const applySchemaVersion22 = (db: Database) => {
  db.prepare(
    `UPDATE role_templates
     SET name = ?, description = ?, updated_at = ?
     WHERE id = 'orchestrator' AND is_builtin = 1`
  ).run(DEPARTMENT_MANAGER_NAME, ORCHESTRATOR_ROLE_DESCRIPTION, Date.now())
}
