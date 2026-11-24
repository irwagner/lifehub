import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { runMigrations } from '../db/migrations';
import {
  applyScheduleTemplateToWeek,
  createCalendarEvent,
  createTask,
  listCalendarEvents,
  listTasks,
  toggleTaskStatus,
  updateCalendarEventTiming,
} from '../repositories/calendarRepo';
import { loadDashboardSnapshot } from '../repositories/dashboardRepo';
import {
  createTransaction,
  getMonthlyFinanceSummary,
  listAccounts,
  listTransactions,
} from '../repositories/financeRepo';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import { createVehicle, createWorkSession, listWorkSessions } from '../repositories/workRepo';

describe('Persistência SQLite e Fatia Vertical Completa', () => {
  it('inicia banco limpo sem dados financeiros inventados e migrações são idempotentes', async () => {
    const db = await createInMemoryTestDatabase();
    // Re-running migrations must be safe
    await runMigrations(db);

    const settings = await getSettings(db);
    expect(settings.routine_mode).toBe('clt');
    expect(settings.onboarding_completed).toBe(0);
    expect(settings.demo_data_loaded).toBe(0);

    const txs = await listTransactions(db);
    const sessions = await listWorkSessions(db);
    const tasks = await listTasks(db);
    expect(txs).toHaveLength(0);
    expect(sessions).toHaveLength(0);
    expect(tasks).toHaveLength(0);

    await db.close();
  });

  it('executa fatia vertical completa: onboarding -> lançamentos -> dashboard calculado do banco', async () => {
    const db = await createInMemoryTestDatabase();

    // 1. Configuração inicial
    const settings = await updateSettings(db, {
      user_name: 'Usuário Teste',
      routine_mode: 'apps',
      work_days_per_week: 5,
      monthly_net_goal: 3800,
      maintenance_per_km: 0.18,
      depreciation_per_km: 0.1,
      child_weekend_mode: 'alternating',
      child_weekend_anchor: '2026-11-28',
      onboarding_completed: 1,
    });

    // 2. Tarefa + Toggle
    const task = await createTask(db, {
      title: 'Revisar freios da moto',
      priority: 'high',
      due_date: '2026-11-24',
    });
    expect(task.status).toBe('todo');

    // 3. Compromisso + Drag/Resize + Template
    const evt = await createCalendarEvent(db, {
      title: 'Entrevista TI',
      category: 'entrevista',
      start_at: '2026-11-24T16:00:00',
      end_at: '2026-11-24T17:00:00',
    });
    await updateCalendarEventTiming(db, evt.id, '2026-11-24T16:30:00', '2026-11-24T17:30:00');
    await applyScheduleTemplateToWeek(db, 'apps_5d', '2026-11-24', settings, true);
    const weekEvents = await listCalendarEvents(db);
    expect(weekEvents.length).toBeGreaterThan(5);

    // 4. Financeiro: receita, despesa parcelada e transferência
    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário líquido',
      amount: 2745,
      date: '2026-11-05',
      status: 'realized',
    });

    const installments = await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_moto',
      type: 'expense',
      source_type: 'outros',
      description: 'Pneu traseiro',
      amount: 300,
      date: '2026-11-10',
      status: 'realized',
      installments: 3,
    });
    expect(installments).toHaveLength(3);
    expect(installments[0].status).toBe('realized');
    expect(installments[1].status).toBe('planned');

    await createTransaction(db, {
      account_id: 'acc_principal',
      destination_account_id: 'acc_carteira',
      type: 'transfer',
      description: 'Saque para troco',
      amount: 200,
      date: '2026-11-12',
      status: 'realized',
    });

    const accounts = await listAccounts(db);
    const principal = accounts.find((a) => a.id === 'acc_principal')!;
    const carteira = accounts.find((a) => a.id === 'acc_carteira')!;
    // 2745 - 100 (1a parcela) - 200 (transfer) = 2445; carteira = +200
    expect(principal.current_balance).toBe(2445);
    expect(carteira.current_balance).toBe(200);

    const monthSummary = await getMonthlyFinanceSummary(db, '2026-11');
    expect(monthSummary.realizedIncome).toBe(2745);
    expect(monthSummary.realizedExpense).toBe(100);
    expect(monthSummary.realizedNet).toBe(2645);

    // 5. Veículo e Jornada Uber/99
    const moto = await createVehicle(db, {
      name: 'Yamaha Fazer 150',
      model_year: '2021',
      status: 'owned',
      estimated_value: 10000,
      monthly_payment: 0,
      maintenance_per_km: 0.18,
      depreciation_per_km: 0.1,
      is_active: 1,
    });

    await createWorkSession(
      db,
      {
        vehicle_id: moto.id,
        date: '2026-11-24',
        platform: 'uber_moto',
        start_time: '06:00',
        end_time: '12:30',
        gross_amount: 220,
        km_start: 30000,
        km_end: 30110,
        fuel_liters: 3.4,
        fuel_cost: 21,
        tolls_parking: 0,
      },
      settings,
    );

    // 6. Dashboard consolidado calculado do banco
    const dash = await loadDashboardSnapshot(db, '2026-11-24');
    expect(dash.totalBalance).toBe(2645);
    expect(dash.workWeek.totalGross).toBe(220);
    expect(dash.workWeek.totalKm).toBe(110);
    // manut = 110 * 0.18 = 19.80; oper net = 220 - 21 - 19.80 = 179.20
    expect(dash.workWeek.totalOperationalNet).toBe(179.2);
    expect(dash.priorityTasks).toHaveLength(1);
    expect(dash.upcomingChildWeekends[0].saturday).toBe('2026-11-28');

    // Concluir tarefa e confirmar atualização
    await toggleTaskStatus(db, task.id);
    const dashAfter = await loadDashboardSnapshot(db, '2026-11-24');
    expect(dashAfter.priorityTasks).toHaveLength(0);

    await db.close();
  });

  it('rejeita iFood como plataforma de trabalho em validação e no schema SQLite', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    await expect(
      createWorkSession(
        db,
        {
          date: '2026-11-24',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          platform: 'ifood' as any,
          start_time: '06:00',
          end_time: '12:00',
          gross_amount: 100,
          km_total: 50,
        },
        settings,
      ),
    ).rejects.toThrow();

    await db.close();
  });
});
