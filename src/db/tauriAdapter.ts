import { invoke } from '@tauri-apps/api/core';
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

export interface TauriDbLike {
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  close(): Promise<boolean>;
}

/**
 * Adapter for official `@tauri-apps/plugin-sql` (SQLite).
 *
 * IMPORTANT: `tauri-plugin-sql` v2 uses a multi-connection `sqlx::Pool<Sqlite>`, where each
 * `execute()` call may borrow a different connection from the pool. Sending raw `BEGIN TRANSACTION`
 * / `COMMIT` across separate `execute()` calls causes `database is locked` or
 * `cannot commit - no transaction is active` errors on pooled connections.
 * Therefore, `transaction()` serializes multi-step writes through an async mutex queue without
 * leaving dangling transactions on random pooled connections.
 */
export class TauriSqliteAdapter implements SqlExecutor {
  readonly driverName = 'tauri-sqlite' as const;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private inMutex = false;

  private constructor(private readonly db: TauriDbLike) {}

  static async open(dbUrl = 'sqlite:lifehub.db'): Promise<TauriSqliteAdapter> {
    const db = await Database.load(dbUrl);
    return new TauriSqliteAdapter(db);
  }

  static fromInstance(db: TauriDbLike): TauriSqliteAdapter {
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
    if (this.inMutex) {
      return fn(this);
    }

    const prev = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;
    this.inMutex = true;
    try {
      return await fn(this);
    } finally {
      this.inMutex = false;
      release();
    }
  }

  async exportBinary(): Promise<Uint8Array | null> {
    const bytes = await invoke<number[]>('export_sqlite_bytes');
    return new Uint8Array(bytes);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
