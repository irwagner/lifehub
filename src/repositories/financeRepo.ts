import type { SqlExecutor } from '../db/types';
import { generateInstallmentPlan } from '../services/calculations';
import type { ParsedStatementItem } from '../services/importParser';
import { createTransactionSchema } from '../services/validation';
import type {
  Account,
  AccountType,
  Category,
  CategoryBudget,
  FinancialGoal,
  RecurringRule,
  Transaction,
  TransactionSourceType,
  TransactionStatus,
  TransactionType,
} from '../types/domain';
import { addMonthsISO, createId, round2 } from '../utils/format';

export interface AccountWithBalance extends Account {
  current_balance: number;
}

export interface MonthlyFinanceSummary {
  month: string;
  realizedIncome: number;
  realizedExpense: number;
  realizedNet: number;
  plannedIncome: number;
  plannedExpense: number;
  incomeBySource: Record<string, number>;
}

export async function listAccounts(db: SqlExecutor): Promise<AccountWithBalance[]> {
  const accounts = await db.select<Account>(
    'SELECT * FROM accounts WHERE active = 1 ORDER BY created_at ASC',
  );
  const realizedTxs = await db.select<
    Pick<Transaction, 'account_id' | 'destination_account_id' | 'type' | 'amount'>
  >(
    `SELECT account_id, destination_account_id, type, amount
     FROM transactions
     WHERE status = 'realized'`,
  );

  const deltaMap = new Map<string, number>();
  for (const tx of realizedTxs) {
    if (tx.type === 'income') {
      deltaMap.set(tx.account_id, (deltaMap.get(tx.account_id) ?? 0) + tx.amount);
    } else if (tx.type === 'expense') {
      deltaMap.set(tx.account_id, (deltaMap.get(tx.account_id) ?? 0) - tx.amount);
    } else if (tx.type === 'transfer') {
      deltaMap.set(tx.account_id, (deltaMap.get(tx.account_id) ?? 0) - tx.amount);
      if (tx.destination_account_id) {
        deltaMap.set(
          tx.destination_account_id,
          (deltaMap.get(tx.destination_account_id) ?? 0) + tx.amount,
        );
      }
    }
  }

  return accounts.map((acc) => ({
    ...acc,
    current_balance: round2(acc.initial_balance + (deltaMap.get(acc.id) ?? 0)),
  }));
}

export async function createAccount(
  db: SqlExecutor,
  input: { name: string; type: AccountType; initial_balance: number },
): Promise<Account> {
  const name = input.name.trim();
  if (!name) throw new Error('Informe o nome da conta.');
  const now = new Date().toISOString();
  const id = createId('acc');
  await db.execute(
    `INSERT INTO accounts (id, name, type, initial_balance, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [id, name, input.type, round2(input.initial_balance), now, now],
  );
  const rows = await db.select<Account>('SELECT * FROM accounts WHERE id = ?', [id]);
  return rows[0];
}

export async function listCategories(db: SqlExecutor): Promise<Category[]> {
  return db.select<Category>('SELECT * FROM categories ORDER BY kind ASC, name ASC');
}

export async function createCategory(
  db: SqlExecutor,
  input: { name: string; kind: 'income' | 'expense' | 'both'; color: string },
): Promise<Category> {
  const name = input.name.trim();
  if (!name) throw new Error('Informe o nome da categoria.');
  const now = new Date().toISOString();
  const id = createId('cat');
  await db.execute(
    `INSERT INTO categories (id, name, kind, color, is_default, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [id, name, input.kind, input.color || '#6366f1', now],
  );
  const rows = await db.select<Category>('SELECT * FROM categories WHERE id = ?', [id]);
  return rows[0];
}

export async function deleteCategory(db: SqlExecutor, id: string): Promise<void> {
  const rows = await db.select<Category>('SELECT is_default FROM categories WHERE id = ?', [id]);
  if (rows.length === 0) return;
  if (rows[0].is_default === 1) {
    throw new Error('Categorias padrão do sistema não podem ser excluídas.');
  }
  await db.execute('DELETE FROM categories WHERE id = ?', [id]);
}

export interface TransactionFilters {
  month?: string; // YYYY-MM
  type?: TransactionType;
  status?: TransactionStatus;
  accountId?: string;
}

export async function listTransactions(
  db: SqlExecutor,
  filters: TransactionFilters = {},
): Promise<Transaction[]> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.month) {
    clauses.push('substr(date, 1, 7) = ?');
    params.push(filters.month);
  }
  if (filters.type) {
    clauses.push('type = ?');
    params.push(filters.type);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.accountId) {
    clauses.push('(account_id = ? OR destination_account_id = ?)');
    params.push(filters.accountId, filters.accountId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.select<Transaction>(
    `SELECT * FROM transactions ${where} ORDER BY date DESC, created_at DESC`,
    params,
  );
}

export async function createTransaction(
  db: SqlExecutor,
  rawInput: {
    account_id: string;
    destination_account_id?: string | null;
    category_id?: string | null;
    type: TransactionType;
    source_type?: 'salario' | 'aplicativos' | 'servicos_ti' | 'outros';
    description: string;
    amount: number;
    date: string;
    due_date?: string | null;
    status?: TransactionStatus;
    installments?: number;
    notes?: string;
  },
): Promise<Transaction[]> {
  const input = createTransactionSchema.parse(rawInput);
  const now = new Date().toISOString();
  const groupId = input.installments > 1 ? createId('inst') : null;

  const plan = generateInstallmentPlan({
    totalAmount: input.amount,
    installmentsCount: input.installments,
    firstDateISO: input.date,
    description: input.description,
  });

  const createdIds: string[] = [];

  await db.transaction(async (tx) => {
    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      const id = createId('tx');
      createdIds.push(id);
      // Future installments default to 'planned' unless first installment was marked realized
      const rowStatus: TransactionStatus =
        i === 0 ? input.status : 'planned';

      await tx.execute(
        `INSERT INTO transactions (
          id, account_id, destination_account_id, category_id, type, source_type,
          description, amount, date, due_date, status,
          installment_group_id, installment_number, installment_total,
          notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.account_id,
          input.type === 'transfer' ? (input.destination_account_id ?? null) : null,
          input.type === 'transfer' ? null : (input.category_id ?? null),
          input.type,
          input.source_type,
          item.description,
          item.amount,
          item.date,
          i === 0 ? (input.due_date ?? item.due_date) : item.due_date,
          rowStatus,
          groupId,
          input.installments > 1 ? item.installment_number : null,
          input.installments > 1 ? item.installment_total : null,
          input.notes,
          now,
          now,
        ],
      );
    }
  });

  const placeholders = createdIds.map(() => '?').join(', ');
  return db.select<Transaction>(
    `SELECT * FROM transactions WHERE id IN (${placeholders}) ORDER BY date ASC`,
    createdIds,
  );
}

export async function toggleTransactionStatus(
  db: SqlExecutor,
  id: string,
): Promise<void> {
  const rows = await db.select<Transaction>('SELECT status FROM transactions WHERE id = ?', [id]);
  if (rows.length === 0) return;
  const nextStatus: TransactionStatus = rows[0].status === 'realized' ? 'planned' : 'realized';
  await db.execute(
    'UPDATE transactions SET status = ?, updated_at = ? WHERE id = ?',
    [nextStatus, new Date().toISOString(), id],
  );
}

export async function deleteTransaction(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM transactions WHERE id = ?', [id]);
}

export async function updateTransaction(
  db: SqlExecutor,
  id: string,
  input: {
    account_id: string;
    destination_account_id?: string | null;
    category_id?: string | null;
    type: TransactionType;
    source_type: TransactionSourceType;
    description: string;
    amount: number;
    date: string;
    due_date?: string | null;
    status: TransactionStatus;
    notes?: string;
  },
): Promise<Transaction> {
  const parsed = createTransactionSchema.parse({
    ...input,
    installments: 1,
    notes: input.notes ?? '',
  });
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE transactions
     SET account_id = ?, destination_account_id = ?, category_id = ?, type = ?,
         source_type = ?, description = ?, amount = ?, date = ?, due_date = ?,
         status = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      parsed.account_id,
      parsed.type === 'transfer' ? (parsed.destination_account_id ?? null) : null,
      parsed.type === 'transfer' ? null : (parsed.category_id ?? null),
      parsed.type,
      parsed.source_type,
      parsed.description,
      round2(parsed.amount),
      parsed.date,
      parsed.due_date ?? null,
      parsed.status,
      parsed.notes,
      now,
      id,
    ],
  );
  const rows = await db.select<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error('Transação não encontrada.');
  return rows[0];
}

export async function getMonthlyFinanceSummary(
  db: SqlExecutor,
  month: string,
): Promise<MonthlyFinanceSummary> {
  const txs = await listTransactions(db, { month });
  let realizedIncome = 0;
  let realizedExpense = 0;
  let plannedIncome = 0;
  let plannedExpense = 0;
  const incomeBySource: Record<string, number> = {
    salario: 0,
    aplicativos: 0,
    servicos_ti: 0,
    outros: 0,
  };

  for (const tx of txs) {
    if (tx.type === 'income') {
      if (tx.status === 'realized') {
        realizedIncome += tx.amount;
        incomeBySource[tx.source_type] = round2((incomeBySource[tx.source_type] ?? 0) + tx.amount);
      } else {
        plannedIncome += tx.amount;
      }
    } else if (tx.type === 'expense') {
      if (tx.status === 'realized') {
        realizedExpense += tx.amount;
      } else {
        plannedExpense += tx.amount;
      }
    }
  }

  return {
    month,
    realizedIncome: round2(realizedIncome),
    realizedExpense: round2(realizedExpense),
    realizedNet: round2(realizedIncome - realizedExpense),
    plannedIncome: round2(plannedIncome),
    plannedExpense: round2(plannedExpense),
    incomeBySource,
  };
}

export async function listUpcomingBills(
  db: SqlExecutor,
  fromDateISO: string,
  limit = 6,
): Promise<Transaction[]> {
  return db.select<Transaction>(
    `SELECT * FROM transactions
     WHERE type = 'expense' AND status = 'planned' AND COALESCE(due_date, date) >= ?
     ORDER BY COALESCE(due_date, date) ASC
     LIMIT ?`,
    [fromDateISO, limit],
  );
}

export async function listGoals(db: SqlExecutor): Promise<FinancialGoal[]> {
  return db.select<FinancialGoal>('SELECT * FROM goals ORDER BY created_at DESC');
}

export async function createGoal(
  db: SqlExecutor,
  input: {
    name: string;
    target_amount: number;
    current_amount?: number;
    target_date?: string | null;
    notes?: string;
  },
): Promise<FinancialGoal> {
  const name = input.name.trim();
  if (!name) throw new Error('Informe o nome da meta.');
  if (!(input.target_amount > 0)) throw new Error('Valor alvo deve ser maior que zero.');
  const now = new Date().toISOString();
  const id = createId('goal');
  await db.execute(
    `INSERT INTO goals (id, name, target_amount, current_amount, target_date, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      round2(input.target_amount),
      round2(input.current_amount ?? 0),
      input.target_date ?? null,
      input.notes ?? '',
      now,
      now,
    ],
  );
  const rows = await db.select<FinancialGoal>('SELECT * FROM goals WHERE id = ?', [id]);
  return rows[0];
}

export async function addGoalContribution(
  db: SqlExecutor,
  id: string,
  deltaAmount: number,
): Promise<void> {
  if (!Number.isFinite(deltaAmount) || deltaAmount === 0) return;
  await db.execute(
    `UPDATE goals
     SET current_amount = MAX(0, ROUND(current_amount + ?, 2)), updated_at = ?
     WHERE id = ?`,
    [deltaAmount, new Date().toISOString(), id],
  );
}

export async function deleteGoal(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM goals WHERE id = ?', [id]);
}

export interface StatementImportSummary {
  importedCount: number;
  duplicateCount: number;
}

export async function findExistingExternalHashes(
  db: SqlExecutor,
  hashes: string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const unique = Array.from(new Set(hashes));
  const placeholders = unique.map(() => '?').join(', ');
  const rows = await db.select<{ external_hash: string }>(
    `SELECT external_hash FROM transactions WHERE external_hash IN (${placeholders})`,
    unique,
  );
  return new Set(rows.map((r) => r.external_hash));
}

export async function importStatementItems(
  db: SqlExecutor,
  accountId: string,
  items: ParsedStatementItem[],
): Promise<StatementImportSummary> {
  if (items.length === 0) {
    return { importedCount: 0, duplicateCount: 0 };
  }

  const existingHashes = await findExistingExternalHashes(
    db,
    items.map((i) => i.external_hash),
  );
  const seenInBatch = new Set<string>();
  const now = new Date().toISOString();

  let importedCount = 0;
  let duplicateCount = 0;

  await db.transaction(async (tx) => {
    for (const item of items) {
      if (existingHashes.has(item.external_hash) || seenInBatch.has(item.external_hash)) {
        duplicateCount++;
        continue;
      }
      seenInBatch.add(item.external_hash);
      const id = createId('tx');
      const defaultCategory = item.type === 'income' ? 'cat_outras_receitas' : 'cat_outros';

      await tx.execute(
        `INSERT INTO transactions (
          id, account_id, destination_account_id, category_id, type, source_type,
          description, amount, date, due_date, status,
          installment_group_id, installment_number, installment_total, external_hash,
          notes, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, 'outros', ?, ?, ?, NULL, 'realized', NULL, NULL, NULL, ?, ?, ?, ?)`,
        [
          id,
          accountId,
          defaultCategory,
          item.type,
          item.description,
          round2(item.amount),
          item.date,
          item.external_hash,
          item.fitid ? `Importado (FITID: ${item.fitid})` : 'Importado de extrato CSV/OFX',
          now,
          now,
        ],
      );
      importedCount++;
    }
  });

  return { importedCount, duplicateCount };
}

export async function listRecurringRules(db: SqlExecutor): Promise<RecurringRule[]> {
  return db.select<RecurringRule>(
    'SELECT * FROM recurring_rules WHERE active = 1 ORDER BY day_of_month ASC, description ASC',
  );
}

export async function createRecurringRule(
  db: SqlExecutor,
  input: {
    account_id: string;
    category_id?: string | null;
    type: 'income' | 'expense';
    source_type?: TransactionSourceType;
    description: string;
    amount: number;
    day_of_month: number;
    notes?: string;
  },
): Promise<RecurringRule> {
  if (!input.description.trim()) throw new Error('Informe a descrição da recorrência.');
  if (!(input.amount > 0)) throw new Error('Valor deve ser maior que zero.');
  const day = Math.min(31, Math.max(1, Math.round(input.day_of_month)));
  const now = new Date().toISOString();
  const id = createId('rec');

  await db.execute(
    `INSERT INTO recurring_rules (
      id, account_id, category_id, type, source_type, description, amount,
      day_of_month, active, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      input.account_id,
      input.category_id ?? null,
      input.type,
      input.source_type ?? 'outros',
      input.description.trim(),
      round2(input.amount),
      day,
      input.notes ?? '',
      now,
      now,
    ],
  );

  const rows = await db.select<RecurringRule>('SELECT * FROM recurring_rules WHERE id = ?', [id]);
  return rows[0];
}

export async function deleteRecurringRule(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM recurring_rules WHERE id = ?', [id]);
}

/**
 * Generates planned monthly transactions from active recurring rules.
 * Idempotent: uses external_hash `rec_<ruleId>_<YYYY-MM>` so repeated runs never duplicate entries.
 */
export async function generateMonthlyRecurringTransactions(
  db: SqlExecutor,
  month: string,
): Promise<{ created: number; skipped: number }> {
  const rules = await listRecurringRules(db);
  if (rules.length === 0) return { created: 0, skipped: 0 };

  const [yStr, mStr] = month.split('-');
  const year = Number(yStr);
  const monthNum = Number(mStr);
  const lastDay = new Date(year, monthNum, 0).getDate();

  const hashes = rules.map((r) => `rec_${r.id}_${month}`);
  const existing = await findExistingExternalHashes(db, hashes);

  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    for (const rule of rules) {
      const hash = `rec_${rule.id}_${month}`;
      if (existing.has(hash)) {
        skipped++;
        continue;
      }
      const clampedDay = String(Math.min(rule.day_of_month, lastDay)).padStart(2, '0');
      const dateISO = `${month}-${clampedDay}`;
      const id = createId('tx');

      await tx.execute(
        `INSERT INTO transactions (
          id, account_id, destination_account_id, category_id, type, source_type,
          description, amount, date, due_date, status,
          installment_group_id, installment_number, installment_total, external_hash,
          notes, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'planned', NULL, NULL, NULL, ?, ?, ?, ?)`,
        [
          id,
          rule.account_id,
          rule.category_id,
          rule.type,
          rule.source_type,
          rule.description,
          round2(rule.amount),
          dateISO,
          dateISO,
          hash,
          rule.notes || 'Gerado por regra recorrente mensal',
          now,
          now,
        ],
      );
      created++;
    }
  });

  return { created, skipped };
}

export interface BudgetWithUsage extends CategoryBudget {
  spent_amount: number;
  remaining_amount: number;
  usage_pct: number;
}

export async function listBudgetsForMonth(
  db: SqlExecutor,
  month: string,
): Promise<BudgetWithUsage[]> {
  const budgets = await db.select<CategoryBudget>(
    'SELECT * FROM budgets WHERE month = ? ORDER BY created_at ASC',
    [month],
  );
  const spentRows = await db.select<{ category_id: string; total: number }>(
    `SELECT category_id, COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE type = 'expense' AND status = 'realized' AND substr(date, 1, 7) = ? AND category_id IS NOT NULL
     GROUP BY category_id`,
    [month],
  );
  const spentMap = new Map(spentRows.map((r) => [r.category_id, round2(r.total)]));

  return budgets.map((b) => {
    const spent = spentMap.get(b.category_id) ?? 0;
    const remaining = round2(b.limit_amount - spent);
    const usagePct = b.limit_amount > 0 ? round2((spent / b.limit_amount) * 100) : 0;
    return {
      ...b,
      spent_amount: spent,
      remaining_amount: remaining,
      usage_pct: usagePct,
    };
  });
}

export async function upsertCategoryBudget(
  db: SqlExecutor,
  month: string,
  categoryId: string,
  limitAmount: number,
): Promise<void> {
  if (!(limitAmount > 0)) throw new Error('Limite do orçamento deve ser maior que zero.');
  const now = new Date().toISOString();
  const existing = await db.select<{ id: string }>(
    'SELECT id FROM budgets WHERE month = ? AND category_id = ?',
    [month, categoryId],
  );

  if (existing.length > 0) {
    await db.execute(
      'UPDATE budgets SET limit_amount = ?, updated_at = ? WHERE id = ?',
      [round2(limitAmount), now, existing[0].id],
    );
  } else {
    const id = createId('bdg');
    await db.execute(
      `INSERT INTO budgets (id, month, category_id, limit_amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, month, categoryId, round2(limitAmount), now, now],
    );
  }
}

export async function deleteCategoryBudget(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM budgets WHERE id = ?', [id]);
}

export async function getMultiMonthComparison(
  db: SqlExecutor,
  referenceMonth: string,
  monthsCount = 6,
): Promise<Array<{ month: string; income: number; expense: number; net: number }>> {
  const results: Array<{ month: string; income: number; expense: number; net: number }> = [];
  const baseDate = `${referenceMonth}-01`;

  for (let i = monthsCount - 1; i >= 0; i--) {
    const m = addMonthsISO(baseDate, -i).slice(0, 7);
    const summary = await getMonthlyFinanceSummary(db, m);
    results.push({
      month: m,
      income: summary.realizedIncome,
      expense: summary.realizedExpense,
      net: summary.realizedNet,
    });
  }

  return results;
}
