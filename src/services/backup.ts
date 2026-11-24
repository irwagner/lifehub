import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, ensureStructuralDefaults } from '../db/migrations';
import type { SqlExecutor, SqlValue } from '../db/types';

// Ordered from parent tables to child tables (FK safe for INSERT; reversed for DELETE)
export const BACKUP_TABLES = [
  'settings',
  'accounts',
  'categories',
  'goals',
  'vehicles',
  'habits',
  'study_tracks',
  'calendar_events',
  'tasks',
  'family_plans',
  'job_applications',
  'ideas',
  'projects',
  'weekly_reviews',
  'recurring_rules',
  'budgets',
  'transactions',
  'vehicle_expenses',
  'work_sessions',
  'habit_logs',
  'study_sessions',
  'project_tasks',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export interface LifeHubBackup {
  app: 'LifeHub';
  schemaVersion: number;
  exportedAt: string;
  tableCounts: Record<BackupTableName, number>;
  tables: Record<BackupTableName, Array<Record<string, SqlValue>>>;
}

const backupSchema = z.object({
  app: z.literal('LifeHub'),
  schemaVersion: z.number().int().min(1).max(CURRENT_SCHEMA_VERSION),
  exportedAt: z.string().min(10),
  tables: z.record(z.array(z.record(z.union([z.string(), z.number(), z.null()])))),
});

export async function exportBackupJson(db: SqlExecutor): Promise<LifeHubBackup> {
  const tables = {} as Record<BackupTableName, Array<Record<string, SqlValue>>>;
  const tableCounts = {} as Record<BackupTableName, number>;

  for (const table of BACKUP_TABLES) {
    const rows = await db.select<Record<string, SqlValue>>(`SELECT * FROM ${table}`);
    tables[table] = rows;
    tableCounts[table] = rows.length;
  }

  return {
    app: 'LifeHub',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tableCounts,
    tables,
  };
}

export function validateBackupPayload(raw: unknown): LifeHubBackup {
  const parsed = backupSchema.parse(raw);

  // Security check: ensure no iFood platform sneaks in via tampered backup
  const workSessions = parsed.tables['work_sessions'] ?? [];
  for (const ws of workSessions) {
    if (
      ws.platform !== 'uber_moto' &&
      ws.platform !== '99_moto' &&
      ws.platform !== 'ambos'
    ) {
      throw new Error(`Plataforma inválida encontrada no backup: ${String(ws.platform)}`);
    }
  }

  const tables = {} as Record<BackupTableName, Array<Record<string, SqlValue>>>;
  const tableCounts = {} as Record<BackupTableName, number>;

  for (const table of BACKUP_TABLES) {
    const rows = (parsed.tables[table] ?? []) as Array<Record<string, SqlValue>>;
    tables[table] = rows;
    tableCounts[table] = rows.length;
  }

  return {
    app: 'LifeHub',
    schemaVersion: parsed.schemaVersion,
    exportedAt: parsed.exportedAt,
    tableCounts,
    tables,
  };
}

export async function restoreBackupJson(
  db: SqlExecutor,
  rawPayload: unknown,
): Promise<{ restoredTables: number; totalRows: number }> {
  const backup = validateBackupPayload(rawPayload);

  // Collect allowed column names from live SQLite schema to prevent SQL injection or unknown columns
  const allowedColsByTable = new Map<string, Set<string>>();
  for (const table of BACKUP_TABLES) {
    const info = await db.select<{ name: string }>(`PRAGMA table_info(${table})`);
    allowedColsByTable.set(table, new Set(info.map((c) => c.name)));
  }

  let totalRows = 0;

  await db.transaction(async (tx) => {
    // Delete child tables first
    for (const table of [...BACKUP_TABLES].reverse()) {
      await tx.execute(`DELETE FROM ${table}`);
    }

    // Insert parent tables first
    for (const table of BACKUP_TABLES) {
      const rows = backup.tables[table] ?? [];
      const allowedCols = allowedColsByTable.get(table) ?? new Set<string>();

      for (const row of rows) {
        const cols = Object.keys(row).filter((col) => allowedCols.has(col));
        if (cols.length === 0) continue;

        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
        await tx.execute(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
          values,
        );
        totalRows++;
      }
    }
  });

  await ensureStructuralDefaults(db);

  return {
    restoredTables: BACKUP_TABLES.length,
    totalRows,
  };
}

export async function clearAllUserData(db: SqlExecutor): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [...BACKUP_TABLES].reverse()) {
      await tx.execute(`DELETE FROM ${table}`);
    }
  });
  await ensureStructuralDefaults(db);
}
