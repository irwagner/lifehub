import type { SqlExecutor } from '../db/types';
import type { NavSection } from '../context/AppContext';
import { formatBRL, formatDateBR } from '../utils/format';

export interface GlobalSearchHit {
  id: string;
  section: NavSection;
  sectionLabel: string;
  title: string;
  subtitle: string;
}

export async function searchAllModules(
  db: SqlExecutor,
  rawQuery: string,
  limitPerType = 5,
): Promise<GlobalSearchHit[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const pattern = `%${q}%`;

  const [txs, tasks, events, ideas, projects, jobs] = await Promise.all([
    db.select<{ id: string; description: string; amount: number; date: string; type: string }>(
      `SELECT id, description, amount, date, type FROM transactions
       WHERE description LIKE ? OR notes LIKE ?
       ORDER BY date DESC LIMIT ?`,
      [pattern, pattern, limitPerType],
    ),
    db.select<{ id: string; title: string; due_date: string | null; status: string }>(
      `SELECT id, title, due_date, status FROM tasks
       WHERE title LIKE ? OR description LIKE ?
       ORDER BY created_at DESC LIMIT ?`,
      [pattern, pattern, limitPerType],
    ),
    db.select<{ id: string; title: string; start_at: string; category: string }>(
      `SELECT id, title, start_at, category FROM calendar_events
       WHERE title LIKE ? OR notes LIKE ? OR location LIKE ?
       ORDER BY start_at DESC LIMIT ?`,
      [pattern, pattern, pattern, limitPerType],
    ),
    db.select<{ id: string; title: string; status: string; tags: string }>(
      `SELECT id, title, status, tags FROM ideas
       WHERE title LIKE ? OR description LIKE ? OR tags LIKE ?
       ORDER BY created_at DESC LIMIT ?`,
      [pattern, pattern, pattern, limitPerType],
    ),
    db.select<{ id: string; title: string; status: string; deliverable: string }>(
      `SELECT id, title, status, deliverable FROM projects
       WHERE title LIKE ? OR deliverable LIKE ? OR notes LIKE ?
       ORDER BY created_at DESC LIMIT ?`,
      [pattern, pattern, pattern, limitPerType],
    ),
    db.select<{ id: string; company: string; role: string; status: string }>(
      `SELECT id, company, role, status FROM job_applications
       WHERE company LIKE ? OR role LIKE ? OR notes LIKE ?
       ORDER BY applied_date DESC LIMIT ?`,
      [pattern, pattern, pattern, limitPerType],
    ),
  ]);

  const hits: GlobalSearchHit[] = [];

  for (const t of txs) {
    hits.push({
      id: `tx_${t.id}`,
      section: 'finance',
      sectionLabel: 'Financeiro',
      title: t.description,
      subtitle: `${formatDateBR(t.date)} · ${t.type === 'expense' ? '-' : '+'}${formatBRL(t.amount)}`,
    });
  }
  for (const tk of tasks) {
    hits.push({
      id: `tk_${tk.id}`,
      section: 'calendar',
      sectionLabel: 'Tarefas',
      title: tk.title,
      subtitle: `${tk.status === 'done' ? 'Concluída' : 'Pendente'}${tk.due_date ? ` · ${formatDateBR(tk.due_date)}` : ''}`,
    });
  }
  for (const ev of events) {
    hits.push({
      id: `ev_${ev.id}`,
      section: 'calendar',
      sectionLabel: 'Calendário',
      title: ev.title,
      subtitle: `${formatDateBR(ev.start_at)} · ${ev.category}`,
    });
  }
  for (const id of ideas) {
    hits.push({
      id: `id_${id.id}`,
      section: 'ideas',
      sectionLabel: 'Ideias',
      title: id.title,
      subtitle: `Status: ${id.status}${id.tags ? ` · ${id.tags}` : ''}`,
    });
  }
  for (const pr of projects) {
    hits.push({
      id: `pr_${pr.id}`,
      section: 'career',
      sectionLabel: 'Portfólio TI',
      title: pr.title,
      subtitle: pr.deliverable || `Status: ${pr.status}`,
    });
  }
  for (const jb of jobs) {
    hits.push({
      id: `jb_${jb.id}`,
      section: 'career',
      sectionLabel: 'Vagas TI',
      title: `${jb.role} — ${jb.company}`,
      subtitle: `Etapa: ${jb.status}`,
    });
  }

  return hits;
}
