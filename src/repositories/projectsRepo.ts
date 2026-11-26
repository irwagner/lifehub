import type { SqlExecutor } from '../db/types';
import { recordTombstone } from '../services/syncTombstones';
import type { ProjectCategory, ProjectItem, ProjectStatus, ProjectTask } from '../types/domain';
import { createId } from '../utils/format';

export interface ProjectWithTasks extends ProjectItem {
  tasks: ProjectTask[];
}

export async function listProjectsWithTasks(
  db: SqlExecutor,
  category?: ProjectCategory,
): Promise<ProjectWithTasks[]> {
  const projects = category
    ? await db.select<ProjectItem>(
        'SELECT * FROM projects WHERE category = ? ORDER BY created_at DESC',
        [category],
      )
    : await db.select<ProjectItem>('SELECT * FROM projects ORDER BY created_at DESC');

  const tasks = await db.select<ProjectTask>(
    'SELECT * FROM project_tasks ORDER BY done ASC, created_at ASC',
  );

  const byProject = new Map<string, ProjectTask[]>();
  for (const t of tasks) {
    const arr = byProject.get(t.project_id) ?? [];
    arr.push(t);
    byProject.set(t.project_id, arr);
  }

  return projects.map((p) => ({
    ...p,
    tasks: byProject.get(p.id) ?? [],
  }));
}

export async function createProject(
  db: SqlExecutor,
  input: {
    title: string;
    category?: ProjectCategory;
    status?: ProjectStatus;
    repo_url?: string;
    deliverable?: string;
    notes?: string;
    initialTasks?: string[];
  },
): Promise<ProjectWithTasks> {
  const title = input.title.trim();
  if (!title) throw new Error('Informe o título do projeto.');
  const now = new Date().toISOString();
  const id = createId('prj');

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO projects (id, title, category, status, repo_url, deliverable, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        input.category ?? 'portfolio_ti',
        input.status ?? 'active',
        input.repo_url?.trim() ?? '',
        input.deliverable?.trim() ?? '',
        input.notes ?? '',
        now,
        now,
      ],
    );

    for (const rawTask of input.initialTasks ?? []) {
      const taskTitle = rawTask.trim();
      if (!taskTitle) continue;
      await tx.execute(
        `INSERT INTO project_tasks (id, project_id, title, done, created_at)
         VALUES (?, ?, ?, 0, ?)`,
        [createId('ptk'), id, taskTitle, now],
      );
    }
  });

  const all = await listProjectsWithTasks(db);
  return all.find((p) => p.id === id)!;
}

export async function updateProjectStatus(
  db: SqlExecutor,
  id: string,
  status: ProjectStatus,
): Promise<void> {
  await db.execute('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    new Date().toISOString(),
    id,
  ]);
}

export async function deleteProject(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM projects WHERE id = ?', [id]);
  recordTombstone('projects', id);
}

export async function addProjectTask(
  db: SqlExecutor,
  projectId: string,
  title: string,
): Promise<ProjectTask> {
  const clean = title.trim();
  if (!clean) throw new Error('Informe o texto da etapa.');
  const now = new Date().toISOString();
  const id = createId('ptk');
  await db.execute(
    'INSERT INTO project_tasks (id, project_id, title, done, created_at) VALUES (?, ?, ?, 0, ?)',
    [id, projectId, clean, now],
  );
  const rows = await db.select<ProjectTask>('SELECT * FROM project_tasks WHERE id = ?', [id]);
  return rows[0];
}

export async function toggleProjectTask(db: SqlExecutor, taskId: string): Promise<void> {
  await db.execute(
    'UPDATE project_tasks SET done = CASE WHEN done = 1 THEN 0 ELSE 1 END WHERE id = ?',
    [taskId],
  );
}

export async function deleteProjectTask(db: SqlExecutor, taskId: string): Promise<void> {
  await db.execute('DELETE FROM project_tasks WHERE id = ?', [taskId]);
  recordTombstone('project_tasks', taskId);
}
