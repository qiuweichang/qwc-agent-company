import type { Database } from 'better-sqlite3'

/**
 * Sets the two front-of-house implementation roles to Codex for existing installations.
 * The migration runs once, so later user changes made in role configuration remain intact.
 */
export const applySchemaVersion24 = (db: Database) => {
  const hasRoleTemplates = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'role_templates'")
    .get()
  if (!hasRoleTemplates) return

  db.prepare(
    `UPDATE role_templates
     SET default_command = 'codex', updated_at = ?
     WHERE id IN ('ui_designer', 'frontend_engineer') AND is_builtin = 1`
  ).run(Date.now())
}
