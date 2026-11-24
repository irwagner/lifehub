import React, { useEffect, useState } from 'react';
import { BookOpen, Briefcase, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  createJobApplication,
  createStudySession,
  deleteJobApplication,
  deleteStudySession,
  getWeeklyStudyHours,
  listJobApplications,
  listStudySessions,
  listStudyTracks,
  updateJobApplicationStatus,
  updateStudyTrackStatus,
  type StudyTrackWithStats,
} from '../repositories/careerRepo';
import type { JobApplication, JobApplicationStatus, StudySession } from '../types/domain';
import { formatDateBR, formatNumber, todayISO } from '../utils/format';

const JOB_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  saved: 'Salva',
  applied: 'Enviada',
  interview: 'Entrevista',
  technical: 'Teste Técnico',
  offer: 'Proposta',
  rejected: 'Encerrada',
};

export const CareerPage: React.FC = () => {
  const { db, settings, dataVersion, bumpDataVersion, notify } = useApp();
  const [tracks, setTracks] = useState<StudyTrackWithStats[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [jobs, setJobs] = useState<JobApplication[]>([]);
  const [weeklyHours, setWeeklyHours] = useState(0);

  // Study session form
  const [trackId, setTrackId] = useState('');
  const [studyDate, setStudyDate] = useState(todayISO());
  const [studyMinutes, setStudyMinutes] = useState('60');
  const [studyTopic, setStudyTopic] = useState('');

  // Job application form
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [salaryInfo, setSalaryInfo] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [jobLink, setJobLink] = useState('');

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const [tr, ss, jb, wh] = await Promise.all([
        listStudyTracks(db),
        listStudySessions(db),
        listJobApplications(db),
        getWeeklyStudyHours(db, todayISO()),
      ]);
      if (active) {
        setTracks(tr);
        setSessions(ss);
        setJobs(jb);
        setWeeklyHours(wh);
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

  const cardClass =
    'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900';
  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Estudos & Carreira em TI</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Meta semanal de estudos: {formatNumber(weeklyHours, 1)}h /{' '}
            {settings?.study_weekly_goal_hours ?? 6}h · Suporte, Redes, Infraestrutura e Segurança.
          </p>
        </div>
      </div>

      {/* Study Tracks */}
      <section className={cardClass}>
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-sky-500" />
          <h3 className="font-semibold">Trilhas de Estudo</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tracks.map((t) => {
            const pct = Math.min(100, (t.loggedHours / Math.max(1, t.target_hours)) * 100);
            return (
              <div
                key={t.id}
                className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{t.name}</p>
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
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {formatNumber(t.loggedHours, 1)}h / {t.target_hours}h
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Study Sessions */}
        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Registrar Sessão de Estudo</h3>
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
    </div>
  );
};
