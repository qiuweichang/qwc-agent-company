import type { Database } from 'better-sqlite3'

/**
 * Adds the lifecycle state and durable planning/execution thread attribution used
 * by Agent Company. Existing Hive messages are treated as planning history.
 */
export const applySchemaVersion19 = (db: Database) => {
  const messageColumns = new Set(
    (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  if (!messageColumns.has('thread')) {
    db.exec("ALTER TABLE messages ADD COLUMN thread TEXT NOT NULL DEFAULT 'planning'")
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_workflows (
      workspace_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      active_thread TEXT NOT NULL,
      requirements_frozen INTEGER NOT NULL,
      architecture_status TEXT NOT NULL,
      ui_status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_workspace_thread_sequence
      ON messages (workspace_id, thread, sequence);
  `)
}
