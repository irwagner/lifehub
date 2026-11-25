import { z } from 'zod';
import type { SqlExecutor } from '../db/types';
import { loadDashboardSnapshot } from '../repositories/dashboardRepo';
import {
  listCategories,
  listRecurringRules,
  listTransactions,
} from '../repositories/financeRepo';
import type { RecurringRule, Transaction } from '../types/domain';
import { currentMonthISO, todayISO } from '../utils/format';
import { normalizeEndpointUrl } from './cloudSync';

export const DEFAULT_FAMILY_SYNC_URL = 'https://lifehub-sync.irwagneremanoel.workers.dev';
const FAMILY_CONFIG_KEY = 'lifehub_family_finance_config_v1';
const FAMILY_CACHE_KEY = 'lifehub_family_finance_cache_v1';
const PBKDF2_ITERATIONS = 120_000;

export interface FamilyFinanceConfig {
  enabled: boolean;
  autoSync: boolean;
  endpointUrl: string;
  familyKey: string;
  memberId: string;
  memberName: string;
  shareBalance: boolean;
  autoIncludeHousehold: boolean;
  lastSyncedAt: string | null;
  lastRevision: number;
  updatedAt?: string;
}

export interface FamilySharedExpense {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: 'realized' | 'planned';
  categoryName: string;
  memberId: string;
  memberName: string;
  notes?: string;
}

export interface FamilySharedBill {
  id: string;
  dayOfMonth: number;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  categoryName: string;
  memberId: string;
  memberName: string;
}

export interface FamilyMemberSnapshot {
  memberId: string;
  memberName: string;
  updatedAt: string;
  shareBalance: boolean;
  totalBalance: number | null;
  monthlyIncome: number;
  monthlyExpense: number;
  monthlyPlannedExpense: number;
  sharedExpenses: FamilySharedExpense[];
  sharedBills: FamilySharedBill[];
}

export interface FamilyHubDocument {
  v: 1;
  updatedAt: string;
  members: Record<string, FamilyMemberSnapshot>;
}

const familyEnvelopeSchema = z.object({
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

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
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
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function generateFamilyPassphrase(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `LH-FAM-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function generateMemberId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `mbr_${bytesToHex(bytes)}`;
}

export function isFamilySyncReady(cfg: FamilyFinanceConfig): boolean {
  return Boolean(cfg.endpointUrl.trim() && cfg.familyKey.trim().length >= 8 && cfg.memberName.trim());
}

export function loadFamilyFinanceConfig(defaultName = ''): FamilyFinanceConfig {
  try {
    const raw = localStorage.getItem(FAMILY_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FamilyFinanceConfig>;
      return {
        enabled: Boolean(parsed.enabled),
        autoSync: parsed.autoSync !== false,
        endpointUrl:
          typeof parsed.endpointUrl === 'string' && parsed.endpointUrl.trim()
            ? parsed.endpointUrl.trim()
            : DEFAULT_FAMILY_SYNC_URL,
        familyKey: typeof parsed.familyKey === 'string' ? parsed.familyKey : '',
        memberId:
          typeof parsed.memberId === 'string' && parsed.memberId.trim()
            ? parsed.memberId.trim()
            : generateMemberId(),
        memberName:
          typeof parsed.memberName === 'string' && parsed.memberName.trim()
            ? parsed.memberName
            : defaultName || 'Eu',
        shareBalance: parsed.shareBalance !== false,
        autoIncludeHousehold: parsed.autoIncludeHousehold !== false,
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
        lastRevision: typeof parsed.lastRevision === 'number' ? parsed.lastRevision : 0,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
    }
  } catch {
    // ignore corrupted storage
  }
  const initial: FamilyFinanceConfig = {
    enabled: false,
    autoSync: true,
    endpointUrl: DEFAULT_FAMILY_SYNC_URL,
    familyKey: '',
    memberId: generateMemberId(),
    memberName: defaultName || 'Eu',
    shareBalance: true,
    autoIncludeHousehold: true,
    lastSyncedAt: null,
    lastRevision: 0,
  };
  saveFamilyFinanceConfig(initial);
  return initial;
}

export function saveFamilyFinanceConfig(cfg: FamilyFinanceConfig): void {
  try {
    localStorage.setItem(
      FAMILY_CONFIG_KEY,
      JSON.stringify({
        ...cfg,
        updatedAt: cfg.updatedAt ?? new Date().toISOString(),
      }),
    );
  } catch {
    // ignore storage errors
  }
}

export function loadCachedFamilyHub(): FamilyHubDocument | null {
  try {
    const raw = localStorage.getItem(FAMILY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FamilyHubDocument;
    if (parsed && parsed.v === 1 && parsed.members && typeof parsed.members === 'object') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveCachedFamilyHub(doc: FamilyHubDocument): void {
  try {
    localStorage.setItem(FAMILY_CACHE_KEY, JSON.stringify(doc));
  } catch {
    // ignore
  }
}

export function buildFamilyInviteUrl(endpointUrl: string, familyKey: string): string {
  const base = normalizeEndpointUrl(endpointUrl);
  const cleanKey = familyKey.trim();
  if (cleanKey.length < 8) {
    throw new Error('A Chave da Família deve ter ao menos 8 caracteres.');
  }
  const payload = JSON.stringify({ u: base, f: cleanKey });
  const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(payload))));
  return `${base}/#family=${encoded}`;
}

export function parseFamilyInviteHash(
  hash: string,
): { endpointUrl: string; familyKey: string } | null {
  const match = hash.match(/family=([^&]+)/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(escape(atob(decodeURIComponent(match[1]))));
    const parsed = JSON.parse(decoded) as { u?: string; f?: string };
    if (typeof parsed.u === 'string' && typeof parsed.f === 'string' && parsed.f.trim().length >= 8) {
      return {
        endpointUrl: normalizeEndpointUrl(parsed.u),
        familyKey: parsed.f.trim(),
      };
    }
  } catch {
    return null;
  }
  return null;
}

const HOUSEHOLD_CATEGORY_IDS = new Set(['cat_moradia', 'cat_familia', 'cat_alimentacao']);
const HOUSEHOLD_KEYWORD_REGEX =
  /(\[fam[ií]lia\]|#fam[ií]lia|#casa|moradia|aluguel|condom[ií]nio|[aá]gua|luz|energia|internet|mercado|supermercado|g[aá]s|casa|filho|pens[aã]o|escola|fam[ií]lia)/i;

export function isHouseholdExpense(
  item: Pick<Transaction, 'type' | 'category_id' | 'description' | 'notes'>,
  categoryName: string,
  autoIncludeHousehold = true,
): boolean {
  if (item.type !== 'expense') return false;
  const tagged = /\[fam[ií]lia\]|#fam[ií]lia|#casa/i.test(item.notes ?? '');
  if (tagged) return true;
  if (!autoIncludeHousehold) return false;
  if (item.category_id && HOUSEHOLD_CATEGORY_IDS.has(item.category_id)) return true;
  return (
    HOUSEHOLD_KEYWORD_REGEX.test(categoryName) ||
    HOUSEHOLD_KEYWORD_REGEX.test(item.description)
  );
}

export function isHouseholdRecurringRule(
  rule: Pick<RecurringRule, 'category_id' | 'description' | 'notes'>,
  categoryName: string,
  autoIncludeHousehold = true,
): boolean {
  const tagged = /\[fam[ií]lia\]|#fam[ií]lia|#casa/i.test(rule.notes ?? '');
  if (tagged) return true;
  if (!autoIncludeHousehold) return false;
  if (rule.category_id && HOUSEHOLD_CATEGORY_IDS.has(rule.category_id)) return true;
  return (
    HOUSEHOLD_KEYWORD_REGEX.test(categoryName) ||
    HOUSEHOLD_KEYWORD_REGEX.test(rule.description)
  );
}

export async function buildLocalMemberSnapshot(
  db: SqlExecutor,
  config: Pick<FamilyFinanceConfig, 'memberId' | 'memberName' | 'shareBalance' | 'autoIncludeHousehold'>,
  month = currentMonthISO(),
): Promise<FamilyMemberSnapshot> {
  const today = todayISO();
  const [snap, categories, monthTxs, rules] = await Promise.all([
    loadDashboardSnapshot(db, today),
    listCategories(db),
    listTransactions(db, { month }),
    listRecurringRules(db),
  ]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const memberName = config.memberName.trim() || snap.settings.user_name || 'Membro';

  const sharedExpenses: FamilySharedExpense[] = monthTxs
    .filter((tx) =>
      isHouseholdExpense(
        tx,
        tx.category_id ? (catMap.get(tx.category_id) ?? '') : '',
        config.autoIncludeHousehold,
      ),
    )
    .map((tx) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      status: tx.status,
      categoryName: tx.category_id ? (catMap.get(tx.category_id) ?? 'Casa') : 'Casa',
      memberId: config.memberId,
      memberName,
      notes: tx.notes || undefined,
    }));

  const sharedBills: FamilySharedBill[] = rules
    .filter((r) =>
      isHouseholdRecurringRule(
        r,
        r.category_id ? (catMap.get(r.category_id) ?? '') : '',
        config.autoIncludeHousehold,
      ),
    )
    .map((r) => ({
      id: r.id,
      dayOfMonth: r.day_of_month,
      description: r.description,
      amount: r.amount,
      type: r.type,
      categoryName: r.category_id ? (catMap.get(r.category_id) ?? 'Casa') : 'Casa',
      memberId: config.memberId,
      memberName,
    }));

  return {
    memberId: config.memberId,
    memberName,
    updatedAt: new Date().toISOString(),
    shareBalance: config.shareBalance,
    totalBalance: config.shareBalance ? snap.totalBalance : null,
    monthlyIncome: config.shareBalance ? snap.monthlyFinance.realizedIncome : 0,
    monthlyExpense: snap.monthlyFinance.realizedExpense,
    monthlyPlannedExpense: snap.monthlyFinance.plannedExpense,
    sharedExpenses,
    sharedBills,
  };
}

async function deriveFamilyVaultCredentials(
  familyKey: string,
): Promise<{ vaultId: string; authToken: string }> {
  const clean = familyKey.trim();
  if (clean.length < 8) {
    throw new Error('A Chave da Família deve ter ao menos 8 caracteres.');
  }
  const [vaultId, authToken] = await Promise.all([
    sha256Hex(`lifehub:family:id:v1:${clean}`),
    sha256Hex(`lifehub:family:auth:v1:${clean}`),
  ]);
  return { vaultId, authToken };
}

async function encryptFamilyDoc(
  doc: FamilyHubDocument,
  familyKey: string,
  revision: number,
) {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);
  const aesKey = await deriveAesKey(familyKey.trim(), salt, PBKDF2_ITERATIONS);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    aesKey,
    new TextEncoder().encode(JSON.stringify(doc)),
  );
  return {
    v: 1 as const,
    alg: 'AES-256-GCM' as const,
    kdf: 'PBKDF2-SHA256' as const,
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    updatedAt: new Date().toISOString(),
    deviceName: 'LifeHub Family Hub',
    revision: Math.max(1, revision),
  };
}

async function decryptFamilyDoc(
  rawEnvelope: unknown,
  familyKey: string,
): Promise<{ doc: FamilyHubDocument; revision: number }> {
  const env = familyEnvelopeSchema.parse(rawEnvelope);
  const aesKey = await deriveAesKey(familyKey.trim(), base64ToBytes(env.salt), env.iterations);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(env.iv)) },
      aesKey,
      toArrayBuffer(base64ToBytes(env.ciphertext)),
    );
  } catch {
    throw new Error('Chave da Família incorreta. Peça a chave exata para a outra pessoa.');
  }
  const doc = JSON.parse(new TextDecoder().decode(plainBuf)) as FamilyHubDocument;
  if (!doc || doc.v !== 1 || !doc.members) {
    throw new Error('Pacote familiar inválido no cofre.');
  }
  return { doc, revision: env.revision };
}

/**
 * Bidirectional E2EE Family Hub sync using the same Cloudflare Worker free tier.
 * Updates only this member's slot while preserving all other connected members.
 */
export async function syncFamilyFinanceHub(
  db: SqlExecutor,
  config: FamilyFinanceConfig,
  fetchFn: typeof fetch = fetch,
  month = currentMonthISO(),
): Promise<{ hub: FamilyHubDocument; revision: number; syncedAt: string }> {
  const base = normalizeEndpointUrl(config.endpointUrl);
  const { vaultId, authToken } = await deriveFamilyVaultCredentials(config.familyKey);
  const mySnapshot = await buildLocalMemberSnapshot(db, config, month);
  const vaultUrl = `${base}/api/vault/${vaultId}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const getRes = await fetchFn(vaultUrl, {
      method: 'GET',
      headers: { 'X-Vault-Token': authToken },
    });

    if (getRes.status === 401 || getRes.status === 403) {
      throw new Error('Chave da Família recusada pelo cofre.');
    }

    let doc: FamilyHubDocument = {
      v: 1,
      updatedAt: new Date().toISOString(),
      members: {},
    };
    let expectedRevision = 0;
    let nextRevision = 1;

    if (getRes.status === 200) {
      const remoteEnv = await getRes.json();
      const decrypted = await decryptFamilyDoc(remoteEnv, config.familyKey);
      doc = decrypted.doc;
      expectedRevision = decrypted.revision;
      nextRevision = decrypted.revision + 1;
    } else if (getRes.status !== 404) {
      throw new Error(`Erro ao acessar cofre da família (HTTP ${getRes.status}).`);
    }

    const mergedDoc: FamilyHubDocument = {
      v: 1,
      updatedAt: new Date().toISOString(),
      members: {
        ...doc.members,
        [mySnapshot.memberId]: mySnapshot,
      },
    };

    const envelope = await encryptFamilyDoc(
      mergedDoc,
      config.familyKey,
      nextRevision,
    );

    const putRes = await fetchFn(vaultUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Token': authToken,
        'X-Expected-Revision': String(expectedRevision),
      },
      body: JSON.stringify(envelope),
    });

    if (putRes.status === 409 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 350));
      continue;
    }
    if (!putRes.ok) {
      throw new Error(`Falha ao salvar cofre da família (HTTP ${putRes.status}).`);
    }

    saveCachedFamilyHub(mergedDoc);
    return {
      hub: mergedDoc,
      revision: nextRevision,
      syncedAt: envelope.updatedAt,
    };
  }

  throw new Error('Conflito ao sincronizar cofre da família. Tente novamente.');
}
