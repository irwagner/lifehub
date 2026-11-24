import type { SqlExecutor } from '../db/types';
import { isChildWeekend } from '../services/recurrence';
import {
  buildWeekEventsFromTemplate,
  type ScheduleTemplateId,
} from '../services/scheduleTemplates';
import { createCalendarEventSchema, createTaskSchema } from '../services/validation';
import {
  EVENT_CATEGORY_META,
  type CalendarEvent,
  type EventCategory,
  type Settings,
  type TaskItem,
  type TaskPriority,
  type TaskStatus,
} from '../types/domain';
import { addDaysISO, createId, startOfWeekISO } from '../utils/format';

export async function listCalendarEvents(
  db: SqlExecutor,
  range?: { startISO?: string; endISO?: string },
): Promise<CalendarEvent[]> {
  const clauses: string[] = [];
  const params: string[] = [];

  if (range?.startISO) {
    clauses.push('end_at >= ?');
    params.push(range.startISO);
  }
  if (range?.endISO) {
    clauses.push('start_at <= ?');
    params.push(range.endISO);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.select<CalendarEvent>(
    `SELECT * FROM calendar_events ${where} ORDER BY start_at ASC`,
    params,
  );
}

export async function createCalendarEvent(
  db: SqlExecutor,
  rawInput: {
    title: string;
    category: EventCategory;
    start_at: string;
    end_at: string;
    all_day?: number;
    color?: string;
    location?: string;
    notes?: string;
    source_template?: string | null;
    recurrence_rule?: string | null;
  },
): Promise<CalendarEvent> {
  const input = createCalendarEventSchema.parse(rawInput);
  const now = new Date().toISOString();
  const id = createId('evt');
  const color = input.color || EVENT_CATEGORY_META[input.category].color;

  await db.execute(
    `INSERT INTO calendar_events (
      id, title, category, start_at, end_at, all_day, color,
      location, notes, source_template, recurrence_rule, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.category,
      input.start_at,
      input.end_at,
      input.all_day,
      color,
      input.location,
      input.notes,
      input.source_template ?? null,
      input.recurrence_rule ?? null,
      now,
      now,
    ],
  );

  const rows = await db.select<CalendarEvent>('SELECT * FROM calendar_events WHERE id = ?', [id]);
  return rows[0];
}

export async function updateCalendarEventTiming(
  db: SqlExecutor,
  id: string,
  start_at: string,
  end_at: string,
  all_day?: number,
): Promise<void> {
  if (end_at < start_at) {
    throw new Error('Hora final não pode ser anterior à hora inicial.');
  }
  const now = new Date().toISOString();
  if (typeof all_day === 'number') {
    await db.execute(
      'UPDATE calendar_events SET start_at = ?, end_at = ?, all_day = ?, updated_at = ? WHERE id = ?',
      [start_at, end_at, all_day, now, id],
    );
  } else {
    await db.execute(
      'UPDATE calendar_events SET start_at = ?, end_at = ?, updated_at = ? WHERE id = ?',
      [start_at, end_at, now, id],
    );
  }
}

export async function updateCalendarEvent(
  db: SqlExecutor,
  id: string,
  rawInput: {
    title: string;
    category: EventCategory;
    start_at: string;
    end_at: string;
    all_day?: number;
    location?: string;
    notes?: string;
  },
): Promise<CalendarEvent> {
  const input = createCalendarEventSchema.parse(rawInput);
  const now = new Date().toISOString();
  const color = EVENT_CATEGORY_META[input.category].color;

  await db.execute(
    `UPDATE calendar_events
     SET title = ?, category = ?, start_at = ?, end_at = ?, all_day = ?, color = ?, location = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.title,
      input.category,
      input.start_at,
      input.end_at,
      input.all_day,
      color,
      input.location,
      input.notes,
      now,
      id,
    ],
  );

  const rows = await db.select<CalendarEvent>('SELECT * FROM calendar_events WHERE id = ?', [id]);
  return rows[0];
}

export async function createRecurringWeeklyEvents(
  db: SqlExecutor,
  rawInput: {
    title: string;
    category: EventCategory;
    date: string;
    start_time: string;
    end_time: string;
    weeks: number;
    location?: string;
    notes?: string;
    skipChildWeekends?: boolean;
  },
  settings?: Settings,
): Promise<{ created: CalendarEvent[]; skippedChildWeekends: number }> {
  const weeks = Math.min(26, Math.max(1, Math.round(rawInput.weeks)));
  const groupRule = weeks > 1 ? `WEEKLY:${weeks}` : null;
  const created: CalendarEvent[] = [];
  let skippedChildWeekends = 0;

  for (let i = 0; i < weeks; i++) {
    const targetDate = addDaysISO(rawInput.date, i * 7);
    if (
      rawInput.skipChildWeekends &&
      rawInput.category === 'trabalho' &&
      settings &&
      isChildWeekend(targetDate, settings.child_weekend_mode, settings.child_weekend_anchor)
    ) {
      skippedChildWeekends++;
      continue;
    }

    const evt = await createCalendarEvent(db, {
      title: rawInput.title,
      category: rawInput.category,
      start_at: `${targetDate}T${rawInput.start_time}:00`,
      end_at: `${targetDate}T${rawInput.end_time}:00`,
      location: rawInput.location ?? '',
      notes: rawInput.notes ?? '',
      recurrence_rule: groupRule,
    });
    created.push(evt);
  }

  return { created, skippedChildWeekends };
}

export async function deleteCalendarEvent(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM calendar_events WHERE id = ?', [id]);
}

export async function applyScheduleTemplateToWeek(
  db: SqlExecutor,
  templateId: ScheduleTemplateId,
  referenceDateISO: string,
  settings: Settings,
  replaceTemplateEvents = true,
): Promise<CalendarEvent[]> {
  const monday = startOfWeekISO(referenceDateISO);
  const sundayEnd = `${addDaysISO(monday, 6)}T23:59:59`;
  const mondayStart = `${monday}T00:00:00`;

  const drafts = buildWeekEventsFromTemplate(
    templateId,
    referenceDateISO,
    settings.child_weekend_mode,
    settings.child_weekend_anchor,
  );
  const now = new Date().toISOString();
  const insertedIds: string[] = [];

  await db.transaction(async (tx) => {
    if (replaceTemplateEvents) {
      await tx.execute(
        `DELETE FROM calendar_events
         WHERE source_template IS NOT NULL
           AND start_at >= ?
           AND start_at <= ?`,
        [mondayStart, sundayEnd],
      );
    }

    for (const draft of drafts) {
      const id = createId('evt');
      insertedIds.push(id);
      await tx.execute(
        `INSERT INTO calendar_events (
          id, title, category, start_at, end_at, all_day, color,
          location, notes, source_template, recurrence_rule, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          id,
          draft.title,
          draft.category,
          draft.start_at,
          draft.end_at,
          draft.all_day,
          draft.color,
          draft.location,
          draft.notes,
          draft.source_template,
          now,
          now,
        ],
      );
    }
  });

  if (insertedIds.length === 0) return [];
  const placeholders = insertedIds.map(() => '?').join(', ');
  return db.select<CalendarEvent>(
    `SELECT * FROM calendar_events WHERE id IN (${placeholders}) ORDER BY start_at ASC`,
    insertedIds,
  );
}

export async function listTasks(
  db: SqlExecutor,
  status?: TaskStatus,
): Promise<TaskItem[]> {
  if (status) {
    return db.select<TaskItem>(
      `SELECT * FROM tasks
       WHERE status = ?
       ORDER BY
         CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
         COALESCE(due_date, '9999-12-31') ASC,
         created_at DESC`,
      [status],
    );
  }
  return db.select<TaskItem>(
    `SELECT * FROM tasks
     ORDER BY
       CASE status WHEN 'todo' THEN 0 ELSE 1 END ASC,
       CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
       COALESCE(due_date, '9999-12-31') ASC,
       created_at DESC`,
  );
}

export async function createTask(
  db: SqlExecutor,
  rawInput: {
    title: string;
    description?: string;
    due_date?: string | null;
    priority?: TaskPriority;
    category?: string;
  },
): Promise<TaskItem> {
  const input = createTaskSchema.parse(rawInput);
  const now = new Date().toISOString();
  const id = createId('tsk');

  await db.execute(
    `INSERT INTO tasks (
      id, title, description, due_date, priority, category, status, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'todo', NULL, ?, ?)`,
    [id, input.title, input.description, input.due_date ?? null, input.priority, input.category, now, now],
  );

  const rows = await db.select<TaskItem>('SELECT * FROM tasks WHERE id = ?', [id]);
  return rows[0];
}

export async function toggleTaskStatus(db: SqlExecutor, id: string): Promise<TaskItem | null> {
  const rows = await db.select<TaskItem>('SELECT * FROM tasks WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  const now = new Date().toISOString();
  const nextStatus: TaskStatus = rows[0].status === 'done' ? 'todo' : 'done';
  const completedAt = nextStatus === 'done' ? now : null;
  await db.execute(
    'UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
    [nextStatus, completedAt, now, id],
  );
  const updated = await db.select<TaskItem>('SELECT * FROM tasks WHERE id = ?', [id]);
  return updated[0] ?? null;
}

export async function deleteTask(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM tasks WHERE id = ?', [id]);
}

export async function updateTask(
  db: SqlExecutor,
  id: string,
  rawInput: {
    title: string;
    description?: string;
    due_date?: string | null;
    priority?: TaskPriority;
    category?: string;
  },
): Promise<TaskItem> {
  const input = createTaskSchema.parse(rawInput);
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE tasks
     SET title = ?, description = ?, due_date = ?, priority = ?, category = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.title,
      input.description,
      input.due_date ?? null,
      input.priority,
      input.category,
      now,
      id,
    ],
  );
  const rows = await db.select<TaskItem>('SELECT * FROM tasks WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error('Tarefa não encontrada.');
  return rows[0];
}
