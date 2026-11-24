import React, { useEffect, useState } from 'react';
import { CheckSquare, Square, Trash2, Users } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { useApp } from '../context/AppContext';
import {
  createFamilyPlan,
  deleteFamilyPlan,
  listFamilyPlans,
  updateFamilyPlanChecklist,
} from '../repositories/familyRepo';
import {
  generateUpcomingChildWeekends,
  normalizeToSaturday,
} from '../services/recurrence';
import type { ChildWeekendMode, FamilyChecklistItem, FamilyPlan } from '../types/domain';
import { createId, formatBRL, formatDateBR, todayISO } from '../utils/format';

export const FamilyPage: React.FC = () => {
  const { db, settings, patchSettings, dataVersion, bumpDataVersion, notify } = useApp();
  const [plans, setPlans] = useState<FamilyPlan[]>([]);
  const [mode, setMode] = useState<ChildWeekendMode>(settings?.child_weekend_mode ?? 'alternating');
  const [anchor, setAnchor] = useState(settings?.child_weekend_anchor ?? '');

  const [planWeekend, setPlanWeekend] = useState(normalizeToSaturday(todayISO()));
  const [planTitle, setPlanTitle] = useState('');
  const [planBudget, setPlanBudget] = useState('');
  const [planItemsText, setPlanItemsText] = useState('');
  const [planNotes, setPlanNotes] = useState('');

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const list = await listFamilyPlans(db);
      if (active) setPlans(list);
    })();
    return () => {
      active = false;
    };
  }, [db, dataVersion]);

  useEffect(() => {
    if (!settings) return;
    setMode(settings.child_weekend_mode);
    setAnchor(settings.child_weekend_anchor ?? '');
  }, [settings]);

  if (!settings) return null;

  const upcoming = generateUpcomingChildWeekends(todayISO(), 6, mode, anchor || null);

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await patchSettings({
        child_weekend_mode: mode,
        child_weekend_anchor: mode === 'alternating' && anchor ? normalizeToSaturday(anchor) : null,
      });
      notify('Regra de fins de semana com o filho salva.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar regra.', 'error');
    }
  };

  const handleAddPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      const checklist: FamilyChecklistItem[] = planItemsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((label) => ({ id: createId('chk'), label, done: false }));

      await createFamilyPlan(db, {
        weekend_start: normalizeToSaturday(planWeekend),
        title: planTitle,
        budget_amount: Number(planBudget) || 0,
        checklist,
        notes: planNotes,
      });
      setPlanTitle('');
      setPlanBudget('');
      setPlanItemsText('');
      setPlanNotes('');
      bumpDataVersion();
      notify('Planejamento salvo.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar plano.', 'error');
    }
  };

  const handleToggleChecklistItem = async (plan: FamilyPlan, itemId: string) => {
    if (!db) return;
    const list: FamilyChecklistItem[] = JSON.parse(plan.checklist_json || '[]');
    const updated = list.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    );
    await updateFamilyPlanChecklist(db, plan.id, updated);
    bumpDataVersion();
  };

  const cardClass =
    'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900';
  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Família & Fins de Semana com o Filho</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure a frequência sem assumir data inicial. Os fins de semana reservados bloqueiam trabalho automaticamente nos templates.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-pink-500" />
            <h3 className="font-semibold">Regra de Recorrência</h3>
          </div>

          <form onSubmit={handleSaveRule} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Frequência</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ChildWeekendMode)}
                className={inputClass}
              >
                <option value="all">Todos os fins de semana</option>
                <option value="alternating">Fins de semana alternados (quinzenal)</option>
                <option value="custom">Somente manual no calendário</option>
              </select>
            </div>

            {mode === 'alternating' && (
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Data âncora de um fim de semana com o filho
                </label>
                <input
                  type="date"
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  O sistema nunca presume a data inicial; escolha qualquer data do fim de semana de referência.
                </p>
              </div>
            )}

            <button
              type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Salvar Regra
            </button>
          </form>

          <div className="mt-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Próximos fins de semana reservados
            </h4>
            {upcoming.length === 0 ? (
              <p className="text-xs text-slate-500">
                {mode === 'alternating'
                  ? 'Defina uma data âncora acima para gerar os próximos fins de semana quinzenais.'
                  : 'Modo manual ativo — adicione eventos na categoria "Filho / Família" no calendário.'}
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {upcoming.map((w) => (
                  <li
                    key={w.saturday}
                    className="rounded-xl border border-pink-500/30 bg-pink-500/10 px-3 py-2 text-xs font-medium text-pink-600 dark:text-pink-300"
                  >
                    {w.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Planejar Atividade / Passeio</h3>
          <p className="mb-3 text-xs text-slate-500">
            Privacidade: mantenha apenas atividades, orçamento e itens práticos — sem dados sensíveis do menor.
          </p>
          <form onSubmit={handleAddPlan} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Sábado do fim de semana</label>
                <input
                  type="date"
                  required
                  value={planWeekend}
                  onChange={(e) => setPlanWeekend(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Orçamento previsto (R$)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={planBudget}
                  onChange={(e) => setPlanBudget(e.target.value)}
                  placeholder="Ex.: 100"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Atividade planejada</label>
              <input
                required
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                placeholder="Ex.: Parque, praia, filme em casa..."
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Checklist de itens (um por linha)
              </label>
              <textarea
                rows={3}
                value={planItemsText}
                onChange={(e) => setPlanItemsText(e.target.value)}
                placeholder={'Água e lanche\nProtetor solar\nRoupa extra'}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Observações</label>
              <input
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Salvar Planejamento
            </button>
          </form>
        </section>
      </div>

      <section className={cardClass}>
        <h3 className="mb-3 font-semibold">Planejamentos Salvos</h3>
        {plans.length === 0 ? (
          <EmptyState
            title="Nenhum passeio planejado ainda"
            description="Use o formulário acima para registrar atividades, orçamento e checklist."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => {
              const items: FamilyChecklistItem[] = JSON.parse(plan.checklist_json || '[]');
              return (
                <div
                  key={plan.id}
                  className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-pink-500">
                        Fim de semana de {formatDateBR(plan.weekend_start)}
                      </p>
                      <h4 className="font-semibold">{plan.title}</h4>
                      <p className="text-xs text-slate-500">
                        Orçamento: {formatBRL(plan.budget_amount)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!db) return;
                        await deleteFamilyPlan(db, plan.id);
                        bumpDataVersion();
                      }}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {items.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {items.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => handleToggleChecklistItem(plan, item.id)}
                            className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                          >
                            {item.done ? (
                              <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Square className="h-3.5 w-3.5 text-slate-400" />
                            )}
                            <span className={item.done ? 'line-through opacity-60' : ''}>
                              {item.label}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.notes && <p className="mt-2 text-xs text-slate-500">{plan.notes}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
