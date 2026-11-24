import type { BudgetWithUsage } from '../repositories/financeRepo';
import type { WorkPeriodSummary } from './calculations';
import type { Settings } from '../types/domain';
import { formatBRL, formatNumber } from '../utils/format';

export interface ExplainableRecommendation {
  id: string;
  area: 'trabalho' | 'financeiro' | 'saude' | 'carreira' | 'familia';
  tone: 'positive' | 'attention' | 'info';
  title: string;
  explanation: string;
  basis: string;
}

/**
 * Generates deterministic, 100% fact-backed recommendations without requiring AI.
 * Every recommendation explicitly states the real numbers behind it (Blueprint 6.9).
 */
export function generateExplainableRecommendations(input: {
  settings: Settings;
  workWeek: WorkPeriodSummary;
  workLast30Days: WorkPeriodSummary;
  monthlyRealizedNet: number;
  budgets: BudgetWithUsage[];
  workoutsThisWeek: number;
  weeklyStudyHours: number;
  activeApplicationsCount: number;
  hasChildWeekendThisWeek: boolean;
}): ExplainableRecommendation[] {
  const recs: ExplainableRecommendation[] = [];
  const {
    settings,
    workWeek,
    workLast30Days,
    monthlyRealizedNet,
    budgets,
    workoutsThisWeek,
    weeklyStudyHours,
    activeApplicationsCount,
    hasChildWeekendThisWeek,
  } = input;

  // 1. Work efficiency & weekly goal pacing
  if (workWeek.sessionsCount > 0) {
    const fuelRatioPct =
      workWeek.totalGross > 0 ? (workWeek.totalFuelCost / workWeek.totalGross) * 100 : 0;

    if (workWeek.totalNetAfterVehicle >= workWeek.weeklyNetGoal && workWeek.weeklyNetGoal > 0) {
      recs.push({
        id: 'rec_work_goal_hit',
        area: 'trabalho',
        tone: 'positive',
        title: 'Meta semanal de aplicativos atingida',
        explanation:
          'Você já atingiu a meta líquida semanal. Evite horas extras desnecessárias para preservar sono, treino e família.',
        basis: `Líquido após moto: ${formatBRL(workWeek.totalNetAfterVehicle)} vs. meta semanal ${formatBRL(workWeek.weeklyNetGoal)} (${workWeek.sessionsCount} jornadas).`,
      });
    } else if (workWeek.weeklyNetGoal > 0) {
      const missing = Math.max(0, workWeek.weeklyNetGoal - workWeek.totalNetAfterVehicle);
      const estHours =
        workLast30Days.operationalNetPerHour > 0
          ? missing / workLast30Days.operationalNetPerHour
          : 0;
      recs.push({
        id: 'rec_work_goal_gap',
        area: 'trabalho',
        tone: 'info',
        title: 'Falta pouco para fechar a meta semanal',
        explanation:
          estHours > 0
            ? `Faltam ${formatBRL(missing)} líquidos na semana (estimativa de ~${formatNumber(estHours, 1)}h pela sua média real de 30 dias). Só use o bloco 17h–20h se não comprometer o sono.`
            : `Faltam ${formatBRL(missing)} líquidos para a meta semanal de ${formatBRL(workWeek.weeklyNetGoal)}.`,
        basis: `Semana: ${formatBRL(workWeek.totalNetAfterVehicle)} de ${formatBRL(workWeek.weeklyNetGoal)} · Média 30d: ${formatBRL(workLast30Days.operationalNetPerHour)}/h.`,
      });
    }

    if (fuelRatioPct > 22) {
      recs.push({
        id: 'rec_fuel_high',
        area: 'trabalho',
        tone: 'attention',
        title: 'Combustível acima de 22% do faturamento bruto',
        explanation:
          'O peso do combustível na semana está alto. Avalie calibragem dos pneus, rotas com menor deslocamento vazio ou horários de maior tarifa.',
        basis: `Combustível: ${formatBRL(workWeek.totalFuelCost)} (${formatNumber(fuelRatioPct, 1)}% do bruto de ${formatBRL(workWeek.totalGross)}).`,
      });
    }
  }

  // 2. Budget alerts
  const overBudgets = budgets.filter((b) => b.usage_pct >= 100);
  if (overBudgets.length > 0) {
    recs.push({
      id: 'rec_budget_over',
      area: 'financeiro',
      tone: 'attention',
      title: `${overBudgets.length} categoria(s) ultrapassaram o teto mensal`,
      explanation:
        'Revise os lançamentos previstos do restante do mês na aba Financeiro antes de assumir novas parcelas.',
      basis: `Maior utilização: ${formatNumber(Math.max(...overBudgets.map((b) => b.usage_pct)), 0)}% do limite definido.`,
    });
  } else if (settings.monthly_net_goal > 0 && monthlyRealizedNet >= settings.monthly_net_goal) {
    recs.push({
      id: 'rec_fin_positive',
      area: 'financeiro',
      tone: 'positive',
      title: 'Saldo líquido mensal acima da meta',
      explanation:
        'Considere direcionar parte do excedente para a reserva de emergência antes de qualquer financiamento.',
      basis: `Saldo realizado no mês: ${formatBRL(monthlyRealizedNet)} vs. meta ${formatBRL(settings.monthly_net_goal)}.`,
    });
  }

  // 3. Family weekend protection
  if (hasChildWeekendThisWeek) {
    recs.push({
      id: 'rec_child_weekend',
      area: 'familia',
      tone: 'info',
      title: 'Fim de semana reservado para o filho',
      explanation:
        'Sábado e domingo estão protegidos para convivência familiar. Concentre sua meta de trabalho nos dias úteis e não se cobre por semanas mais leves de treino.',
      basis: `Regra ativa: ${settings.child_weekend_mode === 'all' ? 'todos os fins de semana' : 'quinzenal'}.`,
    });
  }

  // 4. Health consistency (non-punitive!)
  if (workoutsThisWeek >= 4) {
    recs.push({
      id: 'rec_health_good',
      area: 'saude',
      tone: 'positive',
      title: 'Boa consistência física na semana',
      explanation:
        'Você manteve a rotina de treinos ativa. Respeite os blocos de descanso e sono (22h) para recuperação.',
      basis: `${workoutsThisWeek} sessões de academia/corrida registradas nesta semana.`,
    });
  } else if (workoutsThisWeek === 0 && !hasChildWeekendThisWeek) {
    recs.push({
      id: 'rec_health_gentle',
      area: 'saude',
      tone: 'info',
      title: 'Retome com um treino curto esta semana',
      explanation:
        'Ainda não há sessões de academia ou corrida registradas nesta semana. Uma sessão de 30–45 min já mantém o ritmo sem sobrecarregar.',
      basis: '0 sessões de academia/corrida registradas até hoje nesta semana.',
    });
  }

  // 5. Career / Studies
  if (weeklyStudyHours < settings.study_weekly_goal_hours) {
    const remaining = Math.max(0, settings.study_weekly_goal_hours - weeklyStudyHours);
    recs.push({
      id: 'rec_study_pace',
      area: 'carreira',
      tone: 'info',
      title: 'Progresso da trilha de TI na semana',
      explanation: `Faltam ${formatNumber(remaining, 1)}h para atingir sua meta semanal de estudos. Um bloco de 60 min às 16h já aproxima você da transição para TI.`,
      basis: `${formatNumber(weeklyStudyHours, 1)}h estudadas de ${settings.study_weekly_goal_hours}h planejadas · ${activeApplicationsCount} vaga(s) ativa(s).`,
    });
  } else {
    recs.push({
      id: 'rec_study_hit',
      area: 'carreira',
      tone: 'positive',
      title: 'Meta semanal de estudos de TI concluída',
      explanation:
        'Aproveite o próximo bloco de carreira para atualizar seu portfólio ou enviar novas candidaturas.',
      basis: `${formatNumber(weeklyStudyHours, 1)}h estudadas (meta: ${settings.study_weekly_goal_hours}h).`,
    });
  }

  return recs;
}
