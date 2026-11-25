import { describe, expect, it } from 'vitest';
import {
  handleSyncRequest,
  type VaultStoreLike,
} from '../../cloudflare-sync/src/handler';
import { createInMemoryTestDatabase } from '../db/client';
import { createTask, listTasks } from '../repositories/calendarRepo';
import { createTransaction, listTransactions } from '../repositories/financeRepo';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import { createWorkSession, listWorkSessions } from '../repositories/workRepo';
import { exportBackupJson } from '../services/backup';
import {
  buildMobilePairingUrl,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  generateSyncPassphrase,
  parseMobilePairingHash,
  syncDatabaseWithCloud,
  testCloudSyncConnection,
} from '../services/cloudSync';

function createMockStore(): VaultStoreLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function createWorkerFetch(store: VaultStoreLike): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return handleSyncRequest(req, { store });
  }) as typeof fetch;
}

describe('App Mobile + Cloudflare Sync Zero-Knowledge (E2EE)', () => {
  it('criptografa snapshot com AES-256-GCM sem vazar texto claro e rejeita chave incorreta', async () => {
    const db = await createInMemoryTestDatabase();
    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'SEGREDO_FINANCEIRO_98765',
      amount: 4321.5,
      date: '2026-11-24',
      status: 'realized',
    });

    const backup = await exportBackupJson(db);
    const key = generateSyncPassphrase();
    expect(key).toMatch(/^LH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const envelope = await encryptBackupEnvelope(backup, key, {
      deviceName: 'Windows Desktop',
      revision: 1,
    });

    const rawSerialized = JSON.stringify(envelope);
    expect(rawSerialized).not.toContain('SEGREDO_FINANCEIRO_98765');
    expect(rawSerialized).not.toContain('4321.5');

    const { backup: decrypted } = await decryptBackupEnvelope(envelope, key);
    expect(decrypted.tables.transactions).toHaveLength(1);
    expect(decrypted.tables.transactions[0].description).toBe('SEGREDO_FINANCEIRO_98765');

    await expect(decryptBackupEnvelope(envelope, 'LH-WRONG-KEY-0000-0000')).rejects.toThrow(
      /descriptografar/i,
    );
    await db.close();
  });

  it('gera e lê link mágico de pareamento no fragmento (#pair) sem expor chave na query HTTP', () => {
    const key = generateSyncPassphrase();
    const link = buildMobilePairingUrl('https://lifehub-sync.demo.workers.dev/', key);
    expect(link.startsWith('https://lifehub-sync.demo.workers.dev/#pair=')).toBe(true);
    expect(link).not.toContain('?');

    const parsed = parseMobilePairingHash(new URL(link).hash);
    expect(parsed).toEqual({
      endpointUrl: 'https://lifehub-sync.demo.workers.dev',
      passphrase: key,
    });
  });

  it('sincroniza bidirecionalmente Desktop ↔ Celular pelo Worker Cloudflare sem perder dados offline nem a skin local', async () => {
    const kv = createMockStore();
    const workerFetch = createWorkerFetch(kv);
    const endpointUrl = 'https://lifehub-sync.demo.workers.dev';
    const passphrase = generateSyncPassphrase();

    // Health check
    const health = await testCloudSyncConnection(endpointUrl, workerFetch);
    expect(health.ok).toBe(true);
    expect(health.service).toBe('lifehub-sync');

    // Desktop & Mobile start as separate SQLite databases
    const desktopDb = await createInMemoryTestDatabase();
    const mobileDb = await createInMemoryTestDatabase();

    await updateSettings(desktopDb, {
      user_name: 'Carlos',
      ui_skin: 'concept_qleandesk',
      onboarding_completed: 1,
    });
    const desktopSettings = await getSettings(desktopDb);

    await createTransaction(desktopDb, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário Desktop',
      amount: 3200,
      date: '2026-11-24',
      status: 'realized',
    });

    // 1. Desktop pushes initial encrypted snapshot (rev 1)
    const r1 = await syncDatabaseWithCloud(
      desktopDb,
      { endpointUrl, passphrase, deviceName: 'Windows Desktop' },
      workerFetch,
    );
    expect(r1.action).toBe('pushed_initial');
    expect(r1.revision).toBe(1);
    expect(kv.store.size).toBe(1);

    // Ensure KV stored zero plaintext
    const storedKvRaw = Array.from(kv.store.values())[0];
    expect(storedKvRaw).not.toContain('Salário Desktop');

    // 2. Mobile syncs and pulls Desktop data (rev 2)
    const r2 = await syncDatabaseWithCloud(
      mobileDb,
      { endpointUrl, passphrase, deviceName: 'iPhone' },
      workerFetch,
    );
    expect(r2.action).toBe('merged_and_pushed');
    expect(r2.revision).toBe(2);
    expect((await listTransactions(mobileDb)).some((t) => t.description === 'Salário Desktop')).toBe(
      true,
    );

    // 3. Offline edits on BOTH devices simultaneously
    await createTask(desktopDb, { title: 'Tarefa criada no PC' });
    await createWorkSession(
      mobileDb,
      {
        date: '2026-11-25',
        platform: '99_moto',
        start_time: '07:00',
        end_time: '12:00',
        gross_amount: 185,
        km_total: 92,
        fuel_cost: 28,
      },
      desktopSettings,
    );
    await createTransaction(mobileDb, {
      account_id: 'acc_principal',
      category_id: 'cat_combustivel',
      type: 'expense',
      source_type: 'aplicativos',
      description: 'Gasolina lançada no iPhone',
      amount: 28,
      date: '2026-11-25',
      status: 'realized',
    });

    // 4. Mobile syncs (rev 3), then Desktop syncs (rev 4), then Mobile syncs (rev 5)
    await syncDatabaseWithCloud(
      mobileDb,
      { endpointUrl, passphrase, deviceName: 'iPhone' },
      workerFetch,
    );
    const r4 = await syncDatabaseWithCloud(
      desktopDb,
      { endpointUrl, passphrase, deviceName: 'Windows Desktop' },
      workerFetch,
    );
    expect(r4.revision).toBe(4);

    // Desktop now has BOTH its offline task AND Mobile's 99Moto session & fuel expense, keeping its local skin!
    expect((await listTasks(desktopDb)).some((t) => t.title === 'Tarefa criada no PC')).toBe(true);
    expect((await listWorkSessions(desktopDb)).some((w) => w.platform === '99_moto')).toBe(true);
    expect(
      (await listTransactions(desktopDb)).some((t) => t.description === 'Gasolina lançada no iPhone'),
    ).toBe(true);
    expect((await getSettings(desktopDb)).ui_skin).toBe('concept_qleandesk');

    // Sync Mobile once more to also receive Desktop's offline task
    await syncDatabaseWithCloud(
      mobileDb,
      { endpointUrl, passphrase, deviceName: 'iPhone' },
      workerFetch,
    );
    expect((await listTasks(mobileDb)).some((t) => t.title === 'Tarefa criada no PC')).toBe(true);

    // Worker rejects wrong token & invalid vault ID
    const badRes = await workerFetch(`${endpointUrl}/api/vault/${'a'.repeat(64)}`, {
      method: 'GET',
      headers: { 'X-Vault-Token': 'short' },
    });
    expect(badRes.status).toBe(401);

    await desktopDb.close();
    await mobileDb.close();
  });
});
