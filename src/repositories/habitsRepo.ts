import type { SqlExecutor } from '../db/types';
import type { Habit, HabitCategory, HabitLog } from '../types/domain';
import { addDaysISO, createId, startOfWeekISO } from '../utils/format';

export interface HabitWithWeeklyProgress extends Habit {
  completedThisWeek: number;
  doneToday: boolean;
  totalMinutesThisWeek: number;
}

export async function listHabitsWithProgress(
  db: SqlExecutor,
  referenceDateISO: string,
): Promise<HabitWithWeeklyProgress[]> {
  const habits = await db.select<Habit>(
    'SELECT * FROM habits WHERE active = 1 ORDER BY created_at ASC',
  );
  const weekStart = startOfWeekISO(referenceDateISO);
  const weekEnd = addDaysISO(weekStart, 6);

  const logs = await db.select<HabitLog>(
    'SELECT * FROM habit_logs WHERE date >= ? AND date <= ? AND completed = 1',
    [weekStart, weekEnd],
  );

  return habits.map((h) => {
    const hLogs = logs.filter((l) => l.habit_id === h.id);
    const distinctDates = new Set(hLogs.map((l) => l.date));
    return {
      ...h,
      completedThisWeek: distinctDates.size,
      doneToday: distinctDates.has(referenceDateISO),
      totalMinutesThisWeek: hLogs.reduce((acc, l) => acc + l.duration_minutes, 0),
    };
  });
}

export async function listHabitLogs(db: SqlExecutor, limit = 30): Promise<HabitLog[]> {
  return db.select<HabitLog>(
    'SELECT * FROM habit_logs ORDER BY date DESC, created_at DESC LIMIT ?',
    [limit],
  );
}

export async function createHabit(
  db: SqlExecutor,
  input: { name: string; category: HabitCategory; weekly_target: number; unit?: string },
): Promise<Habit> {
  if (!input.name.trim()) throw new Error('Informe o nome do hábito.');
  const now = new Date().toISOString();
  const id = createId('hab');
  await db.execute(
    `INSERT INTO habits (id, name, category, weekly_target, unit, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [id, input.name.trim(), input.category, Math.max(1, input.weekly_target), input.unit || 'sessão', now],
  );
  const rows = await db.select<Habit>('SELECT * FROM habits WHERE id = ?', [id]);
  return rows[0];
}

export async function logHabitSession(
  db: SqlExecutor,
  input: { habit_id: string; date: string; duration_minutes?: number; notes?: string },
): Promise<HabitLog> {
  const now = new Date().toISOString();
  const id = createId('hlog');
  await db.execute(
    `INSERT INTO habit_logs (id, habit_id, date, completed, duration_minutes, notes, created_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
    [id, input.habit_id, input.date, Math.max(0, input.duration_minutes ?? 0), input.notes ?? '', now],
  );
  const rows = await db.select<HabitLog>('SELECT * FROM habit_logs WHERE id = ?', [id]);
  return rows[0];
}

export async function deleteHabitLog(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM habit_logs WHERE id = ?', [id]);
}
