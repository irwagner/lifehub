import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { runMigrations } from '../db/migrations';
import { createCalendarEvent, createTask } from '../repositories/calendarRepo';
import { createJobApplication } from '../repositories/careerRepo';
import {
  createCategory,
  createTransaction,
  deleteCategory,
  listCategories,
  listTransactions,
} from '../repositories/financeRepo';
import { createIdea } from '../repositories/ideasRepo';
import { createProject } from '../repositories/projectsRepo';
import { searchAllModules } from '../repositories/searchRepo';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import { createWorkSession, getLastRecordedOdometer } from '../repositories/workRepo';
import { clearAllUserData, exportBackupJson, restoreBackupJson } from '../services/backup';
import { CLASSIC_SKINS, REFERENCE_SKINS, UI_SKINS } from '../services/skins';

describe('Restauração Binária SQLite, Categorias Personalizadas, Odômetro e Busca Global', () => {
  it('exporta e restaura banco SQLite binário (.sqlite) e rejeita arquivo inválido', async () => {
    const db = await createInMemoryTestDatabase();
    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Registro binário SQLite',
      amount: 1234.56,
      date: '2026-11-20',
      status: 'realized',
    });

    const binary = await db.exportBinary!();
    expect(binary).not.toBeNull();
    expect(binary!.length).toBeGreaterThan(4096);

    // Clear all data then restore from binary
    await clearAllUserData(db);
    expect(await listTransactions(db)).toHaveLength(0);

    await db.importBinary!(binary!);
    await runMigrations(db);

    const restoredTxs = await listTransactions(db);
    expect(restoredTxs).toHaveLength(1);
    expect(restoredTxs[0].description).toBe('Registro binário SQLite');

    // Invalid binary must be rejected without crashing or losing restored data
    await expect(db.importBinary!(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/inválido/i);
    expect(await listTransactions(db)).toHaveLength(1);

    await db.close();
  });

  it('permite criar e remover categorias personalizadas, mas protege categorias padrão', async () => {
    const db = await createInMemoryTestDatabase();
    const custom = await createCategory(db, {
      name: 'Peças Moto',
      kind: 'expense',
      color: '#f97316',
    });
    expect(custom.is_default).toBe(0);

    await expect(deleteCategory(db, 'cat_salario')).rejects.toThrow(/padrão/i);

    await deleteCategory(db, custom.id);
    const cats = await listCategories(db);
    expect(cats.some((c) => c.id === custom.id)).toBe(false);
    await db.close();
  });

  it('recupera último odômetro registrado para agilizar próxima jornada', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);
    expect(await getLastRecordedOdometer(db)).toBeNull();

    await createWorkSession(
      db,
      {
        date: '2026-11-23',
        platform: 'uber_moto',
        start_time: '06:00',
        end_time: '12:00',
        gross_amount: 190,
        km_start: 35000,
        km_end: 35115,
      },
      settings,
    );

    expect(await getLastRecordedOdometer(db)).toBe(35115);
    await db.close();
  });

  it('realiza busca global unificada em transações, tarefas, agenda, ideias, projetos e vagas', async () => {
    const db = await createInMemoryTestDatabase();
    await createTransaction(db, {
      account_id: 'acc_principal',
      type: 'expense',
      description: 'Curso Redes Mikrotik',
      amount: 80,
      date: '2026-11-24',
      status: 'realized',
    });
    await createTask(db, { title: 'Praticar laboratório de Redes' });
    await createCalendarEvent(db, {
      title: 'Aula de Redes TCP/IP',
      category: 'estudos',
      start_at: '2026-11-24T16:00:00',
      end_at: '2026-11-24T17:00:00',
    });
    await createIdea(db, { title: 'Monitor de Redes em Python' });
    await createProject(db, { title: 'Portfólio Redes HomeLab' });
    await createJobApplication(db, {
      company: 'NetOps',
      role: 'Analista de Redes Júnior',
      applied_date: '2026-11-24',
    });

    const hits = await searchAllModules(db, 'Redes');
    expect(hits).toHaveLength(6);
    expect(new Set(hits.map((h) => h.sectionLabel))).toEqual(
      new Set(['Financeiro', 'Tarefas', 'Calendário', 'Ideias', 'Portfólio TI', 'Vagas TI']),
    );
    await db.close();
  });

  it('persiste troca entre todas as 15 skins (9 de referência + 6 clássicas), rejeita skin inválida e preserva no backup JSON', async () => {
    const db = await createInMemoryTestDatabase();
    expect(REFERENCE_SKINS).toHaveLength(9);
    expect(CLASSIC_SKINS).toHaveLength(6);
    expect(UI_SKINS).toHaveLength(15);

    const initial = await getSettings(db);
    expect(initial.ui_skin).toBe('orbital');

    for (const skin of UI_SKINS) {
      const updated = await updateSettings(db, {
        ui_skin: skin.id,
        theme: skin.preferredTheme,
      });
      expect(updated.ui_skin).toBe(skin.id);
      expect(updated.theme).toBe(skin.preferredTheme);
    }

    // Invalid skin must be rejected by Zod
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateSettings(db, { ui_skin: 'invalid_skin' as any }),
    ).rejects.toThrow();

    // Backup round-trip preserves active reference skin
    await updateSettings(db, { ui_skin: 'ref_relogio_noturno', theme: 'dark' });
    const backup = await exportBackupJson(db);
    await clearAllUserData(db);
    await restoreBackupJson(db, JSON.parse(JSON.stringify(backup)));
    const restored = await getSettings(db);
    expect(restored.ui_skin).toBe('ref_relogio_noturno');

    await db.close();
  });
});
