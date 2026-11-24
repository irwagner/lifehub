import { runMigrations } from './migrations';
import { SqlJsSqliteAdapter } from './sqljsAdapter';
import { TauriSqliteAdapter } from './tauriAdapter';
import type { SqlExecutor } from './types';

let activeDb: SqlExecutor | null = null;
let initPromise: Promise<SqlExecutor> | null = null;

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export async function getDatabase(): Promise<SqlExecutor> {
  if (activeDb) return activeDb;

  if (!initPromise) {
    initPromise = (async () => {
      let adapter: SqlExecutor;
      if (isTauriRuntime()) {
        adapter = await TauriSqliteAdapter.open('sqlite:lifehub.db');
      } else {
        adapter = await SqlJsSqliteAdapter.open({ persistLocal: true });
      }
      await runMigrations(adapter);
      activeDb = adapter;
      return adapter;
    })();
  }

  return initPromise;
}

export async function createInMemoryTestDatabase(): Promise<SqlExecutor> {
  const adapter = await SqlJsSqliteAdapter.open({ persistLocal: false });
  await runMigrations(adapter);
  return adapter;
}
