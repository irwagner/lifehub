import Database from '@tauri-apps/plugin-sql';
import type { ExecuteResult, SqlExecutor, SqlValue } from './types';

/**
 * Converts positional `?` placeholders to `$1, $2, ...` required by tauri-plugin-sql,
 * skipping `?` inside single-quoted string literals.
 */
export function convertPlaceholdersToDollar(sql: string): string {
  let result = '';
  let paramIndex = 1;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += ch;
      continue;
    }

    if (ch === '?' && !inSingleQuote) {
      result += `$${paramIndex++}`;
    } else {
      result += ch;
    }
  }

  return result;
}

export class TauriSqliteAdapter implements SqlExecutor {
  readonly driverName = 'tauri-sqlite' as const;
  private inTransaction = false;

  private constructor(private readonly db: Database) {}

  static async open(dbUrl = 'sqlite:lifehub.db'): Promise<TauriSqliteAdapter> {
    const db = await Database.load(dbUrl);
    return new TauriSqliteAdapter(db);
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<ExecuteResult> {
    const formattedSql = convertPlaceholdersToDollar(sql);
    const res = await this.db.execute(formattedSql, params);
    return {
      rowsAffected: res.rowsAffected,
      lastInsertId: typeof res.lastInsertId === 'number' ? res.lastInsertId : undefined,
    };
  }

  async select<T = Record<string, unknown>>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<T[]> {
    const formattedSql = convertPlaceholdersToDollar(sql);
    return this.db.select<T[]>(formattedSql, params);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return fn(this);
    }

    this.inTransaction = true;
    await this.db.execute('BEGIN TRANSACTION');
    try {
      const value = await fn(this);
      await this.db.execute('COMMIT');
      return value;
    } catch (error) {
      await this.db.execute('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
