import type { SqlExecutor } from '../db/types';
import {
  getMonthlyFinanceSummary,
  listBudgetsForMonth,
  listCategories,
  listGoals,
  type BudgetWithUsage,
  type MonthlyFinanceSummary,
} from '../repositories/financeRepo';
import { getSettings } from '../repositories/settingsRepo';
import { listVehicles, listWorkSessions } from '../repositories/workRepo';
import { summarizeWorkSessions, type WorkPeriodSummary } from './calculations';
import {
  ROUTINE_MODE_LABELS,
  type FinancialGoal,
  type Settings,
} from '../types/domain';
import { formatBRL, formatNumber, round2 } from '../utils/format';

export interface MonthlyConsolidatedReport {
  month: string;
  settings: Settings;
  finance: MonthlyFinanceSummary;
  budgets: Array<BudgetWithUsage & { category_name: string }>;
  goals: FinancialGoal[];
  work: WorkPeriodSummary;
  workoutsCount: number;
  academiaCount: number;
  corridaCount: number;
  studyHours: number;
  applicationsSent: number;
  interviewsCount: number;
  tasksCompleted: number;
}

export async function buildMonthlyConsolidatedReport(
  db: SqlExecutor,
  month: string,
): Promise<MonthlyConsolidatedReport> {
  const monthStart = `${month}-01`;
  const [yStr, mStr] = month.split('-');
  const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

  const settings = await getSettings(db);
  const [
    finance,
    rawBudgets,
    categories,
    goals,
    vehicles,
    workSessions,
    habitRows,
    studyRows,
    appRows,
    taskRows,
  ] = await Promise.all([
    getMonthlyFinanceSummary(db, month),
    listBudgetsForMonth(db, month),
    listCategories(db),
    listGoals(db),
    listVehicles(db),
    listWorkSessions(db, { startDate: monthStart, endDate: monthEnd }),
    db.select<{ category: string; date: string }>(
      `SELECT h.category, hl.date FROM habit_logs hl
       JOIN habits h ON h.id = hl.habit_id
       WHERE hl.completed = 1 AND hl.date >= ? AND hl.date <= ?`,
      [monthStart, monthEnd],
    ),
    db.select<{ total_min: number }>(
      `SELECT COALESCE(SUM(duration_minutes), 0) as total_min
       FROM study_sessions WHERE date >= ? AND date <= ?`,
      [monthStart, monthEnd],
    ),
    db.select<{ status: string }>(
      `SELECT status FROM job_applications WHERE applied_date >= ? AND applied_date <= ?`,
      [monthStart, monthEnd],
    ),
    db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM tasks
       WHERE status = 'done' AND completed_at IS NOT NULL AND substr(completed_at, 1, 7) = ?`,
      [month],
    ),
  ]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const activeVehicle = vehicles.find((v) => v.is_active === 1);
  const activePayment = activeVehicle
    ? activeVehicle.monthly_payment
    : settings.vehicle_monthly_payment;

  const work = summarizeWorkSessions(workSessions, {
    monthlyVehiclePayment: activePayment,
    periodDays: lastDay,
    monthlyNetGoal: settings.monthly_net_goal,
    workDaysPerWeek: settings.work_days_per_week,
  });

  const academiaDates = new Set(
    habitRows.filter((h) => h.category === 'academia').map((h) => h.date),
  );
  const corridaDates = new Set(
    habitRows.filter((h) => h.category === 'corrida').map((h) => h.date),
  );

  return {
    month,
    settings,
    finance,
    budgets: rawBudgets.map((b) => ({
      ...b,
      category_name: catMap.get(b.category_id) ?? b.category_id,
    })),
    goals,
    work,
    workoutsCount: academiaDates.size + corridaDates.size,
    academiaCount: academiaDates.size,
    corridaCount: corridaDates.size,
    studyHours: round2((studyRows[0]?.total_min ?? 0) / 60),
    applicationsSent: appRows.length,
    interviewsCount: appRows.filter((a) => a.status === 'interview' || a.status === 'technical')
      .length,
    tasksCompleted: taskRows[0]?.count ?? 0,
  };
}

export function formatMonthlyReportMarkdown(report: MonthlyConsolidatedReport): string {
  const lines: string[] = [
    `# LifeHub — Relatório Mensal (${report.month})`,
    '',
    `- **Modo de rotina**: ${ROUTINE_MODE_LABELS[report.settings.routine_mode]} (${report.settings.work_days_per_week} dias/semana)`,
    `- **Meta líquida mensal**: ${formatBRL(report.settings.monthly_net_goal)}`,
    '',
    '## 1. Financeiro Pessoal',
    `- Receitas realizadas: **${formatBRL(report.finance.realizedIncome)}**`,
    `  - Salário CLT: ${formatBRL(report.finance.incomeBySource.salario ?? 0)}`,
    `  - Aplicativos (Uber/99): ${formatBRL(report.finance.incomeBySource.aplicativos ?? 0)}`,
    `  - Serviços TI: ${formatBRL(report.finance.incomeBySource.servicos_ti ?? 0)}`,
    `- Despesas realizadas: **${formatBRL(report.finance.realizedExpense)}**`,
    `- Saldo líquido realizado: **${formatBRL(report.finance.realizedNet)}**`,
    `- Despesas ainda previstas: ${formatBRL(report.finance.plannedExpense)}`,
    '',
    '## 2. Trabalho por Aplicativos (Uber Moto / 99Moto)',
    `- Jornadas registradas: **${report.work.sessionsCount}** (${formatNumber(report.work.totalHours, 1)}h · ${formatNumber(report.work.totalKm, 1)} km)`,
    `- Faturamento bruto: **${formatBRL(report.work.totalGross)}**`,
    `- Combustível: ${formatBRL(report.work.totalFuelCost)} (${formatNumber(report.work.totalFuelLiters, 1)} L)`,
    `- Manutenção estimada: ${formatBRL(report.work.totalMaintenance)}`,
    `- Depreciação estimada (à parte): ${formatBRL(report.work.totalDepreciation)}`,
    `- **Líquido operacional**: **${formatBRL(report.work.totalOperationalNet)}** (${formatBRL(report.work.operationalNetPerHour)}/h · ${formatBRL(report.work.operationalNetPerKm)}/km)`,
    `- Parcela do veículo no período: ${formatBRL(report.work.proportionalVehiclePayment)}`,
    `- **Líquido após parcela da moto**: **${formatBRL(report.work.totalNetAfterVehicle)}**`,
    '',
    '## 3. Saúde, Estudos, Carreira e Rotina',
    `- Treinos no mês: **${report.workoutsCount}** (${report.academiaCount} academia · ${report.corridaCount} corrida)`,
    `- Horas estudadas (TI): **${formatNumber(report.studyHours, 1)}h**`,
    `- Candidaturas enviadas no mês: **${report.applicationsSent}** (entrevistas/técnicos: ${report.interviewsCount})`,
    `- Tarefas concluídas no mês: **${report.tasksCompleted}**`,
  ];

  if (report.budgets.length > 0) {
    lines.push('', '## 4. Orçamentos por Categoria');
    for (const b of report.budgets) {
      lines.push(
        `- ${b.category_name}: ${formatBRL(b.spent_amount)} / ${formatBRL(b.limit_amount)} (${formatNumber(b.usage_pct, 0)}%)`,
      );
    }
  }

  return lines.join('\n');
}
