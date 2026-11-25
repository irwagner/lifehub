import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Bike,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Circle,
  Compass,
  FileBarChart2,
  Heart,
  SlidersHorizontal,
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
      <div className="lh-card flex items-center gap-3 p-8 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        Calculando indicadores a partir do SQLite...
      </div>
    );
  }

  const { settings } = snapshot;
  const greeting = greetingForHour();
  const displayName = settings.user_name ? `, ${settings.user_name}` : '';
  const monthGoalPct =
    settings.monthly_net_goal > 0
      ? Math.min(
          100,
          Math.max(0, (snapshot.monthlyFinance.realizedNet / settings.monthly_net_goal) * 100),
        )
      : 0;

  const studyGoalPct =
    settings.study_weekly_goal_hours > 0
      ? Math.min(100, (snapshot.weeklyStudyHours / settings.study_weekly_goal_hours) * 100)
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero Banner */}
      <div className="lh-card relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-52 w-52 rounded-full bg-brand-400/10 blur-3xl" />

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-brand-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-500/20 dark:text-brand-300">
                {formatDateBR(snapshot.today)}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-900/5 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                {ROUTINE_MODE_LABELS[settings.routine_mode]} · {settings.work_days_per_week}{' '}
                dias/sem
              </span>
            </div>
            <h2 className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              {greeting}
              {displayName}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Painel consolidado em tempo real direto do seu banco SQLite local.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="lh-btn-secondary"
            >
              <FileBarChart2 className="h-3.5 w-3.5 text-brand-500" /> Relatório do Mês
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('settings')}
              className="lh-btn-primary"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Configurar Modo
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Finance KPI */}
        <button
          type="button"
          onClick={() => setActiveSection('finance')}
          className="lh-card-hover group text-left"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Saldo Registrado
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-500 ring-1 ring-emerald-500/20">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <p className="lh-kpi-value mt-3">{formatBRL(snapshot.totalBalance)}</p>
          <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <span className="text-emerald-500">+{formatBRL(snapshot.monthlyFinance.realizedIncome)}</span>
            {' · '}
            <span className="text-rose-400">-{formatBRL(snapshot.monthlyFinance.realizedExpense)}</span>
          </p>
          <div className="mt-4">
            <div className="flex justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              <span>Meta {formatBRL(settings.monthly_net_goal)}</span>
              <span className="font-semibold text-emerald-500">{formatNumber(monthGoalPct, 0)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                style={{ width: `${monthGoalPct}%` }}
              />
            </div>
          </div>
        </button>

        {/* Apps Work KPI */}
        <button
          type="button"
          onClick={() => setActiveSection('work')}
          className="lh-card-hover group text-left"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Apps Semana (Uber/99)
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/12 text-brand-500 ring-1 ring-brand-500/20">
              <Bike className="h-4 w-4" />
            </span>
          </div>
          <p className="lh-kpi-value mt-3">{formatBRL(snapshot.workWeek.totalGross)}</p>
          <p className="mt-1 text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
            Líquido oper.: {formatBRL(snapshot.workWeek.totalOperationalNet)}
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] tabular-nums text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
            <span>Comb.: {formatBRL(snapshot.workWeek.totalFuelCost)}</span>
            <span>{formatNumber(snapshot.workWeek.totalKm, 1)} km</span>
          </div>
        </button>

        {/* Studies & Career KPI */}
        <button
          type="button"
          onClick={() => setActiveSection('career')}
          className="lh-card-hover group text-left"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Estudos & Carreira TI
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/12 text-sky-500 ring-1 ring-sky-500/20">
              <Briefcase className="h-4 w-4" />
            </span>
          </div>
          <p className="lh-kpi-value mt-3">
            {formatNumber(snapshot.weeklyStudyHours, 1)}h{' '}
            <span className="text-sm font-medium text-slate-400">
              / {settings.study_weekly_goal_hours}h
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {snapshot.activeApplications.length} vaga(s) ativa(s) ·{' '}
            {snapshot.upcomingInterviews.length} entrevista(s)
          </p>
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-brand-400 transition-all duration-500"
                style={{ width: `${studyGoalPct}%` }}
              />
            </div>
            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-500 group-hover:underline">
              Abrir trilhas e vagas <ArrowUpRight className="h-3 w-3" />
            </p>
          </div>
        </button>

        {/* Family KPI */}
        <button
          type="button"
          onClick={() => setActiveSection('family')}
          className="lh-card-hover group text-left"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Fim de Semana c/ Filho
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-pink-500/12 text-pink-500 ring-1 ring-pink-500/20">
              <Users className="h-4 w-4" />
            </span>
          </div>
          {snapshot.upcomingChildWeekends.length > 0 ? (
            <>
              <p className="mt-3 text-base font-bold tracking-tight text-slate-900 dark:text-white">
                {snapshot.upcomingChildWeekends[0].label}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Protegido automaticamente contra trabalho.
              </p>
            </>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Configure a regra ou data âncora na aba Família para gerar recorrências.
            </p>
          )}
          <p className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-pink-500 group-hover:underline">
            Gerenciar agenda família <ArrowUpRight className="h-3 w-3" />
          </p>
        </button>
      </div>

      {/* Main 2-column grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's schedule */}
        <section className="lh-card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/12 text-brand-500">
                <CalendarDays className="h-4 w-4" />
              </span>
              <h3 className="font-semibold tracking-tight">
                Agenda de Hoje ({formatDateBR(snapshot.today)})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('calendar')}
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              Ver calendário →
            </button>
          </div>

          {snapshot.todayEvents.length === 0 ? (
            <EmptyState
              title="Nenhum compromisso para hoje"
              description="Adicione um evento rápido ou aplique um template semanal na aba Calendário."
              actionLabel="+ Compromisso"
              onAction={() => openQuickAction('event')}
            />
          ) : (
            <ul className="space-y-2.5">
              {snapshot.todayEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3.5 transition hover:border-slate-300 dark:border-white/[0.06] dark:bg-white/[0.025] dark:hover:border-white/[0.12]"
                >
                  <div className="flex items-center gap-3.5">
                    <span
                      className="h-9 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: ev.color }}
                    />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {ev.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {EVENT_CATEGORY_META[ev.category]?.label ?? ev.category}
                        {ev.notes ? ` · ${ev.notes}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-white/[0.08]">
                    {formatTimeBR(ev.start_at)} – {formatTimeBR(ev.end_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Priority tasks */}
        <section className="lh-card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold tracking-tight">Tarefas Prioritárias</h3>
            <button
              type="button"
              onClick={() => openQuickAction('task')}
              className="rounded-lg bg-brand-500/12 px-2.5 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-500/20 dark:text-brand-300"
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
                  className="flex items-start gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2.5 transition hover:border-slate-300 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.12]"
                >
                  <button
                    type="button"
                    onClick={() => handleToggleTask(task.id)}
                    className="mt-0.5 text-slate-400 transition hover:text-emerald-500"
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
                    <div className="mt-1 flex items-center gap-2 text-[11px]">
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-semibold ${
                          task.priority === 'high'
                            ? 'bg-rose-500/15 text-rose-500'
                            : task.priority === 'medium'
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-slate-500/15 text-slate-400'
                        }`}
                      >
                        {task.priority === 'high'
                          ? 'Alta'
                          : task.priority === 'medium'
                            ? 'Média'
                            : 'Baixa'}
                      </span>
                      {task.due_date && (
                        <span className="tabular-nums text-slate-500 dark:text-slate-400">
                          {formatDateBR(task.due_date)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Habits + Upcoming Bills */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="lh-card">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-500">
                <Heart className="h-4 w-4" />
              </span>
              <h3 className="font-semibold tracking-tight">Saúde & Hábitos da Semana</h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('health')}
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              Ver detalhes →
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot.habits.map((h) => {
              const pct = Math.min(100, (h.completedThisWeek / Math.max(1, h.weekly_target)) * 100);
              return (
                <div
                  key={h.id}
                  className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3.5 dark:border-white/[0.06] dark:bg-white/[0.02]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{h.name}</p>
                      <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {h.completedThisWeek} / {h.weekly_target} na semana
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleQuickHabit(h.id, h.name)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        h.doneToday
                          ? 'bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30'
                          : 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-brand-600 hover:text-white dark:bg-white/[0.06] dark:text-slate-200 dark:ring-white/[0.08] dark:hover:bg-brand-600'
                      }`}
                    >
                      {h.doneToday ? '✓ Feito' : '+ Registrar'}
                    </button>
                  </div>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.07]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="lh-card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold tracking-tight">Próximas Contas Previstas</h3>
            <button
              type="button"
              onClick={() => setActiveSection('finance')}
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              Abrir financeiro →
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
                  className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50/50 px-3.5 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]"
                >
                  <div>
                    <p className="text-sm font-semibold">{bill.description}</p>
                    <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      Vencimento: {formatDateBR(bill.due_date ?? bill.date)}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-rose-500">
                    {formatBRL(bill.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Explainable Recommendations */}
      {snapshot.recommendations.length > 0 && (
        <section className="lh-card">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/12 text-brand-500">
                <Compass className="h-4 w-4" />
              </span>
              <h3 className="font-semibold tracking-tight">
                Decisões Explicáveis (baseadas em seus dados reais)
              </h3>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
              100% determinístico · sem IA
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {snapshot.recommendations.slice(0, 6).map((rec) => (
              <div
                key={rec.id}
                className={`relative overflow-hidden rounded-xl border p-4 pl-5 text-xs ${
                  rec.tone === 'positive'
                    ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                    : rec.tone === 'attention'
                      ? 'border-amber-500/30 bg-amber-500/[0.07]'
                      : 'border-slate-200/80 bg-slate-50/70 dark:border-white/[0.06] dark:bg-white/[0.02]'
                }`}
              >
                <span
                  className={`absolute inset-y-0 left-0 w-1 ${
                    rec.tone === 'positive'
                      ? 'bg-emerald-500'
                      : rec.tone === 'attention'
                        ? 'bg-amber-500'
                        : 'bg-brand-500'
                  }`}
                />
                <p className="font-semibold text-slate-900 dark:text-white">{rec.title}</p>
                <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-300">
                  {rec.explanation}
                </p>
                <p className="mt-2.5 border-t border-slate-200/60 pt-2 font-mono text-[10px] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
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
