import type { SqlExecutor } from '../db/types';
import { generateInstallmentPlan } from '../services/calculations';
import { createTransactionSchema } from '../services/validation';
import type {
  Account,
  AccountType,
  Category,
  FinancialGoal,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/domain';
import { createId, round2 } from '../utils/format';

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
