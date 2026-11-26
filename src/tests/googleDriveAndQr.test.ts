import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { createTransaction, deleteTransaction, listTransactions } from '../repositories/financeRepo';
import {
  buildMobilePairingUrl,
  parseScannedPairingText,
} from '../services/cloudSync';
import {
  generateGoogleDriveAppsScriptCode,
  syncDatabaseWithGoogleDriveAppsScript,
  syncDatabaseWithGoogleDriveOAuth,
  type GoogleDriveSyncConfig,
} from '../services/googleDriveSync';
import { clearTombstones } from '../services/syncTombstones';

describe('Pareamento por QR Code (Scanner In-App) e Sync E2EE no Google Drive', () => {
  it('decodifica URL HTTPS, deep link lifehub://, fragmento #pair= e JSON cru do QR Code', () => {
    const url = buildMobilePairingUrl(
      'https://lifehub-sync.irwagneremanoel.workers.dev',
      'LH-TEST-1234-ABCD-5678',
      { geminiApiKey: 'AIzaTestKey123' },
    );

    const fromHttps = parseScannedPairingText(url);
    expect(fromHttps).toEqual({
      endpointUrl: 'https://lifehub-sync.irwagneremanoel.workers.dev',
      passphrase: 'LH-TEST-1234-ABCD-5678',
      geminiApiKey: 'AIzaTestKey123',
    });

    const hashPart = url.slice(url.indexOf('#'));
    const fromDeepLink = parseScannedPairingText(`lifehub://pair${hashPart}`);
    expect(fromDeepLink?.passphrase).toBe('LH-TEST-1234-ABCD-5678');

    const fromHashOnly = parseScannedPairingText(hashPart);
    expect(fromHashOnly?.endpointUrl).toBe('https://lifehub-sync.irwagneremanoel.workers.dev');

    const fromRawJson = parseScannedPairingText(
      JSON.stringify({ u: 'https://lifehub-sync.irwagneremanoel.workers.dev', k: 'LH-ABCD-EFGH' }),
    );
    expect(fromRawJson?.passphrase).toBe('LH-ABCD-EFGH');

    expect(parseScannedPairingText('https://google.com')).toBeNull();
  });

  it('sincroniza PC <-> Google Drive (Apps Script Vault) com criptografia E2EE AES-256-GCM e tombstones', async () => {
    clearTombstones();
    const pcDb = await createInMemoryTestDatabase();
    const mobileDb = await createInMemoryTestDatabase();

    await createTransaction(pcDb, {
      account_id: 'acc_principal',
      category_id: 'cat_combustivel',
      type: 'expense',
      source_type: 'outros',
      description: 'Gasolina PC Secreta',
      amount: 45,
      date: '2026-11-26',
      status: 'realized',
    });

    let storedEnvelopeRaw = '';
    let storedEnvelopeObj: unknown = null;

    const mockDriveScriptFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        action: string;
        secret: string;
        envelope?: unknown;
      };
      if (body.secret !== 'GD-TEST-SECRET-9999') {
        return new Response(JSON.stringify({ ok: false, error: 'Token inválido' }), { status: 200 });
      }
      if (body.action === 'get') {
        return new Response(
          JSON.stringify({
            ok: true,
            found: Boolean(storedEnvelopeObj),
            fileId: storedEnvelopeObj ? 'drive_file_1' : undefined,
            envelope: storedEnvelopeObj,
          }),
          { status: 200 },
        );
      }
      if (body.action === 'put') {
        storedEnvelopeObj = body.envelope;
        storedEnvelopeRaw = JSON.stringify(body.envelope);
        return new Response(
          JSON.stringify({ ok: true, fileId: 'drive_file_1', updatedAt: new Date().toISOString() }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const cfg: GoogleDriveSyncConfig = {
      enabled: true,
      mode: 'apps_script',
      autoSync: true,
      customPassphrase: 'LH-DRIVE-E2EE-KEY-9999',
      oauthClientId: '',
      googleUserEmail: null,
      appsScriptUrl: 'https://script.google.com/macros/s/test-script/exec',
      appsScriptSecret: 'GD-TEST-SECRET-9999',
      driveFolderName: 'LifeHub',
      driveFileName: 'lifehub-vault-e2ee.json',
      driveFileId: null,
      lastSyncedAt: null,
      lastRevision: 0,
    };

    // 1. PC pushes initial encrypted vault to Google Drive
    const push1 = await syncDatabaseWithGoogleDriveAppsScript(pcDb, cfg, {
      deviceName: 'Windows Desktop',
      fetchFn: mockDriveScriptFetch,
    });
    expect(push1.action).toBe('pushed_initial');
    expect(push1.revision).toBe(1);
    expect(storedEnvelopeRaw).not.toContain('Gasolina PC Secreta'); // Zero plaintext in Google Drive!

    // 2. Mobile pulls & merges, adds a new expense, and deletes PC's expense
    const pullMobile = await syncDatabaseWithGoogleDriveAppsScript(mobileDb, cfg, {
      deviceName: 'Android App',
      fetchFn: mockDriveScriptFetch,
    });
    expect(pullMobile.remoteHadData).toBe(true);
    const mobileTxs = await listTransactions(mobileDb);
    expect(mobileTxs.some((t) => t.description === 'Gasolina PC Secreta')).toBe(true);

    const toDelete = mobileTxs.find((t) => t.description === 'Gasolina PC Secreta')!;
    await deleteTransaction(mobileDb, toDelete.id);
    await createTransaction(mobileDb, {
      account_id: 'acc_principal',
      category_id: 'cat_alimentacao',
      type: 'expense',
      source_type: 'outros',
      description: 'Almoço Celular',
      amount: 28,
      date: '2026-11-26',
      status: 'realized',
    });

    await syncDatabaseWithGoogleDriveAppsScript(mobileDb, cfg, {
      deviceName: 'Android App',
      fetchFn: mockDriveScriptFetch,
    });

    // 3. PC syncs again -> receives Mobile's expense AND does NOT resurrect deleted expense!
    await syncDatabaseWithGoogleDriveAppsScript(pcDb, cfg, {
      deviceName: 'Windows Desktop',
      fetchFn: mockDriveScriptFetch,
    });

    const pcFinalTxs = await listTransactions(pcDb);
    expect(pcFinalTxs.some((t) => t.description === 'Almoço Celular')).toBe(true);
    expect(pcFinalTxs.some((t) => t.description === 'Gasolina PC Secreta')).toBe(false);

    const scriptCode = generateGoogleDriveAppsScriptCode('GD-TEST-SECRET-9999');
    expect(scriptCode).toContain('DriveApp.getFoldersByName');
    expect(scriptCode).toContain('lifehub-vault-e2ee.json');

    clearTombstones();
    await pcDb.close();
    await mobileDb.close();
  });

  it('sincroniza via Google Drive REST API v3 (OAuth 2.0 drive.file) criando pasta e arquivo criptografado', async () => {
    clearTombstones();
    const db1 = await createInMemoryTestDatabase();
    const db2 = await createInMemoryTestDatabase();

    await createTransaction(db1, {
      account_id: 'acc_principal',
      category_id: 'cat_apps',
      type: 'income',
      source_type: 'aplicativos',
      description: 'Corrida Uber Moto Drive OAuth',
      amount: 220,
      date: '2026-11-26',
      status: 'realized',
    });

    let folderCreated = false;
    let savedDriveContent = '';

    const mockDriveOAuthFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      // Folder search
      if (url.includes('/drive/v3/files?q=') && url.includes('folder')) {
        return new Response(
          JSON.stringify({ files: folderCreated ? [{ id: 'fld_lifehub', name: 'LifeHub' }] : [] }),
          { status: 200 },
        );
      }
      // Folder create
      if (method === 'POST' && url.includes('/drive/v3/files?fields=id')) {
        folderCreated = true;
        return new Response(JSON.stringify({ id: 'fld_lifehub' }), { status: 200 });
      }
      // File search inside folder
      if (url.includes('/drive/v3/files?q=') && url.includes('lifehub-vault-e2ee.json')) {
        return new Response(
          JSON.stringify({
            files: savedDriveContent ? [{ id: 'file_vault_oauth', name: 'lifehub-vault-e2ee.json' }] : [],
          }),
          { status: 200 },
        );
      }
      // Multipart create upload
      if (method === 'POST' && url.includes('/upload/drive/v3/files?uploadType=multipart')) {
        const rawBody = String(init?.body ?? '');
        const parts = rawBody.split('\r\n\r\n');
        // Extract second JSON payload part (before closing boundary)
        const jsonPart = parts[2]?.split('\r\n--')[0] ?? '';
        savedDriveContent = jsonPart;
        return new Response(JSON.stringify({ id: 'file_vault_oauth' }), { status: 200 });
      }
      // File download
      if (method === 'GET' && url.includes('/drive/v3/files/file_vault_oauth?alt=media')) {
        return new Response(savedDriveContent, { status: 200 });
      }
      // Media update
      if (method === 'PATCH' && url.includes('/upload/drive/v3/files/file_vault_oauth')) {
        savedDriveContent = String(init?.body ?? '');
        return new Response(JSON.stringify({ id: 'file_vault_oauth' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `Unexpected ${method} ${url}` }), { status: 404 });
    }) as typeof fetch;

    const cfg: GoogleDriveSyncConfig = {
      enabled: true,
      mode: 'oauth',
      autoSync: true,
      customPassphrase: 'LH-OAUTH-VAULT-KEY-777',
      oauthClientId: '12345.apps.googleusercontent.com',
      googleUserEmail: 'usuario@gmail.com',
      appsScriptUrl: '',
      appsScriptSecret: '',
      driveFolderName: 'LifeHub',
      driveFileName: 'lifehub-vault-e2ee.json',
      driveFileId: null,
      lastSyncedAt: null,
      lastRevision: 0,
    };

    const res1 = await syncDatabaseWithGoogleDriveOAuth(db1, cfg, {
      accessToken: 'ya29.fake-oauth-token',
      deviceName: 'Windows Desktop',
      fetchFn: mockDriveOAuthFetch,
    });
    expect(res1.provider).toBe('oauth');
    expect(res1.fileId).toBe('file_vault_oauth');
    expect(folderCreated).toBe(true);
    expect(savedDriveContent).not.toContain('Corrida Uber Moto Drive OAuth');

    const res2 = await syncDatabaseWithGoogleDriveOAuth(db2, cfg, {
      accessToken: 'ya29.fake-oauth-token',
      deviceName: 'iPhone App',
      fetchFn: mockDriveOAuthFetch,
    });
    expect(res2.remoteHadData).toBe(true);
    expect(res2.revision).toBe(2);
    const db2Txs = await listTransactions(db2);
    expect(db2Txs.some((t) => t.description === 'Corrida Uber Moto Drive OAuth')).toBe(true);

    clearTombstones();
    await db1.close();
    await db2.close();
  });
});
