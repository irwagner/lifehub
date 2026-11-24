import React, { useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { loadDemoData } from '../services/demoSeed';
import type { ChildWeekendMode, RoutineMode, WorkDaysPerWeek } from '../types/domain';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            LH
          </div>
          <div>
            <h1 className="text-xl font-bold">Bem-vindo ao LifeHub — Central de Vida</h1>
            <p className="text-sm text-slate-400">
              Configuração inicial local-first. Todos os dados ficam salvos apenas neste dispositivo.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Como prefere ser chamado (opcional)
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Ex.: Carlos"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Modo de rotina atual
              </label>
              <select
                value={routineMode}
                onChange={(e) => setRoutineMode(e.target.value as RoutineMode)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              >
                <option value="clt">Trabalho CLT (atual)</option>
                <option value="apps">Trabalho por Aplicativos (Uber/99 Moto)</option>
                <option value="ti">Emprego de TI</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Dias de trabalho / semana
              </label>
              <select
                value={workDays}
                onChange={(e) => setWorkDays(Number(e.target.value) as WorkDaysPerWeek)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value={4}>4 dias/semana</option>
                <option value={5}>5 dias/semana (padrão)</option>
                <option value={6}>6 dias/semana</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Meta líquida mensal (R$)
              </label>
              <input
                type="number"
                step="50"
                min="0"
                value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Ref. líquido CLT (R$)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={cltRef}
                onChange={(e) => setCltRef(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Fins de semana com filho
              </label>
              <select
                value={childMode}
                onChange={(e) => setChildMode(e.target.value as ChildWeekendMode)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="all">Todos os fins de semana</option>
                <option value="alternating">Fins de semana alternados</option>
                <option value="custom">Manual no calendário</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Data âncora (se alternado)
              </label>
              <input
                type="date"
                disabled={childMode !== 'alternating'}
                value={childAnchor}
                onChange={(e) => setChildAnchor(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-40"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Opcional: nenhuma data inicial é assumida automaticamente.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Deslocamento médio (min)
              </label>
              <input
                type="number"
                min="0"
                max="360"
                value={commuteMinutes}
                onChange={(e) => setCommuteMinutes(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>
              Privacidade garantida: o LifeHub começa <strong>limpo, sem dados financeiros inventados</strong>, não solicita credenciais da Uber/99 e não sincroniza em nuvem nesta versão.
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleLoadDemo}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Explorar com dados de demonstração
            </button>

            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Começar com banco limpo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
