/**
 * LifeHub Zero-Knowledge Sync Worker (Cloudflare Free Tier: Workers + KV + Static Assets).
 * Stores ONLY client-encrypted AES-256-GCM envelopes — plaintext financial data never reaches Cloudflare.
 */

export interface KVNamespaceLike {
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface AssetsBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface SyncWorkerEnv {
  LIFEHUB_VAULTS: KVNamespaceLike;
  ASSETS?: AssetsBindingLike;
}

interface StoredVaultRecord {
  authHash: string;
  revision: number;
  updatedAt: string;
  envelope: Record<string, unknown>;
}

const VAULT_ID_REGEX = /^[a-f0-9]{64}$/;
const TOKEN_REGEX = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MiB hard cap against memory exhaustion

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Vault-Token, X-Expected-Revision',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  const a = hexToBytes(aHex);
  const b = hexToBytes(bHex);
  // Constant-time comparison (compatible with both Cloudflare Workers and standard WebCrypto)
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    return null;
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function isValidEnvelope(raw: unknown): raw is Record<string, unknown> & {
  v: number;
  alg: string;
  ciphertext: string;
  iv: string;
  salt: string;
  revision: number;
  updatedAt: string;
} {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.v === 1 &&
    obj.alg === 'AES-256-GCM' &&
    typeof obj.ciphertext === 'string' &&
    obj.ciphertext.length >= 16 &&
    typeof obj.iv === 'string' &&
    typeof obj.salt === 'string' &&
    typeof obj.revision === 'number' &&
    Number.isInteger(obj.revision) &&
    obj.revision >= 1 &&
    typeof obj.updatedAt === 'string'
  );
}

export async function handleSyncRequest(request: Request, env: SyncWorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return jsonResponse({
      ok: true,
      service: 'lifehub-sync',
      e2ee: 'AES-256-GCM',
      freeTier: 'cloudflare-workers-kv',
    });
  }

  const vaultMatch = url.pathname.match(/^\/api\/vault\/([a-f0-9]{64})$/);
  if (vaultMatch) {
    const vaultId = vaultMatch[1];
    if (!VAULT_ID_REGEX.test(vaultId)) {
      return jsonResponse({ error: 'Identificador de cofre inválido.' }, 400);
    }

    const token = (request.headers.get('X-Vault-Token') ?? '').trim().toLowerCase();
    if (!TOKEN_REGEX.test(token)) {
      return jsonResponse({ error: 'Token de autenticação do cofre ausente ou inválido.' }, 401);
    }

    const tokenHash = bytesToHex(await sha256Bytes(`lifehub:kv-auth:${token}`));
    const kvKey = `vault:${vaultId}`;

    try {
      if (request.method === 'GET') {
        const raw = await env.LIFEHUB_VAULTS.get(kvKey, 'text');
        if (!raw) {
          return jsonResponse({ error: 'Cofre ainda não inicializado.' }, 404);
        }
        const stored = JSON.parse(raw) as StoredVaultRecord;
        if (!timingSafeHexEqual(stored.authHash, tokenHash)) {
          return jsonResponse({ error: 'Chave secreta inválida para este cofre.' }, 403);
        }
        return jsonResponse(stored.envelope, 200);
      }

      if (request.method === 'PUT') {
        const rawBody = await readBoundedText(request, MAX_PAYLOAD_BYTES);
        if (rawBody === null) {
          return jsonResponse({ error: 'Payload excede o limite de 4 MB.' }, 413);
        }

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          return jsonResponse({ error: 'JSON inválido.' }, 400);
        }

        if (!isValidEnvelope(parsedBody)) {
          return jsonResponse({ error: 'Envelope criptografado inválido.' }, 400);
        }

        const existingRaw = await env.LIFEHUB_VAULTS.get(kvKey, 'text');
        const expectedHeader = request.headers.get('X-Expected-Revision');
        const expectedRev = expectedHeader !== null ? Number(expectedHeader) : null;

        if (existingRaw) {
          const existing = JSON.parse(existingRaw) as StoredVaultRecord;
          if (!timingSafeHexEqual(existing.authHash, tokenHash)) {
            return jsonResponse({ error: 'Chave secreta inválida para atualizar este cofre.' }, 403);
          }
          if (expectedRev !== null && expectedRev !== existing.revision) {
            return jsonResponse(
              {
                error: 'Conflito de revisão: outro dispositivo atualizou o cofre primeiro.',
                currentRevision: existing.revision,
              },
              409,
            );
          }
        }

        const record: StoredVaultRecord = {
          authHash: tokenHash,
          revision: parsedBody.revision,
          updatedAt: parsedBody.updatedAt,
          envelope: parsedBody,
        };

        await env.LIFEHUB_VAULTS.put(kvKey, JSON.stringify(record));
        return jsonResponse(
          {
            ok: true,
            revision: record.revision,
            updatedAt: record.updatedAt,
          },
          200,
        );
      }

      if (request.method === 'DELETE') {
        const existingRaw = await env.LIFEHUB_VAULTS.get(kvKey, 'text');
        if (!existingRaw) {
          return jsonResponse({ ok: true, deleted: false }, 200);
        }
        const existing = JSON.parse(existingRaw) as StoredVaultRecord;
        if (!timingSafeHexEqual(existing.authHash, tokenHash)) {
          return jsonResponse({ error: 'Chave secreta inválida para apagar este cofre.' }, 403);
        }
        await env.LIFEHUB_VAULTS.delete(kvKey);
        return jsonResponse({ ok: true, deleted: true }, 200);
      }

      return jsonResponse({ error: 'Método não permitido.' }, 405);
    } catch (err) {
      return jsonResponse(
        {
          error: 'Erro interno no servidor de sincronização.',
          detail: err instanceof Error ? err.message : 'unknown',
        },
        500,
      );
    }
  }

  // Static PWA assets (LifeHub Mobile for iPhone & Android)
  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return jsonResponse({ error: 'Rota não encontrada.' }, 404);
}

export default {
  async fetch(request: Request, env: SyncWorkerEnv): Promise<Response> {
    return handleSyncRequest(request, env);
  },
};
