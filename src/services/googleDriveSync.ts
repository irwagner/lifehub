import type { SqlExecutor } from '../db/types';
import { exportBackupJson, restoreBackupJson } from './backup';
import {
  GOOGLE_DRIVE_STORAGE_KEY,
  applyMergedClientExtensions,
  collectLocalClientExtensions,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  generateSyncPassphrase,
  loadCloudSyncConfig,
  mergeBackups,
  totalRowsInBackup,
  type EncryptedVaultEnvelope,
} from './cloudSync';

export type GoogleDriveSyncMode = 'oauth' | 'apps_script';

export interface GoogleDriveSyncConfig {
  enabled: boolean;
  mode: GoogleDriveSyncMode;
  autoSync: boolean;
  /** Optional custom passphrase; when empty, automatically reuses the main E2EE Vault Key from CloudSync. */
  customPassphrase: string;
  oauthClientId: string;
  googleUserEmail: string | null;
  appsScriptUrl: string;
  appsScriptSecret: string;
  driveFolderName: string;
  driveFileName: string;
  driveFileId: string | null;
  lastSyncedAt: string | null;
  lastRevision: number;
  updatedAt?: string;
}

export interface GoogleDriveSyncResult {
  provider: GoogleDriveSyncMode;
  action: 'pushed_initial' | 'merged_and_pushed';
  revision: number;
  syncedAt: string;
  remoteHadData: boolean;
  localRowCount: number;
  mergedRowCount: number;
  fileId?: string;
}

const DEFAULT_DRIVE_FOLDER = 'LifeHub';
const DEFAULT_DRIVE_FILE = 'lifehub-vault-e2ee.json';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_OAUTH_SCOPE =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

// Ephemeral in-memory OAuth access token (never persisted to backup or disk)
let memoryOAuthToken: { accessToken: string; expiresAt: number; email?: string | null } | null =
  null;

export function setGoogleDriveSessionToken(
  accessToken: string,
  expiresInSeconds = 3500,
  email?: string | null,
): void {
  memoryOAuthToken = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresInSeconds - 60) * 1000,
    email: email ?? null,
  };
}

export function clearGoogleDriveSessionToken(): void {
  memoryOAuthToken = null;
}

export function getGoogleDriveSessionToken(): string | null {
  if (!memoryOAuthToken) return null;
  if (Date.now() >= memoryOAuthToken.expiresAt) {
    memoryOAuthToken = null;
    return null;
  }
  return memoryOAuthToken.accessToken;
}

export function generateGoogleDriveSecret(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = new Uint8Array(12);
  crypto.getRandomValues(random);
  const chars = Array.from(random, (b) => alphabet[b % alphabet.length]);
  return `GD-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function loadGoogleDriveConfig(): GoogleDriveSyncConfig {
  try {
    const raw = localStorage.getItem(GOOGLE_DRIVE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GoogleDriveSyncConfig>;
      return {
        enabled: Boolean(parsed.enabled),
        mode: parsed.mode === 'oauth' ? 'oauth' : 'apps_script',
        autoSync: parsed.autoSync !== false,
        customPassphrase:
          typeof parsed.customPassphrase === 'string' ? parsed.customPassphrase : '',
        oauthClientId: typeof parsed.oauthClientId === 'string' ? parsed.oauthClientId : '',
        googleUserEmail: typeof parsed.googleUserEmail === 'string' ? parsed.googleUserEmail : null,
        appsScriptUrl: typeof parsed.appsScriptUrl === 'string' ? parsed.appsScriptUrl : '',
        appsScriptSecret:
          typeof parsed.appsScriptSecret === 'string' && parsed.appsScriptSecret.trim()
            ? parsed.appsScriptSecret
            : generateGoogleDriveSecret(),
        driveFolderName:
          typeof parsed.driveFolderName === 'string' && parsed.driveFolderName.trim()
            ? parsed.driveFolderName.trim()
            : DEFAULT_DRIVE_FOLDER,
        driveFileName:
          typeof parsed.driveFileName === 'string' && parsed.driveFileName.trim()
            ? parsed.driveFileName.trim()
            : DEFAULT_DRIVE_FILE,
        driveFileId: typeof parsed.driveFileId === 'string' ? parsed.driveFileId : null,
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
        lastRevision: typeof parsed.lastRevision === 'number' ? parsed.lastRevision : 0,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
    }
  } catch {
    // ignore corrupted local storage
  }
  return {
    enabled: false,
    mode: 'apps_script',
    autoSync: true,
    customPassphrase: '',
    oauthClientId: '',
    googleUserEmail: null,
    appsScriptUrl: '',
    appsScriptSecret: generateGoogleDriveSecret(),
    driveFolderName: DEFAULT_DRIVE_FOLDER,
    driveFileName: DEFAULT_DRIVE_FILE,
    driveFileId: null,
    lastSyncedAt: null,
    lastRevision: 0,
  };
}

export function saveGoogleDriveConfig(cfg: GoogleDriveSyncConfig): void {
  try {
    localStorage.setItem(
      GOOGLE_DRIVE_STORAGE_KEY,
      JSON.stringify({
        ...cfg,
        updatedAt: cfg.updatedAt ?? new Date().toISOString(),
      }),
    );
  } catch {
    // ignore storage quota errors
  }
}

export function resolveGoogleDrivePassphrase(cfg: GoogleDriveSyncConfig): string {
  const custom = cfg.customPassphrase.trim();
  if (custom.length >= 8) return custom;
  const cloudCfg = loadCloudSyncConfig();
  if (cloudCfg.passphrase.trim().length >= 8) {
    return cloudCfg.passphrase.trim();
  }
  return '';
}

export function isGoogleDriveReady(cfg: GoogleDriveSyncConfig): boolean {
  const passphrase = resolveGoogleDrivePassphrase(cfg);
  if (passphrase.length < 8) return false;
  if (cfg.mode === 'apps_script') {
    return Boolean(cfg.appsScriptUrl.trim() && cfg.appsScriptSecret.trim().length >= 6);
  }
  return Boolean(cfg.oauthClientId.trim() && getGoogleDriveSessionToken());
}

export function normalizeAppsScriptUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Cole a URL do Web App do Google Apps Script.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('URL do Google Apps Script inválida.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('A URL do Google Apps Script deve usar HTTPS.');
  }
  return trimmed;
}

/**
 * Generates a ready-to-paste Google Apps Script that turns the user's own Google Drive
 * into a private E2EE backup & sync database (zero Google Cloud Console setup needed).
 */
export function generateGoogleDriveAppsScriptCode(
  secretToken: string,
  folderName = DEFAULT_DRIVE_FOLDER,
  fileName = DEFAULT_DRIVE_FILE,
): string {
  const safeSecret = secretToken.replace(/'/g, "\\'");
  const safeFolder = folderName.replace(/'/g, "\\'");
  const safeFile = fileName.replace(/'/g, "\\'");

  return `// LifeHub — Cofre E2EE no Google Drive (Redundância & Sync 100% Grátis)
// 1. Acesse https://script.google.com -> Novo projeto
// 2. Cole este código e clique em Implantar -> Nova implantação -> App da Web
// 3. Executar como: "Eu" | Quem pode acessar: "Qualquer pessoa"
// 4. Copie a URL gerada (/exec) e cole no LifeHub -> Configurações -> Google Drive

const SECRET_TOKEN = '${safeSecret}';
const FOLDER_NAME = '${safeFolder}';
const FILE_NAME = '${safeFile}';

function getOrCreateFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function findVaultFile_(folder) {
  const it = folder.getFilesByName(FILE_NAME);
  return it.hasNext() ? it.next() : null;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.secret !== SECRET_TOKEN) {
      return jsonOut_({ ok: false, error: 'Token secreto inválido.' });
    }

    const folder = getOrCreateFolder_();
    const existing = findVaultFile_(folder);

    if (req.action === 'health') {
      return jsonOut_({
        ok: true,
        service: 'lifehub-google-drive-vault',
        folder: FOLDER_NAME,
        fileName: FILE_NAME,
        hasData: Boolean(existing),
      });
    }

    if (req.action === 'get') {
      if (!existing) {
        return jsonOut_({ ok: true, found: false, envelope: null });
      }
      const text = existing.getBlob().getDataAsString('UTF-8');
      return jsonOut_({
        ok: true,
        found: true,
        fileId: existing.getId(),
        envelope: JSON.parse(text),
      });
    }

    if (req.action === 'put') {
      const payload = JSON.stringify(req.envelope);
      let file = existing;
      if (file) {
        file.setContent(payload);
      } else {
        file = folder.createFile(FILE_NAME, payload, MimeType.PLAIN_TEXT);
      }
      return jsonOut_({
        ok: true,
        fileId: file.getId(),
        updatedAt: new Date().toISOString(),
      });
    }

    return jsonOut_({ ok: false, error: 'Ação desconhecida.' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}`;
}

interface GoogleIdentityTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    }) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => GoogleIdentityTokenClient;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOAuth2;
      };
    };
  }
}

async function ensureGoogleIdentityScriptLoaded(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Login OAuth do Google só está disponível em ambiente visual.');
  }
  if (window.google?.accounts?.oauth2) return;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Identity Services.')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Não foi possível carregar o script oficial de login do Google (verifique a internet).'));
    document.head.appendChild(script);
  });
}

/**
 * Interactive "Entrar com Google" OAuth 2.0 flow using Google Identity Services.
 * Requests minimal `drive.file` scope (only files created by LifeHub).
 */
export async function signInWithGoogleDriveOAuth(
  oauthClientId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number; email: string | null }> {
  const cleanClientId = oauthClientId.trim();
  if (!cleanClientId) {
    throw new Error(
      'Informe o Google OAuth Client ID (criado grátis no Google Cloud Console) para usar "Entrar com Google", ou use a aba "Drive Vault Direto (Sem OAuth)".',
    );
  }

  await ensureGoogleIdentityScriptLoaded();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google Identity Services não inicializou neste navegador/WebView.');
  }

  const tokenResult = await new Promise<{ accessToken: string; expiresIn: number }>(
    (resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: cleanClientId,
        scope: DRIVE_OAUTH_SCOPE,
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(
              new Error(
                resp.error_description ||
                  resp.error ||
                  'Login com Google cancelado ou recusado.',
              ),
            );
            return;
          }
          resolve({
            accessToken: resp.access_token,
            expiresIn: Number(resp.expires_in) || 3500,
          });
        },
        error_callback: (err) => {
          reject(
            new Error(
              err.message ||
                'Popup de login do Google bloqueado neste ambiente. No APK/iOS ou Tauri, você também pode usar a aba "Drive Vault Direto (Sem OAuth)".',
            ),
          );
        },
      });
      client.requestAccessToken({ prompt: 'consent' });
    },
  );

  let email: string | null = null;
  try {
    const userInfoRes = await fetchFn('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
    });
    if (userInfoRes.ok) {
      const info = (await userInfoRes.json()) as { email?: string };
      if (info.email) email = info.email;
    }
  } catch {
    // non-fatal
  }

  setGoogleDriveSessionToken(tokenResult.accessToken, tokenResult.expiresIn, email);
  return { ...tokenResult, email };
}

async function findOrCreateDriveFolder(
  accessToken: string,
  folderName: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const escaped = folderName.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`;
  const listUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`;
  const listRes = await fetchFn(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (listRes.status === 401) {
    clearGoogleDriveSessionToken();
    throw new Error('Sessão Google expirada. Clique em "Entrar com Google" novamente.');
  }
  if (!listRes.ok) {
    throw new Error(`Erro ao consultar pasta no Google Drive (HTTP ${listRes.status}).`);
  }
  const listData = (await listRes.json()) as { files?: Array<{ id: string; name: string }> };
  if (listData.files && listData.files.length > 0) {
    return listData.files[0].id;
  }

  const createRes = await fetchFn(`${DRIVE_API_BASE}/files?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Não foi possível criar a pasta ${folderName} no Google Drive (HTTP ${createRes.status}).`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

async function findDriveVaultFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const escaped = fileName.replace(/'/g, "\\'");
  const q = `name='${escaped}' and '${folderId}' in parents and trashed=false`;
  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&spaces=drive`;
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Erro ao buscar cofre no Google Drive (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

async function uploadDriveVaultFile(
  accessToken: string,
  folderId: string,
  existingFileId: string | null,
  fileName: string,
  envelope: EncryptedVaultEnvelope,
  fetchFn: typeof fetch,
): Promise<string> {
  const jsonBody = JSON.stringify(envelope);

  if (existingFileId) {
    const updateRes = await fetchFn(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFileId)}?uploadType=media&fields=id`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: jsonBody,
      },
    );
    if (!updateRes.ok) {
      throw new Error(`Falha ao atualizar cofre no Google Drive (HTTP ${updateRes.status}).`);
    }
    const updated = (await updateRes.json()) as { id?: string };
    return updated.id ?? existingFileId;
  }

  const boundary = `lifehub_drive_${Date.now()}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType: 'application/json',
  });
  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    jsonBody,
    `--${boundary}--`,
  ].join('\r\n');

  const createRes = await fetchFn(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
  if (!createRes.ok) {
    throw new Error(`Falha ao criar cofre no Google Drive (HTTP ${createRes.status}).`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * Bidirectional E2EE sync directly against Google Drive REST API v3 (OAuth 2.0 `drive.file`).
 */
export async function syncDatabaseWithGoogleDriveOAuth(
  db: SqlExecutor,
  config: GoogleDriveSyncConfig,
  options?: {
    accessToken?: string;
    deviceName?: string;
    fetchFn?: typeof fetch;
  },
): Promise<GoogleDriveSyncResult> {
  const fetchFn = options?.fetchFn ?? fetch;
  const accessToken = options?.accessToken ?? getGoogleDriveSessionToken();
  if (!accessToken) {
    throw new Error('Faça login com o Google primeiro para sincronizar via Google Drive API.');
  }

  const passphrase = resolveGoogleDrivePassphrase(config);
  if (passphrase.length < 8) {
    throw new Error('Defina uma Chave Secreta E2EE (mín. 8 caracteres) antes de sincronizar no Google Drive.');
  }

  const localBackup = await exportBackupJson(db);
  const localExtensions = collectLocalClientExtensions();
  if (localExtensions) {
    localBackup.clientExtensions = localExtensions;
  }
  const localRowCount = totalRowsInBackup(localBackup);

  const folderId = await findOrCreateDriveFolder(
    accessToken,
    config.driveFolderName || DEFAULT_DRIVE_FOLDER,
    fetchFn,
  );
  const existingFileId = await findDriveVaultFile(
    accessToken,
    folderId,
    config.driveFileName || DEFAULT_DRIVE_FILE,
    fetchFn,
  );

  let mergedBackup = localBackup;
  let nextRevision = Math.max(1, config.lastRevision + 1);
  let remoteHadData = false;

  if (existingFileId) {
    const dlRes = await fetchFn(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(existingFileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (dlRes.ok) {
      const remoteJson = await dlRes.json();
      const { backup: remoteBackup, envelope } = await decryptBackupEnvelope(
        remoteJson,
        passphrase,
      );
      remoteHadData = true;
      nextRevision = envelope.revision + 1;
      mergedBackup = mergeBackups(localBackup, remoteBackup);
      await restoreBackupJson(db, mergedBackup);
      applyMergedClientExtensions(mergedBackup.clientExtensions);
    }
  }

  const envelopeToPush = await encryptBackupEnvelope(mergedBackup, passphrase, {
    deviceName: options?.deviceName ?? 'LifeHub Device',
    revision: nextRevision,
  });

  const savedFileId = await uploadDriveVaultFile(
    accessToken,
    folderId,
    existingFileId,
    config.driveFileName || DEFAULT_DRIVE_FILE,
    envelopeToPush,
    fetchFn,
  );

  return {
    provider: 'oauth',
    action: remoteHadData ? 'merged_and_pushed' : 'pushed_initial',
    revision: nextRevision,
    syncedAt: envelopeToPush.updatedAt,
    remoteHadData,
    localRowCount,
    mergedRowCount: totalRowsInBackup(mergedBackup),
    fileId: savedFileId,
  };
}

export async function testGoogleDriveAppsScript(
  appsScriptUrl: string,
  secretToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; hasData: boolean; message: string }> {
  const url = normalizeAppsScriptUrl(appsScriptUrl);
  const secret = secretToken.trim();
  if (secret.length < 6) {
    throw new Error('Informe o Token Secreto do Apps Script (mínimo 6 caracteres).');
  }
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'health', secret }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script respondeu com HTTP ${res.status}.`);
  }
  const body = (await res.json()) as {
    ok?: boolean;
    error?: string;
    hasData?: boolean;
    folder?: string;
  };
  if (!body.ok) {
    throw new Error(body.error || 'Apps Script recusou a conexão. Verifique o Token Secreto.');
  }
  return {
    ok: true,
    hasData: Boolean(body.hasData),
    message: body.hasData
      ? `Conexão confirmada! Cofre E2EE já encontrado na pasta "${body.folder || DEFAULT_DRIVE_FOLDER}" do Google Drive.`
      : `Conexão confirmada! A pasta "${body.folder || DEFAULT_DRIVE_FOLDER}" no seu Google Drive está pronta para receber o primeiro backup E2EE.`,
  };
}

/**
 * Bidirectional E2EE sync against the user's Google Drive via their private Apps Script Web App.
 * Works identically on Windows Desktop (Tauri), Android APK, iOS IPA, and Browser with zero OAuth setup.
 */
export async function syncDatabaseWithGoogleDriveAppsScript(
  db: SqlExecutor,
  config: GoogleDriveSyncConfig,
  options?: {
    deviceName?: string;
    fetchFn?: typeof fetch;
  },
): Promise<GoogleDriveSyncResult> {
  const fetchFn = options?.fetchFn ?? fetch;
  const url = normalizeAppsScriptUrl(config.appsScriptUrl);
  const secret = config.appsScriptSecret.trim();
  if (secret.length < 6) {
    throw new Error('Informe o Token Secreto do Apps Script.');
  }
  const passphrase = resolveGoogleDrivePassphrase(config);
  if (passphrase.length < 8) {
    throw new Error('Defina uma Chave Secreta E2EE (mín. 8 caracteres) antes de sincronizar no Google Drive.');
  }

  const localBackup = await exportBackupJson(db);
  const localExtensions = collectLocalClientExtensions();
  if (localExtensions) {
    localBackup.clientExtensions = localExtensions;
  }
  const localRowCount = totalRowsInBackup(localBackup);

  const getRes = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'get', secret }),
  });
  if (!getRes.ok) {
    throw new Error(`Falha ao consultar Google Drive Vault (HTTP ${getRes.status}).`);
  }
  const getBody = (await getRes.json()) as {
    ok?: boolean;
    found?: boolean;
    fileId?: string;
    envelope?: unknown;
    error?: string;
  };
  if (!getBody.ok) {
    throw new Error(getBody.error || 'Google Drive Vault recusou a leitura (verifique o Token Secreto).');
  }

  let mergedBackup = localBackup;
  let nextRevision = Math.max(1, config.lastRevision + 1);
  let remoteHadData = false;

  if (getBody.found && getBody.envelope) {
    const { backup: remoteBackup, envelope } = await decryptBackupEnvelope(
      getBody.envelope,
      passphrase,
    );
    remoteHadData = true;
    nextRevision = envelope.revision + 1;
    mergedBackup = mergeBackups(localBackup, remoteBackup);
    await restoreBackupJson(db, mergedBackup);
    applyMergedClientExtensions(mergedBackup.clientExtensions);
  }

  const envelopeToPush = await encryptBackupEnvelope(mergedBackup, passphrase, {
    deviceName: options?.deviceName ?? 'LifeHub Device',
    revision: nextRevision,
  });

  const putRes = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'put',
      secret,
      envelope: envelopeToPush,
    }),
  });
  if (!putRes.ok) {
    throw new Error(`Falha ao salvar cofre no Google Drive Vault (HTTP ${putRes.status}).`);
  }
  const putBody = (await putRes.json()) as { ok?: boolean; fileId?: string; error?: string };
  if (!putBody.ok) {
    throw new Error(putBody.error || 'Google Drive Vault retornou erro ao gravar.');
  }

  return {
    provider: 'apps_script',
    action: remoteHadData ? 'merged_and_pushed' : 'pushed_initial',
    revision: nextRevision,
    syncedAt: envelopeToPush.updatedAt,
    remoteHadData,
    localRowCount,
    mergedRowCount: totalRowsInBackup(mergedBackup),
    fileId: putBody.fileId ?? getBody.fileId,
  };
}

export async function syncDatabaseWithGoogleDrive(
  db: SqlExecutor,
  config: GoogleDriveSyncConfig,
  options?: {
    accessToken?: string;
    deviceName?: string;
    fetchFn?: typeof fetch;
  },
): Promise<GoogleDriveSyncResult> {
  if (config.mode === 'oauth') {
    return syncDatabaseWithGoogleDriveOAuth(db, config, options);
  }
  return syncDatabaseWithGoogleDriveAppsScript(db, config, options);
}

export function ensurePassphraseOrGenerate(cfg: GoogleDriveSyncConfig): string {
  const existing = resolveGoogleDrivePassphrase(cfg);
  return existing || generateSyncPassphrase();
}
