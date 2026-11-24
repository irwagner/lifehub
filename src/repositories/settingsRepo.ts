import type { SqlExecutor } from '../db/types';
import { settingsUpdateSchema } from '../services/validation';
import type { Settings } from '../types/domain';

export async function getSettings(db: SqlExecutor): Promise<Settings> {
  const rows = await db.select<Settings>('SELECT * FROM settings WHERE id = 1');
  if (rows.length === 0) {
    throw new Error('Configurações iniciais não encontradas no banco.');
  }
  return rows[0];
}

export async function updateSettings(
  db: SqlExecutor,
  patch: Partial<Omit<Settings, 'id' | 'updated_at'>>,
): Promise<Settings> {
  const parsed = settingsUpdateSchema.parse(patch);
  const keys = Object.keys(parsed) as Array<keyof typeof parsed>;
  if (keys.length === 0) {
    return getSettings(db);
  }

  const now = new Date().toISOString();
  const assignments = keys.map((k) => `${k} = ?`);
  const values = keys.map((k) => parsed[k] ?? null);

  await db.execute(
    `UPDATE settings SET ${assignments.join(', ')}, updated_at = ? WHERE id = 1`,
    [...values, now],
  );

  return getSettings(db);
}
