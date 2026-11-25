import { z } from 'zod';
import type { SqlExecutor, SqlValue } from '../db/types';
import {
  BACKUP_TABLES,
  exportBackupJson,
  restoreBackupJson,
  validateBackupPayload,
  type BackupTableName,
  type LifeHubBackup,
  type SyncedClientExtensions,
} from './backup';
import {
  GEMINI_MODELS,
  loadAiMemory,
  loadGeminiAiConfig,
  saveAiMemoryList,
  saveGeminiAiConfig,
  type GeminiModelId,
} from './geminiAi';

export interface CloudSyncConfig {
  enabled: boolean;
  autoSync?: boolean;
  endpointUrl: string; // Ex.: https://lifehub-sync.sua-conta.workers.dev
  passphrase: string;
  deviceName: string;
  lastSyncedAt: string | null;
  lastRevision: number;
}

export type AutoSyncStatus = 'idle' | 'scheduled' | 'syncing' | 'synced' | 'error' | 'offline';

export interface EncryptedVaultEnvelope {
  v: 1;
  alg: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  updatedAt: string;
  deviceName: string;
  revision: number;
}

export interface SyncResult {
  action: 'pushed_initial' | 'merged_and_pushed';
  revision: number;
  syncedAt: string;
  remoteHadData: boolean;
  localRowCount: number;
  mergedRowCount: number;
}

const SYNC_CONFIG_STORAGE_KEY = 'lifehub_cloud_sync_config_v1';
const PBKDF2_ITERATIONS = 120_000;

export const encryptedEnvelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal('AES-256-GCM'),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().min(10_000).max(500_000),
  salt: z.string().min(12),
  iv: z.string().min(12),
  ciphertext: z.string().min(16),
  updatedAt: z.string().min(10),
  deviceName: z.string().max(80),
  revision: z.number().int().min(1),
});

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generates a high-entropy human-friendly passphrase using Web Crypto CSPRNG.
 */
export function generateSyncPassphrase(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  const chars = Array.from(random, (b) => alphabet[b % alphabet.length]);
  return `LH-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`;
}

export async function deriveVaultCredentials(passphrase: string): Promise<{
  vaultId: string;
  authToken: string;
}> {
  const clean = passphrase.trim();
  if (clean.length < 8) {
    throw new Error('A chave secreta do cofre deve ter ao menos 8 caracteres.');
  }
  const [vaultId, authToken] = await Promise.all([
    sha256Hex(`lifehub:vault:id:v1:${clean}`),
    sha256Hex(`lifehub:vault:auth:v1:${clean}`),
  ]);
  return { vaultId, authToken };
}

export async function encryptBackupEnvelope(
  backup: LifeHubBackup,
  passphrase: string,
  meta: { deviceName: string; revision: number },
): Promise<EncryptedVaultEnvelope> {
  const clean = passphrase.trim();
  if (clean.length < 8) {
    throw new Error('A chave secreta do cofre deve ter ao menos 8 caracteres.');
  }
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const key = await deriveAesKey(clean, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(backup));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    plaintext,
  );

  return {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    updatedAt: new Date().toISOString(),
    deviceName: meta.deviceName.trim() || 'LifeHub Device',
    revision: Math.max(1, meta.revision),
  };
}

export async function decryptBackupEnvelope(
  rawEnvelope: unknown,
  passphrase: string,
): Promise<{ backup: LifeHubBackup; envelope: EncryptedVaultEnvelope }> {
  const envelope = encryptedEnvelopeSchema.parse(rawEnvelope);
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveAesKey(passphrase.trim(), salt, envelope.iterations);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    );
  } catch {
    throw new Error('Não foi possível descriptografar o cofre. Verifique se a chave secreta é a mesma nos dois dispositivos.');
  }

  const text = new TextDecoder().decode(decrypted);
  const backup = validateBackupPayload(JSON.parse(text));
  return { backup, envelope };
}

function rowTimestamp(row: Record<string, SqlValue>): string {
  const updated = row.updated_at;
  if (typeof updated === 'string' && updated.length > 0) return updated;
  const created = row.created_at;
  if (typeof created === 'string' && created.length > 0) return created;
  return '';
}

function rowKey(table: BackupTableName, row: Record<string, SqlValue>): string {
  if (table === 'settings') return '1';
  if (row.id != null) return String(row.id);
  return JSON.stringify(row);
}

/**
 * Deterministic bidirectional Last-Write-Wins merge by row ID & updated_at/created_at.
 * Keeps local Desktop visual preferences (ui_skin, theme) intact while syncing all real data.
 */
export function mergeBackups(local: LifeHubBackup, remote: LifeHubBackup): LifeHubBackup {
  const mergedTables = {} as Record<BackupTableName, Array<Record<string, SqlValue>>>;
  const tableCounts = {} as Record<BackupTableName, number>;

  for (const table of BACKUP_TABLES) {
    const localRows = local.tables[table] ?? [];
    const remoteRows = remote.tables[table] ?? [];

    if (table === 'settings') {
      const localSettings = localRows[0];
      const remoteSettings = remoteRows[0];
      if (!localSettings && !remoteSettings) {
        mergedTables.settings = [];
      } else if (!remoteSettings) {
        mergedTables.settings = [localSettings];
      } else if (!localSettings) {
        mergedTables.settings = [remoteSettings];
      } else {
        const useRemote = rowTimestamp(remoteSettings) > rowTimestamp(localSettings);
        const winner = useRemote ? { ...remoteSettings } : { ...localSettings };
        // Keep device-local appearance preferences untouched
        if (localSettings.ui_skin != null) winner.ui_skin = localSettings.ui_skin;
        if (localSettings.theme != null) winner.theme = localSettings.theme;
        if (localSettings.onboarding_completed === 1 || remoteSettings.onboarding_completed === 1) {
          winner.onboarding_completed = 1;
        }
        mergedTables.settings = [winner];
      }
      tableCounts.settings = mergedTables.settings.length;
      continue;
    }

    const byId = new Map<string, Record<string, SqlValue>>();
    for (const row of localRows) {
      byId.set(rowKey(table, row), row);
    }

    for (const rRow of remoteRows) {
      const key = rowKey(table, rRow);
      const lRow = byId.get(key);
      if (!lRow) {
        byId.set(key, rRow);
      } else {
        const rTs = rowTimestamp(rRow);
        const lTs = rowTimestamp(lRow);
        if (rTs > lTs) {
          byId.set(key, rRow);
        }
      }
    }

    // Deduplicate unique external_hash on transactions and unique week_start on weekly_reviews
    let rows = Array.from(byId.values());
    if (table === 'transactions') {
      const seenHash = new Map<string, Record<string, SqlValue>>();
      const noHash: Array<Record<string, SqlValue>> = [];
      for (const row of rows) {
        const hash = row.external_hash;
        if (typeof hash === 'string' && hash.length > 0) {
          const prev = seenHash.get(hash);
          if (!prev || rowTimestamp(row) > rowTimestamp(prev)) {
            seenHash.set(hash, row);
          }
        } else {
          noHash.push(row);
        }
      }
      rows = [...noHash, ...seenHash.values()];
    } else if (table === 'weekly_reviews') {
      const byWeek = new Map<string, Record<string, SqlValue>>();
      for (const row of rows) {
        const wk = String(row.week_start ?? row.id ?? '');
        const prev = byWeek.get(wk);
        if (!prev || rowTimestamp(row) > rowTimestamp(prev)) {
          byWeek.set(wk, row);
        }
      }
      rows = Array.from(byWeek.values());
    } else if (table === 'budgets') {
      const byMonthCat = new Map<string, Record<string, SqlValue>>();
      for (const row of rows) {
        const key = `${String(row.month ?? '')}:${String(row.category_id ?? '')}`;
        const prev = byMonthCat.get(key);
        if (!prev || rowTimestamp(row) > rowTimestamp(prev)) {
          byMonthCat.set(key, row);
        }
      }
      rows = Array.from(byMonthCat.values());
    }

    mergedTables[table] = rows;
    tableCounts[table] = rows.length;
  }

  const mergedClientExtensions = mergeClientExtensions(
    local.clientExtensions,
    remote.clientExtensions,
  );

  return {
    app: 'LifeHub',
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    exportedAt: new Date().toISOString(),
    tableCounts,
    tables: mergedTables,
    ...(mergedClientExtensions ? { clientExtensions: mergedClientExtensions } : {}),
  };
}

function mergeClientExtensions(
  local?: SyncedClientExtensions,
  remote?: SyncedClientExtensions,
): SyncedClientExtensions | undefined {
  if (!local && !remote) return undefined;

  let mergedGemini = local?.geminiAi;
  const rGem = remote?.geminiAi;
  if (!mergedGemini?.apiKey?.trim() && rGem?.apiKey?.trim()) {
    mergedGemini = rGem;
  } else if (mergedGemini?.apiKey?.trim() && rGem?.apiKey?.trim()) {
    if ((rGem.updatedAt || '') > (mergedGemini.updatedAt || '')) {
      mergedGemini = rGem;
    }
  }

  const memMap = new Map<string, { id: string; fact: string; createdAt: string }>();
  for (const item of [...(local?.aiMemory ?? []), ...(remote?.aiMemory ?? [])]) {
    const key = item.fact.trim().toLowerCase();
    if (key && !memMap.has(key)) {
      memMap.set(key, item);
    }
  }
  const mergedMemory = Array.from(memMap.values()).slice(-15);

  if (!mergedGemini && mergedMemory.length === 0) return undefined;
  return {
    ...(mergedGemini ? { geminiAi: mergedGemini } : {}),
    ...(mergedMemory.length > 0 ? { aiMemory: mergedMemory } : {}),
  };
}

export function normalizeEndpointUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Informe a URL do seu Cloudflare Worker (ex.: https://lifehub-sync.sua-conta.workers.dev).');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('URL do servidor de sincronização inválida.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('A URL de sincronização deve começar com https:// ou http://.');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export function loadCloudSyncConfig(defaultDeviceName = 'Windows Desktop'): CloudSyncConfig {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CloudSyncConfig>;
      return {
        enabled: Boolean(parsed.enabled),
        autoSync: parsed.autoSync !== false,
        endpointUrl: typeof parsed.endpointUrl === 'string' ? parsed.endpointUrl : '',
        passphrase: typeof parsed.passphrase === 'string' ? parsed.passphrase : '',
        deviceName:
          typeof parsed.deviceName === 'string' && parsed.deviceName.trim()
            ? parsed.deviceName
            : defaultDeviceName,
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
        lastRevision: typeof parsed.lastRevision === 'number' ? parsed.lastRevision : 0,
      };
    }
  } catch {
    // ignore corrupted local storage
  }
  return {
    enabled: false,
    autoSync: true,
    endpointUrl: '',
    passphrase: '',
    deviceName: defaultDeviceName,
    lastSyncedAt: null,
    lastRevision: 0,
  };
}

export function isCloudSyncReady(cfg: CloudSyncConfig): boolean {
  return Boolean(cfg.endpointUrl.trim() && cfg.passphrase.trim().length >= 8);
}

export function saveCloudSyncConfig(config: CloudSyncConfig): void {
  try {
    localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Builds a pairing URL for the mobile PWA (fragment `#pair=...` is never sent in HTTP requests).
 * Optionally carries the user's Gemini API key locally inside the fragment for instant 1-scan setup.
 */
export function buildMobilePairingUrl(
  endpointUrl: string,
  passphrase: string,
  options?: { geminiApiKey?: string },
): string {
  const base = normalizeEndpointUrl(endpointUrl);
  const cleanPassphrase = passphrase.trim();
  if (cleanPassphrase.length < 8) {
    throw new Error('A chave secreta deve ter ao menos 8 caracteres para gerar o link ou QR Code.');
  }
  const cleanAiKey = options?.geminiApiKey?.trim();
  const payloadObj: { u: string; k: string; a?: string } = {
    u: base,
    k: cleanPassphrase,
    ...(cleanAiKey ? { a: cleanAiKey } : {}),
  };
  const payload = JSON.stringify(payloadObj);
  const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(payload))));
  return `${base}/#pair=${encoded}`;
}

export function parseMobilePairingHash(
  hash: string,
): { endpointUrl: string; passphrase: string; geminiApiKey?: string } | null {
  const match = hash.match(/pair=([^&]+)/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(escape(atob(decodeURIComponent(match[1]))));
    const parsed = JSON.parse(decoded) as { u?: string; k?: string; a?: string };
    if (typeof parsed.u === 'string' && typeof parsed.k === 'string' && parsed.k.length >= 8) {
      const cleanAi = typeof parsed.a === 'string' && parsed.a.trim().length > 0 ? parsed.a.trim() : undefined;
      return {
        endpointUrl: normalizeEndpointUrl(parsed.u),
        passphrase: parsed.k.trim(),
        ...(cleanAi ? { geminiApiKey: cleanAi } : {}),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function testCloudSyncConnection(
  endpointUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; service?: string; message: string }> {
  const base = normalizeEndpointUrl(endpointUrl);
  const res = await fetchFn(`${base}/api/health`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Servidor respondeu com HTTP ${res.status}.`);
  }
  const body = (await res.json()) as { ok?: boolean; service?: string };
  if (!body.ok) {
    throw new Error('Endpoint encontrado, mas não é um servidor LifeHub Sync válido.');
  }
  return {
    ok: true,
    service: body.service ?? 'lifehub-sync',
    message: 'Conexão confirmada com o Cloudflare Worker LifeHub Sync.',
  };
}

function totalRowsInBackup(backup: LifeHubBackup): number {
  return Object.values(backup.tableCounts).reduce((acc, n) => acc + n, 0);
}

function collectLocalClientExtensions(): SyncedClientExtensions | undefined {
  const aiCfg = loadGeminiAiConfig();
  const memories = loadAiMemory();
  const hasAiKey = aiCfg.apiKey.trim().length > 0;
  if (!hasAiKey && memories.length === 0) return undefined;
  return {
    ...(hasAiKey
      ? {
          geminiAi: {
            apiKey: aiCfg.apiKey.trim(),
            model: aiCfg.model,
            shareFinancialContext: aiCfg.shareFinancialContext,
            autoExecuteActions: aiCfg.autoExecuteActions,
            updatedAt: aiCfg.updatedAt ?? new Date().toISOString(),
          },
        }
      : {}),
    ...(memories.length > 0 ? { aiMemory: memories } : {}),
  };
}

function applyMergedClientExtensions(ext?: SyncedClientExtensions): void {
  if (!ext) return;
  if (ext.geminiAi?.apiKey?.trim()) {
    const current = loadGeminiAiConfig();
    const validModel: GeminiModelId = GEMINI_MODELS.some((m) => m.id === ext.geminiAi?.model)
      ? (ext.geminiAi.model as GeminiModelId)
      : current.model;
    saveGeminiAiConfig({
      apiKey: ext.geminiAi.apiKey.trim(),
      model: validModel,
      shareFinancialContext: ext.geminiAi.shareFinancialContext,
      autoExecuteActions: ext.geminiAi.autoExecuteActions,
      updatedAt: ext.geminiAi.updatedAt,
    });
  }
  if (ext.aiMemory && ext.aiMemory.length > 0) {
    saveAiMemoryList(ext.aiMemory);
  }
}

/**
 * Full E2EE bidirectional sync: Pull -> Decrypt -> Merge -> Apply Locally -> Encrypt -> Push.
 * Also syncs Gemini AI key and lightweight AI memory strictly inside the AES-256-GCM payload.
 */
export async function syncDatabaseWithCloud(
  db: SqlExecutor,
  config: Pick<CloudSyncConfig, 'endpointUrl' | 'passphrase' | 'deviceName'>,
  fetchFn: typeof fetch = fetch,
): Promise<SyncResult> {
  const base = normalizeEndpointUrl(config.endpointUrl);
  const { vaultId, authToken } = await deriveVaultCredentials(config.passphrase);
  const localBackup = await exportBackupJson(db);
  const localExtensions = collectLocalClientExtensions();
  if (localExtensions) {
    localBackup.clientExtensions = localExtensions;
  }
  const localRowCount = totalRowsInBackup(localBackup);

  const vaultUrl = `${base}/api/vault/${vaultId}`;
  const getRes = await fetchFn(vaultUrl, {
    method: 'GET',
    headers: { 'X-Vault-Token': authToken },
  });

  if (getRes.status === 401 || getRes.status === 403) {
    throw new Error('Chave secreta recusada pelo cofre remoto. Confira se a chave está correta.');
  }

  let mergedBackup = localBackup;
  let nextRevision = 1;
  let remoteHadData = false;
  let expectedRevision = 0;

  if (getRes.status === 200) {
    const remoteJson = await getRes.json();
    const { backup: remoteBackup, envelope } = await decryptBackupEnvelope(
      remoteJson,
      config.passphrase,
    );
    remoteHadData = true;
    expectedRevision = envelope.revision;
    nextRevision = envelope.revision + 1;
    mergedBackup = mergeBackups(localBackup, remoteBackup);
    await restoreBackupJson(db, mergedBackup);
    applyMergedClientExtensions(mergedBackup.clientExtensions);
  } else if (getRes.status !== 404) {
    throw new Error(`Falha ao consultar cofre remoto (HTTP ${getRes.status}).`);
  }

  const envelopeToPush = await encryptBackupEnvelope(mergedBackup, config.passphrase, {
    deviceName: config.deviceName,
    revision: nextRevision,
  });

  const putRes = await fetchFn(vaultUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Vault-Token': authToken,
      'X-Expected-Revision': String(expectedRevision),
    },
    body: JSON.stringify(envelopeToPush),
  });

  if (putRes.status === 409) {
    throw new Error('Outro dispositivo sincronizou neste exato segundo. Clique em Sincronizar novamente para mesclar.');
  }
  if (!putRes.ok) {
    throw new Error(`Falha ao enviar snapshot criptografado (HTTP ${putRes.status}).`);
  }

  const mergedRowCount = totalRowsInBackup(mergedBackup);

  return {
    action: remoteHadData ? 'merged_and_pushed' : 'pushed_initial',
    revision: nextRevision,
    syncedAt: envelopeToPush.updatedAt,
    remoteHadData,
    localRowCount,
    mergedRowCount,
  };
}

export interface AutoSyncControllerOptions {
  debounceMs?: number;
  conflictRetryDelayMs?: number;
  isOnline?: () => boolean;
  getConfig: () => CloudSyncConfig;
  saveConfig?: (cfg: CloudSyncConfig) => void;
  runSyncFn: (cfg: CloudSyncConfig) => Promise<SyncResult>;
  onStateChange?: (status: AutoSyncStatus, errorMessage?: string) => void;
  onSynced?: (result: SyncResult, cfg: CloudSyncConfig) => void | Promise<void>;
}

/**
 * Coalesces rapid local edits into a single background E2EE sync, serializes in-flight uploads,
 * and retries once automatically on HTTP 409 revision conflicts.
 */
export class AutoSyncController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private pendingAnotherRun = false;
  private disposed = false;

  constructor(private readonly opts: AutoSyncControllerOptions) {}

  schedule(): void {
    if (this.disposed) return;
    const cfg = this.opts.getConfig();
    if (!isCloudSyncReady(cfg) || cfg.autoSync === false) return;

    if (this.inFlight) {
      this.pendingAnotherRun = true;
      return;
    }

    if (this.timer) clearTimeout(this.timer);
    this.opts.onStateChange?.('scheduled');
    const delay = this.opts.debounceMs ?? 1200;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, delay);
  }

  async flushNow(forceEvenIfAutoDisabled = false): Promise<SyncResult | null> {
    if (this.disposed) return null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const cfg = this.opts.getConfig();
    if (!isCloudSyncReady(cfg)) return null;
    if (!forceEvenIfAutoDisabled && cfg.autoSync === false) return null;

    const online = this.opts.isOnline
      ? this.opts.isOnline()
      : typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online) {
      this.opts.onStateChange?.('offline');
      return null;
    }

    if (this.inFlight) {
      this.pendingAnotherRun = true;
      return null;
    }

    this.inFlight = true;
    this.pendingAnotherRun = false;
    this.opts.onStateChange?.('syncing');

    let finalResult: SyncResult | null = null;
    try {
      let attempt = 0;
      while (attempt < 2) {
        attempt++;
        try {
          const res = await this.opts.runSyncFn(cfg);
          const updatedCfg: CloudSyncConfig = {
            ...cfg,
            enabled: true,
            lastSyncedAt: res.syncedAt,
            lastRevision: res.revision,
          };
          (this.opts.saveConfig ?? saveCloudSyncConfig)(updatedCfg);
          await this.opts.onSynced?.(res, updatedCfg);
          this.opts.onStateChange?.('synced');
          finalResult = res;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isConflict409 = msg.includes('Outro dispositivo sincronizou') || msg.includes('409');
          if (isConflict409 && attempt < 2 && !this.disposed) {
            await new Promise((r) => setTimeout(r, this.opts.conflictRetryDelayMs ?? 450));
            continue;
          }
          this.opts.onStateChange?.('error', msg);
          if (forceEvenIfAutoDisabled) throw err;
          break;
        }
      }
    } finally {
      this.inFlight = false;
      if (this.pendingAnotherRun && !this.disposed) {
        this.pendingAnotherRun = false;
        this.schedule();
      }
    }

    return finalResult;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
