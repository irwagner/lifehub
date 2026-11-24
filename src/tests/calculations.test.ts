import { describe, expect, it } from 'vitest';
import { convertPlaceholdersToDollar, TauriSqliteAdapter } from '../db/tauriAdapter';
import {
  calculateSessionDurationHours,
  calculateWeeklyAndDailyGoals,
  calculateWorkSessionMetrics,
  calculateWorkingDaysInMonth,
  generateInstallmentPlan,
  resolveSessionKm,
  simulateWorkScenario,
  summarizeWorkSessions,
} from '../services/calculations';
import type { WorkSession } from '../types/domain';

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'ws_1',
    vehicle_id: null,
    date: '2026-11-23',
    platform: 'ambos',
    start_time: '06:00',
    end_time: '12:30',
    gross_amount: 210,
    km_start: 10000,
    km_end: 10120,
    km_total: 120,
    fuel_liters: 3.5,
    fuel_cost: 22.5,
    tolls_parking: 5,
    maintenance_per_km_snapshot: 0.18,
    depreciation_per_km_snapshot: 0.1,
    notes: '',
    created_at: '2026-11-23T12:35:00Z',
    updated_at: '2026-11-23T12:35:00Z',
    ...overrides,
  };
}

describe('Cálculos de Trabalho por Aplicativos e Financeiro', () => {
  it('calcula duração de jornada normal e atravessando meia-noite', () => {
    expect(calculateSessionDurationHours('06:00', '12:30')).toBe(6.5);
    expect(calculateSessionDurationHours('22:00', '01:30')).toBe(3.5);
  });

  it('resolve quilometragem por odômetro ou total e bloqueia km final < inicial', () => {
    expect(resolveSessionKm({ km_start: 34300, km_end: 34418 })).toBe(118);
    expect(resolveSessionKm({ km_total: 95.5 })).toBe(95.5);
    expect(() => resolveSessionKm({ km_start: 500, km_end: 490 })).toThrow();
  });

  it('separa corretamente bruto, combustível, pedágio, manutenção/km, depreciação e líquido', () => {
    const metrics = calculateWorkSessionMetrics(makeSession());
    // 120 km * 0.18 = 21.60 manut; 120 * 0.10 = 12.00 deprec
    // custos operacionais = 22.50 + 5.00 + 21.60 = 49.10
    // líquido operacional = 210 - 49.10 = 160.90
    // líquido após depreciação = 160.90 - 12.00 = 148.90
    expect(metrics.durationHours).toBe(6.5);
    expect(metrics.estimatedMaintenance).toBe(21.6);
    expect(metrics.estimatedDepreciation).toBe(12);
    expect(metrics.operationalCosts).toBe(49.1);
    expect(metrics.operationalNet).toBe(160.9);
    expect(metrics.netAfterDepreciation).toBe(148.9);
    expect(metrics.grossPerHour).toBe(32.31);
    expect(metrics.operationalNetPerHour).toBe(24.75);
    expect(metrics.grossPerKm).toBe(1.75);
    expect(metrics.operationalNetPerKm).toBe(1.34);
  });

  it('recalcula meta diária e semanal ao alternar 4, 5 e 6 dias/semana', () => {
    const g4 = calculateWeeklyAndDailyGoals(3500, 428, 4);
    const g5 = calculateWeeklyAndDailyGoals(3500, 428, 5);
    const g6 = calculateWeeklyAndDailyGoals(3500, 428, 6);

    expect(g4.weeklyNetGoal).toBe(g5.weeklyNetGoal);
    expect(g4.dailyOperationalTarget).toBeGreaterThan(g5.dailyOperationalTarget);
    expect(g5.dailyOperationalTarget).toBeGreaterThan(g6.dailyOperationalTarget);
  });

  it('resume período com parcela proporcional do veículo separada', () => {
    const summary = summarizeWorkSessions(
      [makeSession(), makeSession({ id: 'ws_2', gross_amount: 190, km_total: 100 })],
      {
        monthlyVehiclePayment: 428,
        periodDays: 7,
        monthlyNetGoal: 3500,
        workDaysPerWeek: 5,
      },
    );

    expect(summary.sessionsCount).toBe(2);
    expect(summary.totalGross).toBe(400);
    expect(summary.totalKm).toBe(220);
    expect(summary.proportionalVehiclePayment).toBe(99.87);
    expect(summary.totalNetAfterVehicle).toBe(
      Number((summary.totalOperationalNet - summary.proportionalVehiclePayment).toFixed(2)),
    );
  });

  it('gera parcelamento mensal exato sem perda de centavos e ajusta virada de mês', () => {
    const plan = generateInstallmentPlan({
      totalAmount: 100,
      installmentsCount: 3,
      firstDateISO: '2026-01-31',
      description: 'Capacete',
    });

    expect(plan).toHaveLength(3);
    expect(plan[0].amount).toBe(33.33);
    expect(plan[1].amount).toBe(33.33);
    expect(plan[2].amount).toBe(33.34);
    const sum = plan.reduce((acc, p) => acc + p.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(100);
    expect(plan[0].date).toBe('2026-01-31');
    expect(plan[1].date).toBe('2026-02-28');
    expect(plan[2].date).toBe('2026-03-31');
  });

  it('conta dias úteis do mês para 4, 5 e 6 dias/semana respeitando datas excluídas', () => {
    // Novembro de 2026 tem 30 dias:
    // Seg-Sex = 21 dias; Seg-Qui = 17 dias; Seg-Sáb = 25 dias
    expect(calculateWorkingDaysInMonth(2026, 11, 5)).toBe(21);
    expect(calculateWorkingDaysInMonth(2026, 11, 4)).toBe(17);
    expect(calculateWorkingDaysInMonth(2026, 11, 6)).toBe(25);
    // Excluindo 2 sábados de fim de semana com o filho
    expect(calculateWorkingDaysInMonth(2026, 11, 6, ['2026-11-07', '2026-11-21'])).toBe(23);
  });

  it('simula cenário comparando moto quitada vs financiada', () => {
    const owned = simulateWorkScenario({
      workDaysPerWeek: 5,
      hoursPerDay: 6.5,
      grossPerHour: 35,
      kmPerHour: 18,
      fuelCostPerKm: 0.19,
      maintenancePerKm: 0.18,
      depreciationPerKm: 0.1,
      vehicleMonthlyPayment: 0,
      monthlyNetGoal: 3500,
    });
    const financed = simulateWorkScenario({
      workDaysPerWeek: 5,
      hoursPerDay: 6.5,
      grossPerHour: 35,
      kmPerHour: 18,
      fuelCostPerKm: 0.19,
      maintenancePerKm: 0.18,
      depreciationPerKm: 0.1,
      vehicleMonthlyPayment: 428,
      monthlyNetGoal: 3500,
    });

    expect(owned.monthlyNetAfterVehicle - financed.monthlyNetAfterVehicle).toBeCloseTo(428, 2);
  });

  it('converte placeholders SQL ? para $1, $2 preservando literais com ?', () => {
    const sql = "SELECT * FROM tasks WHERE title != 'Qual?' AND status = ? AND priority = ?";
    expect(convertPlaceholdersToDollar(sql)).toBe(
      "SELECT * FROM tasks WHERE title != 'Qual?' AND status = $1 AND priority = $2",
    );
  });

  it('TauriSqliteAdapter serializa transações sem emitir BEGIN/COMMIT em pool sqlx', async () => {
    const executedSql: string[] = [];
    const adapter = TauriSqliteAdapter.fromInstance({
      async execute(query) {
        executedSql.push(query);
        await new Promise((r) => setTimeout(r, 5));
        return { rowsAffected: 1 };
      },
      async select<T>() {
        return [] as unknown as T;
      },
      async close() {
        return true;
      },
    });

    await Promise.all([
      adapter.transaction(async (tx) => {
        await tx.execute('INSERT INTO t VALUES (?)', [1]);
        await tx.execute('INSERT INTO t VALUES (?)', [2]);
      }),
      adapter.transaction(async (tx) => {
        await tx.execute('INSERT INTO t VALUES (?)', [3]);
      }),
    ]);

    expect(executedSql).toEqual([
      'INSERT INTO t VALUES ($1)',
      'INSERT INTO t VALUES ($1)',
      'INSERT INTO t VALUES ($1)',
    ]);
    expect(executedSql.some((s) => /BEGIN|COMMIT|ROLLBACK/i.test(s))).toBe(false);
  });
});
