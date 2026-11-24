import type { SqlExecutor } from '../db/types';
import { createIdeaSchema } from '../services/validation';
import type { IdeaItem, IdeaStatus, WeeklyReview } from '../types/domain';
import { addDaysISO, createId, round2, startOfWeekISO } from '../utils/format';
import { calculateWorkSessionMetrics } from '../services/calculations';
import type { WorkSession } from '../types/domain';

export async function listIdeas(db: SqlExecutor): Promise<IdeaItem[]> {
  return db.select<IdeaItem>(
    'SELECT * FROM ideas ORDER BY (impact * 2 - effort) DESC, created_at DESC',
  );
}

export async function createIdea(
  db: SqlExecutor,
  rawInput: {
    title: string;
    description?: string;
    tags?: string;
    status?: IdeaStatus;
    impact?: number;
    effort?: number;
  },
): Promise<IdeaItem> {
  const input = createIdeaSchema.parse(rawInput);
  const now = new Date().toISOString();
  const id = createId('idea');
  await db.execute(
    `INSERT INTO ideas (id, title, description, tags, status, impact, effort, checklist_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
    [
      id,
      input.title,
      input.description,
      input.tags,
      input.status,
      input.impact,
      input.effort,
      now,
      now,
    ],
  );
  const rows = await db.select<IdeaItem>('SELECT * FROM ideas WHERE id = ?', [id]);
  return rows[0];
}

export async function updateIdeaStatus(
  db: SqlExecutor,
  id: string,
  status: IdeaStatus,
): Promise<void> {
  await db.execute('UPDATE ideas SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    new Date().toISOString(),
    id,
  ]);
}

export async function deleteIdea(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM ideas WHERE id = ?', [id]);
}

export async function listWeeklyReviews(db: SqlExecutor): Promise<WeeklyReview[]> {
  return db.select<WeeklyReview>('SELECT * FROM weekly_reviews ORDER BY week_start DESC');
}

export interface ComputedWeeklyFacts {
  weekStart: string;
  weekEnd: string;
  grossEarned: number;
  netLeft: number;
  workHours: number;
  workoutsCount: number;
  studyHours: number;
  applicationsCount: number;
}

export async function computeWeeklyFacts(
  db: SqlExecutor,
  referenceDateISO: string,
): Promise<ComputedWeeklyFacts> {
  const weekStart = startOfWeekISO(referenceDateISO);
  const weekEnd = addDaysISO(weekStart, 6);

  const [workSessions, txRows, workoutRows, studyRows, appRows] = await Promise.all([
    db.select<WorkSession>(
      'SELECT * FROM work_sessions WHERE date >= ? AND date <= ?',
      [weekStart, weekEnd],
    ),
    db.select<{ type: string; amount: number }>(
      `SELECT type, amount FROM transactions
       WHERE status = 'realized' AND date >= ? AND date <= ?`,
      [weekStart, weekEnd],
    ),
    db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM habit_logs hl
       JOIN habits h ON h.id = hl.habit_id
       WHERE hl.completed = 1 AND h.category IN ('academia', 'corrida')
         AND hl.date >= ? AND hl.date <= ?`,
      [weekStart, weekEnd],
    ),
    db.select<{ total_min: number }>(
      'SELECT COALESCE(SUM(duration_minutes), 0) as total_min FROM study_sessions WHERE date >= ? AND date <= ?',
      [weekStart, weekEnd],
    ),
    db.select<{ count: number }>(
      'SELECT COUNT(*) as count FROM job_applications WHERE applied_date >= ? AND applied_date <= ?',
      [weekStart, weekEnd],
    ),
  ]);

  let appGross = 0;
  let appNet = 0;
  let workHours = 0;
  for (const s of workSessions) {
    const m = calculateWorkSessionMetrics(s);
    appGross += m.gross;
    appNet += m.operationalNet;
    workHours += m.durationHours;
  }

  let txIncome = 0;
  let txExpense = 0;
  for (const tx of txRows) {
    if (tx.type === 'income') txIncome += tx.amount;
    if (tx.type === 'expense') txExpense += tx.amount;
  }

  return {
    weekStart,
    weekEnd,
    grossEarned: round2(Math.max(appGross, txIncome)),
    netLeft: round2(txIncome > 0 || txExpense > 0 ? txIncome - txExpense : appNet),
    workHours: round2(workHours),
    workoutsCount: workoutRows[0]?.count ?? 0,
    studyHours: round2((studyRows[0]?.total_min ?? 0) / 60),
    applicationsCount: appRows[0]?.count ?? 0,
  };
}

export async function saveWeeklyReview(
  db: SqlExecutor,
  input: {
    week_start: string;
    gross_earned: number;
    net_left: number;
    work_hours: number;
    workouts_count: number;
    study_hours: number;
    applications_count: number;
    family_notes: string;
    lessons_learned: string;
    next_week_focus: string;
  },
): Promise<WeeklyReview> {
  const now = new Date().toISOString();
  const existing = await db.select<WeeklyReview>(
    'SELECT * FROM weekly_reviews WHERE week_start = ?',
    [input.week_start],
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE weekly_reviews
       SET gross_earned = ?, net_left = ?, work_hours = ?, workouts_count = ?,
           study_hours = ?, applications_count = ?, family_notes = ?,
           lessons_learned = ?, next_week_focus = ?, updated_at = ?
       WHERE week_start = ?`,
      [
        round2(input.gross_earned),
        round2(input.net_left),
        round2(input.work_hours),
        input.workouts_count,
        round2(input.study_hours),
        input.applications_count,
        input.family_notes,
        input.lessons_learned,
        input.next_week_focus,
        now,
        input.week_start,
      ],
    );
  } else {
    const id = createId('rev');
    await db.execute(
      `INSERT INTO weekly_reviews (
        id, week_start, gross_earned, net_left, work_hours, workouts_count,
        study_hours, applications_count, family_notes, lessons_learned, next_week_focus,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.week_start,
        round2(input.gross_earned),
        round2(input.net_left),
        round2(input.work_hours),
        input.workouts_count,
        round2(input.study_hours),
        input.applications_count,
        input.family_notes,
        input.lessons_learned,
        input.next_week_focus,
        now,
        now,
      ],
    );
  }

  const rows = await db.select<WeeklyReview>(
    'SELECT * FROM weekly_reviews WHERE week_start = ?',
    [input.week_start],
  );
  return rows[0];
}
