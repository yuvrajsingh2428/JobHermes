// ============================================================
// Database Migration Runner – Idempotent versioned SQL runner
// ============================================================

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrationFiles(migrationsDir?: string): MigrationFile[] {
  const dir = migrationsDir || path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const list: MigrationFile[] = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (match) {
      const version = parseInt(match[1], 10);
      const name = match[2];
      const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
      list.push({ version, name, sql });
    }
  }

  list.sort((a, b) => a.version - b.version);
  return list;
}

export function runMigrations(db: Database.Database, migrationsDir?: string): number {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const migrations = loadMigrationFiles(migrationsDir);
  let newlyApplied = 0;

  for (const m of migrations) {
    if (!appliedSet.has(m.version)) {
      logger.info(`Applying database migration ${m.version}: ${m.name}...`);
      const applyTx = db.transaction(() => {
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      });
      applyTx();
      newlyApplied++;
      logger.success(`Migration ${m.version} (${m.name}) applied successfully.`);
    }
  }

  return newlyApplied;
}
