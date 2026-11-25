import { describe, expect, it } from 'vitest';
import { buildQrSvgPath } from '../components/PairingQrCode';
import { buildMobilePairingUrl, parseMobilePairingHash } from '../services/cloudSync';

describe('Pareamento Mobile & QR Code Offline', () => {
  it('gera e decodifica link de pareamento com fragmento #pair=', () => {
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
