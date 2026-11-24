import React, { useRef, useState } from 'react';
import {
  Database,
  Download,
  Moon,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  clearAllUserData,
  exportBackupJson,
  restoreBackupJson,
} from '../services/backup';
import { loadDemoData } from '../services/demoSeed';
import type { ChildWeekendMode, RoutineMode, ThemeMode, WorkDaysPerWeek } from '../types/domain';
import { todayISO } from '../utils/format';

export const SettingsPage: React.FC = () => {
  const { db, settings, patchSettings, reloadSettings, bumpDataVersion, notify } = useApp();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [userName, setUserName] = useState(settings?.user_name ?? '');
  const [theme, setTheme] = useState<ThemeMode>(settings?.theme ?? 'dark');
  const [routineMode, setRoutineMode] = useState<RoutineMode>(settings?.routine_mode ?? 'clt');
  const [workDays, setWorkDays] = useState<WorkDaysPerWeek>(settings?.work_days_per_week ?? 5);
  const [monthlyGoal, setMonthlyGoal] = useState(String(settings?.monthly_net_goal ?? 3500));
  const [cltRef, setCltRef] = useState(String(settings?.clt_reference_net ?? 2745));
  const [maintPerKm, setMaintPerKm] = useState(String(settings?.maintenance_per_km ?? 0.18));
  const [deprecPerKm, setDeprecPerKm] = useState(String(settings?.depreciation_per_km ?? 0.1));
  const [vehiclePayment, setVehiclePayment] = useState(
    String(settings?.vehicle_monthly_payment ?? 0),
  );
  const [childMode, setChildMode] = useState<ChildWeekendMode>(
    settings?.child_weekend_mode ?? 'alternating',
  );
  const [childAnchor, setChildAnchor] = useState(settings?.child_weekend_anchor ?? '');
  const [commuteMin, setCommuteMin] = useState(String(settings?.commute_minutes ?? 60));
  const [studyGoal, setStudyGoal] = useState(String(settings?.study_weekly_goal_hours ?? 6));
  const [remindersEnabled, setRemindersEnabled] = useState(
    (settings?.reminders_enabled ?? 1) === 1,
  );
  const [busy, setBusy] = useState(false);

  if (!db || !settings) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await patchSettings({
        user_name: userName.trim(),
        theme,
        routine_mode: routineMode,
        work_days_per_week: workDays,
        monthly_net_goal: Number(monthlyGoal) || 0,
        clt_reference_net: Number(cltRef) || 0,
        maintenance_per_km: Number(maintPerKm) || 0,
        depreciation_per_km: Number(deprecPerKm) || 0,
        vehicle_monthly_payment: Number(vehiclePayment) || 0,
        child_weekend_mode: childMode,
        child_weekend_anchor: childMode === 'alternating' && childAnchor ? childAnchor : null,
        commute_minutes: Number(commuteMin) || 0,
        study_weekly_goal_hours: Number(studyGoal) || 6,
        reminders_enabled: remindersEnabled ? 1 : 0,
      });
      notify('Preferências salvas no SQLite.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar preferências.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = async () => {
    try {
      const backup = await exportBackupJson(db);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lifehub-backup-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify('Backup JSON exportado com sucesso.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao exportar backup.', 'error');
    }
  };

  const handleExportSqliteBinary = async () => {
    if (!db.exportBinary) {
      notify(
        'No modo Tauri desktop, o arquivo SQLite nativo fica salvo em AppData\\Roaming\\com.lifehub.desktop\\lifehub.db.',
        'info',
      );
      return;
    }
    const bytes = await db.exportBinary();
    if (!bytes) return;
    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy.buffer], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifehub-${todayISO()}.sqlite`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Arquivo SQLite (.sqlite) exportado.');
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await restoreBackupJson(db, parsed);
      await reloadSettings();
      bumpDataVersion();
      notify(`Backup restaurado com sucesso (${res.totalRows} registros em ${res.restoredTables} tabelas).`);
    } catch (err) {
      notify(
        err instanceof Error ? `Backup inválido: ${err.message}` : 'Erro ao restaurar backup.',
        'error',
      );
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadDemo = async () => {
    const ok = window.confirm(
      'Isso substituirá os dados atuais por dados de demonstração realistas. Deseja continuar?',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await loadDemoData(db);
      await reloadSettings();
      bumpDataVersion();
      notify('Dados de demonstração carregados.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    const ok = window.confirm(
      'Atenção: isso apagará todos os lançamentos locais (faça um backup JSON antes!). Confirmar limpeza total?',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await clearAllUserData(db);
      await patchSettings({ onboarding_completed: 1, demo_data_loaded: 0 });
      await reloadSettings();
      bumpDataVersion();
      notify('Banco limpo e reinicializado com padrões estruturais.');
    } finally {
      setBusy(false);
    }
  };

  const cardClass =
    'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900';
  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configurações, Rotina & Backup</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alterne entre CLT, Aplicativos e Emprego TI sem perder histórico. Exporte e restaure backups locais.
        </p>
      </div>

      {/* Main preferences */}
      <form onSubmit={handleSave} className={`${cardClass} space-y-5`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Preferências Gerais e Modo de Trabalho</h3>
          <button
            type="button"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700"
          >
            {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            Tema: {theme === 'dark' ? 'Escuro' : 'Claro'}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Nome</label>
            <input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Modo de Rotina</label>
            <select
              value={routineMode}
              onChange={(e) => setRoutineMode(e.target.value as RoutineMode)}
              className={inputClass}
            >
              <option value="clt">Trabalho CLT</option>
              <option value="apps">Trabalho por Aplicativos (Uber/99)</option>
              <option value="ti">Emprego de TI</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Dias de trabalho/sem</label>
            <select
              value={workDays}
              onChange={(e) => setWorkDays(Number(e.target.value) as WorkDaysPerWeek)}
              className={inputClass}
            >
              <option value={4}>4 dias/semana</option>
              <option value={5}>5 dias/semana</option>
              <option value={6}>6 dias/semana</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Meta líquida mensal (R$)</label>
            <input
              type="number"
              step="50"
              value={monthlyGoal}
              onChange={(e) => setMonthlyGoal(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Ref. líquido CLT (R$)</label>
            <input
              type="number"
              value={cltRef}
              onChange={(e) => setCltRef(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Manutenção est./km (R$)</label>
            <input
              type="number"
              step="0.01"
              value={maintPerKm}
              onChange={(e) => setMaintPerKm(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Depreciação est./km (R$)</label>
            <input
              type="number"
              step="0.01"
              value={deprecPerKm}
              onChange={(e) => setDeprecPerKm(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Parcela fixa moto (R$/mês)</label>
            <input
              type="number"
              step="10"
              value={vehiclePayment}
              onChange={(e) => setVehiclePayment(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Fins de semana com filho</label>
            <select
              value={childMode}
              onChange={(e) => setChildMode(e.target.value as ChildWeekendMode)}
              className={inputClass}
            >
              <option value="all">Todos</option>
              <option value="alternating">Alternados (quinzenal)</option>
              <option value="custom">Manual</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Data âncora (alternado)</label>
            <input
              type="date"
              disabled={childMode !== 'alternating'}
              value={childAnchor}
              onChange={(e) => setChildAnchor(e.target.value)}
              className={`${inputClass} disabled:opacity-40`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Deslocamento médio (min)</label>
            <input
              type="number"
              value={commuteMin}
              onChange={(e) => setCommuteMin(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Meta semanal estudos (h)</label>
            <input
              type="number"
              step="0.5"
              value={studyGoal}
              onChange={(e) => setStudyGoal(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={remindersEnabled}
            onChange={(e) => setRemindersEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-400"
          />
          Ativar lembretes locais discretos (vencimentos, agenda do dia e tarefas — sem exibir valores financeiros em R$).
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Salvando...' : 'Salvar Preferências'}
        </button>
      </form>

      {/* Backup & Restore */}
      <section className={cardClass}>
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-emerald-500" />
          <h3 className="font-semibold">Backup, Restauração & Dados Locais</h3>
        </div>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          O backup JSON exporta todas as tabelas com validação de integridade e restauração atômica (em transação SQLite). Driver ativo:{' '}
          <code>{db.driverName}</code>.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleExportJson}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Download className="h-4 w-4" /> Exportar Backup JSON
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold hover:border-brand-500 dark:border-slate-700"
          >
            <Upload className="h-4 w-4" /> Restaurar Backup JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportJsonFile}
            className="hidden"
          />

          <button
            type="button"
            disabled={busy}
            onClick={handleExportSqliteBinary}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold hover:border-brand-500 dark:border-slate-700"
          >
            <Database className="h-4 w-4" /> Exportar SQLite (.sqlite)
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleLoadDemo}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-500 hover:bg-amber-500/20"
          >
            <Sparkles className="h-4 w-4" /> Carregar Dados de Demonstração
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleClearAll}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/20"
          >
            <Trash2 className="h-4 w-4" /> Limpar Todos os Dados
          </button>
        </div>
      </section>

      {/* Planned future features (transparent, zero fake buttons) */}
      <section className={cardClass}>
        <h3 className="mb-2 font-semibold">Funcionalidades Futuras (Planejadas — fora do escopo atual)</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-slate-500 dark:text-slate-400">
          <li>
            <strong>Sincronização opcional com smartphone:</strong> prevista para etapa futura com criptografia ponta a ponta e consentimento explícito.
          </li>
          <li>
            <strong>Integração Google Calendar (OAuth):</strong> sincronização bidirecional somente mediante autorização do usuário.
          </li>
          <li>
            <strong>Resumos assistidos por IA local (opt-in):</strong> planejamento opcional sobre dados locais sem envio automático para nuvem.
          </li>
        </ul>
      </section>
    </div>
  );
};
