import { DurableObject } from 'cloudflare:workers';
import { handleSyncRequest, type AssetsBindingLike } from './handler';

interface VaultStub {
  getRecord(): Promise<string | null>;
  putRecord(value: string): Promise<void>;
  deleteRecord(): Promise<void>;
}

interface VaultNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): VaultStub;
}

export interface Env {
  VAULT_DO: VaultNamespaceLike;
  ASSETS?: AssetsBindingLike;
}

interface SqlCursorLike {
  toArray(): Array<{ payload: string }>;
}

interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

interface DurableObjectStateLike {
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  storage: {
    sql: SqlStorageLike;
  };
}

/**
 * Per-vault SQLite-backed Durable Object (Cloudflare Free Tier).
 * Provides strong consistency across Windows Desktop, iPhone, and Android with zero KV lag.
 */
export class VaultDurableObject extends DurableObject<Env> {
  private readonly sql: SqlStorageLike;

  constructor(ctx: DurableObjectStateLike, env: Env) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(ctx as any, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS vault_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    });
  }

  async getRecord(): Promise<string | null> {
    const rows = this.sql.exec('SELECT payload FROM vault_state WHERE id = 1').toArray();
    return rows[0]?.payload ?? null;
  }

  async putRecord(value: string): Promise<void> {
    this.sql.exec(
      `INSERT INTO vault_state (id, payload, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      value,
      new Date().toISOString(),
    );
  }

  async deleteRecord(): Promise<void> {
    this.sql.exec('DELETE FROM vault_state WHERE id = 1');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const getStub = (vaultId: string): VaultStub => {
      const id = env.VAULT_DO.idFromName(vaultId);
      return env.VAULT_DO.get(id);
    };

    return handleSyncRequest(request, {
      assets: env.ASSETS,
      store: {
        get: (vaultId) => getStub(vaultId).getRecord(),
        put: (vaultId, value) => getStub(vaultId).putRecord(value),
        delete: (vaultId) => getStub(vaultId).deleteRecord(),
      },
    });
  },
};
