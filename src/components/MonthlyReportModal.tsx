import React, { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  buildMonthlyConsolidatedReport,
  formatMonthlyReportMarkdown,
  type MonthlyConsolidatedReport,
} from '../services/monthlyReport';
import { downloadTextFile } from '../services/reports';
import { currentMonthISO, formatBRL, formatNumber } from '../utils/format';
import { Modal } from './Modal';

export const MonthlyReportModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { db, notify } = useApp();
  const [month, setMonth] = useState(currentMonthISO());
  const [report, setReport] = useState<MonthlyConsolidatedReport | null>(null);

  useEffect(() => {
    if (!open || !db) return;
    let active = true;
    (async () => {
      const data = await buildMonthlyConsolidatedReport(db, month);
      if (active) setReport(data);
    })();
    return () => {
      active = false;
    };
  }, [open, db, month]);

  const handleExportMd = () => {
    if (!report) return;
    const md = formatMonthlyReportMarkdown(report);
    downloadTextFile(md, `lifehub-relatorio-${month}.md`, 'text/markdown;charset=utf-8');
    notify(`Relatório mensal (${month}) exportado em Markdown.`);
  };

  return (
    <Modal
      open={open}
      title="Relatório Mensal Consolidado"
      subtitle="Resumo factual completo gerado a partir do SQLite local."
      onClose={onClose}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExportMd}
              disabled={!report}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> Exportar Markdown (.md)
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold hover:border-brand-500 dark:border-slate-700"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
            </button>
          </div>
        </div>

        {report && (
          <div className="space-y-4 text-xs">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                <p className="text-slate-500">Financeiro Realizado</p>
                <p className="mt-1 text-lg font-bold text-emerald-500">
                  {formatBRL(report.finance.realizedNet)}
                </p>
                <p className="mt-1 text-slate-400">
                  +{formatBRL(report.finance.realizedIncome)} / -
                  {formatBRL(report.finance.realizedExpense)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                <p className="text-slate-500">Apps (Uber/99 Moto)</p>
                <p className="mt-1 text-lg font-bold">
                  {formatBRL(report.work.totalOperationalNet)} líq.
                </p>
                <p className="mt-1 text-slate-400">
                  {report.work.sessionsCount} jornadas · {formatNumber(report.work.totalHours, 1)}h ·{' '}
                  {formatNumber(report.work.totalKm, 0)} km
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                <p className="text-slate-500">Saúde, TI & Rotina</p>
                <p className="mt-1 text-lg font-bold">
                  {report.workoutsCount} treinos · {formatNumber(report.studyHours, 1)}h TI
                </p>
                <p className="mt-1 text-slate-400">
                  {report.applicationsSent} candidaturas · {report.tasksCompleted} tarefas feitas
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                <p className="mb-2 font-semibold">Composição de Receitas</p>
                <ul className="space-y-1 text-slate-500 dark:text-slate-300">
                  <li>Salário CLT: {formatBRL(report.finance.incomeBySource.salario ?? 0)}</li>
                  <li>Aplicativos: {formatBRL(report.finance.incomeBySource.aplicativos ?? 0)}</li>
                  <li>Serviços TI: {formatBRL(report.finance.incomeBySource.servicos_ti ?? 0)}</li>
                  <li>Outros: {formatBRL(report.finance.incomeBySource.outros ?? 0)}</li>
                </ul>
              </div>
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                <p className="mb-2 font-semibold">Detalhamento Operacional Apps</p>
                <ul className="space-y-1 text-slate-500 dark:text-slate-300">
                  <li>Bruto: {formatBRL(report.work.totalGross)}</li>
                  <li>Combustível: {formatBRL(report.work.totalFuelCost)}</li>
                  <li>Manutenção estimada: {formatBRL(report.work.totalMaintenance)}</li>
                  <li>Depreciação (separada): {formatBRL(report.work.totalDepreciation)}</li>
                  <li>Parcela moto no mês: {formatBRL(report.work.proportionalVehiclePayment)}</li>
                  <li className="font-semibold text-emerald-500">
                    Após parcela moto: {formatBRL(report.work.totalNetAfterVehicle)}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
