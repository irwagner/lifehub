import { describe, expect, it } from 'vitest';
import { buildQrSvgPath } from '../components/PairingQrCode';
import {
  buildMobilePairingUrl,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  mergeBackups,
  parseMobilePairingHash,
} from '../services/cloudSync';
import { createInMemoryTestDatabase } from '../db/client';
import { exportBackupJson } from '../services/backup';

describe('Pareamento Mobile & QR Code Offline', () => {
  it('gera e decodifica link de pareamento com fragmento #pair= (com e sem chave Gemini IA)', () => {
    const url = buildMobilePairingUrl(
      'https://lifehub-sync.irwagneremanoel.workers.dev/',
      'LH-TEST-9876-ABCD-1234',
    );
    expect(url.startsWith('https://lifehub-sync.irwagneremanoel.workers.dev/#pair=')).toBe(true);

    const hash = url.slice(url.indexOf('#'));
    const parsed = parseMobilePairingHash(hash);
    expect(parsed).toEqual({
      endpointUrl: 'https://lifehub-sync.irwagneremanoel.workers.dev',
      passphrase: 'LH-TEST-9876-ABCD-1234',
    });

    const urlWithAi = buildMobilePairingUrl(
      'https://lifehub-sync.irwagneremanoel.workers.dev',
      'LH-TEST-9876-ABCD-1234',
      { geminiApiKey: 'AIzaSyTEST_KEY_LOCAL_ONLY' },
    );
    const parsedWithAi = parseMobilePairingHash(urlWithAi.slice(urlWithAi.indexOf('#')));
    expect(parsedWithAi).toEqual({
      endpointUrl: 'https://lifehub-sync.irwagneremanoel.workers.dev',
      passphrase: 'LH-TEST-9876-ABCD-1234',
      geminiApiKey: 'AIzaSyTEST_KEY_LOCAL_ONLY',
    });
  });

  it('criptografa e mescla a chave da IA Gemini + memória dentro do cofre E2EE sem vazar texto claro', async () => {
    const db = await createInMemoryTestDatabase();
    const localBackup = await exportBackupJson(db);
    const remoteBackup = await exportBackupJson(db);

    remoteBackup.clientExtensions = {
      geminiAi: {
        apiKey: 'AQ.Ab8RN6TEST_GEMINI_SECRET',
        model: 'auto',
        shareFinancialContext: true,
        autoExecuteActions: true,
        updatedAt: '2026-11-25T22:00:00.000Z',
      },
      aiMemory: [
        { id: 'm1', fact: 'Pagamentos fixos no dia 01.', createdAt: '2026-11-25T22:00:00.000Z' },
      ],
    };

    const envelope = await encryptBackupEnvelope(remoteBackup, 'LH-TEST-9876-ABCD-1234', {
      deviceName: 'Windows Desktop',
      revision: 1,
    });
    expect(JSON.stringify(envelope)).not.toContain('AQ.Ab8RN6TEST_GEMINI_SECRET');

    const { backup: decrypted } = await decryptBackupEnvelope(envelope, 'LH-TEST-9876-ABCD-1234');
    const merged = mergeBackups(localBackup, decrypted);
    expect(merged.clientExtensions?.geminiAi?.apiKey).toBe('AQ.Ab8RN6TEST_GEMINI_SECRET');
    expect(merged.clientExtensions?.aiMemory).toHaveLength(1);

    await db.close();
  });

  it('recusa chave secreta curta ao montar link de pareamento', () => {
    expect(() =>
      buildMobilePairingUrl('https://lifehub-sync.irwagneremanoel.workers.dev', '1234567'),
    ).toThrow(/8 caracteres/i);
  });

  it('gera matriz SVG de QR Code 100% offline com quiet zone válida', () => {
    const pairUrl = buildMobilePairingUrl(
      'https://lifehub-sync.irwagneremanoel.workers.dev',
      'LH-TEST-9876-ABCD-1234',
    );
    const qr = buildQrSvgPath(pairUrl, 3);
    expect(qr.size).toBeGreaterThanOrEqual(35);
    expect(qr.moduleCount).toBeGreaterThan(100);
    expect(qr.path.startsWith('M')).toBe(true);
    expect(qr.path).not.toContain('http');
  });
});
