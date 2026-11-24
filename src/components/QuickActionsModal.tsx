import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  createCalendarEvent,
  createRecurringWeeklyEvents,
  createTask,
} from '../repositories/calendarRepo';
import { createTransaction, listAccounts, listCategories } from '../repositories/financeRepo';
import { createIdea } from '../repositories/ideasRepo';
import {
  createWorkSession,
  getLastRecordedOdometer,
  listVehicles,
} from '../repositories/workRepo';
import { isChildWeekend } from '../services/recurrence';
import {
  EVENT_CATEGORY_META,
  type Account,
  type Category,
  type EventCategory,
  type TaskPriority,
  type TransactionSourceType,
  type TransactionStatus,
  type TransactionType,
  type Vehicle,
  type WorkPlatform,
} from '../types/domain';
import { todayISO } from '../utils/format';
import { Modal } from './Modal';

export const QuickActionsModal: React.FC = () => {
  const { db, settings, quickAction, openQuickAction, bumpDataVersion, notify } = useApp();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Transaction state
  const [txType, setTxType] = useState<TransactionType>('expense');
  const [txSource, setTxSource] = useState<TransactionSourceType>('outros');
  const [txDesc, setTxDesc] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txDate, setTxDate] = useState(todayISO());
  const [txStatus, setTxStatus] = useState<TransactionStatus>('realized');
  const [txAccount, setTxAccount] = useState('acc_principal');
  const [txDestAccount, setTxDestAccount] = useState('acc_carteira');
  const [txCategory, setTxCategory] = useState('cat_alimentacao');
  const [txInstallments, setTxInstallments] = useState('1');

  // Work session state
  const [wsDate, setWsDate] = useState(todayISO());
  const [wsPlatform, setWsPlatform] = useState<WorkPlatform>('ambos');
  const [wsStart, setWsStart] = useState('06:00');
  const [wsEnd, setWsEnd] = useState('12:30');
  const [wsGross, setWsGross] = useState('');
  const [wsKmMode, setWsKmMode] = useState<'total' | 'odometer'>('total');
  const [wsKmTotal, setWsKmTotal] = useState('');
  const [wsKmStart, setWsKmStart] = useState('');
  const [wsKmEnd, setWsKmEnd] = useState('');
  const [wsFuelLiters, setWsFuelLiters] = useState('');
  const [wsFuelCost, setWsFuelCost] = useState('');
  const [wsTolls, setWsTolls] = useState('0');
  const [wsVehicleId, setWsVehicleId] = useState('');
  const [wsSyncFinance, setWsSyncFinance] = useState(false);
  const [wsNotes, setWsNotes] = useState('');

  // Event state
  const [evTitle, setEvTitle] = useState('');
  const [evCategory, setEvCategory] = useState<EventCategory>('geral');
  const [evDate, setEvDate] = useState(todayISO());
  const [evStart, setEvStart] = useState('09:00');
  const [evEnd, setEvEnd] = useState('10:00');
  const [evRepeatWeeks, setEvRepeatWeeks] = useState('1');
  const [evNotes, setEvNotes] = useState('');

  // Task state
  const [tkTitle, setTkTitle] = useState('');
  const [tkPriority, setTkPriority] = useState<TaskPriority>('medium');
  const [tkDueDate, setTkDueDate] = useState(todayISO());
  const [tkCategory, setTkCategory] = useState('geral');

  // Idea state
  const [idTitle, setIdTitle] = useState('');
  const [idDesc, setIdDesc] = useState('');
  const [idTags, setIdTags] = useState('');
  const [idImpact, setIdImpact] = useState('4');
  const [idEffort, setIdEffort] = useState('2');

  useEffect(() => {
    if (!db || !quickAction) return;
    (async () => {
      const [accs, cats, vehs, lastOdo] = await Promise.all([
        listAccounts(db),
        listCategories(db),
        listVehicles(db),
        getLastRecordedOdometer(db),
      ]);
      setAccounts(accs);
      setCategories(cats);
      setVehicles(vehs);
      if (accs[0]) setTxAccount(accs[0].id);
      if (accs[1]) setTxDestAccount(accs[1].id);
      const activeVeh = vehs.find((v) => v.is_active === 1);
      setWsVehicleId(activeVeh?.id ?? '');
      if (lastOdo != null && !wsKmStart) {
        setWsKmStart(String(lastOdo));
      }
    })();
  }, [db, quickAction]);

  if (!quickAction || !db || !settings) return null;

  const close = () => openQuickAction(null);

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createTransaction(db, {
        account_id: txAccount,
        destination_account_id: txType === 'transfer' ? txDestAccount : null,
        category_id: txType === 'transfer' ? null : txCategory,
        type: txType,
        source_type: txSource,
        description: txDesc,
        amount: Number(txAmount),
        date: txDate,
        status: txStatus,
        installments: Number(txInstallments) || 1,
      });
      setTxDesc('');
      setTxAmount('');
      setTxInstallments('1');
      bumpDataVersion();
      notify('Transação salva com sucesso.');
      close();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar transação.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWorkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const grossNum = Number(wsGross);
      const fuelCostNum = Number(wsFuelCost) || 0;
      const tollsNum = Number(wsTolls) || 0;

      const created = await createWorkSession(
        db,
        {
          vehicle_id: wsVehicleId || null,
          date: wsDate,
          platform: wsPlatform,
          start_time: wsStart,
          end_time: wsEnd,
          gross_amount: grossNum,
          km_start: wsKmMode === 'odometer' ? Number(wsKmStart) : null,
          km_end: wsKmMode === 'odometer' ? Number(wsKmEnd) : null,
          km_total: wsKmMode === 'total' ? Number(wsKmTotal) : null,
          fuel_liters: Number(wsFuelLiters) || 0,
          fuel_cost: fuelCostNum,
          tolls_parking: tollsNum,
          notes: wsNotes,
        },
        settings,
      );

      if (wsSyncFinance && accounts[0]) {
        const targetAcc = accounts[0].id;
        if (grossNum > 0) {
          await createTransaction(db, {
            account_id: targetAcc,
            category_id: 'cat_apps',
            type: 'income',
            source_type: 'aplicativos',
            description: `Jornada ${wsPlatform === 'uber_moto' ? 'Uber Moto' : wsPlatform === '99_moto' ? '99Moto' : 'Uber/99'} (${created.km_total} km)`,
            amount: grossNum,
            date: wsDate,
            status: 'realized',
            notes: `Vinculado à jornada ${created.id}`,
          });
        }
        if (fuelCostNum + tollsNum > 0) {
          await createTransaction(db, {
            account_id: targetAcc,
            category_id: 'cat_combustivel',
            type: 'expense',
            source_type: 'aplicativos',
            description: `Combustível/pedágio jornada (${created.km_total} km)`,
            amount: fuelCostNum + tollsNum,
            date: wsDate,
            status: 'realized',
            notes: `Vinculado à jornada ${created.id}`,
          });
        }
      }

      setWsGross('');
      setWsKmTotal('');
      setWsKmStart(wsKmMode === 'odometer' && wsKmEnd ? wsKmEnd : wsKmStart);
      setWsKmEnd('');
      setWsFuelLiters('');
      setWsFuelCost('');
      setWsTolls('0');
      setWsSyncFinance(false);
      setWsNotes('');
      bumpDataVersion();
      notify(
        wsSyncFinance
          ? 'Jornada Uber/99 registrada e lançada no Financeiro.'
          : 'Jornada Uber/99 registrada no SQLite.',
      );
      close();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao registrar jornada.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const childWeekendConflict =
    evCategory === 'trabalho' &&
    isChildWeekend(evDate, settings.child_weekend_mode, settings.child_weekend_anchor);

  const handleEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const weeks = Math.max(1, Number(evRepeatWeeks) || 1);
      if (weeks > 1) {
        const res = await createRecurringWeeklyEvents(
          db,
          {
            title: evTitle,
            category: evCategory,
            date: evDate,
            start_time: evStart,
            end_time: evEnd,
            weeks,
            notes: evNotes,
            skipChildWeekends: evCategory === 'trabalho',
          },
          settings,
        );
        notify(
          `${res.created.length} evento(s) recorrente(s) salvo(s)${
            res.skippedChildWeekends > 0
              ? ` (${res.skippedChildWeekends} fim(ns) de semana com filho preservado(s))`
              : ''
          }.`,
        );
      } else {
        await createCalendarEvent(db, {
          title: evTitle,
          category: evCategory,
          start_at: `${evDate}T${evStart}:00`,
          end_at: `${evDate}T${evEnd}:00`,
          notes: evNotes,
        });
        notify('Compromisso salvo no calendário.');
      }
      setEvTitle('');
      setEvRepeatWeeks('1');
      setEvNotes('');
      bumpDataVersion();
      close();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar compromisso.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createTask(db, {
        title: tkTitle,
        priority: tkPriority,
        due_date: tkDueDate || null,
        category: tkCategory,
      });
      setTkTitle('');
      bumpDataVersion();
      notify('Tarefa adicionada.');
      close();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar tarefa.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleIdeaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createIdea(db, {
        title: idTitle,
        description: idDesc,
        tags: idTags,
        impact: Number(idImpact),
        effort: Number(idEffort),
      });
      setIdTitle('');
      setIdDesc('');
      setIdTags('');
      bumpDataVersion();
      notify('Ideia capturada no Kanban.');
      close();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao capturar ideia.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const titles: Record<Exclude<typeof quickAction, null>, string> = {
    transaction: 'Nova Transação',
    work_session: 'Registrar Jornada Uber Moto / 99Moto',
    event: 'Novo Compromisso',
    task: 'Nova Tarefa',
    idea: 'Capturar Ideia',
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

  return (
    <Modal open={true} title={titles[quickAction]} onClose={close}>
      {quickAction === 'transaction' && (
        <form onSubmit={handleTransactionSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(['expense', 'income', 'transfer'] as TransactionType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTxType(t)}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  txType === t
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {t === 'expense' ? 'Despesa' : t === 'income' ? 'Receita' : 'Transferência'}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Descrição</label>
            <input
              required
              value={txDesc}
              onChange={(e) => setTxDesc(e.target.value)}
              placeholder="Ex.: Combustível, Mercado, Contracheque..."
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor total (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input
                required
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Conta</label>
              <select
                value={txAccount}
                onChange={(e) => setTxAccount(e.target.value)}
                className={inputClass}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {txType === 'transfer' ? (
              <div>
                <label className="mb-1 block text-xs font-medium">Conta destino</label>
                <select
                  value={txDestAccount}
                  onChange={(e) => setTxDestAccount(e.target.value)}
                  className={inputClass}
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
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                  className={inputClass}
                >
                  {categories
                    .filter((c) => c.kind === 'both' || c.kind === txType)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Origem</label>
              <select
                value={txSource}
                onChange={(e) => setTxSource(e.target.value as TransactionSourceType)}
                className={inputClass}
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
                value={txStatus}
                onChange={(e) => setTxStatus(e.target.value as TransactionStatus)}
                className={inputClass}
              >
                <option value="realized">Realizado</option>
                <option value="planned">Previsto</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Parcelas</label>
              <input
                type="number"
                min="1"
                max="120"
                value={txInstallments}
                onChange={(e) => setTxInstallments(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      {quickAction === 'work_session' && (
        <form onSubmit={handleWorkSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input
                required
                type="date"
                value={wsDate}
                onChange={(e) => setWsDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Plataforma</label>
              <select
                value={wsPlatform}
                onChange={(e) => setWsPlatform(e.target.value as WorkPlatform)}
                className={inputClass}
              >
                <option value="ambos">Uber Moto + 99Moto</option>
                <option value="uber_moto">Uber Moto</option>
                <option value="99_moto">99Moto</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Início</label>
              <input
                required
                type="time"
                value={wsStart}
                onChange={(e) => setWsStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Fim</label>
              <input
                required
                type="time"
                value={wsEnd}
                onChange={(e) => setWsEnd(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Veículo</label>
              <select
                value={wsVehicleId}
                onChange={(e) => setWsVehicleId(e.target.value)}
                className={inputClass}
              >
                <option value="">Padrão (Configurações)</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Faturamento Bruto (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0"
                value={wsGross}
                onChange={(e) => setWsGross(e.target.value)}
                placeholder="Ex.: 210.00"
                className={inputClass}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium">Quilometragem</label>
                <button
                  type="button"
                  onClick={() =>
                    setWsKmMode((m) => (m === 'total' ? 'odometer' : 'total'))
                  }
                  className="text-[11px] font-medium text-brand-500 hover:underline"
                >
                  {wsKmMode === 'total' ? 'Usar odômetro' : 'Usar km total'}
                </button>
              </div>
              {wsKmMode === 'total' ? (
                <input
                  required
                  type="number"
                  step="0.1"
                  min="0"
                  value={wsKmTotal}
                  onChange={(e) => setWsKmTotal(e.target.value)}
                  placeholder="Ex.: 115"
                  className={inputClass}
                />
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    required
                    type="number"
                    step="0.1"
                    min="0"
                    value={wsKmStart}
                    onChange={(e) => setWsKmStart(e.target.value)}
                    placeholder="Km inic."
                    className={inputClass}
                  />
                  <input
                    required
                    type="number"
                    step="0.1"
                    min="0"
                    value={wsKmEnd}
                    onChange={(e) => setWsKmEnd(e.target.value)}
                    placeholder="Km final"
                    className={inputClass}
                  />
                </div>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
            <input
              type="checkbox"
              checked={wsSyncFinance}
              onChange={(e) => setWsSyncFinance(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            Lançar também no Financeiro (receita bruta + despesa de combustível/pedágio)
          </label>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Combustível (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={wsFuelCost}
                onChange={(e) => setWsFuelCost(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Litros</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={wsFuelLiters}
                onChange={(e) => setWsFuelLiters(e.target.value)}
                placeholder="0.0"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Pedágio / Estac. (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={wsTolls}
                onChange={(e) => setWsTolls(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Observações</label>
            <input
              value={wsNotes}
              onChange={(e) => setWsNotes(e.target.value)}
              placeholder="Região, trânsito, clima..."
              className={inputClass}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : 'Registrar Jornada'}
            </button>
          </div>
        </form>
      )}

      {quickAction === 'event' && (
        <form onSubmit={handleEventSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Título</label>
            <input
              required
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              placeholder="Ex.: Academia, Entrevista TI, Passeio..."
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Categoria</label>
              <select
                value={evCategory}
                onChange={(e) => setEvCategory(e.target.value as EventCategory)}
                className={inputClass}
              >
                {Object.entries(EVENT_CATEGORY_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input
                required
                type="date"
                value={evDate}
                onChange={(e) => setEvDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {childWeekendConflict && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 text-xs text-amber-300">
              Atenção: esta data cai em um <strong>fim de semana reservado para o filho</strong>. Só confirme este evento de trabalho se for uma decisão consciente.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Início</label>
              <input
                required
                type="time"
                value={evStart}
                onChange={(e) => setEvStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Fim</label>
              <input
                required
                type="time"
                value={evEnd}
                onChange={(e) => setEvEnd(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Repetir (semanas)</label>
              <input
                type="number"
                min="1"
                max="26"
                value={evRepeatWeeks}
                onChange={(e) => setEvRepeatWeeks(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Notas</label>
            <input
              value={evNotes}
              onChange={(e) => setEvNotes(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : 'Salvar Compromisso'}
            </button>
          </div>
        </form>
      )}

      {quickAction === 'task' && (
        <form onSubmit={handleTaskSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Título da tarefa</label>
            <input
              required
              value={tkTitle}
              onChange={(e) => setTkTitle(e.target.value)}
              placeholder="Ex.: Atualizar currículo de infraestrutura"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Prioridade</label>
              <select
                value={tkPriority}
                onChange={(e) => setTkPriority(e.target.value as TaskPriority)}
                className={inputClass}
              >
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Prazo</label>
              <input
                type="date"
                value={tkDueDate}
                onChange={(e) => setTkDueDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Categoria</label>
              <input
                value={tkCategory}
                onChange={(e) => setTkCategory(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : 'Criar Tarefa'}
            </button>
          </div>
        </form>
      )}

      {quickAction === 'idea' && (
        <form onSubmit={handleIdeaSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Título</label>
            <input
              required
              value={idTitle}
              onChange={(e) => setIdTitle(e.target.value)}
              placeholder="Ex.: Script de automação ou projeto de portfólio"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Descrição</label>
            <textarea
              rows={3}
              value={idDesc}
              onChange={(e) => setIdDesc(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Tags</label>
              <input
                value={idTags}
                onChange={(e) => setIdTags(e.target.value)}
                placeholder="ti, automacao"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Impacto (1–5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={idImpact}
                onChange={(e) => setIdImpact(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Esforço (1–5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={idEffort}
                onChange={(e) => setIdEffort(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : 'Capturar Ideia'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
