import React, { useEffect, useState } from 'react';
import { Bike, Calculator, Check, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { GroupedBarChart } from '../components/GroupedBarChart';
import { Modal } from '../components/Modal';
import { useApp } from '../context/AppContext';
import {
  createVehicle,
  createVehicleExpense,
  deleteVehicle,
  deleteVehicleExpense,
  deleteWorkSession,
  getWorkDashboardStats,
  listVehicleExpenses,
  listVehicles,
  listWorkSessions,
  setActiveVehicle,
  updateWorkSession,
} from '../repositories/workRepo';
import {
  calculateWorkSessionMetrics,
  simulateWorkScenario,
  type WorkPeriodSummary,
} from '../services/calculations';
import { buildWorkSessionsCsv, downloadTextFile } from '../services/reports';
import {
  PLATFORM_LABELS,
  type Vehicle,
  type VehicleExpense,
  type VehicleExpenseCategory,
  type VehicleStatus,
  type WorkDaysPerWeek,
  type WorkPlatform,
  type WorkSession,
} from '../types/domain';
import { formatBRL, formatDateBR, formatNumber, todayISO } from '../utils/format';

export const WorkPage: React.FC = () => {
  const { db, settings, dataVersion, bumpDataVersion, openQuickAction, notify } = useApp();
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleExpenses, setVehicleExpenses] = useState<VehicleExpense[]>([]);
  const [stats, setStats] = useState<{
    currentWeek: WorkPeriodSummary;
    last7Days: WorkPeriodSummary;
    last30Days: WorkPeriodSummary;
    activeVehiclePayment: number;
  } | null>(null);

  // New vehicle form
  const [vehName, setVehName] = useState('');
  const [vehYear, setVehYear] = useState('');
  const [vehStatus, setVehStatus] = useState<VehicleStatus>('owned');
  const [vehValue, setVehValue] = useState('');
  const [vehPayment, setVehPayment] = useState('0');
  const [vehMaint, setVehMaint] = useState('0.18');
  const [vehDeprec, setVehDeprec] = useState('0.10');

  // New vehicle expense form
  const [expVehId, setExpVehId] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expCat, setExpCat] = useState<VehicleExpenseCategory>('manutencao');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(todayISO());

  // Scenario simulator state (explicitly educational, never overwrites real DB data)
  const [simDays, setSimDays] = useState<WorkDaysPerWeek>(5);
  const [simHours, setSimHours] = useState('6.5');
  const [simGrossPerHour, setSimGrossPerHour] = useState('32');
  const [simKmPerHour, setSimKmPerHour] = useState('18');
  const [simFuelPerKm, setSimFuelPerKm] = useState('0.19');
  const [simVehiclePayment, setSimVehiclePayment] = useState('0');

  // Platform filter & Edit work session modal
  const [platformFilter, setPlatformFilter] = useState<'all' | WorkPlatform>('all');
  const [editingWs, setEditingWs] = useState<WorkSession | null>(null);
  const [editWsDate, setEditWsDate] = useState('');
  const [editWsPlatform, setEditWsPlatform] = useState<WorkPlatform>('ambos');
  const [editWsStart, setEditWsStart] = useState('06:00');
  const [editWsEnd, setEditWsEnd] = useState('12:30');
  const [editWsGross, setEditWsGross] = useState('');
  const [editWsKm, setEditWsKm] = useState('');
  const [editWsFuelCost, setEditWsFuelCost] = useState('');
  const [editWsFuelLiters, setEditWsFuelLiters] = useState('');
  const [editWsTolls, setEditWsTolls] = useState('0');
  const [editWsNotes, setEditWsNotes] = useState('');

  useEffect(() => {
    if (!db || !settings) return;
    let active = true;
    (async () => {
      const [ws, vehs, vExps, st] = await Promise.all([
        listWorkSessions(db),
        listVehicles(db),
        listVehicleExpenses(db),
        getWorkDashboardStats(db, settings, todayISO()),
      ]);
      if (active) {
        setSessions(ws);
        setVehicles(vehs);
        setVehicleExpenses(vExps);
        setStats(st);
        setSimDays(settings.work_days_per_week);
        if (vehs[0] && !expVehId) setExpVehId(vehs[0].id);
        if (st.last30Days.grossPerHour > 0) {
          setSimGrossPerHour(String(st.last30Days.grossPerHour));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [db, settings, dataVersion]);

  if (!settings) return null;

  const simResult = simulateWorkScenario({
    workDaysPerWeek: simDays,
    hoursPerDay: Number(simHours) || 0,
    grossPerHour: Number(simGrossPerHour) || 0,
    kmPerHour: Number(simKmPerHour) || 0,
    fuelCostPerKm: Number(simFuelPerKm) || 0,
    maintenancePerKm: settings.maintenance_per_km,
    depreciationPerKm: settings.depreciation_per_km,
    vehicleMonthlyPayment: Number(simVehiclePayment) || 0,
    monthlyNetGoal: settings.monthly_net_goal,
  });

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createVehicle(db, {
        name: vehName,
        model_year: vehYear,
        status: vehStatus,
        estimated_value: Number(vehValue) || 0,
        monthly_payment: Number(vehPayment) || 0,
        maintenance_per_km: Number(vehMaint) || 0.18,
        depreciation_per_km: Number(vehDeprec) || 0.1,
        is_active: vehicles.length === 0 ? 1 : 0,
      });
      setVehName('');
      setVehYear('');
      setVehValue('');
      setVehPayment('0');
      bumpDataVersion();
      notify('Veículo cadastrado.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao cadastrar veículo.', 'error');
    }
  };

  const handleAddVehicleExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !expVehId) {
      notify('Cadastre ou selecione um veículo primeiro.', 'error');
      return;
    }
    try {
      await createVehicleExpense(db, {
        vehicle_id: expVehId,
        date: expDate,
        category: expCat,
        description: expDesc,
        amount: Number(expAmount),
      });
      setExpDesc('');
      setExpAmount('');
      bumpDataVersion();
      notify('Despesa da moto registrada.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao registrar despesa.', 'error');
    }
  };

  const openEditWorkSession = (ws: WorkSession) => {
    setEditingWs(ws);
    setEditWsDate(ws.date);
    setEditWsPlatform(ws.platform);
    setEditWsStart(ws.start_time);
    setEditWsEnd(ws.end_time);
    setEditWsGross(String(ws.gross_amount));
    setEditWsKm(String(ws.km_total));
    setEditWsFuelCost(String(ws.fuel_cost));
    setEditWsFuelLiters(String(ws.fuel_liters));
    setEditWsTolls(String(ws.tolls_parking));
    setEditWsNotes(ws.notes);
  };

  const handleSaveEditWs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !editingWs) return;
    try {
      await updateWorkSession(db, editingWs.id, {
        vehicle_id: editingWs.vehicle_id,
        date: editWsDate,
        platform: editWsPlatform,
        start_time: editWsStart,
        end_time: editWsEnd,
        gross_amount: Number(editWsGross),
        km_total: Number(editWsKm),
        fuel_cost: Number(editWsFuelCost) || 0,
        fuel_liters: Number(editWsFuelLiters) || 0,
        tolls_parking: Number(editWsTolls) || 0,
        notes: editWsNotes,
      });
      setEditingWs(null);
      bumpDataVersion();
      notify('Jornada atualizada no SQLite.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar jornada.', 'error');
    }
  };

  const filteredSessions =
    platformFilter === 'all'
      ? sessions
      : sessions.filter((s) => s.platform === platformFilter);

  const cardClass = 'lh-card';
  const inputClass = 'lh-input';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="lh-page-title">Trabalho por Aplicativos (Uber Moto / 99Moto)</h2>
          <p className="lh-page-subtitle">
            Financeiro verdadeiro: bruto, combustível, pedágio, manutenção/km, depreciação e parcela do veículo sempre separados. (iFood fora do escopo).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={sessions.length === 0}
            onClick={() => {
              const csv = buildWorkSessionsCsv(sessions);
              downloadTextFile(csv, `lifehub-jornadas-${todayISO()}.csv`);
              notify('Relatório CSV de jornadas exportado.');
            }}
            className="lh-btn-secondary"
          >
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => openQuickAction('work_session')}
            className="lh-btn-primary"
          >
            <Plus className="h-4 w-4" /> Registrar Jornada
          </button>
        </div>
      </div>

      {/* Period KPIs */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={cardClass}>
            <p className="text-xs text-slate-500">Semana Atual — Bruto</p>
            <p className="mt-1 text-2xl font-bold">{formatBRL(stats.currentWeek.totalGross)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {formatNumber(stats.currentWeek.totalHours, 1)}h ·{' '}
              {formatNumber(stats.currentWeek.totalKm, 1)} km
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500">Líquido Operacional (Semana)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-500">
              {formatBRL(stats.currentWeek.totalOperationalNet)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Combustível {formatBRL(stats.currentWeek.totalFuelCost)} · Manut. est.{' '}
              {formatBRL(stats.currentWeek.totalMaintenance)}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500">Indicadores Reais (30 dias)</p>
            <p className="mt-1 text-xl font-bold">
              {formatBRL(stats.last30Days.operationalNetPerHour)}/h líq.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Bruto/h: {formatBRL(stats.last30Days.grossPerHour)} · Líq./km:{' '}
              {formatBRL(stats.last30Days.operationalNetPerKm)}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-slate-500">
              Meta ({settings.work_days_per_week} dias/sem)
            </p>
            <p className="mt-1 text-xl font-bold">
              {formatBRL(stats.currentWeek.dailyNetGoal)}/dia
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Semana: {formatBRL(stats.currentWeek.weeklyNetGoal)} · Deprec. sem:{' '}
              {formatBRL(stats.currentWeek.totalDepreciation)}
            </p>
          </div>
        </div>
      )}

      {/* Recent sessions visual chart */}
      {sessions.length > 0 && (
        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">
            Evolução Recente (Bruto vs. Líquido Operacional — últimas jornadas)
          </h3>
          <GroupedBarChart
            items={[...sessions]
              .slice(0, 7)
              .reverse()
              .map((s) => {
                const m = calculateWorkSessionMetrics(s);
                return {
                  label: formatDateBR(s.date).slice(0, 5),
                  primaryValue: m.gross,
                  secondaryValue: Math.max(0, m.operationalNet),
                };
              })}
            primaryLabel="Bruto"
            secondaryLabel="Líquido Operacional"
            primaryColorClass="fill-indigo-500"
            secondaryColorClass="fill-emerald-500"
          />
        </section>
      )}

      {/* Sessions table */}
      <section className={cardClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">
            Jornadas Registradas ({filteredSessions.length})
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value as 'all' | WorkPlatform)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="all">Todas plataformas</option>
              <option value="uber_moto">Uber Moto</option>
              <option value="99_moto">99Moto</option>
              <option value="ambos">Uber + 99</option>
            </select>
          </div>
        </div>

        {filteredSessions.length === 0 ? (
          <EmptyState
            title="Nenhuma jornada registrada"
            description="Registre suas jornadas de Uber Moto ou 99Moto para calcular lucro líquido real por hora e por km."
            actionLabel="+ Jornada Uber/99"
            onAction={() => openQuickAction('work_session')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="lh-table text-xs tabular-nums">
              <thead>
                <tr>
                  <th className="py-2.5 pr-3">Data</th>
                  <th className="py-2.5 pr-3">Plataforma</th>
                  <th className="py-2.5 pr-3">Horário</th>
                  <th className="py-2.5 pr-3 text-right">Km</th>
                  <th className="py-2.5 pr-3 text-right">Bruto</th>
                  <th className="py-2.5 pr-3 text-right">Comb.</th>
                  <th className="py-2.5 pr-3 text-right">Manut. est.</th>
                  <th className="py-2.5 pr-3 text-right">Deprec.</th>
                  <th className="py-2.5 pr-3 text-right">Líq. Oper.</th>
                  <th className="py-2.5 pr-3 text-right">Líq./h</th>
                  <th className="py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s) => {
                  const m = calculateWorkSessionMetrics(s);
                  return (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-3 font-mono">{formatDateBR(s.date)}</td>
                      <td className="py-2.5 pr-3 font-medium">{PLATFORM_LABELS[s.platform]}</td>
                      <td className="py-2.5 pr-3 font-mono">
                        {s.start_time}–{s.end_time} ({formatNumber(m.durationHours, 1)}h)
                      </td>
                      <td className="py-2.5 pr-3 text-right">{formatNumber(m.km, 1)}</td>
                      <td className="py-2.5 pr-3 text-right font-medium">{formatBRL(m.gross)}</td>
                      <td className="py-2.5 pr-3 text-right text-rose-400">
                        {formatBRL(m.fuelCost)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-amber-400">
                        {formatBRL(m.estimatedMaintenance)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-slate-400">
                        {formatBRL(m.estimatedDepreciation)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-emerald-500">
                        {formatBRL(m.operationalNet)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-medium">
                        {formatBRL(m.operationalNetPerHour)}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditWorkSession(s)}
                            className="text-slate-400 hover:text-brand-500"
                            aria-label="Editar jornada"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!db) return;
                              await deleteWorkSession(db, s.id);
                              bumpDataVersion();
                              notify('Jornada excluída.');
                            }}
                            className="text-slate-400 hover:text-rose-500"
                            aria-label="Excluir jornada"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Scenario simulator */}
      <section className={cardClass}>
        <div className="mb-3 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-brand-500" />
          <h3 className="font-semibold">Painel de Cenários (4, 5 ou 6 dias/semana + Moto)</h3>
        </div>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Simulação educativa para tomada de decisão. Valores de financiamento são ilustrativos (sujeitos a orçamento e CET) e nunca alteram seus registros reais.
        </p>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-[11px] font-medium">Dias/semana</label>
            <select
              value={simDays}
              onChange={(e) => setSimDays(Number(e.target.value) as WorkDaysPerWeek)}
              className={inputClass}
            >
              <option value={4}>4 dias</option>
              <option value={5}>5 dias</option>
              <option value={6}>6 dias</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">Horas/dia</label>
            <input
              type="number"
              step="0.5"
              value={simHours}
              onChange={(e) => setSimHours(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">Bruto/h (R$)</label>
            <input
              type="number"
              step="1"
              value={simGrossPerHour}
              onChange={(e) => setSimGrossPerHour(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">Km/hora</label>
            <input
              type="number"
              step="1"
              value={simKmPerHour}
              onChange={(e) => setSimKmPerHour(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">Comb./km (R$)</label>
            <input
              type="number"
              step="0.01"
              value={simFuelPerKm}
              onChange={(e) => setSimFuelPerKm(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">Parcela moto (R$/mês)</label>
            <input
              type="number"
              step="10"
              value={simVehiclePayment}
              onChange={(e) => setSimVehiclePayment(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/60 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-slate-500">Bruto mensal est.</p>
            <p className="text-base font-bold">{formatBRL(simResult.monthlyGross)}</p>
            <p className="text-[11px] text-slate-400">
              {formatNumber(simResult.monthlyHours, 0)}h · {formatNumber(simResult.monthlyKm, 0)} km
            </p>
          </div>
          <div>
            <p className="text-slate-500">Combustível + Manut.</p>
            <p className="text-base font-bold text-rose-400">
              {formatBRL(simResult.monthlyFuel + simResult.monthlyMaintenance)}
            </p>
            <p className="text-[11px] text-slate-400">
              Depreciação à parte: {formatBRL(simResult.monthlyDepreciation)}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Líquido operacional</p>
            <p className="text-base font-bold text-emerald-500">
              {formatBRL(simResult.monthlyOperationalNet)}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Após parcela moto</p>
            <p className="text-base font-bold">{formatBRL(simResult.monthlyNetAfterVehicle)}</p>
            <p className="text-[11px] text-slate-400">
              Após deprec.: {formatBRL(simResult.monthlyNetAfterVehicleAndDepreciation)}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Vs meta ({formatBRL(settings.monthly_net_goal)})</p>
            <p
              className={`text-base font-bold ${
                simResult.meetsGoal ? 'text-emerald-500' : 'text-amber-500'
              }`}
            >
              {simResult.goalGap >= 0 ? '+' : ''}
              {formatBRL(simResult.goalGap)}
            </p>
            <p className="text-[11px] text-slate-400">
              {simResult.meetsGoal ? 'Atende à meta' : 'Abaixo da meta'}
            </p>
          </div>
        </div>
      </section>

      {/* Vehicles & Vehicle Expenses */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <div className="mb-3 flex items-center gap-2">
            <Bike className="h-4 w-4 text-brand-500" />
            <h3 className="font-semibold">Motos / Veículos</h3>
          </div>
          {vehicles.length === 0 ? (
            <p className="mb-4 text-xs text-slate-500">
              Cadastre sua moto atual (ou um veículo planejado) para controlar custos/km e parcela fixa.
            </p>
          ) : (
            <ul className="mb-4 space-y-2">
              {vehicles.map((v) => (
                <li
                  key={v.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">
                        {v.name} {v.model_year}
                      </p>
                      {v.is_active === 1 && (
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                          Ativo
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                        {v.status === 'owned'
                          ? 'Quitada'
                          : v.status === 'financed'
                            ? 'Financiada'
                            : 'Planejada'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Valor est.: {formatBRL(v.estimated_value)} · Parcela:{' '}
                      {formatBRL(v.monthly_payment)}/mês · Manut.: R${' '}
                      {formatNumber(v.maintenance_per_km, 2)}/km · Deprec.: R${' '}
                      {formatNumber(v.depreciation_per_km, 2)}/km
                    </p>
                    {v.notes && <p className="mt-1 text-[11px] text-slate-400">{v.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {v.is_active === 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!db) return;
                          await setActiveVehicle(db, v.id);
                          bumpDataVersion();
                          notify('Veículo ativo alterado.');
                        }}
                        className="rounded-md bg-slate-100 p-1 text-slate-600 hover:bg-brand-600 hover:text-white dark:bg-slate-800 dark:text-slate-300"
                        title="Definir como ativo"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (!db) return;
                        await deleteVehicle(db, v.id);
                        bumpDataVersion();
                      }}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddVehicle} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <input
              required
              placeholder="Modelo (ex.: Fazer 150)"
              value={vehName}
              onChange={(e) => setVehName(e.target.value)}
              className={`${inputClass} col-span-2 sm:col-span-2`}
            />
            <input
              placeholder="Ano"
              value={vehYear}
              onChange={(e) => setVehYear(e.target.value)}
              className={inputClass}
            />
            <select
              value={vehStatus}
              onChange={(e) => setVehStatus(e.target.value as VehicleStatus)}
              className={inputClass}
            >
              <option value="owned">Quitada</option>
              <option value="financed">Financiada</option>
              <option value="planned">Planejada</option>
            </select>
            <input
              type="number"
              placeholder="Valor est. (R$)"
              value={vehValue}
              onChange={(e) => setVehValue(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Parcela/mês (R$)"
              value={vehPayment}
              onChange={(e) => setVehPayment(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Manut./km"
              value={vehMaint}
              onChange={(e) => setVehMaint(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Deprec./km"
              value={vehDeprec}
              onChange={(e) => setVehDeprec(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              + Veículo
            </button>
          </form>
        </section>

        <section className={cardClass}>
          <h3 className="mb-3 font-semibold">Despesas Reais da Moto</h3>
          {vehicleExpenses.length === 0 ? (
            <p className="mb-4 text-xs text-slate-500">
              Registre trocas de óleo, pneus, revisões, IPVA, seguro ou parcelas pagas.
            </p>
          ) : (
            <ul className="mb-4 max-h-56 space-y-2 overflow-y-auto">
              {vehicleExpenses.map((ex) => (
                <li
                  key={ex.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
                >
                  <div>
                    <p className="font-medium">{ex.description}</p>
                    <p className="text-slate-500">
                      {formatDateBR(ex.date)} · {ex.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-rose-500">{formatBRL(ex.amount)}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!db) return;
                        await deleteVehicleExpense(db, ex.id);
                        bumpDataVersion();
                      }}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddVehicleExpense} className="grid grid-cols-2 gap-2">
            <select
              value={expVehId}
              onChange={(e) => setExpVehId(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecione a moto</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              value={expCat}
              onChange={(e) => setExpCat(e.target.value as VehicleExpenseCategory)}
              className={inputClass}
            >
              <option value="oleo">Óleo</option>
              <option value="manutencao">Manutenção</option>
              <option value="pneu">Pneu</option>
              <option value="financiamento">Financiamento</option>
              <option value="seguro">Seguro</option>
              <option value="ipva">IPVA</option>
              <option value="outro">Outro</option>
            </select>
            <input
              required
              placeholder="Descrição (ex.: Troca de óleo)"
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              className={`${inputClass} col-span-2`}
            />
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Valor (R$)"
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              className={inputClass}
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className={inputClass}
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                +
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Edit Work Session Modal */}
      <Modal
        open={Boolean(editingWs)}
        title="Editar Jornada Uber/99"
        onClose={() => setEditingWs(null)}
      >
        <form onSubmit={handleSaveEditWs} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input
                required
                type="date"
                value={editWsDate}
                onChange={(e) => setEditWsDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Plataforma</label>
              <select
                value={editWsPlatform}
                onChange={(e) => setEditWsPlatform(e.target.value as WorkPlatform)}
                className={inputClass}
              >
                <option value="ambos">Uber Moto + 99Moto</option>
                <option value="uber_moto">Uber Moto</option>
                <option value="99_moto">99Moto</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Início</label>
              <input
                required
                type="time"
                value={editWsStart}
                onChange={(e) => setEditWsStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Fim</label>
              <input
                required
                type="time"
                value={editWsEnd}
                onChange={(e) => setEditWsEnd(e.target.value)}
                className={inputClass}
              />
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
                value={editWsGross}
                onChange={(e) => setEditWsGross(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Km rodados</label>
              <input
                required
                type="number"
                step="0.1"
                min="0"
                value={editWsKm}
                onChange={(e) => setEditWsKm(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Combustível (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editWsFuelCost}
                onChange={(e) => setEditWsFuelCost(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Litros</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editWsFuelLiters}
                onChange={(e) => setEditWsFuelLiters(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Pedágio/Estac.</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editWsTolls}
                onChange={(e) => setEditWsTolls(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Observações</label>
            <input
              value={editWsNotes}
              onChange={(e) => setEditWsNotes(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingWs(null)}
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
    </div>
  );
};
