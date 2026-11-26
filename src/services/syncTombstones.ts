import type { BackupTableName } from './backup';

const TOMBSTONES_STORAGE_KEY = 'lifehub_sync_tombstones_v1';
const MAX_TOMBSTONE_ENTRIES = 2000;
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// In-memory mirror so Vitest / environments without localStorage also preserve tombstones
let memoryTombstones: Record<string, string> = {};

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  } catch {
    return false;
  }
}

function pruneTombstones(raw: Record<string, string>): Record<string, string> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const entries = Object.entries(raw)
    .filter(([k, ts]) => {
      if (!k || typeof ts !== 'string' || ts.length < 10) return false;
      const ms = Date.parse(ts);
      return Number.isNaN(ms) || ms >= cutoff;
    })
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, MAX_TOMBSTONE_ENTRIES);

  return Object.fromEntries(entries);
}

export function loadTombstones(): Record<string, string> {
  if (hasLocalStorage()) {
    try {
      const raw = localStorage.getItem(TOMBSTONES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          memoryTombstones = pruneTombstones(parsed as Record<string, string>);
          return { ...memoryTombstones };
        }
      }
    } catch {
      // ignore corrupted storage
    }
  }
  return { ...memoryTombstones };
}

export function saveTombstones(map: Record<string, string>): void {
  const pruned = pruneTombstones(map);
  memoryTombstones = pruned;
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(TOMBSTONES_STORAGE_KEY, JSON.stringify(pruned));
    } catch {
      // ignore quota errors
    }
  }
}

export function recordTombstone(
  table: BackupTableName,
  id: string,
  deletedAt = new Date().toISOString(),
): void {
  if (!id || !id.trim()) return;
  const current = loadTombstones();
  current[`${table}:${id.trim()}`] = deletedAt;
  saveTombstones(current);
}

export function recordTombstones(
  table: BackupTableName,
  ids: string[],
  deletedAt = new Date().toISOString(),
): void {
  if (ids.length === 0) return;
  const current = loadTombstones();
  for (const id of ids) {
    if (id && id.trim()) {
      current[`${table}:${id.trim()}`] = deletedAt;
    }
  }
  saveTombstones(current);
}

export function mergeTombstoneMaps(
  local?: Record<string, string>,
  remote?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...(local ?? {}) };
  for (const [k, ts] of Object.entries(remote ?? {})) {
    const prev = merged[k];
    if (!prev || ts > prev) {
      merged[k] = ts;
    }
  }
  return pruneTombstones(merged);
}

export function clearTombstones(): void {
  memoryTombstones = {};
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(TOMBSTONES_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
