import type { SqlExecutor } from '../db/types';
import { recordTombstone } from '../services/syncTombstones';
import type {
  JobApplication,
  JobApplicationStatus,
  StudySession,
  StudyTrack,
} from '../types/domain';
import { addDaysISO, createId, round2, startOfWeekISO } from '../utils/format';

export interface StudyTrackWithStats extends StudyTrack {
  loggedHours: number;
}

export async function listStudyTracks(db: SqlExecutor): Promise<StudyTrackWithStats[]> {
  const tracks = await db.select<StudyTrack>(
    'SELECT * FROM study_tracks ORDER BY status ASC, name ASC',
  );
  const sums = await db.select<{ track_id: string; total_min: number }>(
    'SELECT track_id, COALESCE(SUM(duration_minutes), 0) as total_min FROM study_sessions GROUP BY track_id',
  );
  const map = new Map(sums.map((s) => [s.track_id, s.total_min]));
  return tracks.map((t) => ({
    ...t,
    loggedHours: round2((map.get(t.id) ?? 0) / 60),
  }));
}

export async function listStudySessions(
  db: SqlExecutor,
  limit = 40,
): Promise<StudySession[]> {
  return db.select<StudySession>(
    'SELECT * FROM study_sessions ORDER BY date DESC, created_at DESC LIMIT ?',
    [limit],
  );
}

export async function createStudySession(
  db: SqlExecutor,
  input: {
    track_id: string;
    date: string;
    duration_minutes: number;
    topic: string;
    notes?: string;
  },
): Promise<StudySession> {
  if (!(input.duration_minutes > 0)) {
    throw new Error('Informe uma duração válida em minutos.');
  }
  const now = new Date().toISOString();
  const id = createId('std');
  await db.execute(
    `INSERT INTO study_sessions (id, track_id, date, duration_minutes, topic, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.track_id, input.date, Math.round(input.duration_minutes), input.topic.trim(), input.notes ?? '', now],
  );
  const rows = await db.select<StudySession>('SELECT * FROM study_sessions WHERE id = ?', [id]);
  return rows[0];
}

export async function deleteStudySession(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM study_sessions WHERE id = ?', [id]);
  recordTombstone('study_sessions', id);
}

export async function updateStudyTrackStatus(
  db: SqlExecutor,
  id: string,
  status: 'planned' | 'active' | 'completed',
): Promise<void> {
  await db.execute('UPDATE study_tracks SET status = ? WHERE id = ?', [status, id]);
}

export async function updateStudyTrackChecklist(
  db: SqlExecutor,
  id: string,
  items: Array<{ id: string; label: string; done: boolean }>,
): Promise<void> {
  await db.execute('UPDATE study_tracks SET checklist_json = ? WHERE id = ?', [
    JSON.stringify(items),
    id,
  ]);
}

export async function createStudyTrack(
  db: SqlExecutor,
  input: { name: string; target_hours?: number },
): Promise<StudyTrack> {
  const name = input.name.trim();
  if (!name) throw new Error('Informe o nome da trilha de estudos.');
  const now = new Date().toISOString();
  const id = createId('trk');
  const targetHours = Math.max(1, Number(input.target_hours) || 20);
  await db.execute(
    `INSERT INTO study_tracks (id, name, status, target_hours, checklist_json, notes, created_at)
     VALUES (?, ?, 'active', ?, '[]', '', ?)`,
    [id, name, targetHours, now],
  );
  const rows = await db.select<StudyTrack>('SELECT * FROM study_tracks WHERE id = ?', [id]);
  return rows[0];
}

export async function deleteStudyTrack(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM study_tracks WHERE id = ?', [id]);
  recordTombstone('study_tracks', id);
}

export async function getWeeklyStudyHours(
  db: SqlExecutor,
  referenceDateISO: string,
): Promise<number> {
  const weekStart = startOfWeekISO(referenceDateISO);
  const weekEnd = addDaysISO(weekStart, 6);
  const rows = await db.select<{ total_min: number }>(
    'SELECT COALESCE(SUM(duration_minutes), 0) as total_min FROM study_sessions WHERE date >= ? AND date <= ?',
    [weekStart, weekEnd],
  );
  return round2((rows[0]?.total_min ?? 0) / 60);
}

export async function listJobApplications(db: SqlExecutor): Promise<JobApplication[]> {
  return db.select<JobApplication>(
    'SELECT * FROM job_applications ORDER BY applied_date DESC, created_at DESC',
  );
}

export async function createJobApplication(
  db: SqlExecutor,
  input: {
    company: string;
    role: string;
    link?: string;
    applied_date: string;
    status?: JobApplicationStatus;
    salary_info?: string;
    next_step?: string;
    notes?: string;
  },
): Promise<JobApplication> {
  if (!input.company.trim() || !input.role.trim()) {
    throw new Error('Informe empresa e cargo.');
  }
  const now = new Date().toISOString();
  const id = createId('job');
  await db.execute(
    `INSERT INTO job_applications (
      id, company, role, link, applied_date, status, salary_info, next_step, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.company.trim(),
      input.role.trim(),
      input.link?.trim() ?? '',
      input.applied_date,
      input.status ?? 'applied',
      input.salary_info?.trim() ?? '',
      input.next_step?.trim() ?? '',
      input.notes ?? '',
      now,
      now,
    ],
  );
  const rows = await db.select<JobApplication>('SELECT * FROM job_applications WHERE id = ?', [id]);
  return rows[0];
}

export async function updateJobApplicationStatus(
  db: SqlExecutor,
  id: string,
  status: JobApplicationStatus,
  nextStep?: string,
): Promise<void> {
  const now = new Date().toISOString();
  if (typeof nextStep === 'string') {
    await db.execute(
      'UPDATE job_applications SET status = ?, next_step = ?, updated_at = ? WHERE id = ?',
      [status, nextStep, now, id],
    );
  } else {
    await db.execute(
      'UPDATE job_applications SET status = ?, updated_at = ? WHERE id = ?',
      [status, now, id],
    );
  }
}

export async function deleteJobApplication(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM job_applications WHERE id = ?', [id]);
  recordTombstone('job_applications', id);
}
