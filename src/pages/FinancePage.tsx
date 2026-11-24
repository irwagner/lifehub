import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { useApp } from '../context/AppContext';
import {
  addGoalContribution,
  createAccount,
  createGoal,
  deleteGoal,
  deleteTransaction,
  getMonthlyFinanceSummary,
  listAccounts,
  listCategories,
  listGoals,
  listTransactions,
  toggleTransactionStatus,
  type AccountWithBalance,
  type MonthlyFinanceSummary,
} from '../repositories/financeRepo';
import type { AccountType, Category, FinancialGoal, Transaction } from '../types/domain';
import { currentMonthISO, formatBRL, formatDateBR, formatNumber } from '../utils/format';

export const FinancePage: React.FC = () => {
  const { db, dataVersion, bumpDataVersion, openQuickAction, notify } = useApp();
  const [month, setMonth] = useState(currentMonthISO());
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<MonthlyFinanceSummary | null>(null);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);

  // New account inline state
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('reserva');
  const [accBalance, setAccBalance] = useState('0');

  // New goal inline state
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const [accs, cats, txs, sum, gls] = await Promise.all([
        listAccounts(db),
        listCategories(db),
        listTransactions(db, { month }),
        getMonthlyFinanceSummary(db, month),
        listGoals(db),
      ]);
      if (active) {
        setAccounts(accs);
        setCategories(cats);
        setTransactions(txs);
        setSummary(sum);
        setGoals(gls);
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

  const cardClass =
    'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900';
  const inputClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Financeiro Pessoal</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Previsto vs realizado, receitas por origem, parcelamentos e reservas — 100% offline.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => openQuickAction('transaction')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" /> Nova Transação
          </button>
        </div>
      </div>

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
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Lançamentos de {month}</h3>
          <span className="text-xs text-slate-500">{transactions.length} registro(s)</span>
        </div>

        {transactions.length === 0 ? (
          <EmptyState
            title="Nenhum lançamento neste mês"
            description="Registre receitas (salário, aplicativos, serviços TI), despesas ou parcelamentos."
            actionLabel="+ Transação"
            onAction={() => openQuickAction('transaction')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Descrição</th>
                  <th className="py-2 pr-3">Conta</th>
                  <th className="py-2 pr-3">Categoria</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {transactions.map((tx) => (
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      {/* Planned future note */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
        <strong>Planejado (próximas fases):</strong> Importação de extratos CSV/OFX com detecção de duplicidades. Conexão direta com bancos não entra no MVP por privacidade e simplicidade.
      </div>
    </div>
  );
};
