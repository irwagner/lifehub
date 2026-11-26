import React, { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Plus,
  Receipt,
  Shield,
  Trash2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  createTransaction,
  deleteInstallmentGroup,
  listTransactions,
  markNextInstallmentPaid,
  toggleTransactionStatus,
  type AccountWithBalance,
} from '../repositories/financeRepo';
import type { Category, Transaction } from '../types/domain';
import { addMonthsISO, currentMonthISO, formatBRL, formatDateBR, todayISO } from '../utils/format';

export type InstallmentKind = 'cartao' | 'moto' | 'seguro' | 'outro';

const KIND_META: Record<
  InstallmentKind,
  { label: string; tag: string; badgeClass: string; icon: React.FC<{ className?: string }> }
> = {
  cartao: {
    label: 'Cartão de Crédito',
    tag: '[Cartão]',
    badgeClass: 'bg-indigo-500/15 text-indigo-400',
    icon: CreditCard,
  },
  moto: {
    label: 'Financiamento / Moto',
    tag: '[Moto]',
    badgeClass: 'bg-emerald-500/15 text-emerald-400',
    icon: Bike,
  },
  seguro: {
    label: 'Seguro',
    tag: '[Seguro]',
    badgeClass: 'bg-amber-500/15 text-amber-400',
    icon: Shield,
  },
  outro: {
    label: 'Carnê / Boleto / Outro',
    tag: '[Parcelado]',
    badgeClass: 'bg-sky-500/15 text-sky-400',
    icon: Receipt,
  },
};

export interface InstallmentGroupView {
  groupId: string;
  title: string;
  kind: InstallmentKind;
  issuer: string;
  isFamily: boolean;
  totalCount: number;
  paidCount: number;
  remainingCount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  parcelAmount: number;
  nextDueDate: string | null;
  items: Transaction[];
}

export function detectInstallmentKind(tx: Pick<Transaction, 'description' | 'notes'>): {
  kind: InstallmentKind;
  issuer: string;
  isFamily: boolean;
} {
  const notes = tx.notes ?? '';
  const combined = `${tx.description} ${notes}`.toLowerCase();
  const issuerMatch = notes.match(/\[Cart[aã]o:\s*([^\]]+)\]/i);
  const issuer = issuerMatch ? issuerMatch[1].trim() : '';
  const isFamily = /\[fam[ií]lia\]|#fam[ií]lia/i.test(notes);

  // Explicit tags take priority
  if (issuer || /\[cart[aã]o\]/i.test(notes)) return { kind: 'cartao', issuer, isFamily };
  if (/\[seguro\]/i.test(notes)) return { kind: 'seguro', issuer, isFamily };
  if (/\[moto\]/i.test(notes)) return { kind: 'moto', issuer, isFamily };
  if (/\[parcelado\]/i.test(notes)) return { kind: 'outro', issuer, isFamily };

  // Fallback keyword detection
  if (/cart[aã]o|nubank|inter|ita[uú]|santander|bradesco|c6|xp/i.test(combined)) {
    return { kind: 'cartao', issuer, isFamily };
  }
  if (/seguro|prote[cç][aã]o veicular/i.test(combined)) {
    return { kind: 'seguro', issuer, isFamily };
  }
  if (/moto|financiamento|cons[oó]rcio|ve[ií]culo/i.test(combined)) {
    return { kind: 'moto', issuer, isFamily };
  }
  return { kind: 'outro', issuer, isFamily };
}

export function isTrackedInstallmentTransaction(
  tx: Pick<Transaction, 'installment_group_id' | 'installment_total'>,
): boolean {
  return Boolean(tx.installment_group_id) && (tx.installment_total ?? 0) >= 1;
}

export function groupInstallmentTransactions(allTransactions: Transaction[]): InstallmentGroupView[] {
  const byGroup = new Map<string, Transaction[]>();
  for (const tx of allTransactions) {
    if (!isTrackedInstallmentTransaction(tx) || !tx.installment_group_id) continue;
    const list = byGroup.get(tx.installment_group_id) ?? [];
    list.push(tx);
    byGroup.set(tx.installment_group_id, list);
  }

  const groups: InstallmentGroupView[] = [];
  for (const [groupId, items] of byGroup.entries()) {
    items.sort((a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0));
    const first = items[0];
    const cleanTitle = first.description.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
    const { kind, issuer, isFamily } = detectInstallmentKind(first);
    const paidItems = items.filter((t) => t.status === 'realized');
    const pendingItems = items.filter((t) => t.status === 'planned');
    const totalAmount = items.reduce((acc, t) => acc + t.amount, 0);
    const paidAmount = paidItems.reduce((acc, t) => acc + t.amount, 0);
    const remainingAmount = pendingItems.reduce((acc, t) => acc + t.amount, 0);

    groups.push({
      groupId,
      title: cleanTitle || first.description,
      kind,
      issuer,
      isFamily,
      totalCount: first.installment_total ?? items.length,
      paidCount: paidItems.length,
      remainingCount: pendingItems.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      paidAmount: Math.round(paidAmount * 100) / 100,
      remainingAmount: Math.round(remainingAmount * 100) / 100,
      parcelAmount: first.amount,
      nextDueDate: pendingItems[0]?.date ?? null,
      items,
    });
  }

  return groups.sort((a, b) => {
    if (a.remainingCount > 0 && b.remainingCount === 0) return -1;
    if (a.remainingCount === 0 && b.remainingCount > 0) return 1;
    return (a.nextDueDate ?? '9999-12-31').localeCompare(b.nextDueDate ?? '9999-12-31');
  });
}

function getNextMonths(startMonth: string, count: number): string[] {
  const [yStr, mStr] = startMonth.split('-');
  let y = Number(yStr);
  let m = Number(mStr);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

interface InstallmentsTabPanelProps {
  accounts: AccountWithBalance[];
  categories: Category[];
  month: string;
}

export const InstallmentsTabPanel: React.FC<InstallmentsTabPanelProps> = ({
  accounts,
  categories,
  month,
}) => {
  const { db, dataVersion, bumpDataVersion, notify } = useApp();
  const [allTxs, setAllTxs] = useState<Transaction[]>([]);
  const [filterKind, setFilterKind] = useState<'all' | InstallmentKind>('all');
  const [onlyActive, setOnlyActive] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  // Quick Add Installment Form
  const [desc, setDesc] = useState('');
  const [kind, setKind] = useState<InstallmentKind>('cartao');
  const [issuer, setIssuer] = useState('');
  const [amountMode, setAmountMode] = useState<'per_parcel' | 'total'>('per_parcel');
  const [amountInput, setAmountInput] = useState('');
  const [installmentsCount, setInstallmentsCount] = useState('6');
  const [firstDate, setFirstDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 'acc_principal');
  const [firstPaid, setFirstPaid] = useState(false);
  const [isFamilyExpense, setIsFamilyExpense] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.kind === 'expense'),
    [categories],
  );

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => {
    if (!db) return;
    listTransactions(db).then(setAllTxs).catch(() => {});
  }, [db, dataVersion]);

  const groups = useMemo(() => groupInstallmentTransactions(allTxs), [allTxs]);

  const visibleGroups = useMemo(() => {
    return groups.filter((g) => {
      if (onlyActive && g.remainingCount === 0) return false;
      if (filterKind !== 'all' && g.kind !== filterKind) return false;
      return true;
    });
  }, [groups, filterKind, onlyActive]);

  const activeMonth = month || currentMonthISO();

  const kpis = useMemo(() => {
    const allInstallmentTxs = allTxs.filter(isTrackedInstallmentTransaction);
    const thisMonthTotal = allInstallmentTxs
      .filter((t) => t.date.startsWith(activeMonth))
      .reduce((acc, t) => acc + t.amount, 0);
    const totalRemaining = allInstallmentTxs
      .filter((t) => t.status === 'planned')
      .reduce((acc, t) => acc + t.amount, 0);
    const totalPaid = allInstallmentTxs
      .filter((t) => t.status === 'realized')
      .reduce((acc, t) => acc + t.amount, 0);
    const activeGroupsCount = groups.filter((g) => g.remainingCount > 0).length;
    return { thisMonthTotal, totalRemaining, totalPaid, activeGroupsCount };
  }, [allTxs, activeMonth, groups]);

  const projection6m = useMemo(() => {
    const months = getNextMonths(activeMonth, 6);
    const allInst = allTxs.filter(isTrackedInstallmentTransaction);
    const rows = months.map((m) => {
      const total = allInst
        .filter((t) => t.date.startsWith(m))
        .reduce((acc, t) => acc + t.amount, 0);
      return { month: m, total: Math.round(total * 100) / 100 };
    });
    const max = Math.max(...rows.map((r) => r.total), 1);
    return { rows, max };
  }, [allTxs, activeMonth]);

  const parsedAmount = Number(amountInput.replace(',', '.')) || 0;
  const parsedCount = Math.min(120, Math.max(1, Math.round(Number(installmentsCount) || 1)));
  const isSingleBill = parsedCount === 1;
  const computedTotal =
    amountMode === 'per_parcel'
      ? Math.round(parsedAmount * parsedCount * 100) / 100
      : Math.round(parsedAmount * 100) / 100;
  const computedParcel =
    amountMode === 'per_parcel'
      ? Math.round(parsedAmount * 100) / 100
      : parsedCount > 0
        ? Math.round((parsedAmount / parsedCount) * 100) / 100
        : 0;

  const handleAddInstallment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !(computedTotal > 0)) return;
    setSubmitting(true);
    try {
      const kindTag =
        kind === 'cartao' && issuer.trim()
          ? `[Cartão: ${issuer.trim()}]`
          : KIND_META[kind].tag;
      const notes = [kindTag, isFamilyExpense ? '[Família]' : ''].filter(Boolean).join(' ');

      await createTransaction(db, {
        account_id: accountId || accounts[0]?.id || 'acc_principal',
        category_id: categoryId || null,
        type: 'expense',
        source_type: 'outros',
        description: desc.trim(),
        amount: computedTotal,
        date: firstDate,
        due_date: firstDate,
        status: firstPaid ? 'realized' : 'planned',
        installments: parsedCount,
        force_installment_group: true,
        notes,
      });

      setDesc('');
      setAmountInput('');
      setIssuer('');
      setFirstPaid(false);
      bumpDataVersion();
      notify(
        isSingleBill
          ? `Conta 1x registrada: ${formatBRL(computedTotal)} (venc. ${formatDateBR(firstDate)}).`
          : `Parcelamento criado: ${parsedCount}x de ${formatBRL(computedParcel)} (${formatBRL(computedTotal)}).`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar lançamento no cartão.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayNext = async (group: InstallmentGroupView) => {
    if (!db) return;
    const paid = await markNextInstallmentPaid(db, group.groupId);
    if (!paid) {
      notify('Todas as parcelas deste item já foram pagas.', 'info');
      return;
    }
    bumpDataVersion();
    notify(
      group.totalCount === 1
        ? `"${group.title}" (1x) marcada como paga!`
        : `Parcela ${paid.installment_number}/${paid.installment_total} marcada como paga!`,
    );
  };

  const handleDeleteGroup = async (group: InstallmentGroupView) => {
    if (!db) return;
    const ok = window.confirm(
      group.totalCount === 1
        ? `Excluir lançamento 1x "${group.title}"?`
        : `Excluir todas as ${group.totalCount} parcelas de "${group.title}"?`,
    );
    if (!ok) return;
    await deleteInstallmentGroup(db, group.groupId);
    bumpDataVersion();
    notify(`"${group.title}" removido.`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Parcelas em {activeMonth}
          </p>
          <p className="mt-1 text-2xl font-bold text-rose-500">
            {formatBRL(kpis.thisMonthTotal)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Comprometido no mês</p>
        </div>

        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">Total Restante a Pagar</p>
          <p className="mt-1 text-2xl font-bold text-amber-500">
            {formatBRL(kpis.totalRemaining)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Soma de todas as parcelas futuras</p>
        </div>

        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">Total Já Quitado</p>
          <p className="mt-1 text-2xl font-bold text-emerald-500">
            {formatBRL(kpis.totalPaid)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Parcelas já realizadas</p>
        </div>

        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">Parcelamentos Ativos</p>
          <p className="mt-1 text-2xl font-bold">{kpis.activeGroupsCount}</p>
          <p className="mt-1 text-xs text-slate-500">Cartão, moto, seguro e carnês</p>
        </div>
      </div>

      {/* Quick Form: Add Card / Bike / Insurance / Any Installment */}
      <form onSubmit={handleAddInstallment} className="lh-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-brand-500" />
            <h3 className="font-semibold">
              Novo Parcelamento (Cartão, Roupa, Moto, Seguro ou Carnê)
            </h3>
          </div>
          <div className="inline-flex rounded-xl border p-0.5 text-xs" style={{ borderColor: 'var(--lh-card-border)' }}>
            <button
              type="button"
              onClick={() => setAmountMode('per_parcel')}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                amountMode === 'per_parcel' ? 'bg-brand-600 text-white' : 'opacity-70 hover:opacity-100'
              }`}
            >
              Valor de cada parcela
            </button>
            <button
              type="button"
              onClick={() => setAmountMode('total')}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                amountMode === 'total' ? 'bg-brand-600 text-white' : 'opacity-70 hover:opacity-100'
              }`}
            >
              Valor total ÷ X
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium">O que você parcelou?</label>
            <input
              required
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Ex.: Roupa Renner, Financiamento Moto, Seguro Moto..."
              className="lh-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Tipo</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as InstallmentKind)}
              className="lh-input"
            >
              <option value="cartao">Cartão de Crédito</option>
              <option value="moto">Financiamento / Moto</option>
              <option value="seguro">Seguro</option>
              <option value="outro">Carnê / Boleto / Outro</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">
              {kind === 'cartao' ? 'Qual cartão? (opcional)' : 'Banco / Seguradora (opcional)'}
            </label>
            <input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder={kind === 'cartao' ? 'Ex.: Nubank, Inter, Itaú' : 'Ex.: Santander, Suhai'}
              className="lh-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">
              {amountMode === 'per_parcel' ? 'Valor de cada parcela (R$)' : 'Valor total da compra (R$)'}
            </label>
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={amountMode === 'per_parcel' ? 'Ex.: 149.90' : 'Ex.: 450.00'}
              className="lh-input"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-xs font-medium">Quantas vezes? (1 a 120x)</label>
              <button
                type="button"
                onClick={() => {
                  setInstallmentsCount('1');
                  setFirstDate(addMonthsISO(todayISO(), 1));
                  setFirstPaid(false);
                }}
                className="rounded-md bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-500 hover:bg-brand-500/25"
              >
                1x Próx. mês
              </button>
            </div>
            <input
              required
              type="number"
              min="1"
              max="120"
              value={installmentsCount}
              onChange={(e) => setInstallmentsCount(e.target.value)}
              className="lh-input"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-xs font-medium">
                {isSingleBill ? 'Vencimento / fatura' : '1ª parcela (data)'}
              </label>
              <button
                type="button"
                onClick={() => setFirstDate((prev) => addMonthsISO(prev || todayISO(), 1))}
                className="rounded-md bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold opacity-80 hover:opacity-100"
              >
                +1 mês
              </button>
            </div>
            <input
              required
              type="date"
              value={firstDate}
              onChange={(e) => setFirstDate(e.target.value)}
              className="lh-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Categoria</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="lh-input"
            >
              <option value="">Sem categoria</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={firstPaid}
                onChange={(e) => setFirstPaid(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              {isSingleBill ? 'Já foi paga' : '1ª parcela já foi paga'}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isFamilyExpense}
                onChange={(e) => setIsFamilyExpense(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Incluir no Financeiro da Família
            </label>
          </div>

          <div className="flex items-center gap-3">
            {computedTotal > 0 && (
              <span className="rounded-xl bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-500">
                {isSingleBill
                  ? `1x (fatura única) · Total ${formatBRL(computedTotal)}`
                  : `${parsedCount}x de ${formatBRL(computedParcel)} · Total ${formatBRL(computedTotal)}`}
              </span>
            )}
            <button type="submit" disabled={submitting} className="lh-btn-primary">
              <Plus className="h-4 w-4" />
              {submitting
                ? 'Salvando...'
                : isSingleBill
                  ? 'Adicionar no Cartão (1x)'
                  : 'Adicionar Parcelamento'}
            </button>
          </div>
        </div>
      </form>

      {/* 6-Month Commitment Projection */}
      <section className="lh-card space-y-3">
        <h3 className="text-sm font-semibold">Comprometimento de Parcelas — Próximos 6 Meses</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {projection6m.rows.map((r) => {
            const pct = Math.max(4, Math.round((r.total / projection6m.max) * 100));
            return (
              <div
                key={r.month}
                className="flex flex-col justify-between rounded-xl border p-2.5 text-xs"
                style={{ borderColor: 'var(--lh-card-border)' }}
              >
                <span className="font-mono text-[11px] opacity-70">{r.month}</span>
                <div className="my-2 h-12 flex items-end">
                  <div
                    className="w-full rounded-md bg-gradient-to-t from-brand-600 to-indigo-400 transition-all"
                    style={{ height: r.total > 0 ? `${pct}%` : '4px', opacity: r.total > 0 ? 1 : 0.25 }}
                  />
                </div>
                <span className="font-bold tabular-nums">{formatBRL(r.total)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Grouped Installments List */}
      <section className="lh-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Meus Parcelamentos ({visibleGroups.length})</h3>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'cartao', 'moto', 'seguro', 'outro'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterKind(k)}
                className={`rounded-xl px-2.5 py-1 text-xs font-semibold transition ${
                  filterKind === k
                    ? 'bg-brand-600 text-white'
                    : 'border opacity-75 hover:opacity-100'
                }`}
                style={filterKind === k ? undefined : { borderColor: 'var(--lh-card-border)' }}
              >
                {k === 'all' ? 'Todos' : KIND_META[k].label}
              </button>
            ))}
            <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
              />
              Só ativos
            </label>
          </div>
        </div>

        {visibleGroups.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            Nenhum parcelamento encontrado neste filtro. Cadastre acima compras no cartão, parcela da moto, seguro ou carnês.
          </p>
        ) : (
          <div className="space-y-3">
            {visibleGroups.map((g) => {
              const meta = KIND_META[g.kind];
              const Icon = meta.icon;
              const pct = g.totalCount > 0 ? Math.round((g.paidCount / g.totalCount) * 100) : 0;
              const expanded = expandedGroupId === g.groupId;

              return (
                <div
                  key={g.groupId}
                  className="rounded-2xl border p-3.5 transition"
                  style={{ borderColor: 'var(--lh-card-border)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.badgeClass}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-sm font-bold">{g.title}</h4>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
                            {g.issuer ? `${meta.label} · ${g.issuer}` : meta.label}
                          </span>
                          {g.isFamily && (
                            <span className="rounded-full bg-pink-500/15 px-2 py-0.5 text-[10px] font-semibold text-pink-400">
                              Família
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {g.totalCount === 1 ? (
                            <>
                              <strong>1x · {formatBRL(g.parcelAmount)}</strong> ·{' '}
                              {g.paidCount === 1
                                ? 'Pago!'
                                : g.nextDueDate
                                  ? `Vencimento: ${formatDateBR(g.nextDueDate)}`
                                  : 'Em aberto'}
                            </>
                          ) : (
                            <>
                              <strong>{formatBRL(g.parcelAmount)}</strong>/mês · {g.paidCount}/{g.totalCount} pagas · Falta{' '}
                              <strong className="text-amber-500">{formatBRL(g.remainingAmount)}</strong>
                              {g.nextDueDate ? ` · Próxima: ${formatDateBR(g.nextDueDate)}` : ' · Quitado!'}
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {g.remainingCount > 0 && (
                        <button
                          type="button"
                          onClick={() => handlePayNext(g)}
                          className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />{' '}
                          {g.totalCount === 1 ? 'Marcar paga' : 'Pagar próxima'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedGroupId(expanded ? null : g.groupId)}
                        className="lh-btn-secondary py-1.5 text-xs"
                      >
                        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {g.totalCount === 1 ? 'Detalhes' : 'Parcelas'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(g)}
                        title="Excluir parcelamento inteiro"
                        className="rounded-xl border border-rose-500/30 p-1.5 text-rose-500 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Expandable individual installments */}
                  {expanded && (
                    <div className="mt-3 grid gap-1.5 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3" style={{ borderColor: 'var(--lh-card-border)' }}>
                      {g.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={async () => {
                            if (!db) return;
                            await toggleTransactionStatus(db, item.id);
                            bumpDataVersion();
                          }}
                          className={`flex items-center justify-between rounded-xl border px-2.5 py-2 text-left text-xs transition ${
                            item.status === 'realized'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                              : 'border-slate-500/20 hover:border-brand-500/40'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {item.status === 'realized' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            )}
                            <span>
                              {item.installment_number}/{item.installment_total} · {formatDateBR(item.date)}
                            </span>
                          </span>
                          <span className="font-bold tabular-nums">{formatBRL(item.amount)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
