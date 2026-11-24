import React, { useEffect, useState } from 'react';
import { ClipboardCheck, Lightbulb, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  computeWeeklyFacts,
  deleteIdea,
  listIdeas,
  listWeeklyReviews,
  saveWeeklyReview,
  updateIdeaStatus,
  type ComputedWeeklyFacts,
} from '../repositories/ideasRepo';
import type { IdeaItem, IdeaStatus, WeeklyReview } from '../types/domain';
import { formatBRL, formatDateBR, formatNumber, todayISO } from '../utils/format';

const COLUMNS: Array<{ status: IdeaStatus; label: string }> = [
  { status: 'idea', label: 'Ideia' },
  { status: 'planning', label: 'Planejando' },
  { status: 'doing', label: 'Fazendo' },
  { status: 'done', label: 'Concluído' },
  { status: 'paused', label: 'Pausado' },
];

export const IdeasPage: React.FC = () => {
  const { db, dataVersion, bumpDataVersion, openQuickAction, notify } = useApp();
  const [ideas, setIdeas] = useState<IdeaItem[]>([]);
  const [facts, setFacts] = useState<ComputedWeeklyFacts | null>(null);
  const [reviews, setReviews] = useState<WeeklyReview[]>([]);

  const [familyNotes, setFamilyNotes] = useState('');
  const [lessons, setLessons] = useState('');
  const [nextFocus, setNextFocus] = useState('');

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const [idList, wkFacts, revList] = await Promise.all([
        listIdeas(db),
        computeWeeklyFacts(db, todayISO()),
        listWeeklyReviews(db),
      ]);
      if (active) {
        setIdeas(idList);
        setFacts(wkFacts);
        setReviews(revList);
        const existingThisWeek = revList.find((r) => r.week_start === wkFacts.weekStart);
        if (existingThisWeek) {
          setFamilyNotes(existingThisWeek.family_notes);
          setLessons(existingThisWeek.lessons_learned);
          setNextFocus(existingThisWeek.next_week_focus);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [db, dataVersion]);

  const handleSaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !facts) return;
    await saveWeeklyReview(db, {
      week_start: facts.weekStart,
      gross_earned: facts.grossEarned,
      net_left: facts.netLeft,
      work_hours: facts.workHours,
      workouts_count: facts.workoutsCount,
      study_hours: facts.studyHours,
      applications_count: facts.applicationsCount,
      family_notes: familyNotes,
      lessons_learned: lessons,
      next_week_focus: nextFocus,
    });
    bumpDataVersion();
    notify('Revisão semanal salva no SQLite.');
  };

  const cardClass =
    'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900';
  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Ideias, Projetos & Revisão Semanal</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Capture ideias sem tirar o foco das tarefas essenciais e feche a semana com dados reais.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openQuickAction('idea')}
          className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
        >
          + Nova Ideia
        </button>
      </div>

      {/* Kanban */}
      <section className={cardClass}>
        <div className="mb-4 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="font-semibold">Kanban de Ideias e Projetos (ordenado por Impacto vs Esforço)</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {COLUMNS.map((col) => {
            const colItems = ideas.filter((i) => i.status === col.status);
            return (
              <div
                key={col.status}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50"
              >
                <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                  <span>{col.label}</span>
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] dark:bg-slate-800">
                    {colItems.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {colItems.map((idea) => (
                    <div
                      key={idea.id}
                      className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="font-semibold leading-snug">{idea.title}</p>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!db) return;
                            await deleteIdea(db, idea.id);
                            bumpDataVersion();
                          }}
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      {idea.description && (
                        <p className="mt-1 text-[11px] text-slate-500">{idea.description}</p>
                      )}
                      <p className="mt-1.5 text-[10px] text-slate-400">
                        Impacto {idea.impact}/5 · Esforço {idea.effort}/5
                      </p>
                      <select
                        value={idea.status}
                        onChange={async (e) => {
                          if (!db) return;
                          await updateIdeaStatus(db, idea.id, e.target.value as IdeaStatus);
                          bumpDataVersion();
                        }}
                        className="mt-2 w-full rounded border border-slate-300 bg-transparent px-1.5 py-1 text-[11px] dark:border-slate-700"
                      >
                        {COLUMNS.map((c) => (
                          <option key={c.status} value={c.status}>
                            Mover: {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Weekly Review */}
      {facts && (
        <section className={cardClass}>
          <div className="mb-3 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-emerald-500" />
            <h3 className="font-semibold">
              Revisão Semanal ({formatDateBR(facts.weekStart)} a {formatDateBR(facts.weekEnd)})
            </h3>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-[11px] text-slate-500">Ganho Bruto</p>
              <p className="font-bold">{formatBRL(facts.grossEarned)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-[11px] text-slate-500">Sobrou (Líq.)</p>
              <p className="font-bold text-emerald-500">{formatBRL(facts.netLeft)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-[11px] text-slate-500">Horas Apps</p>
              <p className="font-bold">{formatNumber(facts.workHours, 1)}h</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-[11px] text-slate-500">Treinos</p>
              <p className="font-bold">{facts.workoutsCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-[11px] text-slate-500">Estudos TI</p>
              <p className="font-bold">{formatNumber(facts.studyHours, 1)}h</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-[11px] text-slate-500">Candidaturas</p>
              <p className="font-bold">{facts.applicationsCount}</p>
            </div>
          </div>

          <form onSubmit={handleSaveReview} className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">
                Como foi o tempo com seu filho / família?
              </label>
              <textarea
                rows={3}
                value={familyNotes}
                onChange={(e) => setFamilyNotes(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                O que aprendeu nesta semana?
              </label>
              <textarea
                rows={3}
                value={lessons}
                onChange={(e) => setLessons(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Foco explicável para a próxima semana
              </label>
              <textarea
                rows={3}
                value={nextFocus}
                onChange={(e) => setNextFocus(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="md:col-span-3">
              <button
                type="submit"
                className="rounded-xl bg-brand-600 px-5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
              >
                Salvar Revisão Semanal
              </button>
            </div>
          </form>

          {reviews.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="mb-2 text-xs font-semibold text-slate-500">Histórico de revisões</p>
              <ul className="space-y-2 text-xs">
                {reviews.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <p className="font-semibold">Semana de {formatDateBR(r.week_start)}</p>
                    <p className="text-slate-500">
                      Bruto {formatBRL(r.gross_earned)} · Líq. {formatBRL(r.net_left)} ·{' '}
                      {r.workouts_count} treinos · {formatNumber(r.study_hours, 1)}h estudos
                    </p>
                    {r.next_week_focus && (
                      <p className="mt-1 text-slate-400">Foco: {r.next_week_focus}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
