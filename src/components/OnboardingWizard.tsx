import React, { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Briefcase,
  Building2,
  Copy,
  HardDrive,
  KeyRound,
  LogIn,
  QrCode,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  generateSyncPassphrase,
  loadCloudSyncConfig,
  saveCloudSyncConfig,
  syncDatabaseWithCloud,
} from '../services/cloudSync';
import { loadDemoData } from '../services/demoSeed';
import { loadGeminiAiConfig, saveGeminiAiConfig } from '../services/geminiAi';
import {
  generateGoogleDriveAppsScriptCode,
  loadGoogleDriveConfig,
  saveGoogleDriveConfig,
  signInWithGoogleDriveOAuth,
  syncDatabaseWithGoogleDrive,
  type GoogleDriveSyncMode,
} from '../services/googleDriveSync';
import type { ChildWeekendMode, RoutineMode, WorkDaysPerWeek } from '../types/domain';
import { QrCodeScannerModal, type ScannedPairingResult } from './QrCodeScannerModal';
import { WindowTitleBar } from './WindowTitleBar';

type OnboardingStage = 'welcome' | 'google' | 'offline_setup';

const MODE_OPTIONS: Array<{
  id: RoutineMode;
  title: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'clt',
    title: 'Trabalho CLT',
    desc: 'Turno fixo + deslocamento + estudos e treinos ajustados',
    icon: Building2,
  },
  {
    id: 'apps',
    title: 'Aplicativos',
    desc: 'Uber Moto / 99Moto com custos por km e meta semanal',
    icon: Bike,
  },
  {
    id: 'ti',
    title: 'Emprego TI',
    desc: 'Horário comercial com saúde, família e certificações',
    icon: Briefcase,
  },
];

function resolveCurrentDeviceName(): string {
  const plat = Capacitor.getPlatform();
  if (plat === 'android') return 'Android App';
  if (plat === 'ios') return 'iPhone App';
  return 'Windows Desktop';
}

export const OnboardingWizard: React.FC = () => {
  const { db, settings, patchSettings, reloadSettings, bumpDataVersion, notify } = useApp();

  const [stage, setStage] = useState<OnboardingStage>('welcome');
  const [scannerOpen, setScannerOpen] = useState(false);

  // Offline setup form state
  const [userName, setUserName] = useState(settings?.user_name ?? '');
  const [routineMode, setRoutineMode] = useState<RoutineMode>(settings?.routine_mode ?? 'clt');
  const [workDays, setWorkDays] = useState<WorkDaysPerWeek>(settings?.work_days_per_week ?? 5);
  const [monthlyGoal, setMonthlyGoal] = useState(String(settings?.monthly_net_goal ?? 3500));
  const [cltRef, setCltRef] = useState(String(settings?.clt_reference_net ?? 2745));
  const [childMode, setChildMode] = useState<ChildWeekendMode>(
    settings?.child_weekend_mode ?? 'alternating',
  );
  const [childAnchor, setChildAnchor] = useState(settings?.child_weekend_anchor ?? '');
  const [commuteMinutes, setCommuteMinutes] = useState(String(settings?.commute_minutes ?? 60));

  // Google Drive setup state
  const initialDrive = useMemo(() => loadGoogleDriveConfig(), []);
  const [driveMode, setDriveMode] = useState<GoogleDriveSyncMode>('oauth');
  const [oauthClientId, setOauthClientId] = useState(initialDrive.oauthClientId);
  const [appsScriptUrl, setAppsScriptUrl] = useState(initialDrive.appsScriptUrl);
  const [appsScriptSecret, setAppsScriptSecret] = useState(initialDrive.appsScriptSecret);
  const [drivePassphrase, setDrivePassphrase] = useState(
    () => initialDrive.customPassphrase || loadCloudSyncConfig().passphrase || generateSyncPassphrase(),
  );

  const [saving, setSaving] = useState(false);

  const handleQrPaired = async (paired: ScannedPairingResult) => {
    if (!db) return;
    setScannerOpen(false);
    setSaving(true);
    try {
      const deviceName = resolveCurrentDeviceName();
      const nextCfg = {
        ...loadCloudSyncConfig(deviceName),
        enabled: true,
        autoSync: true,
        endpointUrl: paired.endpointUrl,
        passphrase: paired.passphrase,
        deviceName,
      };
      saveCloudSyncConfig(nextCfg);

      if (paired.geminiApiKey) {
        const curAi = loadGeminiAiConfig();
        saveGeminiAiConfig({
          ...curAi,
          apiKey: paired.geminiApiKey,
          updatedAt: new Date().toISOString(),
        });
      }

      const result = await syncDatabaseWithCloud(db, nextCfg);
      saveCloudSyncConfig({
        ...nextCfg,
        lastSyncedAt: result.syncedAt,
        lastRevision: result.revision,
      });

      await patchSettings({ onboarding_completed: 1 });
      await reloadSettings();
      bumpDataVersion({ skipAutoSync: true });
      notify(
        result.remoteHadData
          ? `Conectado ao PC! ${result.mergedRowCount} registros sincronizados (rev. ${result.revision}).`
          : 'Pareado com o PC! Cofre E2EE conectado e pronto para sincronizar.',
      );
    } catch (err) {
      notify(
        err instanceof Error
          ? `Não foi possível sincronizar com o PC: ${err.message}`
          : 'Erro ao conectar com o PC.',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleGoogleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    const cleanKey = drivePassphrase.trim();
    if (cleanKey.length < 8) {
      notify('A Chave Secreta E2EE deve ter pelo menos 8 caracteres.', 'error');
      return;
    }

    setSaving(true);
    try {
      const deviceName = resolveCurrentDeviceName();
      const baseCfg = loadGoogleDriveConfig();
      let accessToken: string | undefined;
      let email = baseCfg.googleUserEmail;

      if (driveMode === 'oauth') {
        const auth = await signInWithGoogleDriveOAuth(oauthClientId);
        accessToken = auth.accessToken;
        email = auth.email ?? email;
      }

      const nextDriveCfg = {
        ...baseCfg,
        enabled: true,
        mode: driveMode,
        autoSync: true,
        customPassphrase: cleanKey,
        oauthClientId: oauthClientId.trim(),
        googleUserEmail: email,
        appsScriptUrl: appsScriptUrl.trim(),
        appsScriptSecret: appsScriptSecret.trim(),
        updatedAt: new Date().toISOString(),
      };
      saveGoogleDriveConfig(nextDriveCfg);

      const res = await syncDatabaseWithGoogleDrive(db, nextDriveCfg, {
        accessToken,
        deviceName,
      });
      saveGoogleDriveConfig({
        ...nextDriveCfg,
        driveFileId: res.fileId ?? nextDriveCfg.driveFileId,
        lastSyncedAt: res.syncedAt,
        lastRevision: res.revision,
      });

      await patchSettings({ onboarding_completed: 1 });
      await reloadSettings();
      bumpDataVersion({ skipAutoSync: true });
      notify(
        res.remoteHadData
          ? `Conta Google conectada! ${res.mergedRowCount} registros restaurados do seu Google Drive.`
          : 'Conta Google conectada! Cofre E2EE criado na pasta LifeHub do seu Google Drive.',
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Erro ao conectar com o Google Drive.',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCopyDriveScript = async () => {
    try {
      const code = generateGoogleDriveAppsScriptCode(appsScriptSecret.trim() || 'SEU-TOKEN-SECRETO');
      await navigator.clipboard.writeText(code);
      notify('Código Apps Script copiado! Cole em script.google.com e publique como App da Web.');
    } catch {
      notify('Abra Configurações → Google Drive depois para visualizar e copiar o código.', 'info');
    }
  };

  const handleSkipOfflineDirect = async () => {
    setSaving(true);
    try {
      await patchSettings({ onboarding_completed: 1 });
      notify('Modo 100% offline ativado! Você pode conectar PC ou Google Drive quando quiser em Configurações.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao iniciar offline.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOffline = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await patchSettings({
        user_name: userName.trim(),
        routine_mode: routineMode,
        work_days_per_week: workDays,
        monthly_net_goal: Number(monthlyGoal) || 0,
        clt_reference_net: Number(cltRef) || 0,
        child_weekend_mode: childMode,
        child_weekend_anchor: childMode === 'alternating' && childAnchor ? childAnchor : null,
        commute_minutes: Number(commuteMinutes) || 0,
        onboarding_completed: 1,
      });
      notify('Configuração inicial salva localmente no SQLite.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar configuração.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDemo = async () => {
    if (!db) return;
    setSaving(true);
    try {
      await loadDemoData(db);
      await reloadSettings();
      bumpDataVersion();
      notify('Dados de demonstração carregados. Você pode limpá-los em Configurações.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar dados demo.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lh-app-shell flex h-full flex-col overflow-hidden text-slate-100">
      <WindowTitleBar />
      <div className="lh-scroll-region lh-safe-top lh-safe-bottom relative flex flex-1 items-start justify-center bg-[#070b14] p-4 sm:items-center sm:p-6">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
          <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
        </div>

        <div className="relative my-2 w-full max-w-2xl rounded-3xl border border-white/[0.09] bg-[#0d1425]/95 p-5 shadow-2xl backdrop-blur-xl animate-scale-in sm:p-8">
          {/* Header */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-700 text-white shadow-glow">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="8" className="opacity-40" />
                <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                Bem-vindo ao LifeHub
              </h1>
              <p className="text-xs text-slate-400 sm:text-sm">
                {stage === 'welcome'
                  ? 'Escolha como deseja começar — conectado ao seu PC, na sua conta Google ou 100% offline.'
                  : stage === 'google'
                    ? 'Sincronize seu cofre criptografado (AES-256-GCM) direto na pasta LifeHub do seu Google Drive.'
                    : 'Configure sua rotina inicial localmente. Tudo fica salvo no SQLite do seu aparelho.'}
              </p>
            </div>
          </div>

          {/* STAGE 1: WELCOME CHOICE (Conectar no PC / Conta Google / Offline) */}
          {stage === 'welcome' && (
            <div className="space-y-4">
              <div className="grid gap-3">
                {/* Option 1: Conectar no PC via QR Code */}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setScannerOpen(true)}
                  className="group flex w-full items-start gap-4 rounded-2xl border border-brand-500/35 bg-brand-500/10 p-4 text-left transition hover:border-brand-400 hover:bg-brand-500/15 disabled:opacity-50"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-brand-400">
                    <QrCode className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-white">Conectar ao PC (QR Code ou Link)</p>
                      <span className="rounded-full bg-brand-500/25 px-2 py-0.5 text-[10px] font-semibold text-brand-300">
                        Mais rápido p/ celular
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">
                      Já usa o LifeHub no computador? Escaneie o QR Code do PC (ou cole o link) para puxar todas as suas finanças, agenda e chave IA automaticamente.
                    </p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-brand-400 transition group-hover:translate-x-0.5" />
                </button>

                {/* Option 2: Entrar com Conta Google (Google Drive E2EE) */}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setStage('google')}
                  className="group flex w-full items-start gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.08] p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-500/15 disabled:opacity-50"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                    <HardDrive className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-white">Entrar com Conta Google (Google Drive)</p>
                      <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        Cofre E2EE no seu Drive
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">
                      Salve ou restaure seu banco criptografado direto na sua conta Google Drive — funciona mesmo sem depender de nenhum servidor externo.
                    </p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-emerald-400 transition group-hover:translate-x-0.5" />
                </button>

                {/* Option 3: Usar Offline (Sem conectar a nada) */}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setStage('offline_setup')}
                  className="group flex w-full items-start gap-4 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-4 text-left transition hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-700/60 text-slate-200">
                    <WifiOff className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-white">Começar Offline (Sem conectar a nada)</p>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                        100% local
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">
                      Use sem conta, sem login e sem nuvem. Tudo fica salvo no SQLite deste dispositivo e você pode conectar PC ou Google Drive depois nas Configurações.
                    </p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Criptografia ponta a ponta AES-256-GCM · Privacidade total
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSkipOfflineDirect}
                  className="font-semibold text-brand-400 hover:underline"
                >
                  Entrar direto sem configurar →
                </button>
              </div>
            </div>
          )}

          {/* STAGE 2A: CONTA GOOGLE (GOOGLE DRIVE E2EE) */}
          {stage === 'google' && (
            <form onSubmit={handleGoogleConnect} className="space-y-4">
              <button
                type="button"
                onClick={() => setStage('welcome')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar para as opções iniciais
              </button>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDriveMode('oauth')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    driveMode === 'oauth'
                      ? 'bg-brand-600 text-white'
                      : 'border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <LogIn className="h-3.5 w-3.5" /> Login Google (OAuth 2.0)
                </button>
                <button
                  type="button"
                  onClick={() => setDriveMode('apps_script')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    driveMode === 'apps_script'
                      ? 'bg-emerald-600 text-white'
                      : 'border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5" /> Drive Vault Direto (Sem OAuth)
                </button>
              </div>

              {driveMode === 'oauth' ? (
                <div className="space-y-3 rounded-2xl border border-brand-500/25 bg-brand-500/[0.06] p-3.5">
                  <p className="text-xs leading-relaxed text-slate-300">
                    Informe seu <strong>Google OAuth Client ID</strong> (escopo restrito <code>drive.file</code>) para entrar com sua conta Google e criar/restaurar <code>LifeHub/lifehub-vault-e2ee.json</code>.
                  </p>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-200">
                      Google OAuth 2.0 Client ID
                    </label>
                    <input
                      required
                      value={oauthClientId}
                      onChange={(e) => setOauthClientId(e.target.value)}
                      placeholder="1234567890-xxxx.apps.googleusercontent.com"
                      className="lh-input font-mono text-xs"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-300">
                      Cole a URL do seu <strong>Google Apps Script</strong> (cria o cofre no seu Drive sem OAuth).
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyDriveScript}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25"
                    >
                      <Copy className="h-3 w-3" /> Copiar Script
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-200">
                        URL Web App (/exec)
                      </label>
                      <input
                        required
                        type="url"
                        value={appsScriptUrl}
                        onChange={(e) => setAppsScriptUrl(e.target.value)}
                        placeholder="https://script.google.com/macros/s/.../exec"
                        className="lh-input font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-200">
                        Token Secreto
                      </label>
                      <input
                        required
                        value={appsScriptSecret}
                        onChange={(e) => setAppsScriptSecret(e.target.value)}
                        className="lh-input font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                    <KeyRound className="h-3.5 w-3.5 text-brand-400" />
                    Chave Secreta E2EE (use a mesma do PC para restaurar ou gere uma nova)
                  </label>
                  <button
                    type="button"
                    onClick={() => setDrivePassphrase(generateSyncPassphrase())}
                    className="text-[11px] font-semibold text-brand-400 hover:underline"
                  >
                    Gerar nova
                  </button>
                </div>
                <input
                  required
                  value={drivePassphrase}
                  onChange={(e) => setDrivePassphrase(e.target.value)}
                  placeholder="Mínimo 8 caracteres (ex.: LH-XXXX-XXXX-XXXX-XXXX)"
                  className="lh-input font-mono text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStage('offline_setup')}
                  className="text-xs text-slate-400 hover:text-white hover:underline"
                >
                  Prefiro começar offline primeiro
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="lh-btn-primary px-5 py-2.5 text-sm"
                >
                  {saving
                    ? 'Conectando ao Google Drive...'
                    : driveMode === 'oauth'
                      ? 'Entrar com Google e Sincronizar'
                      : 'Conectar ao Google Drive'}
                </button>
              </div>
            </form>
          )}

          {/* STAGE 2B: OFFLINE LOCAL SETUP */}
          {stage === 'offline_setup' && (
            <form onSubmit={handleSaveOffline} className="space-y-5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStage('welcome')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Voltar (PC / Google / Offline)
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSkipOfflineDirect}
                  className="text-xs font-semibold text-brand-400 hover:underline"
                >
                  Pular e entrar direto →
                </button>
              </div>

              {/* Visual routine mode selector */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Modo de rotina atual
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {MODE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = routineMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setRoutineMode(opt.id)}
                        className={`rounded-2xl border p-3.5 text-left transition ${
                          active
                            ? 'border-brand-500 bg-brand-500/15 shadow-glow'
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]'
                        }`}
                      >
                        <Icon
                          className={`h-5 w-5 ${active ? 'text-brand-400' : 'text-slate-400'}`}
                        />
                        <p className="mt-2 text-sm font-semibold text-white">{opt.title}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Como prefere ser chamado (opcional)
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Ex.: Wagner"
                    className="lh-input"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Dias de trabalho por semana
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {([4, 5, 6] as WorkDaysPerWeek[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setWorkDays(d)}
                        className={`rounded-xl border py-2 text-xs font-semibold transition ${
                          workDays === d
                            ? 'border-brand-500 bg-brand-600 text-white'
                            : 'border-white/[0.08] bg-slate-950/70 text-slate-300 hover:border-white/[0.18]'
                        }`}
                      >
                        {d} dias
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Meta líquida mensal (R$)
                  </label>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    value={monthlyGoal}
                    onChange={(e) => setMonthlyGoal(e.target.value)}
                    className="lh-input tabular-nums"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Ref. líquido CLT (R$)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={cltRef}
                    onChange={(e) => setCltRef(e.target.value)}
                    className="lh-input tabular-nums"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Deslocamento médio (min)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="360"
                    value={commuteMinutes}
                    onChange={(e) => setCommuteMinutes(e.target.value)}
                    className="lh-input tabular-nums"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Fins de semana com filho
                  </label>
                  <select
                    value={childMode}
                    onChange={(e) => setChildMode(e.target.value as ChildWeekendMode)}
                    className="lh-input"
                  >
                    <option value="all">Todos os fins de semana</option>
                    <option value="alternating">Fins de semana alternados (quinzenal)</option>
                    <option value="custom">Manual no calendário</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Data âncora (se alternado)
                  </label>
                  <input
                    type="date"
                    disabled={childMode !== 'alternating'}
                    value={childAnchor}
                    onChange={(e) => setChildAnchor(e.target.value)}
                    className="lh-input disabled:opacity-40"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Opcional: o app nunca presume uma data inicial automaticamente.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5 text-xs text-slate-300">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  Privacidade garantida: começa <strong>limpo, sem dados financeiros inventados</strong>, não solicita credenciais da Uber/99 e funciona 100% offline.
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleLoadDemo}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  Explorar com dados de demonstração
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="lh-btn-primary px-6 py-2.5 text-sm"
                >
                  {saving ? 'Salvando...' : 'Começar com banco limpo'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <QrCodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onPaired={handleQrPaired}
      />
    </div>
  );
};
