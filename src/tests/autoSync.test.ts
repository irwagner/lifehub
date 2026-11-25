import { describe, expect, it, vi } from 'vitest';
import {
  AutoSyncController,
  type AutoSyncStatus,
  type CloudSyncConfig,
  type SyncResult,
} from '../services/cloudSync';

function makeCfg(overrides?: Partial<CloudSyncConfig>): CloudSyncConfig {
  return {
    enabled: true,
    autoSync: true,
    endpointUrl: 'https://lifehub-sync.irwagneremanoel.workers.dev',
    passphrase: 'LH-TEST-AUTO-SYNC-1234',
    deviceName: 'Windows Desktop',
    lastSyncedAt: null,
    lastRevision: 0,
    ...overrides,
  };
}

function makeResult(rev: number): SyncResult {
  return {
    action: 'merged_and_pushed',
    revision: rev,
    syncedAt: '2026-11-25T21:55:00.000Z',
    remoteHadData: true,
    localRowCount: 10,
    mergedRowCount: 12,
  };
}

describe('AutoSyncController (sync automático a cada ação)', () => {
  it('agrupa múltiplas ações rápidas em 1 único sync via debounce', async () => {
    vi.useFakeTimers();
    let cfg = makeCfg();
    const statuses: AutoSyncStatus[] = [];
    let calls = 0;

    const ctrl = new AutoSyncController({
      debounceMs: 500,
      isOnline: () => true,
      getConfig: () => cfg,
      saveConfig: (next) => {
        cfg = next;
      },
      runSyncFn: async () => {
        calls++;
        return makeResult(calls);
      },
      onStateChange: (s) => statuses.push(s),
    });

    ctrl.schedule();
    ctrl.schedule();
    ctrl.schedule();
    expect(calls).toBe(0);

    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toBe(1);
    expect(cfg.lastRevision).toBe(1);
    expect(statuses).toContain('scheduled');
    expect(statuses).toContain('syncing');
    expect(statuses[statuses.length - 1]).toBe('synced');

    ctrl.dispose();
    vi.useRealTimers();
  });

  it('enfileira nova sincronização se uma ação ocorrer durante um upload em andamento', async () => {
    let cfg = makeCfg();
    let calls = 0;
    let releaseFirst: (() => void) | null = null;

    const ctrl = new AutoSyncController({
      debounceMs: 10,
      isOnline: () => true,
      getConfig: () => cfg,
      saveConfig: (next) => {
        cfg = next;
      },
      runSyncFn: async () => {
        calls++;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return makeResult(calls);
      },
    });

    const firstRun = ctrl.flushNow();
    // Action arrives while first sync is in flight
    ctrl.schedule();
    expect(calls).toBe(1);

    releaseFirst!();
    await firstRun;
    await new Promise((r) => setTimeout(r, 40));

    expect(calls).toBe(2);
    expect(cfg.lastRevision).toBe(2);
    ctrl.dispose();
  });

  it('tenta novamente automaticamente em conflito HTTP 409 e respeita autoSync=false', async () => {
    let cfg = makeCfg();
    let attempts = 0;

    const ctrl = new AutoSyncController({
      debounceMs: 10,
      conflictRetryDelayMs: 10,
      isOnline: () => true,
      getConfig: () => cfg,
      saveConfig: (next) => {
        cfg = next;
      },
      runSyncFn: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Outro dispositivo sincronizou neste exato segundo (409).');
        }
        return makeResult(7);
      },
    });

    const res = await ctrl.flushNow();
    expect(attempts).toBe(2);
    expect(res?.revision).toBe(7);

    // When autoSync is disabled, schedule() does nothing
    cfg = makeCfg({ autoSync: false });
    ctrl.schedule();
    await new Promise((r) => setTimeout(r, 30));
    expect(attempts).toBe(2);

    ctrl.dispose();
  });
});
