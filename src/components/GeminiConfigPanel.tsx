import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Cpu, Eye, EyeOff, ShieldCheck, Sparkles, Wifi } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  GEMINI_MODEL_ROUTING_GUIDE,
  GEMINI_MODELS,
  loadGeminiAiConfig,
  saveGeminiAiConfig,
  testGeminiConnection,
  type GeminiAiConfig,
  type GeminiModelId,
} from '../services/geminiAi';

export const GeminiConfigPanel: React.FC = () => {
  const { dataVersion, bumpDataVersion, notify } = useApp();
  const [config, setConfig] = useState<GeminiAiConfig>(() => loadGeminiAiConfig());
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [model, setModel] = useState<GeminiModelId>(config.model);
  const [shareFinancialContext, setShareFinancialContext] = useState(config.shareFinancialContext);
  const [autoExecuteActions, setAutoExecuteActions] = useState(config.autoExecuteActions);
  const [showKey, setShowKey] = useState(false);
  const [showRoutingGuide, setShowRoutingGuide] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fresh = loadGeminiAiConfig();
    setConfig(fresh);
    if (fresh.apiKey && !apiKey) {
      setApiKey(fresh.apiKey);
    }
  }, [dataVersion]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const next: GeminiAiConfig = {
      apiKey: apiKey.trim(),
      model,
      shareFinancialContext,
      autoExecuteActions,
      updatedAt: new Date().toISOString(),
    };
    saveGeminiAiConfig(next);
    setConfig(next);
    bumpDataVersion();
    notify('Configuração da IA Gemini salva e sincronizada no cofre E2EE!');
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const res = await testGeminiConnection(apiKey, model);
      const next: GeminiAiConfig = {
        apiKey: apiKey.trim(),
        model,
        shareFinancialContext,
        autoExecuteActions,
        updatedAt: new Date().toISOString(),
      };
      saveGeminiAiConfig(next);
      setConfig(next);
      bumpDataVersion();
      notify(`Gemini conectado com sucesso (respondeu: ${res.modelUsed})!`);
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

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={autoExecuteActions}
              onChange={(e) => setAutoExecuteActions(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Salvar automaticamente lançamentos entendidos pela IA (ex.: &ldquo;ganhei 1200 da primeira parcela hoje&rdquo; já entra direto no Financeiro).
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={shareFinancialContext}
              onChange={(e) => setShareFinancialContext(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Incluir resumo de valores financeiros (R$) nas consultas ao Assistente IA (desmarque para ocultar valores em R$).
          </label>
        </div>

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
          <button
            type="button"
            onClick={() => setShowRoutingGuide((v) => !v)}
            className="lh-btn-secondary"
          >
            <Cpu className="h-3.5 w-3.5" />
            Mapa: Qual modelo é melhor para quê
            {showRoutingGuide ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </form>

      {showRoutingGuide && (
        <div className="space-y-2 rounded-2xl border border-brand-500/25 bg-brand-500/[0.04] p-3">
          <p className="text-xs font-semibold text-brand-500">
            Roteamento Inteligente Gemini (modo recomendado: &ldquo;Inteligente por Tarefa&rdquo;)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {GEMINI_MODEL_ROUTING_GUIDE.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200/70 bg-white/60 p-2.5 text-[11px] dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-xs">{item.name}</strong>
                  <span className="rounded-full bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-500">
                    {item.dailyQuota}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] opacity-70">{item.tier}</p>
                <p className="mt-1 leading-snug text-slate-600 dark:text-slate-300">
                  <strong>Melhor para:</strong> {item.bestFor}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 text-[11px] text-slate-600 dark:text-slate-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <span>
          A IA agora cria e edita <strong>avulsos, fixos mensais, parcelamentos 1x–120x (cartão/moto), rotina semanal no calendário, ideias, hábitos, metas, orçamentos, projetos e vagas de TI</strong>.
        </span>
      </div>
    </section>
  );
};
