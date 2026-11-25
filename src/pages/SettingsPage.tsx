import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  Database,
  Download,
  FolderOpen,
  Moon,
  Palette,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isTauriRuntime } from '../db/client';
import { runMigrations } from '../db/migrations';
import {
  clearAllUserData,
  exportBackupJson,
  restoreBackupJson,
} from '../services/backup';
import { loadDemoData } from '../services/demoSeed';
import {
  CLASSIC_SKINS,
  CONCEPT_SKINS,
  REFERENCE_SKINS,
  SHELL_LAYOUT_LABELS,
  UI_SKINS,
  type SkinDefinition,
  type SkinGroup,
} from '../services/skins';
import type { ChildWeekendMode, RoutineMode, ThemeMode, WorkDaysPerWeek } from '../types/domain';
import { todayISO } from '../utils/format';

export const SettingsPage: React.FC = () => {
  const { db, settings, patchSettings, reloadSettings, bumpDataVersion, notify } = useApp();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sqliteFileInputRef = useRef<HTMLInputElement | null>(null);

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
  const [nativeDbPath, setNativeDbPath] = useState<string | null>(null);
  const [skinTab, setSkinTab] = useState<'all' | SkinGroup>('concept');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    invoke<string>('get_db_file_path')
      .then((p) => setNativeDbPath(p))
      .catch(() => setNativeDbPath(null));
  }, []);

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

  const handleImportSqliteFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!db.importBinary) {
      notify(
        'No modo Tauri desktop, restaure via Backup JSON ou substitua lifehub.db na pasta de dados do app com o aplicativo fechado.',
        'info',
      );
      if (sqliteFileInputRef.current) sqliteFileInputRef.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      await db.importBinary(new Uint8Array(buffer));
      await runMigrations(db);
      await reloadSettings();
      bumpDataVersion();
      notify('Banco SQLite (.sqlite) restaurado e migrado com sucesso.');
    } catch (err) {
      notify(
        err instanceof Error ? `Arquivo SQLite inválido: ${err.message}` : 'Erro ao restaurar SQLite.',
        'error',
      );
    } finally {
      setBusy(false);
      if (sqliteFileInputRef.current) sqliteFileInputRef.current.value = '';
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

  const cardClass = 'lh-card';
  const inputClass = 'lh-input';

  const handleSelectSkinCard = async (skin: SkinDefinition) => {
    setTheme(skin.preferredTheme);
    await patchSettings({ ui_skin: skin.id, theme: skin.preferredTheme });
    notify(`Skin "${skin.name}" ativada.`);
  };

  const renderSkinCard = (skin: SkinDefinition) => {
    const active = (settings.ui_skin ?? 'orbital') === skin.id;
    const isDarkPreview = skin.preferredTheme === 'dark';
    const subtleBar = isDarkPreview ? 'bg-white/25' : 'bg-slate-900/20';
    const fainterBar = isDarkPreview ? 'bg-white/15' : 'bg-slate-900/12';
    const borderMock =
      skin.id === 'ref_linhas_dia'
        ? 'border-2 border-[#141414]'
        : isDarkPreview
          ? 'border border-white/15'
          : 'border border-black/15';

    const renderMiniStructure = () => {
      if (skin.shell === 'top-nav') {
        return (
          <div className="flex flex-1 flex-col gap-1.5">
            <div
              className="flex h-4 items-center justify-between rounded-md px-1.5"
              style={{ backgroundColor: skin.swatches[1] }}
            >
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: skin.swatches[2] }} />
                <div className={`h-1.5 w-6 rounded-sm ${subtleBar}`} />
                <div className={`h-1.5 w-5 rounded-sm ${fainterBar}`} />
                <div className={`h-1.5 w-5 rounded-sm ${fainterBar}`} />
              </div>
              <div className="h-2 w-4 rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
            </div>
            <div className="grid flex-1 grid-cols-3 gap-1.5">
              <div className="col-span-2 rounded-md p-1" style={{ backgroundColor: skin.swatches[1] }}>
                <div className="h-1.5 w-8 rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
              </div>
              <div className="rounded-md p-1" style={{ backgroundColor: skin.swatches[1] }}>
                <div className={`h-1.5 w-6 rounded-sm ${subtleBar}`} />
              </div>
            </div>
          </div>
        );
      }

      if (skin.shell === 'bottom-dock') {
        return (
          <div className="flex flex-1 flex-col justify-between gap-1">
            <div className="grid flex-1 grid-cols-3 gap-1">
              <div className="rounded-md p-1" style={{ backgroundColor: skin.swatches[1] }}>
                <div className="h-1.5 w-5 rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
              </div>
              <div className="rounded-md p-1" style={{ backgroundColor: skin.swatches[1] }}>
                <div className={`h-1.5 w-6 rounded-sm ${subtleBar}`} />
              </div>
              <div className="rounded-md p-1" style={{ backgroundColor: skin.swatches[1] }}>
                <div className={`h-1.5 w-4 rounded-sm ${fainterBar}`} />
              </div>
            </div>
            <div className="mx-auto flex h-3.5 w-3/4 items-center justify-center gap-1 rounded-full px-2" style={{ backgroundColor: skin.swatches[1] }}>
              <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: skin.swatches[2] }} />
              <span className={`h-1.5 w-1.5 rounded-full ${subtleBar}`} />
              <span className={`h-1.5 w-1.5 rounded-full ${subtleBar}`} />
              <span className={`h-1.5 w-1.5 rounded-full ${subtleBar}`} />
            </div>
          </div>
        );
      }

      if (skin.shell === 'icon-rail') {
        return (
          <>
            <div
              className="mr-1.5 flex w-4 flex-col items-center gap-1 rounded-md py-1"
              style={{ backgroundColor: skin.swatches[1] }}
            >
              <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
              <div className="h-1.5 w-1.5 rounded-sm bg-white/30" />
              <div className="h-1.5 w-1.5 rounded-sm bg-white/20" />
            </div>
            <div className="grid flex-1 grid-cols-3 gap-1">
              <div className="rounded-md border border-black/10 bg-white/70 p-1 dark:bg-white/10">
                <div className="h-1.5 w-5 rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
              </div>
              <div className="rounded-md border border-black/10 bg-white/70 p-1 dark:bg-white/10">
                <div className={`h-1.5 w-5 rounded-sm ${subtleBar}`} />
              </div>
              <div className="rounded-md border border-black/10 bg-white/70 p-1 dark:bg-white/10">
                <div className={`h-1.5 w-4 rounded-sm ${fainterBar}`} />
              </div>
            </div>
          </>
        );
      }

      return (
        <>
          <div
            className={`mr-1.5 w-8 p-1 ${skin.shell === 'floating-island' ? 'rounded-lg shadow-sm' : 'rounded-md'}`}
            style={{ backgroundColor: skin.swatches[1] }}
          >
            <div className="h-1.5 w-full rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
            <div className={`mt-1 h-1 w-4/5 rounded-sm ${skin.shell === 'dual-tone-sidebar' ? 'bg-white/30' : subtleBar}`} />
            <div className={`mt-1 h-1 w-3/5 rounded-sm ${skin.shell === 'dual-tone-sidebar' ? 'bg-white/20' : fainterBar}`} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <div
              className="flex h-4 items-center justify-between rounded-md px-1.5"
              style={{ backgroundColor: skin.shell === 'dual-tone-sidebar' && !isDarkPreview ? '#ffffff' : skin.swatches[1] }}
            >
              <div className={`h-1.5 w-10 rounded-sm ${subtleBar}`} />
              <div className="h-2 w-5 rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
            </div>
            <div className="grid flex-1 grid-cols-2 gap-1.5">
              <div
                className="rounded-md p-1"
                style={{ backgroundColor: skin.shell === 'dual-tone-sidebar' && !isDarkPreview ? '#ffffff' : skin.swatches[1] }}
              >
                <div className="h-1.5 w-6 rounded-sm" style={{ backgroundColor: skin.swatches[2] }} />
              </div>
              <div
                className="rounded-md p-1"
                style={{ backgroundColor: skin.shell === 'dual-tone-sidebar' && !isDarkPreview ? '#ffffff' : skin.swatches[1] }}
              >
                <div className={`h-1.5 w-8 rounded-sm ${subtleBar}`} />
              </div>
            </div>
          </div>
        </>
      );
    };

    return (
      <button
        key={skin.id}
        type="button"
        onClick={() => handleSelectSkinCard(skin)}
        className={`group rounded-2xl border p-3.5 text-left transition ${
          active
            ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/40'
            : 'border-slate-200/80 hover:border-brand-400/60 dark:border-white/[0.08] dark:hover:border-brand-400/50'
        }`}
      >
        {/* Structural mini desktop mockup */}
        <div
          className={`mb-3 flex h-16 overflow-hidden rounded-xl p-1.5 ${borderMock}`}
          style={{ backgroundColor: skin.swatches[0] }}
        >
          {renderMiniStructure()}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{skin.name}</p>
          {active ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-500/20 px-2 py-0.5 text-[10px] font-semibold text-brand-500">
              <Check className="h-3 w-3" /> Ativa
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
              {isDarkPreview ? <Moon className="h-2.5 w-2.5" /> : <Sun className="h-2.5 w-2.5" />}
              {SHELL_LAYOUT_LABELS[skin.shell]}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {skin.tagline}
        </p>
        {skin.sourceRef && (
          <p className="mt-1.5 truncate font-mono text-[10px] text-slate-400 dark:text-slate-500">
            {skin.sourceRef}
          </p>
        )}
      </button>
    );
  };

  const displayedGallerySkins =
    skinTab === 'concept'
      ? CONCEPT_SKINS
      : skinTab === 'reference'
        ? REFERENCE_SKINS
        : skinTab === 'classic'
          ? CLASSIC_SKINS
          : UI_SKINS;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="lh-page-title">Configurações, Skins, Rotina & Backup</h2>
        <p className="lh-page-subtitle">
          Troque visual, estrutura de navegação e layout do dashboard ao vivo entre {UI_SKINS.length} skins ({CONCEPT_SKINS.length} ideias Dribbble/Figma/Behance + {REFERENCE_SKINS.length} referências locais + {CLASSIC_SKINS.length} clássicas).
        </p>
      </div>

      {/* Live Skin Gallery */}
      <section className={cardClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-brand-500" />
            <h3 className="font-semibold">Galeria de Skins & Arquiteturas ({UI_SKINS.length} estilos)</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['concept', `Ideias Web (${CONCEPT_SKINS.length})`],
                ['reference', `Referências Locais (${REFERENCE_SKINS.length})`],
                ['classic', `Clássicas (${CLASSIC_SKINS.length})`],
                ['all', `Todas (${UI_SKINS.length})`],
              ] as Array<['all' | SkinGroup, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSkinTab(key)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  skinTab === key
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'border border-slate-200/80 text-slate-600 hover:border-brand-400 dark:border-white/[0.08] dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {displayedGallerySkins.map(renderSkinCard)}
        </div>
      </section>

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
          <code>{db.driverName}</code>
          {nativeDbPath ? (
            <>
              {' '}· Arquivo local: <code className="break-all">{nativeDbPath}</code>
            </>
          ) : null}
          .
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
            onClick={() => sqliteFileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold hover:border-brand-500 dark:border-slate-700"
          >
            <Upload className="h-4 w-4" /> Restaurar SQLite (.sqlite)
          </button>
          <input
            ref={sqliteFileInputRef}
            type="file"
            accept=".sqlite,.db,.sqlite3"
            onChange={handleImportSqliteFile}
            className="hidden"
          />

          {isTauriRuntime() && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  await invoke('open_data_folder');
                } catch (err) {
                  notify(
                    err instanceof Error ? err.message : 'Não foi possível abrir a pasta de dados.',
                    'error',
                  );
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold hover:border-brand-500 dark:border-slate-700"
            >
              <FolderOpen className="h-4 w-4" /> Abrir Pasta do Banco
            </button>
          )}

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
