import React, { useEffect, useState } from 'react';
import {
  Bike,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Circle,
  Compass,
  FileBarChart2,
  Heart,
  Users,
  Wallet,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { MonthlyReportModal } from '../components/MonthlyReportModal';
import { useApp } from '../context/AppContext';
import { toggleTaskStatus } from '../repositories/calendarRepo';
import { loadDashboardSnapshot, type DashboardSnapshot } from '../repositories/dashboardRepo';
import { logHabitSession } from '../repositories/habitsRepo';
import { EVENT_CATEGORY_META, ROUTINE_MODE_LABELS } from '../types/domain';
import {
  formatBRL,
  formatDateBR,
  formatNumber,
  formatTimeBR,
  greetingForHour,
  todayISO,
} from '../utils/format';

export const DashboardPage: React.FC = () => {
  const { db, dataVersion, bumpDataVersion, openQuickAction, setActiveSection, notify } = useApp();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      try {
        const data = await loadDashboardSnapshot(db, todayISO());
        if (active) {
          setSnapshot(data);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          notify(err instanceof Error ? err.message : 'Erro ao carregar painel.', 'error');
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [db, dataVersion, notify]);

  if (loading || !snapshot) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        Calculando indicadores a partir do SQLite...
      </div>
    );
  }

  const { settings } = snapshot;
  const greeting = greetingForHour();
  const displayName = settings.user_name ? `, ${settings.user_name}` : '';
  const monthGoalPct =
    settings.monthly_net_goal > 0
      ? Math.min(100, Math.max(0, (snapshot.monthlyFinance.realizedNet / settings.monthly_net_goal) * 100))
      : 0;

  const handleToggleTask = async (id: string) => {
    if (!db) return;
    await toggleTaskStatus(db, id);
    bumpDataVersion();
    notify('Tarefa atualizada.');
  };

  const handleQuickHabit = async (habitId: string, habitName: string) => {
    if (!db) return;
    await logHabitSession(db, { habit_id: habitId, date: snapshot.today, duration_minutes: 45 });
    bumpDataVersion();
    notify(`${habitName} registrado hoje.`);
  };

  const cardClass =
    'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-600 dark:text-brand-400">
            {formatDateBR(snapshot.today)} · {ROUTINE_MODE_LABELS[settings.routine_mode]} ·{' '}
            {settings.work_days_per_week} dias/sem
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">
            {greeting}
            {displayName}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Visão consolidada e calculada em tempo real a partir do seu banco SQLite local.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <FileBarChart2 className="h-3.5 w-3.5" /> Relatório do Mês
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('settings')}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            Alternar modo ({ROUTINE_MODE_LABELS[settings.routine_mode]})
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cardClass}>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Saldo Registrado</span>
            <Wallet className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatBRL(snapshot.totalBalance)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Mês: +{formatBRL(snapshot.monthlyFinance.realizedIncome)} / -
            {formatBRL(snapshot.monthlyFinance.realizedExpense)}
          </p>
          <div className="mt-3">
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>Líquido vs meta ({formatBRL(settings.monthly_net_goal)})</span>
              <span>{formatNumber(monthGoalPct, 0)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${monthGoalPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Apps Semana (Uber/99)</span>
            <Bike className="h-4 w-4 text-brand-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatBRL(snapshot.workWeek.totalGross)}</p>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            Líquido oper.: {formatBRL(snapshot.workWeek.totalOperationalNet)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Combustível: {formatBRL(snapshot.workWeek.totalFuelCost)} ·{' '}
            {formatNumber(snapshot.workWeek.totalKm, 1)} km
          </p>
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Estudos & Carreira TI</span>
            <Briefcase className="h-4 w-4 text-sky-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {formatNumber(snapshot.weeklyStudyHours, 1)}h{' '}
            <span className="text-sm font-normal text-slate-400">
              / {settings.study_weekly_goal_hours}h
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {snapshot.activeApplications.length} candidatura(s) ativa(s) ·{' '}
            {snapshot.upcomingInterviews.length} entrevista(s)
          </p>
          <button
            type="button"
            onClick={() => setActiveSection('career')}
            className="mt-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Abrir trilhas e vagas →
          </button>
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Próximo Fim de Semana c/ Filho</span>
            <Users className="h-4 w-4 text-pink-500" />
          </div>
          {snapshot.upcomingChildWeekends.length > 0 ? (
            <>
              <p className="mt-2 text-base font-bold">
                {snapshot.upcomingChildWeekends[0].label}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Bloqueado para trabalho no calendário.
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Configure a regra ou data âncora na aba Família para gerar recorrências.
            </p>
          )}
          <button
            type="button"
            onClick={() => setActiveSection('family')}
            className="mt-2 text-xs font-medium text-pink-500 hover:underline"
          >
            Gerenciar agenda família →
          </button>
        </div>
      </div>

      {/* Main 2-column grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's schedule */}
        <section className={`${cardClass} lg:col-span-2`}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-brand-500" />
              <h3 className="font-semibold">Agenda de Hoje ({formatDateBR(snapshot.today)})</h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('calendar')}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Ver calendário completo
            </button>
          </div>

          {snapshot.todayEvents.length === 0 ? (
            <EmptyState
              title="Nenhum compromisso para hoje"
              description="Adicione um evento rápido ou aplique um template de semana na aba Calendário."
              actionLabel="+ Compromisso"
              onAction={() => openQuickAction('event')}
            />
          ) : (
            <ul className="space-y-2.5">
              {snapshot.todayEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: ev.color }}
                    />
                    <div>
                      <p className="text-sm font-medium">{ev.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {EVENT_CATEGORY_META[ev.category]?.label ?? ev.category}
                        {ev.notes ? ` · ${ev.notes}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {formatTimeBR(ev.start_at)} – {formatTimeBR(ev.end_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Priority tasks */}
        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Tarefas Prioritárias</h3>
            <button
              type="button"
              onClick={() => openQuickAction('task')}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              + Nova
            </button>
          </div>

          {snapshot.priorityTasks.length === 0 ? (
            <EmptyState
              title="Sem tarefas pendentes"
              description="Tudo limpo por aqui. Adicione tarefas essenciais para hoje."
              actionLabel="+ Tarefa"
              onAction={() => openQuickAction('task')}
            />
          ) : (
            <ul className="space-y-2">
              {snapshot.priorityTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800"
                >
                  <button
                    type="button"
                    onClick={() => handleToggleTask(task.id)}
                    className="mt-0.5 text-slate-400 hover:text-emerald-500"
                    aria-label={`Concluir ${task.title}`}
                  >
                    {task.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{task.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {task.priority === 'high'
                        ? 'Alta'
                        : task.priority === 'medium'
                          ? 'Média'
                          : 'Baixa'}
                      {task.due_date ? ` · Vence ${formatDateBR(task.due_date)}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Bottom 2-column grid: Habits + Upcoming Bills */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-emerald-500" />
              <h3 className="font-semibold">Saúde & Hábitos da Semana</h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('health')}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Ver detalhes
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot.habits.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3 dark:border-slate-800"
              >
                <div>
                  <p className="text-sm font-medium">{h.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {h.completedThisWeek} / {h.weekly_target} na semana
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleQuickHabit(h.id, h.name)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    h.doneToday
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-100 text-slate-700 hover:bg-brand-600 hover:text-white dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {h.doneToday ? 'Feito hoje' : '+ Registrar'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Próximas Contas Previstas</h3>
            <button
              type="button"
              onClick={() => setActiveSection('finance')}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Abrir financeiro
            </button>
          </div>
          {snapshot.upcomingBills.length === 0 ? (
            <EmptyState
              title="Nenhuma conta prevista pendente"
              description="Lance despesas previstas para acompanhar vencimentos e fluxo de caixa."
              actionLabel="+ Transação"
              onAction={() => openQuickAction('transaction')}
            />
          ) : (
            <ul className="space-y-2">
              {snapshot.upcomingBills.map((bill) => (
                <li
                  key={bill.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-800"
                >
                  <div>
                    <p className="text-sm font-medium">{bill.description}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Vencimento: {formatDateBR(bill.due_date ?? bill.date)}
                    </p>
                  </div>
                  <span className="font-semibold text-rose-500">{formatBRL(bill.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {/* Explainable Recommendations (Rule-based, zero black-box AI) */}
      {snapshot.recommendations.length > 0 && (
        <section className={cardClass}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-brand-500" />
              <h3 className="font-semibold">Decisões Explicáveis (baseadas em seus dados reais)</h3>
            </div>
            <span className="text-[11px] text-slate-500">Sem IA obrigatória</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {snapshot.recommendations.slice(0, 6).map((rec) => (
              <div
                key={rec.id}
                className={`rounded-xl border p-3.5 text-xs ${
                  rec.tone === 'positive'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : rec.tone === 'attention'
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60'
                }`}
              >
                <p className="font-semibold">{rec.title}</p>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{rec.explanation}</p>
                <p className="mt-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  Base: {rec.basis}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      <MonthlyReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
};
