import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../db/client';

export const CURRENT_APP_VERSION = '0.5.1';
export const GITHUB_REPO_OWNER = 'irwagner';
export const GITHUB_REPO_NAME = 'lifehub';
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
export const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;

export interface ReleaseAssetInfo {
  name: string;
  size: number;
  downloadUrl: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  publishedAt: string;
  notes: string;
  portableAsset: ReleaseAssetInfo | null;
  installerAsset: ReleaseAssetInfo | null;
}

interface GitHubReleaseApiResponse {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  assets?: Array<{
    name?: string;
    size?: number;
    browser_download_url?: string;
  }>;
}

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '').split('-')[0] || '0.0.0';
}

/**
 * Returns >0 if `a > b`, <0 if `a < b`, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = normalizeVersion(b)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export async function resolveCurrentVersion(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const v = await invoke<string>('get_app_version');
      if (v && v.trim()) return normalizeVersion(v);
    } catch {
      // fallback to frontend constant
    }
  }
  return CURRENT_APP_VERSION;
}

export async function checkForGitHubUpdate(
  fetchFn: typeof fetch = fetch,
  currentVersionOverride?: string,
): Promise<UpdateCheckResult> {
  const currentVersion = currentVersionOverride
    ? normalizeVersion(currentVersionOverride)
    : await resolveCurrentVersion();

  const res = await fetchFn(GITHUB_RELEASES_API, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!res.ok) {
    throw new Error(`Não foi possível consultar o GitHub Releases (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as GitHubReleaseApiResponse;
  const latestVersion = normalizeVersion(data.tag_name ?? currentVersion);
  const assets = (data.assets ?? [])
    .filter((a) => typeof a.name === 'string' && typeof a.browser_download_url === 'string')
    .map((a) => ({
      name: a.name as string,
      size: Number(a.size ?? 0),
      downloadUrl: a.browser_download_url as string,
    }));

  const portableAsset =
    assets.find((a) => /^lifehub\.exe$/i.test(a.name)) ??
    assets.find((a) => /\.exe$/i.test(a.name) && !/setup|instalador/i.test(a.name)) ??
    null;

  const installerAsset =
    assets.find((a) => /instalador|setup/i.test(a.name) && /\.exe$/i.test(a.name)) ?? null;

  return {
    hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    releaseName: data.name?.trim() || `LifeHub v${latestVersion}`,
    releaseUrl: data.html_url || GITHUB_RELEASES_PAGE,
    publishedAt: data.published_at || '',
    notes: (data.body || '').trim(),
    portableAsset,
    installerAsset,
  };
}

export async function downloadAndInstallUpdate(
  asset: ReleaseAssetInfo,
  isInstaller: boolean,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>('download_and_apply_update', {
      downloadUrl: asset.downloadUrl,
      isInstaller,
    });
  }
  window.open(asset.downloadUrl, '_blank', 'noopener,noreferrer');
  return 'Download iniciado no navegador.';
}
