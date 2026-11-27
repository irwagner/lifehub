import React, { useEffect, useState } from 'react';
import { CheckCircle2, Heart, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  createHabit,
  deleteHabitLog,
  getHabitsFourWeekConsistency,
  listHabitLogs,
  listHabitsWithProgress,
  logHabitSession,
  type HabitWeekConsistency,
  type HabitWithWeeklyProgress,
} from '../repositories/habitsRepo';
import { isChildWeekend, normalizeToSaturday } from '../services/recurrence';
import type { HabitCategory, HabitLog } from '../types/domain';
import { formatDateBR, todayISO } from '../utils/format';

export const HealthPage: React.FC = () => {
  const { db, settings, dataVersion, bumpDataVersion, notify } = useApp();
  const [habits, setHabits] = useState<HabitWithWeeklyProgress[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [fourWeeks, setFourWeeks] = useState<HabitWeekConsistency[]>([]);

  const [selectedHabitId, setSelectedHabitId] = useState('');
  const [logDate, setLogDate] = useState(todayISO());
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');

  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState<HabitCategory>('outro');
  const [newTarget, setNewTarget] = useState('3');

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const [h, l, fw] = await Promise.all([
        listHabitsWithProgress(db, todayISO()),
        listHabitLogs(db, 25),
        getHabitsFourWeekConsistency(db, todayISO()),
      ]);
      if (active) {
        setHabits(h);
        setLogs(l);
        setFourWeeks(fw);
        if (h[0] && !selectedHabitId) setSelectedHabitId(h[0].id);
      }
    })();
    return () => {
      active = false;
    };
  }, [db, dataVersion]);

  const habitMap = new Map(habits.map((h) => [h.id, h]));

  const handleLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedHabitId) return;
    await logHabitSession(db, {
      habit_id: selectedHabitId,
      date: logDate,
      duration_minutes: Number(duration) || 0,
      notes,
    });
    setNotes('');
    bumpDataVersion();
    notify('Sessão registrada.');
  };

  const handleCreateHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createHabit(db, {
        name: newName,
        category: newCat,
        weekly_target: Number(newTarget) || 3,
      });
      setNewName('');
      bumpDataVersion();
      notify('Hábito adicionado.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar hábito.', 'error');
    }
  };

  const cardClass = 'lh-card';
  const inputClass = 'lh-input';

  const hasChildThisWeek = settings
    ? isChildWeekend(
        normalizeToSaturday(todayISO()),
        settings.child_weekend_mode,
        settings.child_weekend_anchor,
      )
    : false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Saúde & Hábitos</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Consistência realista (academia, corrida, sono, água e descanso), sem penalizar semanas mais cheias ou imprevistos.
        </p>
      </div>

      {hasChildThisWeek && (
        <div className="rounded-xl border border-pink-500/30 bg-pink-500/10 px-4 py-3 text-xs text-pink-300">
          Esta semana inclui <strong>fim de semana reservado em família</strong>. Priorize descanso e convivência — nenhuma métrica penaliza semanas mais leves.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {habits.map((h) => {
          const pct = Math.min(100, (h.completedThisWeek / Math.max(1, h.weekly_target)) * 100);
          return (
            <div key={h.id} className={cardClass}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{h.name}</span>
                <Heart className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="mt-2 text-2xl font-bold">
                {h.completedThisWeek}{' '}
                <span className="text-sm font-normal text-slate-400">/ {h.weekly_target} sem</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>{h.totalMinutesThisWeek} min na semana</span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!db) return;
                    await logHabitSession(db, {
                      habit_id: h.id,
                      date: todayISO(),
                      duration_minutes: h.category === 'academia' ? 60 : h.category === 'corrida' ? 40 : 0,
                    });
                    bumpDataVersion();
                    notify(`${h.name} concluído hoje.`);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-500 hover:bg-emerald-500/25"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Concluir hoje
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Registrar Sessão Detalhada</h3>
          <form onSubmit={handleLog} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Hábito</label>
                <select
                  value={selectedHabitId}
                  onChange={(e) => setSelectedHabitId(e.target.value)}
                  className={inputClass}
                >
                  {habits.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Data</label>
                <input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Duração (min)</label>
                <input
                  type="number"
                  min="0"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Notas</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Treino, distância, energia..."
                  className={inputClass}
                />
              </div>
            </div>
            <button
              type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Salvar Registro
            </button>
          </form>

          <hr className="my-5 border-slate-200 dark:border-slate-800" />
          <h4 className="mb-2 text-sm font-semibold">Criar Hábito Personalizado</h4>
          <form onSubmit={handleCreateHabit} className="grid grid-cols-3 gap-2">
            <input
              required
              placeholder="Nome"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClass}
            />
            <select
              value={newCat}
              onChange={(e) => setNewCat(e.target.value as HabitCategory)}
              className={inputClass}
            >
              <option value="academia">Academia</option>
              <option value="corrida">Corrida</option>
              <option value="sono">Sono</option>
              <option value="agua">Água</option>
              <option value="descanso">Descanso</option>
              <option value="outro">Outro</option>
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max="7"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                className={inputClass}
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white hover:bg-slate-700"
              >
                +
              </button>
            </div>
          </form>
        </section>

        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Histórico Recente</h3>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma sessão registrada ainda.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto">
              {logs.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs dark:border-slate-800"
                >
                  <div>
                    <p className="font-medium">{habitMap.get(l.habit_id)?.name ?? l.habit_id}</p>
                    <p className="text-slate-500">
                      {formatDateBR(l.date)}
                      {l.duration_minutes > 0 ? ` · ${l.duration_minutes} min` : ''}
                      {l.notes ? ` · ${l.notes}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!db) return;
                      await deleteHabitLog(db, l.id);
                      bumpDataVersion();
                    }}
                    className="text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 4-week non-punitive consistency */}
      <section className={cardClass}>
        <h3 className="mb-3 font-semibold">Consistência das Últimas 4 Semanas (sem punição)</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          {fourWeeks.map((w) => (
            <div
              key={w.weekStart}
              className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800"
            >
              <p className="font-mono text-[11px] text-slate-500">
                {formatDateBR(w.weekStart)} – {formatDateBR(w.weekEnd)}
              </p>
              <p className="mt-1.5 text-sm font-semibold">
                {w.academiaCount} academia · {w.corridaCount} corrida
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {w.totalSessions} registro(s) totais
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
