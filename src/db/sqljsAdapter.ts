import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import type { ExecuteResult, SqlExecutor, SqlValue } from './types';

const STORAGE_KEY = 'lifehub_sqlite_db_v1';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      useOldExtensionFunctions: false,
      locateFile: (file: string) => {
        if (isBrowser()) {
          return '/sql-wasm.wasm';
        }
        return `node_modules/sql.js/dist/${file}`;
      },
    });
  }
  return sqlJsPromise;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class SqlJsSqliteAdapter implements SqlExecutor {
  readonly driverName = 'sqljs-sqlite' as const;
  private inTransaction = false;

  private constructor(
    private db: SqlJsDatabase,
    private readonly persistLocal: boolean,
  ) {}

  static async open(options?: {
    persistLocal?: boolean;
    initialBinary?: Uint8Array;
  }): Promise<SqlJsSqliteAdapter> {
    const SQL = await getSqlJs();
    const persistLocal = options?.persistLocal ?? isBrowser();

    let bytes = options?.initialBinary;
    if (!bytes && persistLocal && isBrowser()) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          bytes = base64ToUint8(saved);
        } catch {
          bytes = undefined;
        }
      }
    }

    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    return new SqlJsSqliteAdapter(db, persistLocal);
  }

  private saveIfNeeded(): void {
    if (!this.persistLocal || this.inTransaction || !isBrowser()) return;
    try {
      const data = this.db.export();
      localStorage.setItem(STORAGE_KEY, uint8ToBase64(data));
    } catch (error) {
      console.error('Falha ao persistir banco SQLite local:', error);
    }
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<ExecuteResult> {
    const stmt = this.db.prepare(sql);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      stmt.step();
    } finally {
      stmt.free();
    }
    const rowsAffected = this.db.getRowsModified();
    this.saveIfNeeded();
    return { rowsAffected };
  }

  async select<T = Record<string, unknown>>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return fn(this);
    }
    this.inTransaction = true;
    this.db.run('BEGIN TRANSACTION');
    try {
      const result = await fn(this);
      this.db.run('COMMIT');
      this.inTransaction = false;
      this.saveIfNeeded();
      return result;
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // Ignore rollback failure if transaction already aborted
      }
      this.inTransaction = false;
      throw error;
    }
  }

  async exportBinary(): Promise<Uint8Array | null> {
    return this.db.export();
  }

  async importBinary(bytes: Uint8Array): Promise<void> {
    // Validate SQLite 3 file magic header: "SQLite format 3\0"
    const magic = 'SQLite format 3\0';
    if (bytes.length < 100) {
      throw new Error('Arquivo SQLite inválido ou incompleto.');
    }
    for (let i = 0; i < magic.length; i++) {
      if (bytes[i] !== magic.charCodeAt(i)) {
        throw new Error('O arquivo selecionado não é um banco SQLite 3 válido.');
      }
    }

    const SQL = await getSqlJs();
    const candidate = new SQL.Database(bytes);
    try {
      // Sanity check that the database is readable and has LifeHub schema
      const res = candidate.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
      );
      if (!res.length || !res[0].values.length) {
        throw new Error('Este arquivo SQLite não contém um banco LifeHub válido.');
      }
    } catch (err) {
      candidate.close();
      throw err;
    }

    const oldDb = this.db;
    this.db = candidate;
    oldDb.close();
    this.saveIfNeeded();
  }

  async close(): Promise<void> {
    this.saveIfNeeded();
    this.db.close();
  }
}
