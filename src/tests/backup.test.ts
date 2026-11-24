import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { listTasks } from '../repositories/calendarRepo';
import { listTransactions } from '../repositories/financeRepo';
import { getSettings } from '../repositories/settingsRepo';
import { listWorkSessions } from '../repositories/workRepo';
import { clearAllUserData, exportBackupJson, restoreBackupJson } from '../services/backup';
import { loadDemoData } from '../services/demoSeed';

describe('Backup JSON, Restauração Atômica e Dados Demo', () => {
  it('exporta, limpa e restaura backup JSON com 100% de fidelidade', async () => {
    const db = await createInMemoryTestDatabase();
    await loadDemoData(db, '2026-11-24');

    const beforeSettings = await getSettings(db);
    const beforeTxs = await listTransactions(db);
    const beforeSessions = await listWorkSessions(db);
    const beforeTasks = await listTasks(db);

    expect(beforeTxs.length).toBeGreaterThan(0);
    expect(beforeSessions.length).toBeGreaterThan(0);
    expect(beforeTasks.length).toBeGreaterThan(0);
    expect(beforeSettings.demo_data_loaded).toBe(1);

    const backup = await exportBackupJson(db);
    expect(backup.app).toBe('LifeHub');
    expect(backup.tableCounts.work_sessions).toBe(beforeSessions.length);

    // Clear all user data
    await clearAllUserData(db);
    expect(await listTransactions(db)).toHaveLength(0);
    expect(await listWorkSessions(db)).toHaveLength(0);

    // Restore from JSON
    const restored = await restoreBackupJson(db, JSON.parse(JSON.stringify(backup)));
    expect(restored.totalRows).toBeGreaterThan(10);

    const afterSettings = await getSettings(db);
    const afterTxs = await listTransactions(db);
    const afterSessions = await listWorkSessions(db);
    const afterTasks = await listTasks(db);

    expect(afterSettings.user_name).toBe(beforeSettings.user_name);
    expect(afterTxs).toHaveLength(beforeTxs.length);
    expect(afterSessions).toHaveLength(beforeSessions.length);
    expect(afterTasks).toHaveLength(beforeTasks.length);

    await db.close();
  });

  it('rejeita backup corrompido ou com plataforma inválida sem perder dados existentes', async () => {
    const db = await createInMemoryTestDatabase();
    await loadDemoData(db, '2026-11-24');
    const validBackup = await exportBackupJson(db);
    const originalCount = (await listWorkSessions(db)).length;

    // Tamper backup with forbidden platform
    const tampered = JSON.parse(JSON.stringify(validBackup));
    tampered.tables.work_sessions[0].platform = 'ifood';

    await expect(restoreBackupJson(db, tampered)).rejects.toThrow(/Plataforma inválida/i);

    // Existing DB must remain intact
    expect((await listWorkSessions(db)).length).toBe(originalCount);

    // Reject completely invalid payload
    await expect(restoreBackupJson(db, { app: 'OutroApp' })).rejects.toThrow();

    await db.close();
  });
});
