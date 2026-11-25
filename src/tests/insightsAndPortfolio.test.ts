import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { MIGRATIONS, runMigrations } from '../db/migrations';
import { SqlJsSqliteAdapter } from '../db/sqljsAdapter';
import {
  createRecurringWeeklyEvents,
  listCalendarEvents,
  updateCalendarEvent,
} from '../repositories/calendarRepo';
import {
  listStudyTracks,
  updateStudyTrackChecklist,
} from '../repositories/careerRepo';
import { listAccounts, listCategories, createTransaction, listTransactions } from '../repositories/financeRepo';
import {
  addProjectTask,
  createProject,
  listProjectsWithTasks,
  toggleProjectTask,
} from '../repositories/projectsRepo';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import { createWorkSession, listWorkSessions } from '../repositories/workRepo';
import { clearAllUserData, exportBackupJson, restoreBackupJson } from '../services/backup';
import { generateExplainableRecommendations } from '../services/insights';
import { buildTransactionsCsv, buildWorkSessionsCsv } from '../services/reports';
import { summarizeWorkSessions } from '../services/calculations';

describe('Migração v1->v3, Portfólio, Recorrência de Eventos, Insights Explicáveis e CSV', () => {
  it('executa upgrade real de banco v1 existente para v3 sem perda de dados', async () => {
    const db = await SqlJsSqliteAdapter.open({ persistLocal: false });
    await db.execute('PRAGMA foreign_keys = ON');
    await db.execute(
      `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
    );

    // Apply ONLY migration v1 manually
    const v1 = MIGRATIONS[0];
    for (const stmt of v1.statements) {
      await db.execute(stmt);
    }
    await db.execute(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, '2026-01-01T00:00:00Z')`,
      [v1.name],
    );
    await db.execute(
      `INSERT INTO accounts (id, name, type, initial_balance, active, created_at, updated_at)
       VALUES ('acc_v1', 'Conta Legada v1', 'conta_corrente', 500, 1, '2026-01-01', '2026-01-01')`,
    );

    // Upgrade via runMigrations -> applies v2 and v3 cleanly
    await runMigrations(db);

    const versions = await db.select<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);

    const upgradedSettings = await getSettings(db);
    expect(upgradedSettings.ui_skin).toBe('orbital');

    const accounts = await listAccounts(db);
    expect(accounts.some((a) => a.id === 'acc_v1' && a.current_balance === 500)).toBe(true);

    // Confirm v3 tables work
    const proj = await createProject(db, { title: 'Lab Redes', category: 'portfolio_ti' });
    expect(proj.title).toBe('Lab Redes');

    await db.close();
  });

  it('persiste projetos de portfólio, etapas e checklist de trilhas + round-trip no backup v3', async () => {
    const db = await createInMemoryTestDatabase();

    const proj = await createProject(db, {
      title: 'Automação Helpdesk PowerShell',
      category: 'portfolio_ti',
      repo_url: 'https://github.com/user/helpdesk-ps',
      deliverable: 'Scripts + README',
      initialTasks: ['Diagnóstico DNS', 'Coleta de logs'],
    });

    const added = await addProjectTask(db, proj.id, 'Publicar vídeo demo');
    await toggleProjectTask(db, added.id);

    await updateStudyTrackChecklist(db, 'trk_redes', [
      { id: 'ex1', label: 'Configurar VLAN no Packet Tracer', done: true },
    ]);

    const projects = await listProjectsWithTasks(db, 'portfolio_ti');
    expect(projects).toHaveLength(1);
    expect(projects[0].tasks).toHaveLength(3);
    expect(projects[0].tasks.filter((t) => t.done === 1)).toHaveLength(1);

    const tracks = await listStudyTracks(db);
    const redes = tracks.find((t) => t.id === 'trk_redes')!;
    expect(JSON.parse(redes.checklist_json)).toHaveLength(1);

    // Backup round-trip
    const backup = await exportBackupJson(db);
    expect(backup.tableCounts.projects).toBe(1);
    expect(backup.tableCounts.project_tasks).toBe(3);

    await clearAllUserData(db);
    await restoreBackupJson(db, JSON.parse(JSON.stringify(backup)));
    const restoredProjects = await listProjectsWithTasks(db, 'portfolio_ti');
    expect(restoredProjects).toHaveLength(1);
    expect(restoredProjects[0].tasks).toHaveLength(3);

    await db.close();
  });

  it('cria eventos recorrentes semanais pulando fins de semana com filho e permite editar compromisso', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await updateSettings(db, {
      child_weekend_mode: 'alternating',
      child_weekend_anchor: '2026-11-28',
    });

    // 4 sábados começando em 2026-11-28: 28/11 (filho), 05/12 (livre), 12/12 (filho), 19/12 (livre)
    const res = await createRecurringWeeklyEvents(
      db,
      {
        title: 'Turno Sábado Opcional',
        category: 'trabalho',
        date: '2026-11-28',
        start_time: '06:00',
        end_time: '12:00',
        weeks: 4,
        skipChildWeekends: true,
      },
      settings,
    );

    expect(res.created).toHaveLength(2);
    expect(res.skippedChildWeekends).toBe(2);
    expect(res.created.map((e) => e.start_at.slice(0, 10))).toEqual(['2026-12-05', '2026-12-19']);

    // Edit first created event
    const updated = await updateCalendarEvent(db, res.created[0].id, {
      title: 'Turno Sábado Ajustado',
      category: 'trabalho',
      start_at: '2026-12-05T07:00:00',
      end_at: '2026-12-05T12:30:00',
      location: 'Centro RJ',
      notes: 'Confirmado',
    });
    expect(updated.title).toBe('Turno Sábado Ajustado');
    expect(updated.location).toBe('Centro RJ');

    const all = await listCalendarEvents(db);
    expect(all).toHaveLength(2);
    await db.close();
  });

  it('gera recomendações explicáveis com base numérica factual (sem IA)', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);
    const workSummary = summarizeWorkSessions(
      [
        {
          id: 'ws_1',
          vehicle_id: null,
          date: '2026-11-23',
          platform: 'uber_moto',
          start_time: '06:00',
          end_time: '12:30',
          gross_amount: 180,
          km_start: null,
          km_end: null,
          km_total: 120,
          fuel_liters: 8,
          fuel_cost: 48, // 26.7% do bruto -> deve gerar alerta de combustível > 22%
          tolls_parking: 0,
          maintenance_per_km_snapshot: 0.18,
          depreciation_per_km_snapshot: 0.1,
          notes: '',
          created_at: '',
          updated_at: '',
        },
      ],
      {
        monthlyVehiclePayment: 0,
        periodDays: 7,
        monthlyNetGoal: 3500,
        workDaysPerWeek: 5,
      },
    );

    const recs = generateExplainableRecommendations({
      settings,
      workWeek: workSummary,
      workLast30Days: workSummary,
      monthlyRealizedNet: 1200,
      budgets: [
        {
          id: 'b1',
          month: '2026-11',
          category_id: 'cat_alimentacao',
          limit_amount: 500,
          spent_amount: 560,
          remaining_amount: -60,
          usage_pct: 112,
          created_at: '',
          updated_at: '',
        },
      ],
      workoutsThisWeek: 4,
      weeklyStudyHours: 6.5,
      activeApplicationsCount: 2,
      hasChildWeekendThisWeek: true,
    });

    expect(recs.some((r) => r.id === 'rec_fuel_high')).toBe(true);
    expect(recs.some((r) => r.id === 'rec_budget_over')).toBe(true);
    expect(recs.some((r) => r.id === 'rec_child_weekend')).toBe(true);
    expect(recs.some((r) => r.id === 'rec_study_hit')).toBe(true);
    for (const r of recs) {
      expect(r.basis.length).toBeGreaterThan(5);
    }

    await db.close();
  });

  it('exporta relatórios CSV em formato brasileiro para transações e jornadas', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_alimentacao',
      type: 'expense',
      description: 'Mercado; Bairro',
      amount: 125.5,
      date: '2026-11-24',
      status: 'realized',
    });

    await createWorkSession(
      db,
      {
        date: '2026-11-24',
        platform: '99_moto',
        start_time: '06:00',
        end_time: '12:00',
        gross_amount: 200,
        km_total: 100,
        fuel_liters: 3,
        fuel_cost: 19.5,
      },
      settings,
    );

    const [txs, accs, cats, sessions] = await Promise.all([
      listTransactions(db),
      listAccounts(db),
      listCategories(db),
      listWorkSessions(db),
    ]);

    const txCsv = buildTransactionsCsv(txs, accs, cats);
    expect(txCsv.startsWith('\uFEFFData;Tipo;Origem')).toBe(true);
    expect(txCsv).toContain('"Mercado; Bairro"');
    expect(txCsv).toContain('-125,50');
    expect(txCsv).toContain('24/11/2026');

    const wsCsv = buildWorkSessionsCsv(sessions);
    expect(wsCsv.startsWith('\uFEFFData;Plataforma;Início')).toBe(true);
    expect(wsCsv).toContain('99Moto');
    expect(wsCsv).toContain('200,00');
    expect(wsCsv).toContain('162,50'); // 200 - 19.50 - 18.00 = 162.50

    await db.close();
  });
});
