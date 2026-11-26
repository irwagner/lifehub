import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileUp,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { FamilyFinanceTabPanel } from '../components/FamilyFinanceTabPanel';
import { GroupedBarChart } from '../components/GroupedBarChart';
import { InstallmentsTabPanel } from '../components/InstallmentsTabPanel';
import { Modal } from '../components/Modal';
import { useApp } from '../context/AppContext';
import {
  addGoalContribution,
  createAccount,
  createCategory,
  createGoal,
  createRecurringRule,
  deleteCategory,
  deleteCategoryBudget,
  deleteGoal,
  deleteRecurringRule,
  deleteTransaction,
  findExistingExternalHashes,
  generateMonthlyRecurringTransactions,
  getMonthlyFinanceSummary,
  getMultiMonthComparison,
  importStatementItems,
  listAccounts,
  listBudgetsForMonth,
  listCategories,
  listGoals,
  listRecurringRules,
  listTransactions,
  toggleTransactionStatus,
  updateRecurringRule,
  updateTransaction,
  upsertCategoryBudget,
  type AccountWithBalance,
  type BudgetWithUsage,
  type MonthlyFinanceSummary,
} from '../repositories/financeRepo';
import {
  parseStatementFile,
  type ParsedStatementItem,
} from '../services/importParser';
import { buildTransactionsCsv, downloadTextFile } from '../services/reports';
import type {
  AccountType,
  Category,
  FinancialGoal,
  RecurringRule,
  Transaction,
  TransactionSourceType,
  TransactionStatus,
  TransactionType,
} from '../types/domain';
import { currentMonthISO, formatBRL, formatDateBR, formatNumber } from '../utils/format';
import {
  isGoogleSheetsReady,
  loadGoogleSheetsConfig,
  saveGoogleSheetsConfig,
  syncFinanceToGoogleSheets,
} from '../services/googleSheetsSync';

export const FinancePage: React.FC = () => {
  const { db, dataVersion, bumpDataVersion, openQuickAction, setActiveSection, notify } = useApp();
  const [financeTab, setFinanceTab] = useState<'overview' | 'installments' | 'family'>('overview');
  const [sheetsBusy, setSheetsBusy] = useState(false);
  const [month, setMonth] = useState(currentMonthISO());
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<MonthlyFinanceSummary | null>(null);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [budgets, setBudgets] = useState<BudgetWithUsage[]>([]);
  const [monthComparison, setMonthComparison] = useState<
    Array<{ month: string; income: number; expense: number; net: number }>
  >([]);

  // New account inline state
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('reserva');
  const [accBalance, setAccBalance] = useState('0');

  // New goal inline state
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');

  // New recurring rule state
  const [recDesc, setRecDesc] = useState('');
  const [recType, setRecType] = useState<'income' | 'expense'>('expense');
  const [recSource, setRecSource] = useState<TransactionSourceType>('outros');
  const [recAmount, setRecAmount] = useState('');
  const [recDay, setRecDay] = useState('10');
  const [recCategoryId, setRecCategoryId] = useState('cat_moradia');

  // Edit recurring rule modal state
  const [editingRec, setEditingRec] = useState<RecurringRule | null>(null);
  const [editRecDesc, setEditRecDesc] = useState('');
  const [editRecType, setEditRecType] = useState<'income' | 'expense'>('expense');
  const [editRecSource, setEditRecSource] = useState<TransactionSourceType>('outros');
  const [editRecAmount, setEditRecAmount] = useState('');
  const [editRecDay, setEditRecDay] = useState('10');
  const [editRecAccount, setEditRecAccount] = useState('acc_principal');
  const [editRecCategory, setEditRecCategory] = useState('');
  const [editRecNotes, setEditRecNotes] = useState('');
  const [editRecSyncPlanned, setEditRecSyncPlanned] = useState(true);

  // New budget state
  const [bdgCategoryId, setBdgCategoryId] = useState('cat_alimentacao');
  const [bdgLimit, setBdgLimit] = useState('');

  // CSV / OFX Import modal state
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importAccountId, setImportAccountId] = useState('acc_principal');
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState<
    Array<ParsedStatementItem & { isDuplicate: boolean }>
  >([]);
  const [importSkippedRows, setImportSkippedRows] = useState(0);
  const [importing, setImporting] = useState(false);

  // Filters & Edit Transaction modal state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | TransactionStatus>('all');
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editTxDesc, setEditTxDesc] = useState('');
  const [editTxAmount, setEditTxAmount] = useState('');
  const [editTxDate, setEditTxDate] = useState('');
  const [editTxType, setEditTxType] = useState<TransactionType>('expense');
  const [editTxSource, setEditTxSource] = useState<TransactionSourceType>('outros');
  const [editTxStatus, setEditTxStatus] = useState<TransactionStatus>('realized');
  const [editTxAccount, setEditTxAccount] = useState('acc_principal');
  const [editTxDestAccount, setEditTxDestAccount] = useState('acc_carteira');
  const [editTxCategory, setEditTxCategory] = useState('');
  const [editTxNotes, setEditTxNotes] = useState('');

  // Custom category inline state
  const [newCatName, setNewCatName] = useState('');
  const [newCatKind, setNewCatKind] = useState<'income' | 'expense' | 'both'>('expense');
  const [newCatColor, setNewCatColor] = useState('#6366f1');

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const [accs, cats, txs, sum, gls, recs, bdgs, comp] = await Promise.all([
        listAccounts(db),
        listCategories(db),
        listTransactions(db, { month }),
        getMonthlyFinanceSummary(db, month),
        listGoals(db),
        listRecurringRules(db),
        listBudgetsForMonth(db, month),
        getMultiMonthComparison(db, month, 6),
      ]);
      if (active) {
        setAccounts(accs);
        setCategories(cats);
        setTransactions(txs);
        setSummary(sum);
        setGoals(gls);
        setRecurringRules(recs);
        setBudgets(bdgs);
        setMonthComparison(comp);
        if (accs[0] && !importAccountId) setImportAccountId(accs[0].id);
      }
    })();
    return () => {
      active = false;
    };
  }, [db, month, dataVersion]);

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const accMap = new Map(accounts.map((a) => [a.id, a]));

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createAccount(db, {
        name: accName,
        type: accType,
        initial_balance: Number(accBalance) || 0,
      });
      setAccName('');
      setAccBalance('0');
      bumpDataVersion();
      notify('Conta adicionada.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar conta.', 'error');
    }
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createGoal(db, {
        name: goalName,
        target_amount: Number(goalTarget),
      });
      setGoalName('');
      setGoalTarget('');
      bumpDataVersion();
      notify('Meta criada.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar meta.', 'error');
    }
  };

  const handleContributeGoal = async (goalId: string) => {
    if (!db) return;
    const raw = window.prompt('Valor do aporte em R$ (use negativo para resgate):', '100');
    if (!raw) return;
    const val = Number(raw.replace(',', '.'));
    if (!Number.isFinite(val) || val === 0) return;
    await addGoalContribution(db, goalId, val);
    bumpDataVersion();
    notify('Progresso da meta atualizado.');
  };

  const handleAddRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createRecurringRule(db, {
        account_id: accounts[0]?.id ?? 'acc_principal',
        category_id: recCategoryId || null,
        type: recType,
        source_type: recSource,
        description: recDesc,
        amount: Number(recAmount),
        day_of_month: Number(recDay) || 10,
      });
      setRecDesc('');
      setRecAmount('');
      bumpDataVersion();
      notify('Regra recorrente salva.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar recorrência.', 'error');
    }
  };

  const handleGenerateRecurring = async () => {
    if (!db) return;
    const res = await generateMonthlyRecurringTransactions(db, month);
    bumpDataVersion();
    notify(
      `${res.created} lançamento(s) previsto(s) gerado(s) para ${month} (${res.skipped} já existente(s)).`,
    );
  };

  const openEditRecurring = (rule: RecurringRule) => {
    setEditingRec(rule);
    setEditRecDesc(rule.description);
    setEditRecType(rule.type);
    setEditRecSource(rule.source_type);
    setEditRecAmount(String(rule.amount));
    setEditRecDay(String(rule.day_of_month));
    setEditRecAccount(rule.account_id || accounts[0]?.id || 'acc_principal');
    setEditRecCategory(rule.category_id ?? '');
    setEditRecNotes(rule.notes ?? '');
    setEditRecSyncPlanned(true);
  };

  const handleSaveEditRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !editingRec) return;
    try {
      const res = await updateRecurringRule(db, editingRec.id, {
        account_id: editRecAccount,
        category_id: editRecCategory || null,
        type: editRecType,
        source_type: editRecSource,
        description: editRecDesc,
        amount: Number(editRecAmount.replace(',', '.')),
        day_of_month: Number(editRecDay) || 1,
        notes: editRecNotes,
        syncPlannedTransactions: editRecSyncPlanned,
      });
      setEditingRec(null);
      bumpDataVersion();
      notify(
        res.updatedPlannedCount > 0
          ? `Recorrência atualizada (+ ${res.updatedPlannedCount} lançamento(s) previsto(s) sincronizado(s)).`
          : 'Recorrência mensal atualizada.',
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar recorrência.', 'error');
    }
  };

  const handleUpsertBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await upsertCategoryBudget(db, month, bdgCategoryId, Number(bdgLimit));
      setBdgLimit('');
      bumpDataVersion();
      notify('Orçamento da categoria salvo.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar orçamento.', 'error');
    }
  };

  const handleSelectImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db) return;
    try {
      const content = await file.text();
      const parsed = parseStatementFile(file.name, content, importAccountId);
      const existingHashes = await findExistingExternalHashes(
        db,
        parsed.items.map((i) => i.external_hash),
      );
      const seen = new Set<string>();
      const annotated = parsed.items.map((item) => {
        const dup = existingHashes.has(item.external_hash) || seen.has(item.external_hash);
        seen.add(item.external_hash);
        return { ...item, isDuplicate: dup };
      });
      setImportFileName(file.name);
      setImportPreview(annotated);
      setImportSkippedRows(parsed.skippedRows);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falha ao ler arquivo CSV/OFX.', 'error');
      setImportPreview([]);
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!db || importPreview.length === 0) return;
    setImporting(true);
    try {
      const res = await importStatementItems(db, importAccountId, importPreview);
      setImportOpen(false);
      setImportPreview([]);
      setImportFileName('');
      bumpDataVersion();
      notify(
        `Importação concluída: ${res.importedCount} novo(s), ${res.duplicateCount} duplicado(s) ignorado(s).`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro na importação.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const newItemsCount = importPreview.filter((i) => !i.isDuplicate).length;
  const dupItemsCount = importPreview.filter((i) => i.isDuplicate).length;

  const filteredTransactions = transactions.filter((tx) => {
    if (filterType !== 'all' && tx.type !== filterType) return false;
    if (filterStatus !== 'all' && tx.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const catName = tx.category_id ? (catMap.get(tx.category_id)?.name ?? '').toLowerCase() : '';
      if (!tx.description.toLowerCase().includes(q) && !catName.includes(q)) return false;
    }
    return true;
  });

  const openEditTx = (tx: Transaction) => {
    setEditingTx(tx);
    setEditTxDesc(tx.description);
    setEditTxAmount(String(tx.amount));
    setEditTxDate(tx.date);
    setEditTxType(tx.type);
    setEditTxSource(tx.source_type);
    setEditTxStatus(tx.status);
    setEditTxAccount(tx.account_id);
    setEditTxDestAccount(tx.destination_account_id ?? accounts[1]?.id ?? accounts[0]?.id ?? '');
    setEditTxCategory(tx.category_id ?? '');
    setEditTxNotes(tx.notes);
  };

  const handleSaveEditTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !editingTx) return;
    try {
      await updateTransaction(db, editingTx.id, {
        account_id: editTxAccount,
        destination_account_id: editTxType === 'transfer' ? editTxDestAccount : null,
        category_id: editTxType === 'transfer' ? null : editTxCategory || null,
        type: editTxType,
        source_type: editTxSource,
        description: editTxDesc,
        amount: Number(editTxAmount),
        date: editTxDate,
        status: editTxStatus,
        notes: editTxNotes,
      });
      setEditingTx(null);
      bumpDataVersion();
      notify('Lançamento atualizado no SQLite.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar lançamento.', 'error');
    }
  };

  const handleAddCustomCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createCategory(db, {
        name: newCatName,
        kind: newCatKind,
        color: newCatColor,
      });
      setNewCatName('');
      bumpDataVersion();
      notify('Categoria personalizada criada.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar categoria.', 'error');
    }
  };

  const cardClass = 'lh-card';
  const inputClass = 'lh-input';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="lh-page-title">Financeiro Pessoal</h2>
          <p className="lh-page-subtitle">
            Previsto vs realizado, orçamentos, recorrências, parcelamentos e importação local CSV/OFX com prevenção de duplicidades.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="lh-input w-full sm:w-auto"
          />
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <button
            type="button"
            disabled={sheetsBusy}
            onClick={async () => {
              const cfg = loadGoogleSheetsConfig();
              if (!isGoogleSheetsReady(cfg)) {
                setActiveSection('settings');
                notify('Configure sua planilha em Configurações → Backup Financeiro no Google Sheets.', 'info');
                return;
              }
              if (!db) return;
              setSheetsBusy(true);
              try {
                const res = await syncFinanceToGoogleSheets(db, cfg);
                saveGoogleSheetsConfig({
                  ...cfg,
                  enabled: true,
                  lastSyncedAt: res.syncedAt,
                  lastRowCount: res.transactionsCount + res.recurringCount + res.workSessionsCount,
                });
                notify(`Google Sheets atualizado (${res.transactionsCount} lançamentos + ${res.recurringCount} fixas)!`);
              } catch (err) {
                notify(err instanceof Error ? err.message : 'Erro ao enviar ao Google Sheets.', 'error');
              } finally {
                setSheetsBusy(false);
              }
            }}
            className="lh-btn-secondary w-full sm:w-auto"
          >
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-500" />
            {sheetsBusy ? 'Enviando...' : 'Google Sheets'}
          </button>
          <button
            type="button"
            onClick={() => {
              const csv = buildTransactionsCsv(transactions, accounts, categories);
              downloadTextFile(csv, `lifehub-financeiro-${month}.csv`);
              notify(`Relatório CSV de ${month} exportado.`);
            }}
            disabled={transactions.length === 0}
            className="lh-btn-secondary w-full sm:w-auto"
          >
            <Download className="h-4 w-4 shrink-0" /> Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="lh-btn-secondary w-full sm:w-auto"
          >
            <FileUp className="h-4 w-4 shrink-0" /> Importar
          </button>
          <button
            type="button"
            onClick={() => openQuickAction('transaction')}
            className="lh-btn-primary w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 shrink-0" /> Transação
          </button>
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs: Visão Geral | Cartão & Parcelados | Família / Casal */}
      <div className="grid w-full grid-cols-3 gap-1.5 border-b pb-3 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2" style={{ borderColor: 'var(--lh-card-border)' }}>
        <button
          type="button"
          onClick={() => setFinanceTab('overview')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11.5px] font-semibold transition sm:px-3.5 sm:text-xs ${
            financeTab === 'overview'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'lh-control-btn opacity-80 hover:opacity-100'
          }`}
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Visão Geral</span>
        </button>
        <button
          type="button"
          onClick={() => setFinanceTab('installments')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11.5px] font-semibold transition sm:px-3.5 sm:text-xs ${
            financeTab === 'installments'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'lh-control-btn opacity-80 hover:opacity-100'
          }`}
        >
          <CreditCard className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Cartão</span>
        </button>
        <button
          type="button"
          onClick={() => setFinanceTab('family')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11.5px] font-semibold transition sm:px-3.5 sm:text-xs ${
            financeTab === 'family'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'lh-control-btn opacity-80 hover:opacity-100'
          }`}
        >
          <Users className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Família</span>
        </button>
      </div>

      {financeTab === 'installments' && (
        <InstallmentsTabPanel accounts={accounts} categories={categories} month={month} />
      )}

      {financeTab === 'family' && (
        <FamilyFinanceTabPanel accounts={accounts} categories={categories} month={month} />
      )}

      {financeTab === 'overview' && (
        <>
      {/* Monthly KPIs */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={cardClass}>
            <p className="text-xs text-slate-500 dark:text-slate-400">Receitas Realizadas</p>
            <p className="mt-1 text-2xl font-bold text-emerald-500">
              {formatBRL(summary.realizedIncome)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Previsto adicional: {formatBRL(summary.plannedIncome)}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500 dark:text-slate-400">Despesas Realizadas</p>
            <p className="mt-1 text-2xl font-bold text-rose-500">
              {formatBRL(summary.realizedExpense)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              A pagar (previsto): {formatBRL(summary.plannedExpense)}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500 dark:text-slate-400">Saldo do Mês (Realizado)</p>
            <p
              className={`mt-1 text-2xl font-bold ${
                summary.realizedNet >= 0 ? 'text-emerald-500' : 'text-rose-500'
              }`}
            >
              {formatBRL(summary.realizedNet)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Salário: {formatBRL(summary.incomeBySource.salario ?? 0)} · Apps:{' '}
              {formatBRL(summary.incomeBySource.aplicativos ?? 0)}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500 dark:text-slate-400">Saldo Total nas Contas</p>
            <p className="mt-1 text-2xl font-bold">
              {formatBRL(accounts.reduce((acc, a) => acc + a.current_balance, 0))}
            </p>
            <p className="mt-1 text-xs text-slate-500">{accounts.length} conta(s) ativa(s)</p>
          </div>
        </div>
      )}

      {/* Transactions table */}
      <section className={cardClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Lançamentos de {month}</h3>
            <span className="text-xs text-slate-500">
              ({filteredTransactions.length} de {transactions.length})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar descrição/categoria..."
                className="lh-input w-56 pl-8 text-xs"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | TransactionType)}
              className="lh-input w-auto text-xs"
            >
              <option value="all">Todos tipos</option>
              <option value="income">Receitas</option>
              <option value="expense">Despesas</option>
              <option value="transfer">Transferências</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | TransactionStatus)}
              className="lh-input w-auto text-xs"
            >
              <option value="all">Todos status</option>
              <option value="realized">Realizado</option>
              <option value="planned">Previsto</option>
            </select>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <EmptyState
            title="Nenhum lançamento encontrado"
            description="Ajuste os filtros ou registre receitas, despesas ou importe um extrato CSV/OFX local."
            actionLabel="+ Transação"
            onAction={() => openQuickAction('transaction')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="lh-table">
              <thead>
                <tr>
                  <th className="py-2.5 pr-3">Data</th>
                  <th className="py-2.5 pr-3">Descrição</th>
                  <th className="py-2.5 pr-3">Conta</th>
                  <th className="py-2.5 pr-3">Categoria</th>
                  <th className="py-2.5 pr-3">Status</th>
                  <th className="py-2.5 pr-3 text-right">Valor</th>
                  <th className="py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-2.5 pr-3 font-mono text-xs">{formatDateBR(tx.date)}</td>
                    <td className="py-2.5 pr-3 font-medium">
                      {tx.description}
                      {tx.source_type !== 'outros' && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {tx.source_type}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500">
                      {accMap.get(tx.account_id)?.name ?? tx.account_id}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500">
                      {tx.category_id ? (catMap.get(tx.category_id)?.name ?? '—') : 'Transferência'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!db) return;
                          await toggleTransactionStatus(db, tx.id);
                          bumpDataVersion();
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          tx.status === 'realized'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-amber-500/15 text-amber-500'
                        }`}
                      >
                        {tx.status === 'realized' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {tx.status === 'realized' ? 'Realizado' : 'Previsto'}
                      </button>
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right font-semibold ${
                        tx.type === 'income'
                          ? 'text-emerald-500'
                          : tx.type === 'expense'
                            ? 'text-rose-500'
                            : 'text-sky-400'
                      }`}
                    >
                      {tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : ''}
                      {formatBRL(tx.amount)}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditTx(tx)}
                          className="text-slate-400 hover:text-brand-500"
                          aria-label="Editar lançamento"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!db) return;
                            await deleteTransaction(db, tx.id);
                            bumpDataVersion();
                            notify('Transação excluída.');
                          }}
                          className="text-slate-400 hover:text-rose-500"
                          aria-label="Excluir lançamento"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Budgets & Recurring Rules */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Orçamento por Categoria ({month})</h3>
          {budgets.length === 0 ? (
            <p className="mb-4 text-xs text-slate-500">
              Defina tetos mensais por categoria para acompanhar gastos realizados vs previstos.
            </p>
          ) : (
            <ul className="mb-4 space-y-3">
              {budgets.map((b) => {
                const over = b.usage_pct >= 100;
                const warn = b.usage_pct >= 80 && !over;
                return (
                  <li
                    key={b.id}
                    className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        {catMap.get(b.category_id)?.name ?? b.category_id}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={over ? 'font-bold text-rose-500' : 'text-slate-500'}>
                          {formatBRL(b.spent_amount)} / {formatBRL(b.limit_amount)} (
                          {formatNumber(b.usage_pct, 0)}%)
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!db) return;
                            await deleteCategoryBudget(db, b.id);
                            bumpDataVersion();
                          }}
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          over ? 'bg-rose-500' : warn ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, b.usage_pct)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={handleUpsertBudget} className="flex flex-wrap gap-2">
            <select
              value={bdgCategoryId}
              onChange={(e) => setBdgCategoryId(e.target.value)}
              className={`${inputClass} flex-1`}
            >
              {categories
                .filter((c) => c.kind !== 'income')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <input
              required
              type="number"
              min="1"
              step="10"
              placeholder="Limite (R$)"
              value={bdgLimit}
              onChange={(e) => setBdgLimit(e.target.value)}
              className={`${inputClass} w-32`}
            />
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Definir teto
            </button>
          </form>
        </section>

        <section className={cardClass}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Recorrências Mensais</h3>
            <button
              type="button"
              onClick={handleGenerateRecurring}
              disabled={recurringRules.length === 0}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Gerar em {month}
            </button>
          </div>

          {recurringRules.length === 0 ? (
            <p className="mb-4 text-xs text-slate-500">
              Cadastre contas fixas (aluguel, internet, academia, salário CLT) para gerar previsões do mês sem duplicar.
            </p>
          ) : (
            <ul className="mb-4 max-h-48 space-y-2 overflow-y-auto">
              {recurringRules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
                >
                  <div>
                    <p className="font-medium">{r.description}</p>
                    <p className="text-slate-500">
                      Dia {r.day_of_month} · {r.type === 'income' ? 'Receita' : 'Despesa'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        r.type === 'income'
                          ? 'font-semibold text-emerald-500'
                          : 'font-semibold text-rose-500'
                      }
                    >
                      {formatBRL(r.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditRecurring(r)}
                      className="text-slate-400 hover:text-brand-500"
                      aria-label={`Editar recorrência ${r.description}`}
                      title="Editar recorrência"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!db) return;
                        await deleteRecurringRule(db, r.id);
                        bumpDataVersion();
                      }}
                      className="text-slate-400 hover:text-rose-500"
                      aria-label={`Excluir recorrência ${r.description}`}
                      title="Excluir recorrência"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddRecurring} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <input
              required
              placeholder="Descrição (ex.: Internet)"
              value={recDesc}
              onChange={(e) => setRecDesc(e.target.value)}
              className={`${inputClass} col-span-2 sm:col-span-3`}
            />
            <select
              value={recType}
              onChange={(e) => setRecType(e.target.value as 'income' | 'expense')}
              className={`${inputClass} sm:col-span-3`}
            >
              <option value="expense">Despesa fixa</option>
              <option value="income">Receita fixa</option>
            </select>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Valor (R$)"
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
              className={`${inputClass} sm:col-span-2`}
            />
            <input
              required
              type="number"
              min="1"
              max="31"
              placeholder="Dia"
              value={recDay}
              onChange={(e) => setRecDay(e.target.value)}
              className={`${inputClass} sm:col-span-1`}
            />
            <select
              value={recCategoryId}
              onChange={(e) => setRecCategoryId(e.target.value)}
              className={`${inputClass} sm:col-span-2`}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 sm:col-span-1"
            >
              +
            </button>
            <input
              type="hidden"
              value={recSource}
              onChange={(e) => setRecSource(e.target.value as TransactionSourceType)}
            />
          </form>
        </section>
      </div>

      {/* 6-month Comparison */}
      <section className={cardClass}>
        <h3 className="mb-3 font-semibold">Comparativo dos Últimos 6 Meses (Realizado)</h3>
        {monthComparison.some((m) => m.income > 0 || m.expense > 0) && (
          <div className="mb-4">
            <GroupedBarChart
              items={monthComparison.map((m) => ({
                label: m.month.slice(5) + '/' + m.month.slice(2, 4),
                primaryValue: m.income,
                secondaryValue: m.expense,
              }))}
              primaryLabel="Receitas"
              secondaryLabel="Despesas"
              primaryColorClass="fill-emerald-500"
              secondaryColorClass="fill-rose-500"
            />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-3">Mês</th>
                <th className="py-2 pr-3 text-right">Receitas</th>
                <th className="py-2 pr-3 text-right">Despesas</th>
                <th className="py-2 text-right">Saldo Líquido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {monthComparison.map((row) => (
                <tr key={row.month} className={row.month === month ? 'font-semibold' : ''}>
                  <td className="py-2 pr-3 font-mono">{row.month}</td>
                  <td className="py-2 pr-3 text-right text-emerald-500">
                    {formatBRL(row.income)}
                  </td>
                  <td className="py-2 pr-3 text-right text-rose-500">{formatBRL(row.expense)}</td>
                  <td
                    className={`py-2 text-right font-semibold ${
                      row.net >= 0 ? 'text-emerald-500' : 'text-rose-500'
                    }`}
                  >
                    {formatBRL(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Accounts & Goals */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Contas</h3>
          <ul className="mb-4 space-y-2">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-800"
              >
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-slate-500">{a.type.replace('_', ' ')}</p>
                </div>
                <span className="font-semibold">{formatBRL(a.current_balance)}</span>
              </li>
            ))}
          </ul>

          <form onSubmit={handleAddAccount} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <input
              required
              placeholder="Nova conta"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              className={`${inputClass} sm:col-span-2`}
            />
            <select
              value={accType}
              onChange={(e) => setAccType(e.target.value as AccountType)}
              className={inputClass}
            >
              <option value="conta_corrente">Corrente</option>
              <option value="carteira">Carteira</option>
              <option value="reserva">Reserva</option>
              <option value="poupanca">Poupança</option>
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                value={accBalance}
                onChange={(e) => setAccBalance(e.target.value)}
                placeholder="Saldo"
                className={`${inputClass} w-24`}
              />
              <button
                type="submit"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                +
              </button>
            </div>
          </form>
        </section>

        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Metas de Reserva</h3>
          {goals.length === 0 ? (
            <p className="mb-4 text-xs text-slate-500">
              Nenhuma meta cadastrada. Crie sua reserva de emergência ou fundo de troca da moto.
            </p>
          ) : (
            <ul className="mb-4 space-y-3">
              {goals.map((g) => {
                const pct = Math.min(100, (g.current_amount / g.target_amount) * 100);
                return (
                  <li
                    key={g.id}
                    className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{g.name}</p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleContributeGoal(g.id)}
                          className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500 hover:bg-emerald-500/25"
                        >
                          + Aporte
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!db) return;
                            await deleteGoal(db, g.id);
                            bumpDataVersion();
                          }}
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatBRL(g.current_amount)} de {formatBRL(g.target_amount)} (
                      {formatNumber(pct, 0)}%)
                    </p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={handleAddGoal} className="flex flex-wrap gap-2">
            <input
              required
              placeholder="Nome da meta (ex.: Reserva 6 meses)"
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              className={`${inputClass} flex-1`}
            />
            <input
              required
              type="number"
              min="1"
              step="10"
              placeholder="Alvo (R$)"
              value={goalTarget}
              onChange={(e) => setGoalTarget(e.target.value)}
              className={`${inputClass} w-32`}
            />
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Criar meta
            </button>
          </form>
        </section>
      </div>

      {/* Customizable Categories */}
      <section className={cardClass}>
        <h3 className="mb-3 font-semibold">Categorias Personalizáveis</h3>
        <div className="mb-4 flex flex-wrap gap-2">
          {categories.map((cat) => (
            <span
              key={cat.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs dark:border-slate-800"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              <span>{cat.name}</span>
              <span className="text-[10px] text-slate-400">
                ({cat.kind === 'income' ? 'Receita' : cat.kind === 'expense' ? 'Despesa' : 'Ambos'})
              </span>
              {cat.is_default === 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!db) return;
                    await deleteCategory(db, cat.id);
                    bumpDataVersion();
                    notify('Categoria removida.');
                  }}
                  className="ml-0.5 text-slate-400 hover:text-rose-500"
                  aria-label={`Remover categoria ${cat.name}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <form onSubmit={handleAddCustomCategory} className="flex flex-wrap items-center gap-2">
          <input
            required
            placeholder="Nova categoria (ex.: Peças Moto, Freela TI)"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            className={`${inputClass} flex-1`}
          />
          <select
            value={newCatKind}
            onChange={(e) => setNewCatKind(e.target.value as 'income' | 'expense' | 'both')}
            className={inputClass}
          >
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
            <option value="both">Ambos</option>
          </select>
          <input
            type="color"
            value={newCatColor}
            onChange={(e) => setNewCatColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-700"
            aria-label="Cor da categoria"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            + Categoria
          </button>
        </form>
      </section>
        </>
      )}

      {/* CSV / OFX Import Modal */}
      <Modal
        open={importOpen}
        title="Importar Extrato CSV ou OFX"
        subtitle="Leitura 100% local (sem conexão bancária). Lançamentos duplicados são detectados automaticamente."
        onClose={() => setImportOpen(false)}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Conta de destino</label>
              <select
                value={importAccountId}
                onChange={(e) => {
                  setImportAccountId(e.target.value);
                  setImportPreview([]);
                }}
                className={`${inputClass} w-full`}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Arquivo (.csv ou .ofx)</label>
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-brand-500/60 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-400 hover:bg-brand-500/20"
              >
                <FileUp className="h-4 w-4" />
                {importFileName || 'Selecionar arquivo CSV/OFX'}
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,.ofx,text/csv"
                onChange={handleSelectImportFile}
                className="hidden"
              />
            </div>
          </div>

          {importPreview.length > 0 && (
            <>
              <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                <span className="font-semibold text-emerald-500">{newItemsCount} novo(s)</span>
                <span className="font-semibold text-amber-500">
                  {dupItemsCount} duplicado(s) ignorado(s)
                </span>
                {importSkippedRows > 0 && (
                  <span className="text-slate-500">
                    {importSkippedRows} linha(s) inválida(s)/zerada(s)
                  </span>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                      <th className="p-2">Data</th>
                      <th className="p-2">Descrição</th>
                      <th className="p-2 text-right">Valor</th>
                      <th className="p-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {importPreview.slice(0, 40).map((item, idx) => (
                      <tr key={`${item.external_hash}_${idx}`} className={item.isDuplicate ? 'opacity-50' : ''}>
                        <td className="p-2 font-mono">{formatDateBR(item.date)}</td>
                        <td className="p-2">{item.description}</td>
                        <td
                          className={`p-2 text-right font-semibold ${
                            item.type === 'income' ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {item.type === 'expense' ? '-' : '+'}
                          {formatBRL(item.amount)}
                        </td>
                        <td className="p-2 text-right">
                          {item.isDuplicate ? (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                              Duplicado
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400">
                              Novo
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setImportOpen(false)}
              className="rounded-lg px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={importing || newItemsCount === 0}
              onClick={handleConfirmImport}
              className="rounded-lg bg-brand-600 px-5 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {importing ? 'Importando...' : `Importar ${newItemsCount} lançamento(s)`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Transaction Modal */}
      <Modal
        open={Boolean(editingTx)}
        title="Editar Lançamento"
        onClose={() => setEditingTx(null)}
      >
        <form onSubmit={handleSaveEditTx} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Descrição</label>
            <input
              required
              value={editTxDesc}
              onChange={(e) => setEditTxDesc(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Tipo</label>
              <select
                value={editTxType}
                onChange={(e) => setEditTxType(e.target.value as TransactionType)}
                className={`${inputClass} w-full`}
              >
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
                <option value="transfer">Transferência</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Valor (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={editTxAmount}
                onChange={(e) => setEditTxAmount(e.target.value)}
                className={`${inputClass} w-full`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input
                required
                type="date"
                value={editTxDate}
                onChange={(e) => setEditTxDate(e.target.value)}
                className={`${inputClass} w-full`}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Conta</label>
              <select
                value={editTxAccount}
                onChange={(e) => setEditTxAccount(e.target.value)}
                className={`${inputClass} w-full`}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {editTxType === 'transfer' ? (
              <div>
                <label className="mb-1 block text-xs font-medium">Conta destino</label>
                <select
                  value={editTxDestAccount}
                  onChange={(e) => setEditTxDestAccount(e.target.value)}
                  className={`${inputClass} w-full`}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium">Categoria</label>
                <select
                  value={editTxCategory}
                  onChange={(e) => setEditTxCategory(e.target.value)}
                  className={`${inputClass} w-full`}
                >
                  <option value="">Sem categoria</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Origem</label>
              <select
                value={editTxSource}
                onChange={(e) => setEditTxSource(e.target.value as TransactionSourceType)}
                className={`${inputClass} w-full`}
              >
                <option value="outros">Outros</option>
                <option value="salario">Salário CLT</option>
                <option value="aplicativos">Uber/99 Moto</option>
                <option value="servicos_ti">Serviços TI</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <select
                value={editTxStatus}
                onChange={(e) => setEditTxStatus(e.target.value as TransactionStatus)}
                className={`${inputClass} w-full`}
              >
                <option value="realized">Realizado</option>
                <option value="planned">Previsto</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Observações</label>
            <input
              value={editTxNotes}
              onChange={(e) => setEditTxNotes(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingTx(null)}
              className="rounded-lg px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Salvar Alterações
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Recurring Rule Modal */}
      <Modal
        open={Boolean(editingRec)}
        title="Editar Recorrência Mensal"
        subtitle="Altere descrição, valor, dia do vencimento ou categoria da conta fixa."
        onClose={() => setEditingRec(null)}
      >
        <form onSubmit={handleSaveEditRecurring} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Descrição</label>
            <input
              required
              value={editRecDesc}
              onChange={(e) => setEditRecDesc(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Tipo</label>
              <select
                value={editRecType}
                onChange={(e) => setEditRecType(e.target.value as 'income' | 'expense')}
                className={`${inputClass} w-full`}
              >
                <option value="expense">Despesa fixa</option>
                <option value="income">Receita fixa</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Valor (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={editRecAmount}
                onChange={(e) => setEditRecAmount(e.target.value)}
                className={`${inputClass} w-full`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Dia do mês (1-31)</label>
              <input
                required
                type="number"
                min="1"
                max="31"
                value={editRecDay}
                onChange={(e) => setEditRecDay(e.target.value)}
                className={`${inputClass} w-full`}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Conta</label>
              <select
                value={editRecAccount}
                onChange={(e) => setEditRecAccount(e.target.value)}
                className={`${inputClass} w-full`}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Categoria</label>
              <select
                value={editRecCategory}
                onChange={(e) => setEditRecCategory(e.target.value)}
                className={`${inputClass} w-full`}
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Origem</label>
              <select
                value={editRecSource}
                onChange={(e) => setEditRecSource(e.target.value as TransactionSourceType)}
                className={`${inputClass} w-full`}
              >
                <option value="outros">Outros</option>
                <option value="salario">Salário CLT</option>
                <option value="aplicativos">Uber/99 Moto</option>
                <option value="servicos_ti">Serviços TI</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Observações</label>
              <input
                value={editRecNotes}
                onChange={(e) => setEditRecNotes(e.target.value)}
                className={`${inputClass} w-full`}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
            <input
              type="checkbox"
              checked={editRecSyncPlanned}
              onChange={(e) => setEditRecSyncPlanned(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span>
              Atualizar também lançamentos ainda <strong>Previstos</strong> já gerados por esta regra (meses já pagos não mudam)
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingRec(null)}
              className="rounded-lg px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Salvar Recorrência
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
