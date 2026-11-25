import { describe, expect, it } from 'vitest';
import { checkForGitHubUpdate, compareSemver } from '../services/updater';

describe('Atualização Automática pelo GitHub Releases', () => {
  it('compara versões semânticas corretamente com ou sem prefixo v', () => {
    expect(compareSemver('0.3.0', '0.2.0')).toBe(1);
    expect(compareSemver('v1.0.0', '0.9.9')).toBe(1);
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('0.1.9', '0.2.0')).toBe(-1);
  });

  it('detecta nova versão disponível no GitHub e identifica LifeHub.exe e instalador', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v0.3.0',
          name: 'LifeHub v0.3.0',
          html_url: 'https://github.com/irwagner/lifehub/releases/tag/v0.3.0',
          published_at: '2026-11-26T10:00:00Z',
          body: 'Novas melhorias',
          assets: [
            {
              name: 'LifeHub.exe',
              size: 12_500_000,
              browser_download_url:
                'https://github.com/irwagner/lifehub/releases/download/v0.3.0/LifeHub.exe',
            },
            {
              name: 'LifeHub-Instalador-Windows.exe',
              size: 3_500_000,
              browser_download_url:
                'https://github.com/irwagner/lifehub/releases/download/v0.3.0/LifeHub-Instalador-Windows.exe',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    const info = await checkForGitHubUpdate(mockFetch, '0.2.0');
    expect(info.hasUpdate).toBe(true);
    expect(info.latestVersion).toBe('0.3.0');
    expect(info.portableAsset?.name).toBe('LifeHub.exe');
    expect(info.installerAsset?.name).toBe('LifeHub-Instalador-Windows.exe');

    const upToDate = await checkForGitHubUpdate(mockFetch, '0.3.0');
    expect(upToDate.hasUpdate).toBe(false);
  });
});
