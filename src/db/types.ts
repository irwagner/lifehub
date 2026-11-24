export type SqlValue = string | number | null | Uint8Array;

export interface ExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface SqlExecutor {
  readonly driverName: 'tauri-sqlite' | 'sqljs-sqlite';
  execute(sql: string, params?: SqlValue[]): Promise<ExecuteResult>;
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  exportBinary?(): Promise<Uint8Array | null>;
  close(): Promise<void>;
}
