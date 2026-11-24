import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { createTask, listTasks, updateTask } from '../repositories/calendarRepo';
import {
  createTransaction,
  listAccounts,
  updateTransaction,
} from '../repositories/financeRepo';
import {
  getHabitsFourWeekConsistency,
  logHabitSession,
} from '../repositories/habitsRepo';
import { getSettings } from '../repositories/settingsRepo';
import {
  createWorkSession,
  updateWorkSession,
} from '../repositories/workRepo';
import {
  buildMonthlyConsolidatedReport,
  formatMonthlyReportMarkdown,
} from '../services/monthlyReport';

describe('Edição inline (Transações, Jornadas, Tarefas), Consistência 4 Semanas e Relatório Mensal', () => {
  it('edita transação existente e recalcula saldo das contas com precisão', async () => {
    const db = await createInMemoryTestDatabase();
    const [tx] = await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário parcial',
      amount: 2000,
      date: '2026-11-05',
      status: 'realized',
    });

    await updateTransaction(db, tx.id, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário líquido validado no contracheque',
      amount: 2745,
      date: '2026-11-05',
      status: 'realized',
      notes: 'Conferido',
    });

    const accounts = await listAccounts(db);
    const principal = accounts.find((a) => a.id === 'acc_principal')!;
    expect(principal.current_balance).toBe(2745);
    await db.close();
  });

  it('edita jornada Uber/99 e recalcula km/custos mantendo bloqueio contra iFood', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    const ws = await createWorkSession(
      db,
      {
        date: '2026-11-24',
        platform: 'uber_moto',
        start_time: '06:00',
        end_time: '12:00',
        gross_amount: 180,
        km_total: 90,
        fuel_cost: 0,
      },
      settings,
    );

    const updated = await updateWorkSession(db, ws.id, {
      date: '2026-11-24',
      platform: 'ambos',
      start_time: '06:00',
      end_time: '12:30',
      gross_amount: 215,
      km_total: 112,
      fuel_cost: 22.4,
      fuel_liters: 3.5,
      tolls_parking: 4,
      notes: 'Atualizado após abastecimento',
    });

    expect(updated.platform).toBe('ambos');
    expect(updated.gross_amount).toBe(215);
    expect(updated.km_total).toBe(112);
    expect(updated.fuel_cost).toBe(22.4);

    await expect(
      updateWorkSession(db, ws.id, {
        date: '2026-11-24',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        platform: 'ifood' as any,
        start_time: '06:00',
        end_time: '12:00',
        gross_amount: 100,
        km_total: 50,
      }),
    ).rejects.toThrow();

    await db.close();
  });

  it('edita e reagenda tarefa existente no SQLite', async () => {
    const db = await createInMemoryTestDatabase();
    const task = await createTask(db, {
      title: 'Enviar currículo',
      priority: 'medium',
      due_date: '2026-11-24',
    });

    await updateTask(db, task.id, {
      title: 'Enviar currículo atualizado (Suporte/Redes)',
      priority: 'high',
      due_date: '2026-11-26',
      category: 'carreira',
    });

    const list = await listTasks(db);
    expect(list[0].title).toBe('Enviar currículo atualizado (Suporte/Redes)');
    expect(list[0].priority).toBe('high');
    expect(list[0].due_date).toBe('2026-11-26');
    await db.close();
  });

  it('calcula consistência não-punitiva de 4 semanas de hábitos e relatório mensal consolidado em Markdown', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    await logHabitSession(db, { habit_id: 'hab_academia', date: '2026-11-23', duration_minutes: 60 });
    await logHabitSession(db, { habit_id: 'hab_corrida', date: '2026-11-24', duration_minutes: 40 });
    await logHabitSession(db, { habit_id: 'hab_academia', date: '2026-11-16', duration_minutes: 55 });

    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário Novembro',
      amount: 2745,
      date: '2026-11-05',
      status: 'realized',
    });

    await createWorkSession(
      db,
      {
        date: '2026-11-23',
        platform: 'uber_moto',
        start_time: '06:00',
        end_time: '12:30',
        gross_amount: 210,
        km_total: 100,
        fuel_cost: 20,
      },
      settings,
    );

    const consistency = await getHabitsFourWeekConsistency(db, '2026-11-24');
    expect(consistency).toHaveLength(4);
    expect(consistency[3].academiaCount).toBe(1);
    expect(consistency[3].corridaCount).toBe(1);
    expect(consistency[2].academiaCount).toBe(1);

    const report = await buildMonthlyConsolidatedReport(db, '2026-11');
    expect(report.finance.realizedIncome).toBe(2745);
    expect(report.work.totalGross).toBe(210);
    expect(report.workoutsCount).toBe(3);

    const md = formatMonthlyReportMarkdown(report);
    expect(md).toContain('# LifeHub — Relatório Mensal (2026-11)');
    expect(md).toContain('2.745,00');
    expect(md).toContain('210,00');

    await db.close();
  });
});
