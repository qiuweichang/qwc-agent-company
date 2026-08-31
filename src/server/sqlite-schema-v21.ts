import type { Database } from 'better-sqlite3'

/** Adds durable PTY transcripts so completed member runs remain inspectable after restart. */
export const applySchemaVersion21 = (db: Database) => {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  if (!columns.has('output_text')) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN output_text TEXT NOT NULL DEFAULT ''")
  }
}
