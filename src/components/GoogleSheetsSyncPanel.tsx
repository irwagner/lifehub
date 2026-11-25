import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  generateGoogleAppsScriptCode,
  generateSheetsSecretToken,
  isGoogleSheetsReady,
  loadGoogleSheetsConfig,
  saveGoogleSheetsConfig,
  syncFinanceToGoogleSheets,
  testGoogleSheetsConnection,
  type GoogleSheetsConfig,
} from '../services/googleSheetsSync';

export const GoogleSheetsSyncPanel: React.FC = () => {
  const { db, dataVersion, bumpDataVersion, notify } = useApp();
  const [config, setConfig] = useState<GoogleSheetsConfig>(() => loadGoogleSheetsConfig());
  const [webhookUrl, setWebhookUrl] = useState(config.webhookUrl);
  const [secretToken, setSecretToken] = useState(config.secretToken);
  const [autoSync, setAutoSync] = useState(config.autoSync);
  const [showScript, setShowScript] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fresh = loadGoogleSheetsConfig();
    setConfig(fresh);
    if (fresh.webhookUrl && !webhookUrl) {
      setWebhookUrl(fresh.webhookUrl);
      setSecretToken(fresh.secretToken);
      setAutoSync(fresh.autoSync);
    }
  }, [dataVersion]);

  const scriptCode = useMemo(() => generateGoogleAppsScriptCode(secretToken), [secretToken]);

  if (!db) return null;

  const persist = (overrides?: Partial<GoogleSheetsConfig>): GoogleSheetsConfig => {
    const next: GoogleSheetsConfig = {
      ...config,
      enabled: Boolean(webhookUrl.trim() && secretToken.trim().length >= 8),
      autoSync,
      webhookUrl: webhookUrl.trim(),
      secretToken: secretToken.trim(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
    saveGoogleSheetsConfig(next);
    setConfig(next);
    return next;
  };

  const handleCopyScript = async () => {
    try {
      persist();
      await navigator.clipboard.writeText(scriptCode);
      notify('Script pronto copiado! Cole em Extensões → Apps Script na sua planilha.');
    } catch {
      setShowScript(true);
      notify('Abra o código abaixo e copie manualmente.', 'info');
    }
  };

  const handleRegenerateToken = () => {
    const nextToken = generateSheetsSecretToken();
    setSecretToken(nextToken);
    persist({ secretToken: nextToken });
    notify('Novo Token Secreto gerado! Lembre de atualizar o script no Google Sheets.');
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const active = persist();
      const res = await testGoogleSheetsConnection(active);
      bumpDataVersion({ skipAutoSync: false });
      notify(res.message);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao conectar no Google Sheets.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      const active = persist();
      const res = await syncFinanceToGoogleSheets(db, active);
      persist({
        enabled: true,
        lastSyncedAt: res.syncedAt,
        lastRowCount: res.transactionsCount + res.recurringCount + res.workSessionsCount,
      });
      bumpDataVersion({ skipAutoSync: true });
      notify(
        `Google Sheets atualizado! ${res.transactionsCount} lançamentos, ${res.recurringCount} contas fixas e ${res.workSessionsCount} jornadas salvos.`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar para o Google Sheets.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const ready = isGoogleSheetsReady({
    ...config,
    webhookUrl,
    secretToken,
  });

  return (
    <section className="lh-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <FileSpreadsheet className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-semibold">
              Backup Financeiro no Google Sheets (Planilha Automática)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Espelha <strong>Resumo, Lançamentos, Contas Fixas, Uber/99 Moto e Metas</strong> direto para uma planilha no seu Google Drive — grátis e sem OAuth complexo.
            </p>
          </div>
        </div>
        {ready && config.lastSyncedAt ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> Conectada
          </span>
        ) : (
          <span className="rounded-full bg-slate-500/15 px-2.5 py-1 text-[11px] font-medium text-slate-400">
            Opcional
          </span>
        )}
      </div>

      {/* 3-step setup guide */}
      <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5 text-xs">
        <p className="mb-2 font-semibold text-emerald-600 dark:text-emerald-300">
          Como ativar em 2 minutos (1 única vez):
        </p>
        <ol className="list-decimal space-y-1.5 pl-4 text-slate-600 dark:text-slate-300">
          <li>
            Crie ou abra sua planilha no Google Sheets (
            <a
              href="https://sheets.new"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-semibold text-emerald-600 underline dark:text-emerald-400"
            >
              sheets.new <ExternalLink className="h-3 w-3" />
            </a>
            ) e clique em <strong>Extensões → Apps Script</strong>.
          </li>
          <li>
            Apague o código padrão, clique em <strong>Copiar Script Pronto</strong> abaixo e cole lá (já vai com seu Token Secreto exclusivo).
          </li>
          <li>
            Clique em <strong>Implantar → Nova implantação → App da Web</strong>, marque{' '}
            <strong>Executar como: Eu</strong> e <strong>Quem pode acessar: Qualquer pessoa</strong>, autorize e cole a URL gerada abaixo.
          </li>
        </ol>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyScript}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
          >
            <Copy className="h-3.5 w-3.5" /> Copiar Script Pronto (Apps Script)
          </button>
          <button
            type="button"
            onClick={() => setShowScript((v) => !v)}
            className="lh-btn-secondary py-1.5 text-xs"
          >
            <Code2 className="h-3.5 w-3.5" /> {showScript ? 'Ocultar Código' : 'Ver Código'}
          </button>
          <button
            type="button"
            onClick={handleRegenerateToken}
            className="lh-btn-secondary py-1.5 text-xs"
          >
            <KeyRound className="h-3.5 w-3.5" /> Novo Token
          </button>
        </div>

        {showScript && (
          <pre className="mt-3 max-h-52 overflow-auto rounded-xl border border-slate-700/60 bg-slate-950 p-3 font-mono text-[10.5px] leading-relaxed text-emerald-200">
            {scriptCode}
          </pre>
        )}
      </div>

      {/* URL Input */}
      <div>
        <label className="mb-1 block text-xs font-medium">
          URL do App da Web do Google Apps Script
        </label>
        <input
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://script.google.com/macros/s/AKfycb.../exec"
          className="lh-input font-mono text-xs"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(e) => {
            const checked = e.target.checked;
            setAutoSync(checked);
            persist({ autoSync: checked });
            notify(
              checked
                ? 'Backup automático no Google Sheets ativado a cada alteração!'
                : 'Backup automático no Google Sheets pausado (use o botão manual).',
              'info',
            );
          }}
          className="h-4 w-4 rounded"
        />
        <span>
          <strong>Espelhar automaticamente no Google Sheets a cada ação</strong> (salva no seu Drive ~2s após qualquer lançamento).
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={handleSyncNow}
          className="lh-btn-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Enviando para Planilha...' : 'Sincronizar Planilha Agora'}
        </button>

        <button
          type="button"
          disabled={busy || !ready}
          onClick={handleTest}
          className="lh-btn-secondary disabled:opacity-50"
        >
          <Wifi className="h-3.5 w-3.5" /> Testar Conexão
        </button>
      </div>

      {config.lastSyncedAt && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Último envio ao Google Sheets:{' '}
          <strong>{new Date(config.lastSyncedAt).toLocaleString('pt-BR')}</strong>
          {config.lastRowCount > 0 ? ` (${config.lastRowCount} registros espelhados)` : ''}
        </p>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-slate-500/20 bg-black/[0.02] p-2.5 text-[11px] text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <span>
          Os dados vão direto do seu computador para a <strong>sua própria planilha</strong> via HTTPS com Token Secreto único (nenhum servidor intermediário). Se o Sync Cloudflare estiver ativo, esta configuração também sincroniza criptografada para o seu celular.
        </span>
      </div>
    </section>
  );
};
