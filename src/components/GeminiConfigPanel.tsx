import React, { useState } from 'react';
import { Eye, EyeOff, ShieldCheck, Sparkles, Wifi } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  GEMINI_MODELS,
  loadGeminiAiConfig,
  saveGeminiAiConfig,
  testGeminiConnection,
  type GeminiAiConfig,
  type GeminiModelId,
} from '../services/geminiAi';

export const GeminiConfigPanel: React.FC = () => {
  const { notify } = useApp();
  const [config, setConfig] = useState<GeminiAiConfig>(() => loadGeminiAiConfig());
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [model, setModel] = useState<GeminiModelId>(config.model);
  const [shareFinancialContext, setShareFinancialContext] = useState(config.shareFinancialContext);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const next: GeminiAiConfig = {
      apiKey: apiKey.trim(),
      model,
      shareFinancialContext,
    };
    saveGeminiAiConfig(next);
    setConfig(next);
    notify('Configuração da IA Gemini salva localmente neste dispositivo.');
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const res = await testGeminiConnection(apiKey, model);
      const next: GeminiAiConfig = {
        apiKey: apiKey.trim(),
        model: res.modelUsed as GeminiModelId,
        shareFinancialContext,
      };
      saveGeminiAiConfig(next);
      setConfig(next);
      setModel(next.model);
      notify(`Gemini conectado com sucesso (${res.modelUsed})!`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao testar Gemini.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lh-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/15 text-brand-500">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-semibold">Assistente IA LifeHub (Google Gemini · Opt-in)</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cadastre corridas, gastos e tarefas por frase natural e tire dúvidas sobre sua rotina com fallback automático entre modelos Flash.
            </p>
          </div>
        </div>
        {config.apiKey ? (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500">
            Configurada ({config.model})
          </span>
        ) : (
          <span className="rounded-full bg-slate-500/15 px-2.5 py-0.5 text-[11px] font-medium text-slate-400">
            Opcional · Desativada
          </span>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium">
              Chave API do Google AI Studio (salva apenas localmente)
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Cole sua chave Gemini (AQ... ou AIza...)"
                className="lh-input pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label="Mostrar ou ocultar chave API"
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Modelo padrão</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as GeminiModelId)}
              className="lh-input"
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={shareFinancialContext}
            onChange={(e) => setShareFinancialContext(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          Incluir resumo de valores financeiros (R$) nas consultas ao Assistente IA (desmarque para ocultar valores em R$).
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="lh-btn-primary">
            Salvar Configuração IA
          </button>
          <button
            type="button"
            disabled={busy || !apiKey.trim()}
            onClick={handleTest}
            className="lh-btn-secondary"
          >
            <Wifi className="h-3.5 w-3.5" /> {busy ? 'Testando...' : 'Testar Conexão Gemini'}
          </button>
        </div>
      </form>

      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 text-[11px] text-slate-600 dark:text-slate-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <span>
          A IA só envia dados quando você envia uma mensagem no painel <strong>IA (Alt+A)</strong>. Toda ação sugerida (gasto, jornada, tarefa ou evento) exige sua confirmação em 1 clique antes de gravar no SQLite.
        </span>
      </div>
    </section>
  );
};
