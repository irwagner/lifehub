import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Briefcase,
  CheckSquare,
  FolderGit2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Timer,
  Trash2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  createJobApplication,
  createStudySession,
  createStudyTrack,
  deleteJobApplication,
  deleteStudySession,
  deleteStudyTrack,
  getWeeklyStudyHours,
  listJobApplications,
  listStudySessions,
  listStudyTracks,
  updateJobApplicationStatus,
  updateStudyTrackChecklist,
  updateStudyTrackStatus,
  type StudyTrackWithStats,
} from '../repositories/careerRepo';
import {
  addProjectTask,
  createProject,
  deleteProject,
  deleteProjectTask,
  listProjectsWithTasks,
  toggleProjectTask,
  updateProjectStatus,
  type ProjectWithTasks,
} from '../repositories/projectsRepo';
import type {
  JobApplication,
  JobApplicationStatus,
  ProjectStatus,
  StudySession,
} from '../types/domain';
import { createId, formatDateBR, formatNumber, todayISO } from '../utils/format';

const JOB_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  saved: 'Salva',
  applied: 'Enviada',
  interview: 'Entrevista',
  technical: 'Teste Técnico',
  offer: 'Proposta',
  rejected: 'Encerrada',
};

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planejando',
  active: 'Em andamento',
  completed: 'Entregue',
  paused: 'Pausado',
};

export const CareerPage: React.FC = () => {
  const { db, settings, dataVersion, bumpDataVersion, notify } = useApp();
  const [tracks, setTracks] = useState<StudyTrackWithStats[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [jobs, setJobs] = useState<JobApplication[]>([]);
  const [portfolioProjects, setPortfolioProjects] = useState<ProjectWithTasks[]>([]);
  const [weeklyHours, setWeeklyHours] = useState(0);

  // Study session form
  const [trackId, setTrackId] = useState('');
  const [studyDate, setStudyDate] = useState(todayISO());
  const [studyMinutes, setStudyMinutes] = useState('60');
  const [studyTopic, setStudyTopic] = useState('');
  const [newTrackName, setNewTrackName] = useState('');
  const [newTrackHours, setNewTrackHours] = useState('20');

  // Optional study stopwatch
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Job application form
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [salaryInfo, setSalaryInfo] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [jobLink, setJobLink] = useState('');

  // Portfolio project form
  const [projTitle, setProjTitle] = useState('');
  const [projRepo, setProjRepo] = useState('');
  const [projDeliverable, setProjDeliverable] = useState('');

  useEffect(() => {
    if (!timerRunning) return;
    const interval = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  const formattedTimer = `${String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')}:${String(
    Math.floor((elapsedSeconds % 3600) / 60),
  ).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;

  const handleUseTimerMinutes = () => {
    setTimerRunning(false);
    const mins = Math.max(1, Math.round(elapsedSeconds / 60));
    setStudyMinutes(String(mins));
    notify(`Tempo do cronômetro aplicado (${mins} min). Informe o tema e clique em Salvar Estudo.`);
  };

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const [tr, ss, jb, wh, prjs] = await Promise.all([
        listStudyTracks(db),
        listStudySessions(db),
        listJobApplications(db),
        getWeeklyStudyHours(db, todayISO()),
        listProjectsWithTasks(db, 'portfolio_ti'),
      ]);
      if (active) {
        setTracks(tr);
        setSessions(ss);
        setJobs(jb);
        setWeeklyHours(wh);
        setPortfolioProjects(prjs);
        if (tr[0] && !trackId) setTrackId(tr[0].id);
      }
    })();
    return () => {
      active = false;
    };
  }, [db, dataVersion]);

  const trackMap = new Map(tracks.map((t) => [t.id, t]));

  const handleLogStudy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !trackId) return;
    try {
      await createStudySession(db, {
        track_id: trackId,
        date: studyDate,
        duration_minutes: Number(studyMinutes),
        topic: studyTopic,
      });
      setStudyTopic('');
      bumpDataVersion();
      notify('Sessão de estudo registrada.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao registrar estudo.', 'error');
    }
  };

  const handleAddTrackExercise = async (track: StudyTrackWithStats) => {
    if (!db) return;
    const label = window.prompt(`Novo exercício prático para "${track.name}":`);
    if (!label?.trim()) return;
    const current: Array<{ id: string; label: string; done: boolean }> = JSON.parse(
      track.checklist_json || '[]',
    );
    await updateStudyTrackChecklist(db, track.id, [
      ...current,
      { id: createId('ex'), label: label.trim(), done: false },
    ]);
    bumpDataVersion();
  };

  const handleToggleTrackExercise = async (
    track: StudyTrackWithStats,
    exerciseId: string,
  ) => {
    if (!db) return;
    const current: Array<{ id: string; label: string; done: boolean }> = JSON.parse(
      track.checklist_json || '[]',
    );
    const updated = current.map((it) =>
      it.id === exerciseId ? { ...it, done: !it.done } : it,
    );
    await updateStudyTrackChecklist(db, track.id, updated);
    bumpDataVersion();
  };

  const handleAddJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createJobApplication(db, {
        company,
        role,
        link: jobLink,
        applied_date: todayISO(),
        status: 'applied',
        salary_info: salaryInfo,
        next_step: nextStep,
      });
      setCompany('');
      setRole('');
      setSalaryInfo('');
      setNextStep('');
      setJobLink('');
      bumpDataVersion();
      notify('Candidatura salva.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar vaga.', 'error');
    }
  };

  const handleAddPortfolioProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createProject(db, {
        title: projTitle,
        category: 'portfolio_ti',
        status: 'active',
        repo_url: projRepo,
        deliverable: projDeliverable,
      });
      setProjTitle('');
      setProjRepo('');
      setProjDeliverable('');
      bumpDataVersion();
      notify('Projeto de portfólio adicionado.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar projeto.', 'error');
    }
  };

  const cardClass = 'lh-card';
  const inputClass = 'lh-input';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Estudos, Carreira & Projetos</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Meta semanal de estudos: {formatNumber(weeklyHours, 1)}h /{' '}
          {settings?.study_weekly_goal_hours ?? 6}h · Crie trilhas para qualquer área (faculdade, concursos, idiomas, TI ou negócios).
        </p>
      </div>

      {/* Study Tracks with practical exercises checklist */}
      <section className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-sky-500" />
            <h3 className="font-semibold">Trilhas de Estudo & Exercícios Práticos</h3>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!db || !newTrackName.trim()) return;
              try {
                await createStudyTrack(db, {
                  name: newTrackName,
                  target_hours: Number(newTrackHours) || 20,
                });
                setNewTrackName('');
                bumpDataVersion();
                notify('Nova trilha de estudos criada!');
              } catch (err) {
                notify(err instanceof Error ? err.message : 'Erro ao criar trilha.', 'error');
              }
            }}
            className="flex flex-wrap items-center gap-1.5"
          >
            <input
              value={newTrackName}
              onChange={(e) => setNewTrackName(e.target.value)}
              placeholder="Nova trilha (ex.: Inglês, Concurso...)"
              className="lh-input w-48 py-1.5 text-xs"
            />
            <input
              type="number"
              min="1"
              value={newTrackHours}
              onChange={(e) => setNewTrackHours(e.target.value)}
              title="Meta de horas"
              className="lh-input w-16 py-1.5 text-xs"
            />
            <button type="submit" className="lh-btn-primary py-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Trilha
            </button>
          </form>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tracks.map((t) => {
            const pct = Math.min(100, (t.loggedHours / Math.max(1, t.target_hours)) * 100);
            const exercises: Array<{ id: string; label: string; done: boolean }> = JSON.parse(
              t.checklist_json || '[]',
            );
            return (
              <div
                key={t.id}
                className="flex flex-col rounded-xl border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{t.name}</p>
                  <div className="flex items-center gap-1">
                    <select
                      value={t.status}
                      onChange={async (e) => {
                        if (!db) return;
                        await updateStudyTrackStatus(
                          db,
                          t.id,
                          e.target.value as 'planned' | 'active' | 'completed',
                        );
                        bumpDataVersion();
                      }}
                      className="rounded border border-slate-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                    >
                      <option value="planned">Planejada</option>
                      <option value="active">Ativa</option>
                      <option value="completed">Concluída</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!db) return;
                        await deleteStudyTrack(db, t.id);
                        bumpDataVersion();
                        notify(`Trilha "${t.name}" removida.`);
                      }}
                      title="Remover trilha"
                      className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {formatNumber(t.loggedHours, 1)}h / {t.target_hours}h
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                </div>

                {exercises.length > 0 && (
                  <ul className="mt-2.5 space-y-1">
                    {exercises.map((ex) => (
                      <li key={ex.id}>
                        <button
                          type="button"
                          onClick={() => handleToggleTrackExercise(t, ex.id)}
                          className="flex items-center gap-1.5 text-left text-[11px] text-slate-600 dark:text-slate-300"
                        >
                          {ex.done ? (
                            <CheckSquare className="h-3 w-3 shrink-0 text-emerald-500" />
                          ) : (
                            <Square className="h-3 w-3 shrink-0 text-slate-400" />
                          )}
                          <span className={ex.done ? 'line-through opacity-60' : ''}>
                            {ex.label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  onClick={() => handleAddTrackExercise(t)}
                  className="mt-2.5 inline-flex items-center gap-1 self-start text-[11px] font-medium text-sky-500 hover:underline"
                >
                  <Plus className="h-3 w-3" /> Exercício prático
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Study Sessions + Stopwatch */}
        <section className={cardClass}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Registrar Sessão de Estudo</h3>
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs dark:border-slate-800 dark:bg-slate-950">
              <Timer className="h-3.5 w-3.5 text-sky-500" />
              <span className="font-mono font-semibold">{formattedTimer}</span>
              <button
                type="button"
                onClick={() => setTimerRunning((r) => !r)}
                className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-800"
                title={timerRunning ? 'Pausar cronômetro' : 'Iniciar cronômetro'}
              >
                {timerRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimerRunning(false);
                  setElapsedSeconds(0);
                }}
                className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-800"
                title="Zerar cronômetro"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              {elapsedSeconds >= 60 && (
                <button
                  type="button"
                  onClick={handleUseTimerMinutes}
                  className="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-700"
                >
                  Usar tempo
                </button>
              )}
            </div>
          </div>

          <form onSubmit={handleLogStudy} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <select
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                className={`${inputClass} col-span-2`}
              >
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="5"
                value={studyMinutes}
                onChange={(e) => setStudyMinutes(e.target.value)}
                placeholder="Minutos"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="date"
                value={studyDate}
                onChange={(e) => setStudyDate(e.target.value)}
                className={inputClass}
              />
              <input
                required
                placeholder="Tema estudado / laboratório prático"
                value={studyTopic}
                onChange={(e) => setStudyTopic(e.target.value)}
                className={`${inputClass} col-span-2`}
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Salvar Estudo
            </button>
          </form>

          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
              >
                <div>
                  <p className="font-medium">{s.topic || 'Estudo prático'}</p>
                  <p className="text-slate-500">
                    {trackMap.get(s.track_id)?.name} · {formatDateBR(s.date)} · {s.duration_minutes}{' '}
                    min
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!db) return;
                    await deleteStudySession(db, s.id);
                    bumpDataVersion();
                  }}
                  className="text-slate-400 hover:text-rose-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Job Applications */}
        <section className={cardClass}>
          <div className="mb-3 flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-amber-500" />
            <h3 className="font-semibold">Controle de Vagas & Candidaturas</h3>
          </div>
          <form onSubmit={handleAddJob} className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <input
                required
                placeholder="Empresa"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={inputClass}
              />
              <input
                required
                placeholder="Cargo (ex.: Suporte N1/N2)"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Salário informado"
                value={salaryInfo}
                onChange={(e) => setSalaryInfo(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="Próximo passo"
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex gap-2">
              <input
                placeholder="Link da vaga (opcional)"
                value={jobLink}
                onChange={(e) => setJobLink(e.target.value)}
                className={inputClass}
              />
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
              >
                + Vaga
              </button>
            </div>
          </form>

          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {j.role} · {j.company}
                    </p>
                    <p className="text-slate-500">
                      {formatDateBR(j.applied_date)}
                      {j.salary_info ? ` · ${j.salary_info}` : ''}
                    </p>
                    {j.next_step && <p className="mt-1 text-slate-400">Próx.: {j.next_step}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={j.status}
                      onChange={async (e) => {
                        if (!db) return;
                        await updateJobApplicationStatus(
                          db,
                          j.id,
                          e.target.value as JobApplicationStatus,
                        );
                        bumpDataVersion();
                      }}
                      className="rounded border border-slate-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                    >
                      {Object.entries(JOB_STATUS_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!db) return;
                        await deleteJobApplication(db, j.id);
                        bumpDataVersion();
                      }}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Portfolio TI (Projects, Repositories & Deliverables) */}
      <section className={cardClass}>
        <div className="mb-3 flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-emerald-500" />
          <h3 className="font-semibold">Portfólio TI (Projetos, Repositórios e Entregas)</h3>
        </div>

        <form onSubmit={handleAddPortfolioProject} className="mb-4 grid gap-2 sm:grid-cols-4">
          <input
            required
            placeholder="Projeto (ex.: Scripts PowerShell Suporte)"
            value={projTitle}
            onChange={(e) => setProjTitle(e.target.value)}
            className={inputClass}
          />
          <input
            placeholder="Repositório / GitHub (opcional)"
            value={projRepo}
            onChange={(e) => setProjRepo(e.target.value)}
            className={inputClass}
          />
          <input
            placeholder="Entrega principal (ex.: README + scripts)"
            value={projDeliverable}
            onChange={(e) => setProjDeliverable(e.target.value)}
            className={inputClass}
          />
          <button
            type="submit"
            className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
          >
            + Projeto de Portfólio
          </button>
        </form>

        {portfolioProjects.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nenhum projeto de portfólio cadastrado ainda. Registre laboratórios, scripts e entregas técnicas para mostrar em entrevistas.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {portfolioProjects.map((proj) => (
              <div
                key={proj.id}
                className="rounded-xl border border-slate-200 p-4 text-xs dark:border-slate-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{proj.title}</p>
                    {proj.deliverable && (
                      <p className="mt-0.5 text-slate-500">Entrega: {proj.deliverable}</p>
                    )}
                    {proj.repo_url && (
                      <p className="mt-0.5 font-mono text-[11px] text-sky-400 break-all">
                        {proj.repo_url}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={proj.status}
                      onChange={async (e) => {
                        if (!db) return;
                        await updateProjectStatus(db, proj.id, e.target.value as ProjectStatus);
                        bumpDataVersion();
                      }}
                      className="rounded border border-slate-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                    >
                      {Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!db) return;
                        await deleteProject(db, proj.id);
                        bumpDataVersion();
                      }}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {proj.tasks.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {proj.tasks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!db) return;
                            await toggleProjectTask(db, t.id);
                            bumpDataVersion();
                          }}
                          className="flex items-center gap-1.5 text-left text-slate-600 dark:text-slate-300"
                        >
                          {t.done === 1 ? (
                            <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Square className="h-3.5 w-3.5 text-slate-400" />
                          )}
                          <span className={t.done === 1 ? 'line-through opacity-60' : ''}>
                            {t.title}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!db) return;
                            await deleteProjectTask(db, t.id);
                            bumpDataVersion();
                          }}
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  onClick={async () => {
                    if (!db) return;
                    const label = window.prompt(`Nova etapa de entrega para "${proj.title}":`);
                    if (!label?.trim()) return;
                    await addProjectTask(db, proj.id, label.trim());
                    bumpDataVersion();
                  }}
                  className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-brand-500 hover:underline"
                >
                  <Plus className="h-3 w-3" /> Adicionar etapa
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
