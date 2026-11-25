import React, { useEffect, useRef, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  Eye,
  EyeOff,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  askLifeHubAssistant,
  clearAiChatHistory,
  executeProposedAiAction,
  loadAiChatHistory,
  loadAiMemory,
  loadGeminiAiConfig,
  removeAiMemoryFact,
  saveAiChatHistory,
  saveGeminiAiConfig,
  type AiChatMessage,
  type AiMemoryItem,
  type GeminiAiConfig,
  type ProposedAiAction,
} from '../services/geminiAi';

const QUICK_PROMPTS = [
  'Resuma meu dia e diga minhas 3 prioridades agora',
  'Analise minhas finanças e rendimento Uber/99 da semana',
  'Monte um plano prático de estudos de TI para esta semana',
  'Rodei 85 km na Uber Moto hoje, fiz 190 bruto e gastei 32 de gasolina',
];

export const AiAssistantDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { db, settings, bumpDataVersion, notify } = useApp();
  const [config, setConfig] = useState<GeminiAiConfig>(() => loadGeminiAiConfig());
  const [keyDraft, setKeyDraft] = useState(config.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>(() => loadAiChatHistory());
  const [memories, setMemories] = useState<AiMemoryItem[]>(() => loadAiMemory());
  const [showMemory, setShowMemory] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      const fresh = loadGeminiAiConfig();
      setConfig(fresh);
      setKeyDraft(fresh.apiKey);
      setMemories(loadAiMemory());
    }
  }, [open]);

  useEffect(() => {
    saveAiChatHistory(messages);
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSaveInlineKey = (e: React.FormEvent) => {
    e.preventDefault();
    const next: GeminiAiConfig = {
      ...config,
      apiKey: keyDraft.trim(),
      updatedAt: new Date().toISOString(),
    };
    saveGeminiAiConfig(next);
    setConfig(next);
    bumpDataVersion();
    notify('Chave Gemini salva e sincronizada no cofre E2EE!');
  };

  const toggleFinancialContext = () => {
    const next: GeminiAiConfig = {
      ...config,
      shareFinancialContext: !config.shareFinancialContext,
    };
    saveGeminiAiConfig(next);
    setConfig(next);
  };

  const toggleAutoExecute = () => {
    const next: GeminiAiConfig = {
      ...config,
      autoExecuteActions: !config.autoExecuteActions,
    };
    saveGeminiAiConfig(next);
    setConfig(next);
  };

  const sendMessage = async (textToSend: string) => {
    if (!db || !textToSend.trim() || loading) return;
    const userMsg: AiChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: textToSend.trim(),
      createdAt: new Date().toISOString(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setPrompt('');
    setLoading(true);
    try {
      const reply = await askLifeHubAssistant(db, config, messages, userMsg.text);
      const executedIds: string[] = [];
      const savedSummaries: string[] = [];

      if (config.autoExecuteActions && settings && reply.actions.length > 0) {
        for (const act of reply.actions) {
          try {
            const msgDone = await executeProposedAiAction(db, settings, act);
            executedIds.push(act.id);
            savedSummaries.push(msgDone);
          } catch (actErr) {
            notify(
              actErr instanceof Error ? actErr.message : 'Não foi possível salvar uma ação automaticamente.',
              'error',
            );
          }
        }
        if (executedIds.length > 0) {
          setMemories(loadAiMemory());
          bumpDataVersion();
          notify(savedSummaries[0] ?? 'Lançamento salvo automaticamente no LifeHub!');
        }
      }

      const aiMsg: AiChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: reply.text,
        modelUsed: reply.modelUsed,
        actions: reply.actions,
        executedActionIds: executedIds,
        actionResultNotes: savedSummaries,
        autoExecuted: executedIds.length > 0,
        createdAt: new Date().toISOString(),
      };
      setMessages([...nextHistory, aiMsg]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao consultar Gemini.', 'error');
      setMessages([
        ...nextHistory,
        {
          id: `e_${Date.now()}`,
          role: 'assistant',
          text: `Não consegui concluir a resposta: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async (msgId: string, action: ProposedAiAction) => {
    if (!db || !settings) return;
    try {
      const doneText = await executeProposedAiAction(db, settings, action);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                executedActionIds: [...(m.executedActionIds ?? []), action.id],
                actionResultNotes: [...(m.actionResultNotes ?? []), doneText],
              }
            : m,
        ),
      );
      setMemories(loadAiMemory());
      bumpDataVersion();
      notify(doneText);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao executar ação.', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lh-modal-panel flex h-full w-full max-w-md flex-col rounded-none border-y-0 border-r-0 p-0 shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--lh-card-border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15 text-brand-500">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold leading-tight">Assistente IA · Gemini</h2>
              <p className="text-[10.5px] opacity-70">
                {config.apiKey
                  ? config.model === 'auto'
                    ? 'Melhores modelos primeiro · fallback auto'
                    : `${config.model} · fallback automático`
                  : 'Configure sua chave abaixo'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowMemory((v) => !v)}
              title="Memória persistente do Assistente"
              className={`lh-control-btn inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold ${
                showMemory ? 'border-brand-500 text-brand-500' : 'opacity-80 hover:opacity-100'
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              <span>{memories.length}</span>
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  clearAiChatHistory();
                }}
                title="Limpar conversa salva"
                className="lh-control-btn p-1.5 opacity-75 hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar assistente IA"
              className="lh-control-btn p-1.5 opacity-75 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Privacy & Auto-Save bar */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-[11px]"
          style={{ borderColor: 'var(--lh-card-border)' }}
        >
          <span className="inline-flex items-center gap-1 opacity-75">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Local-first
          </span>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 font-medium" title="Salva transações, tarefas e jornadas automaticamente no SQLite">
              <input
                type="checkbox"
                checked={config.autoExecuteActions}
                onChange={toggleAutoExecute}
                className="h-3.5 w-3.5 rounded"
              />
              Salvar direto
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={config.shareFinancialContext}
                onChange={toggleFinancialContext}
                className="h-3.5 w-3.5 rounded"
              />
              Enviar R$
            </label>
          </div>
        </div>

        {/* Collapsible Lightweight Persistent Memory Panel */}
        {showMemory && (
          <div
            className="border-b bg-brand-500/[0.04] px-4 py-2.5 text-[11px]"
            style={{ borderColor: 'var(--lh-card-border)' }}
          >
            <div className="mb-1.5 flex items-center justify-between font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5 text-brand-500" />
                Memória Persistente ({memories.length}/15)
              </span>
              <span className="text-[10px] font-normal opacity-65">Salva localmente</span>
            </div>
            {memories.length === 0 ? (
              <p className="opacity-70">
                Nenhuma memória salva ainda. Quando você contar regras fixas (ex.: &ldquo;faço pagamentos dia 01&rdquo;), eu guardo aqui automaticamente.
              </p>
            ) : (
              <ul className="max-h-32 space-y-1 overflow-y-auto">
                {memories.map((mem) => (
                  <li
                    key={mem.id}
                    className="flex items-start justify-between gap-2 rounded-lg border px-2 py-1"
                    style={{ borderColor: 'var(--lh-card-border)' }}
                  >
                    <span className="leading-snug">{mem.fact}</span>
                    <button
                      type="button"
                      onClick={() => setMemories(removeAiMemoryFact(mem.id))}
                      aria-label="Esquecer memória"
                      className="shrink-0 opacity-60 hover:text-rose-500 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!config.apiKey ? (
            <form onSubmit={handleSaveInlineKey} className="lh-card space-y-3">
              <p className="text-xs font-semibold">Conecte sua chave API do Google AI Studio</p>
              <p className="text-[11px] leading-relaxed opacity-75">
                Sua chave fica salva apenas neste computador e permite conversar com seus dados reais e lançar corridas/gastos/tarefas por frase natural.
              </p>
              <div className="relative">
                <input
                  required
                  type={showKey ? 'text' : 'password'}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="Cole sua chave API (AQ... ou AIza...)"
                  className="lh-input pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2.5 top-2 text-slate-400"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <button type="submit" className="lh-btn-primary w-full">
                Ativar Assistente IA
              </button>
            </form>
          ) : messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs opacity-75">
                Pergunte sobre sua rotina ou digite um lançamento natural — eu preparo tudo para você salvar com 1 clique:
              </p>
              <div className="space-y-1.5">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    className="lh-control-btn block w-full px-3 py-2 text-left text-xs leading-snug"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-brand-600 text-[color:var(--lh-btn-primary-fg,#ffffff)]'
                      : 'border bg-black/[0.03] dark:bg-white/[0.04]'
                  }`}
                  style={msg.role === 'assistant' ? { borderColor: 'var(--lh-card-border)' } : undefined}
                >
                  {msg.text}
                </div>

                {msg.modelUsed && (
                  <span className="mt-1 px-1 text-[9.5px] opacity-50">{msg.modelUsed}</span>
                )}

                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-2 w-[92%] space-y-1.5">
                    {msg.actions.map((act) => {
                      const done = msg.executedActionIds?.includes(act.id);
                      return (
                        <div
                          key={act.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-brand-500/35 bg-brand-500/10 px-3 py-2 text-xs"
                        >
                          <span className="font-medium">{act.summary}</span>
                          {done ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-emerald-500">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Salvo
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleConfirmAction(msg.id, act)}
                              className="lh-btn-primary shrink-0 px-2.5 py-1 text-[11px]"
                            >
                              Salvar
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}

          {loading && (
            <div className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs opacity-75" style={{ borderColor: 'var(--lh-card-border)' }}>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
              Consultando Gemini...
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input footer */}
        {config.apiKey && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(prompt);
            }}
            className="flex items-center gap-2 border-t p-3"
            style={{ borderColor: 'var(--lh-card-border)' }}
          >
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Pergunte ou lance por frase (ex.: gastei 35 de gasolina)..."
              className="lh-input flex-1 text-xs"
            />
            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              aria-label="Enviar mensagem"
              className="lh-btn-primary shrink-0 px-3 py-2"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
