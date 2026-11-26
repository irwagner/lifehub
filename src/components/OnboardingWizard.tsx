import React, { useState } from 'react';
import { Bike, Briefcase, Building2, ShieldCheck, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { loadDemoData } from '../services/demoSeed';
import type { ChildWeekendMode, RoutineMode, WorkDaysPerWeek } from '../types/domain';
import { WindowTitleBar } from './WindowTitleBar';

const MODE_OPTIONS: Array<{
  id: RoutineMode;
  title: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'clt',
    title: 'Trabalho CLT',
    desc: 'Turno fixo + deslocamento + estudos e treinos ajustados',
    icon: Building2,
  },
  {
    id: 'apps',
    title: 'Aplicativos',
    desc: 'Uber Moto / 99Moto com custos por km e meta semanal',
    icon: Bike,
  },
  {
    id: 'ti',
    title: 'Emprego TI',
    desc: 'Horário comercial com saúde, família e certificações',
    icon: Briefcase,
  },
];

export const OnboardingWizard: React.FC = () => {
  const { db, settings, patchSettings, reloadSettings, bumpDataVersion, notify } = useApp();

  const [userName, setUserName] = useState(settings?.user_name ?? '');
  const [routineMode, setRoutineMode] = useState<RoutineMode>(settings?.routine_mode ?? 'clt');
  const [workDays, setWorkDays] = useState<WorkDaysPerWeek>(settings?.work_days_per_week ?? 5);
  const [monthlyGoal, setMonthlyGoal] = useState(String(settings?.monthly_net_goal ?? 3500));
  const [cltRef, setCltRef] = useState(String(settings?.clt_reference_net ?? 2745));
  const [childMode, setChildMode] = useState<ChildWeekendMode>(
    settings?.child_weekend_mode ?? 'alternating',
  );
  const [childAnchor, setChildAnchor] = useState(settings?.child_weekend_anchor ?? '');
  const [commuteMinutes, setCommuteMinutes] = useState(String(settings?.commute_minutes ?? 60));
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await patchSettings({
        user_name: userName.trim(),
        routine_mode: routineMode,
        work_days_per_week: workDays,
        monthly_net_goal: Number(monthlyGoal) || 0,
        clt_reference_net: Number(cltRef) || 0,
        child_weekend_mode: childMode,
        child_weekend_anchor: childMode === 'alternating' && childAnchor ? childAnchor : null,
        commute_minutes: Number(commuteMinutes) || 0,
        onboarding_completed: 1,
      });
      notify('Configuração inicial salva localmente no SQLite.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar configuração.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDemo = async () => {
    if (!db) return;
    setSaving(true);
    try {
      await loadDemoData(db);
      await reloadSettings();
      bumpDataVersion();
      notify('Dados de demonstração carregados. Você pode limpá-los em Configurações.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar dados demo.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lh-app-shell flex h-screen flex-col overflow-hidden text-slate-100">
      <WindowTitleBar />
      <div className="lh-safe-top lh-safe-bottom relative flex flex-1 items-start justify-center overflow-y-auto bg-[#070b14] p-4 sm:items-center sm:p-6">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />

        <div className="relative my-2 w-full max-w-2xl rounded-3xl border border-white/[0.09] bg-[#0d1425]/95 p-5 shadow-2xl backdrop-blur-xl animate-scale-in sm:p-8">
        <div className="mb-7 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-700 text-white shadow-glow">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="8" className="opacity-40" />
              <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Bem-vindo ao LifeHub
            </h1>
            <p className="text-sm text-slate-400">
              Central de Vida local-first para Windows. Tudo fica salvo apenas no seu dispositivo.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Visual routine mode selector */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Modo de rotina atual
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = routineMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRoutineMode(opt.id)}
                    className={`rounded-2xl border p-3.5 text-left transition ${
                      active
                        ? 'border-brand-500 bg-brand-500/15 shadow-glow'
                        : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 ${active ? 'text-brand-400' : 'text-slate-400'}`}
                    />
                    <p className="mt-2 text-sm font-semibold text-white">{opt.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Como prefere ser chamado (opcional)
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Ex.: Carlos"
                className="lh-input"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Dias de trabalho por semana
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([4, 5, 6] as WorkDaysPerWeek[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWorkDays(d)}
                    className={`rounded-xl border py-2 text-xs font-semibold transition ${
                      workDays === d
                        ? 'border-brand-500 bg-brand-600 text-white'
                        : 'border-white/[0.08] bg-slate-950/70 text-slate-300 hover:border-white/[0.18]'
                    }`}
                  >
                    {d} dias
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Meta líquida mensal (R$)
              </label>
              <input
                type="number"
                step="50"
                min="0"
                value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(e.target.value)}
                className="lh-input tabular-nums"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Ref. líquido CLT (R$)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={cltRef}
                onChange={(e) => setCltRef(e.target.value)}
                className="lh-input tabular-nums"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Deslocamento médio (min)
              </label>
              <input
                type="number"
                min="0"
                max="360"
                value={commuteMinutes}
                onChange={(e) => setCommuteMinutes(e.target.value)}
                className="lh-input tabular-nums"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Fins de semana com filho
              </label>
              <select
                value={childMode}
                onChange={(e) => setChildMode(e.target.value as ChildWeekendMode)}
                className="lh-input"
              >
                <option value="all">Todos os fins de semana</option>
                <option value="alternating">Fins de semana alternados (quinzenal)</option>
                <option value="custom">Manual no calendário</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Data âncora (se alternado)
              </label>
              <input
                type="date"
                disabled={childMode !== 'alternating'}
                value={childAnchor}
                onChange={(e) => setChildAnchor(e.target.value)}
                className="lh-input disabled:opacity-40"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Opcional: o app nunca presume uma data inicial automaticamente.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5 text-xs text-slate-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              Privacidade garantida: começa <strong>limpo, sem dados financeiros inventados</strong>, não solicita credenciais da Uber/99 e funciona 100% offline.
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={handleLoadDemo}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Explorar com dados de demonstração
            </button>

            <button
              type="submit"
              disabled={saving}
              className="lh-btn-primary px-6 py-2.5 text-sm"
            >
              {saving ? 'Salvando...' : 'Começar com banco limpo'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};
