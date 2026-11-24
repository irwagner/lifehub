import type { SqlExecutor } from '../db/types';
import type { FamilyChecklistItem, FamilyPlan } from '../types/domain';
import { createId, round2 } from '../utils/format';

export async function listFamilyPlans(db: SqlExecutor): Promise<FamilyPlan[]> {
  return db.select<FamilyPlan>('SELECT * FROM family_plans ORDER BY weekend_start DESC');
}

export async function createFamilyPlan(
  db: SqlExecutor,
  input: {
    weekend_start: string;
    title: string;
    budget_amount?: number;
    checklist?: FamilyChecklistItem[];
    notes?: string;
  },
): Promise<FamilyPlan> {
  if (!input.title.trim()) throw new Error('Informe o plano de atividade.');
  const now = new Date().toISOString();
  const id = createId('fam');
  await db.execute(
    `INSERT INTO family_plans (id, weekend_start, title, budget_amount, checklist_json, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.weekend_start,
      input.title.trim(),
      round2(input.budget_amount ?? 0),
      JSON.stringify(input.checklist ?? []),
      input.notes ?? '',
      now,
      now,
    ],
  );
  const rows = await db.select<FamilyPlan>('SELECT * FROM family_plans WHERE id = ?', [id]);
  return rows[0];
}

export async function updateFamilyPlanChecklist(
  db: SqlExecutor,
  id: string,
  checklist: FamilyChecklistItem[],
): Promise<void> {
  await db.execute(
    'UPDATE family_plans SET checklist_json = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(checklist), new Date().toISOString(), id],
  );
}

export async function deleteFamilyPlan(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM family_plans WHERE id = ?', [id]);
}
