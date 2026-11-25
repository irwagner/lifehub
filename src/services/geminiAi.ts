import { z } from 'zod';
import type { SqlExecutor } from '../db/types';
import { createCalendarEvent, createTask } from '../repositories/calendarRepo';
import { loadDashboardSnapshot } from '../repositories/dashboardRepo';
import {
  createRecurringRule,
  createTransaction,
  deleteTransaction,
  listAccounts,
  listCategories,
  listRecurringRules,
  listTransactions,
  updateTransaction,
} from '../repositories/financeRepo';
import { createIdea } from '../repositories/ideasRepo';
import { createWorkSession } from '../repositories/workRepo';
import type { EventCategory, Settings, WorkPlatform } from '../types/domain';
import { formatBRL, formatNumber, todayISO } from '../utils/format';

/**
 * Ordered strictly from BEST / MOST CAPABLE -> LIGHTEST / FALLBACK.
 * When `auto` is selected (default), the app starts at the top and falls back
 * down the chain automatically on quota (429), unavailable (404), overload (503),
 * server error (500), or empty response (502).
 */
export const ORDERED_GEMINI_FALLBACK_CHAIN = [
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it',
] as const;

export type ConcreteGeminiModelId = (typeof ORDERED_GEMINI_FALLBACK_CHAIN)[number];

export const GEMINI_MODELS = [
  { id: 'auto', label: 'Automático (Melhores primeiro → Fallback)' },
  { id: 'gemini-4-hydrogen', label: '1º · Gemini 4 Hydrogen (Topo · 20/dia)' },
  { id: 'gemini-3.8-flash', label: '2º · Gemini 3.8 Flash (Alta inteligência · 20/dia)' },
  { id: 'gemini-3.6-flash', label: '3º · Gemini 3.6 Flash (Avançado · 20/dia)' },
  { id: 'gemini-3.5-flash-lite', label: '4º · Gemini 3.5 Flash Lite (Rápido · 500/dia)' },
  { id: 'gemini-3.1-flash-lite', label: '5º · Gemini 3.1 Flash Lite (Econômico · 500/dia)' },
  { id: 'gemma-4-31b-it', label: '6º · Gemma 4 31B (Reserva · 14.400/dia)' },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]['id'];

export interface GeminiAiConfig {
  apiKey: string;
  model: GeminiModelId;
  shareFinancialContext: boolean;
  autoExecuteActions: boolean;
  configVersion?: number;
  updatedAt?: string;
}

export interface AiMemoryItem {
  id: string;
  fact: string;
  createdAt: string;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modelUsed?: string;
  actions?: ProposedAiAction[];
  executedActionIds?: string[];
  actionResultNotes?: string[];
  autoExecuted?: boolean;
  createdAt: string;
}

const AI_CONFIG_STORAGE_KEY = 'lifehub_gemini_ai_config_v1';
const AI_CHAT_HISTORY_STORAGE_KEY = 'lifehub_gemini_chat_history_v1';
const AI_MEMORY_STORAGE_KEY = 'lifehub_gemini_ai_memory_v1';
const CURRENT_AI_CONFIG_VERSION = 2;
const MAX_STORED_CHAT_MESSAGES = 40;
const MAX_STORED_MEMORIES = 15;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseFlexibleNumber(val: unknown): unknown {
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return val;
  const cleaned = val
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return Number.NaN;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  if (cleaned.includes(',')) {
    return Number(cleaned.replace(',', '.'));
  }
  return Number(cleaned);
}

function normalizeOptionalIsoDate(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (isoDate.test(trimmed)) return trimmed;
  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }
  return undefined;
}

function normalizeTxType(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const lower = val.trim().toLowerCase();
  if (['income', 'receita', 'entrada', 'ganho', 'credito', 'crédito'].includes(lower)) {
    return 'income';
  }
  if (['expense', 'despesa', 'gasto', 'saida', 'saída', 'debito', 'débito'].includes(lower)) {
    return 'expense';
  }
  return lower;
}

function normalizeStatus(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const lower = val.trim().toLowerCase();
  if (['planned', 'previsto', 'pendente', 'agendado', 'futuro'].includes(lower)) {
    return 'planned';
  }
  if (['realized', 'realizado', 'pago', 'recebido', 'efetivado'].includes(lower)) {
    return 'realized';
  }
  return lower;
}

const flexiblePositiveNumber = z.preprocess(parseFlexibleNumber, z.number().positive());
const flexibleNonNegativeNumber = z.preprocess(parseFlexibleNumber, z.number().min(0));
const optionalNormalizedDate = z.preprocess(
  (v) => (v === null || v === '' ? undefined : normalizeOptionalIsoDate(v)),
  z.string().regex(isoDate).optional(),
);
const nullableNormalizedDate = z.preprocess(
  (v) => (v === null || v === '' ? null : normalizeOptionalIsoDate(v) ?? null),
  z.string().regex(isoDate).nullable().optional(),
);
const optionalStatus = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? undefined : normalizeStatus(v)),
  z.enum(['realized', 'planned']).optional(),
);

const proposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_transaction'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      txType: z.preprocess(normalizeTxType, z.enum(['income', 'expense'])),
      description: z.string().min(1).max(140),
      amount: flexiblePositiveNumber,
      date: optionalNormalizedDate,
      due_date: nullableNormalizedDate,
      category_id: z.string().nullable().optional(),
      source_type: z.enum(['salario', 'aplicativos', 'servicos_ti', 'outros']).optional(),
      status: optionalStatus,
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('update_transaction'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      transaction_id: z.string().optional(),
      match_description: z.string().optional(),
      txType: z.preprocess(
        (v) => (v === undefined ? undefined : normalizeTxType(v)),
        z.enum(['income', 'expense']).optional(),
      ),
      description: z.string().min(1).max(140).optional(),
      amount: z.preprocess(
        (v) => (v === undefined ? undefined : parseFlexibleNumber(v)),
        z.number().positive().optional(),
      ),
      date: optionalNormalizedDate,
      due_date: nullableNormalizedDate,
      category_id: z.string().nullable().optional(),
      source_type: z.enum(['salario', 'aplicativos', 'servicos_ti', 'outros']).optional(),
      status: optionalStatus,
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('delete_transaction'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      transaction_id: z.string().optional(),
      match_description: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('create_recurring_rule'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      txType: z.preprocess(normalizeTxType, z.enum(['income', 'expense'])),
      description: z.string().min(1).max(140),
      amount: flexiblePositiveNumber,
      day_of_month: z.preprocess(parseFlexibleNumber, z.number().int().min(1).max(31)),
      category_id: z.string().nullable().optional(),
      source_type: z.enum(['salario', 'aplicativos', 'servicos_ti', 'outros']).optional(),
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('save_memory'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      fact: z.string().min(3).max(200),
    }),
  }),
  z.object({
    type: z.literal('create_work_session'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      // Explicitamente sem iFood conforme regras do projeto
      platform: z.enum(['uber_moto', '99_moto', 'ambos']),
      date: optionalNormalizedDate,
      start_time: z.string().regex(hhmm).optional(),
      end_time: z.string().regex(hhmm).optional(),
      gross_amount: flexibleNonNegativeNumber,
      km_total: flexibleNonNegativeNumber,
      fuel_cost: flexibleNonNegativeNumber.optional(),
      tolls_parking: flexibleNonNegativeNumber.optional(),
      syncFinance: z.boolean().optional(),
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_task'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      title: z.string().min(1).max(140),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      due_date: nullableNormalizedDate,
      category: z.string().max(40).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_event'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      title: z.string().min(1).max(140),
      category: z
        .enum([
          'trabalho',
          'filho',
          'academia',
          'corrida',
          'estudos',
          'entrevista',
          'saude',
          'deslocamento',
          'pausa',
          'geral',
        ])
        .optional(),
      date: optionalNormalizedDate,
      start_time: z.string().regex(hhmm),
      end_time: z.string().regex(hhmm),
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_idea'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      title: z.string().min(1).max(140),
      description: z.string().max(600).optional(),
      tags: z.string().max(120).optional(),
      impact: z.preprocess(parseFlexibleNumber, z.number().int().min(1).max(5)).optional(),
      effort: z.preprocess(parseFlexibleNumber, z.number().int().min(1).max(5)).optional(),
    }),
  }),
]);

export type ProposedAiAction = z.infer<typeof proposedActionSchema> & { id: string };

export function buildModelChain(preferred: GeminiModelId): ConcreteGeminiModelId[] {
  if (preferred === 'auto') {
    return [...ORDERED_GEMINI_FALLBACK_CHAIN];
  }
  return [
    preferred,
    ...ORDERED_GEMINI_FALLBACK_CHAIN.filter((id) => id !== preferred),
  ];
}

export function loadGeminiAiConfig(): GeminiAiConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GeminiAiConfig>;
      const isLegacyDefault =
        (parsed.configVersion ?? 1) < CURRENT_AI_CONFIG_VERSION &&
        parsed.model === 'gemini-3.5-flash-lite';
      const validModel: GeminiModelId = isLegacyDefault
        ? 'auto'
        : GEMINI_MODELS.some((m) => m.id === parsed.model)
          ? (parsed.model as GeminiModelId)
          : 'auto';
      return {
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        model: validModel,
        shareFinancialContext: parsed.shareFinancialContext !== false,
        autoExecuteActions: parsed.autoExecuteActions !== false,
        configVersion: CURRENT_AI_CONFIG_VERSION,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
    }
  } catch {
    // ignore corrupted local storage
  }
  return {
    apiKey: '',
    model: 'auto',
    shareFinancialContext: true,
    autoExecuteActions: true,
    configVersion: CURRENT_AI_CONFIG_VERSION,
  };
}

export function saveGeminiAiConfig(cfg: GeminiAiConfig): void {
  try {
    localStorage.setItem(
      AI_CONFIG_STORAGE_KEY,
      JSON.stringify({
        ...cfg,
        configVersion: CURRENT_AI_CONFIG_VERSION,
        updatedAt: cfg.updatedAt ?? new Date().toISOString(),
      }),
    );
  } catch {
    // ignore storage errors
  }
}

export function loadAiChatHistory(): AiChatMessage[] {
  try {
    const raw = localStorage.getItem(AI_CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.slice(-MAX_STORED_CHAT_MESSAGES) as AiChatMessage[];
    }
  } catch {
    // ignore corrupted storage
  }
  return [];
}

export function saveAiChatHistory(messages: AiChatMessage[]): void {
  try {
    localStorage.setItem(
      AI_CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_CHAT_MESSAGES)),
    );
  } catch {
    // ignore storage quota errors
  }
}

export function clearAiChatHistory(): void {
  try {
    localStorage.removeItem(AI_CHAT_HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function loadAiMemory(): AiMemoryItem[] {
  try {
    const raw = localStorage.getItem(AI_MEMORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (item): item is AiMemoryItem =>
            Boolean(item && typeof item.id === 'string' && typeof item.fact === 'string'),
        )
        .slice(-MAX_STORED_MEMORIES);
    }
  } catch {
    // ignore
  }
  return [];
}

export function addAiMemoryFact(rawFact: string): AiMemoryItem {
  const fact = rawFact.trim().slice(0, 200);
  const current = loadAiMemory();
  const normalized = fact.toLowerCase();
  const existing = current.find((m) => m.fact.toLowerCase() === normalized);
  if (existing) return existing;

  const nextItem: AiMemoryItem = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    fact,
    createdAt: new Date().toISOString(),
  };
  const updated = [...current, nextItem].slice(-MAX_STORED_MEMORIES);
  try {
    localStorage.setItem(AI_MEMORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return nextItem;
}

export function saveAiMemoryList(items: AiMemoryItem[]): void {
  const dedup = new Map<string, AiMemoryItem>();
  for (const item of items) {
    const clean = item.fact.trim().slice(0, 200);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, { ...item, fact: clean });
    }
  }
  const bounded = Array.from(dedup.values()).slice(-MAX_STORED_MEMORIES);
  try {
    localStorage.setItem(AI_MEMORY_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // ignore
  }
}

export function removeAiMemoryFact(id: string): AiMemoryItem[] {
  const updated = loadAiMemory().filter((m) => m.id !== id);
  try {
    localStorage.setItem(AI_MEMORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}

export async function buildCompactLifeHubContext(
  db: SqlExecutor,
  shareFinancialContext: boolean,
): Promise<string> {
  const today = todayISO();
  const [snap, categories, recentTxs, recurring] = await Promise.all([
    loadDashboardSnapshot(db, today),
    listCategories(db),
    listTransactions(db),
    listRecurringRules(db),
  ]);

  const money = (val: number) => (shareFinancialContext ? formatBRL(val) : '[OCULTO]');

  const eventsLine =
    snap.todayEvents.length > 0
      ? snap.todayEvents
          .slice(0, 8)
          .map((e) => `${e.start_at.slice(11, 16)}-${e.end_at.slice(11, 16)} ${e.title} (${e.category})`)
          .join('; ')
      : 'nenhum';

  const tasksLine =
    snap.priorityTasks.length > 0
      ? snap.priorityTasks
          .slice(0, 8)
          .map((t) => `[${t.priority}] ${t.title}${t.due_date ? ` (${t.due_date})` : ''}`)
          .join('; ')
      : 'nenhuma';

  const habitsLine = snap.habits
    .map((h) => `${h.name}: ${h.completedThisWeek}/${h.weekly_target}${h.doneToday ? ' (feito hoje)' : ''}`)
    .join('; ');

  const catsLine = categories.map((c) => `${c.id}=${c.name}(${c.kind})`).join(', ');

  const recentTxLines =
    recentTxs.length > 0
      ? recentTxs
          .slice(0, 10)
          .map(
            (tx) =>
              `id=${tx.id} | ${tx.date} | ${tx.type} | ${tx.status} | ${money(tx.amount)} | ${tx.description}`,
          )
          .join('\n  ')
      : 'nenhuma';

  const recurringLines =
    recurring.length > 0
      ? recurring
          .slice(0, 10)
          .map(
            (r) =>
              `dia ${String(r.day_of_month).padStart(2, '0')} | ${r.type} | ${money(r.amount)} | ${r.description}`,
          )
          .join('; ')
      : 'nenhuma';

  const memories = loadAiMemory();
  const memoryLine =
    memories.length > 0 ? memories.map((m) => `- ${m.fact}`).join('\n  ') : 'nenhuma salva ainda';

  return [
    `Data de hoje: ${today}`,
    `Usuário: ${snap.settings.user_name || 'Usuário'} | Modo rotina: ${snap.settings.routine_mode} (${snap.settings.work_days_per_week}d/sem)`,
    `Financeiro: Saldo=${money(snap.totalBalance)}, Receita mês=${money(snap.monthlyFinance.realizedIncome)}, Despesa mês=${money(snap.monthlyFinance.realizedExpense)}, Meta mensal=${money(snap.settings.monthly_net_goal)}`,
    `Uber/99 Semana: Bruto=${money(snap.workWeek.totalGross)}, Líquido oper=${money(snap.workWeek.totalOperationalNet)}, Combustível=${money(snap.workWeek.totalFuelCost)}, KM=${formatNumber(snap.workWeek.totalKm, 1)}`,
    `Estudos TI semana: ${formatNumber(snap.weeklyStudyHours, 1)}h / ${snap.settings.study_weekly_goal_hours}h | Vagas ativas: ${snap.activeApplications.length} | Entrevistas: ${snap.upcomingInterviews.length}`,
    `Fim de semana com filho: ${snap.upcomingChildWeekends[0]?.label ?? 'não configurado'}`,
    `Agenda de hoje: ${eventsLine}`,
    `Tarefas pendentes: ${tasksLine}`,
    `Hábitos semana: ${habitsLine}`,
    `Regras recorrentes mensais: ${recurringLines}`,
    `Últimas transações no banco (use o id para corrigir/apagar quando pedido):\n  ${recentTxLines}`,
    `Memória persistente sobre o usuário:\n  ${memoryLine}`,
    `Categorias válidas (use estes IDs ao sugerir transações): ${catsLine}`,
  ].join('\n');
}

function tryParseActionsFromJsonString(rawJson: string): ProposedAiAction[] {
  const sanitized = rawJson.trim().replace(/,\s*([}\]])/g, '$1');
  const parsedJson = JSON.parse(sanitized) as unknown;
  const candidateList = Array.isArray(parsedJson)
    ? parsedJson
    : parsedJson &&
        typeof parsedJson === 'object' &&
        'actions' in parsedJson &&
        Array.isArray((parsedJson as { actions?: unknown }).actions)
      ? (parsedJson as { actions: unknown[] }).actions
      : [parsedJson];

  const found: ProposedAiAction[] = [];
  for (let i = 0; i < candidateList.length; i++) {
    const check = proposedActionSchema.safeParse(candidateList[i]);
    if (check.success) {
      found.push({
        ...check.data,
        id: `act_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      });
    }
  }
  return found;
}

const KNOWN_ACTION_KEYWORDS = [
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'create_recurring_rule',
  'save_memory',
  'create_work_session',
  'create_task',
  'create_event',
  'create_idea',
];

export function extractProposedActions(rawText: string): {
  cleanText: string;
  actions: ProposedAiAction[];
} {
  const actions: ProposedAiAction[] = [];
  const primaryRegex = /```lifehub_actions?\s*([\s\S]*?)```/gi;
  let workingText = rawText.replace(primaryRegex, (_full, inner: string) => {
    try {
      actions.push(...tryParseActionsFromJsonString(inner));
    } catch {
      // ignore malformed block
    }
    return '';
  });

  if (actions.length === 0) {
    const jsonFenceRegex = /```json\s*([\s\S]*?)```/gi;
    workingText = workingText.replace(jsonFenceRegex, (full, inner: string) => {
      if (!KNOWN_ACTION_KEYWORDS.some((kw) => inner.includes(kw))) {
        return full;
      }
      try {
        const parsed = tryParseActionsFromJsonString(inner);
        if (parsed.length > 0) {
          actions.push(...parsed);
          return '';
        }
      } catch {
        // leave untouched
      }
      return full;
    });
  }

  const cleanText = workingText.trim();
  return { cleanText: cleanText || rawText.trim(), actions };
}

function buildSystemInstruction(contextSummary: string): string {
  return `Você é o Assistente IA pessoal integrado ao LifeHub (app desktop e mobile em português do Brasil), com memória persistente leve e capacidade de criar, corrigir e organizar registros reais no SQLite do usuário.

Regras obrigatórias:
- Responda em português do Brasil, de forma prática, direta e em parágrafos curtos ou listas.
- NUNCA mencione nem sugira iFood (apenas Uber Moto e 99Moto para aplicativos).
- Respeite sempre os fins de semana com o filho e o equilíbrio entre trabalho, saúde e estudos de TI.
- REGRA DE LANÇAMENTO E CORREÇÃO:
  1) Quando o usuário relatar ganho/recebimento ou gasto JÁ PAGO/RECEBIDO hoje (ex: "recebi 1514,79 do 13º hoje", "gastei 35 de gasolina"), emita \`create_transaction\` com \`"status":"realized"\`.
  2) Quando o usuário informar um **gasto fixo mensal / conta recorrente** SEM dizer que já pagou hoje (ex: "tenho um gasto fixo mensal de 620 de pensão", "pago internet dia 10"), emita \`create_recurring_rule\` (regra mensal) e, se criar a próxima fatura, use \`"status":"planned"\` (Previsto — NÃO desconta do saldo atual!).
  3) Quando o usuário CORRIGIR algo que acabou de ser lançado (ex: "não, ainda não saiu, só sai dia 01", "errei o valor, era 500", "apaga esse lançamento"), use \`update_transaction\` (com o \`transaction_id\` da lista "Últimas transações no banco") ou \`delete_transaction\` para corrigir imediatamente — NUNCA crie duplicata!
  4) Quando o usuário revelar uma preferência/regra duradoura de rotina ou pagamentos (ex: "faço meus pagamentos todo dia 01", "minha meta é juntar X"), salve uma nota curta com \`save_memory\` (sem repetir fatos que já estão na Memória persistente).
- Use SEMPRE número puro em JSON para valores (ex: 1514.79 ou 620, sem "R$").
- Quando o usuário disser "hoje"/"hj", use a Data de hoje do contexto (YYYY-MM-DD).

Formatos permitidos no bloco \`\`\`lifehub_actions (array JSON válido, sem comentários):
1) Criar transação:
{"type":"create_transaction","summary":"Receita: 1ª parcela 13º R$ 1.514,79","payload":{"txType":"income","description":"1ª parcela 13º salário","amount":1514.79,"date":"YYYY-MM-DD","category_id":"cat_salario","source_type":"salario","status":"realized"}}
2) Corrigir transação existente (mudar status planned/realized, data, valor ou descrição):
{"type":"update_transaction","summary":"Corrigir Pensão para Previsto em 01/12","payload":{"transaction_id":"tx_xxx","match_description":"Pensão","status":"planned","date":"2026-12-01","due_date":"2026-12-01"}}
3) Apagar transação errada:
{"type":"delete_transaction","summary":"Remover lançamento duplicado","payload":{"transaction_id":"tx_xxx","match_description":"Pensão"}}
4) Criar gasto/receita fixa mensal (recorrência):
{"type":"create_recurring_rule","summary":"Recorrência mensal: Pensão filho R$ 620 (dia 01)","payload":{"txType":"expense","description":"Pensão do filho","amount":620,"day_of_month":1,"category_id":"cat_filho","source_type":"outros"}}
5) Salvar memória persistente leve:
{"type":"save_memory","summary":"Lembrar: pagamentos fixos no dia 01","payload":{"fact":"Pagamentos fixos mensais são feitos no dia 01 de cada mês."}}
6) Jornada Uber/99:
{"type":"create_work_session","summary":"Uber Moto: R$ 210 bruto · 95 km · Comb. R$ 35","payload":{"platform":"uber_moto","date":"YYYY-MM-DD","start_time":"07:00","end_time":"12:30","gross_amount":210,"km_total":95,"fuel_cost":35,"syncFinance":true,"notes":""}}
7) Tarefa:
{"type":"create_task","summary":"Tarefa: Revisar currículo TI","payload":{"title":"Revisar currículo TI","priority":"high","due_date":"YYYY-MM-DD","category":"carreira"}}
8) Evento:
{"type":"create_event","summary":"Evento: Estudar Redes 19:00-20:30","payload":{"title":"Estudar Redes","category":"estudos","date":"YYYY-MM-DD","start_time":"19:00","end_time":"20:30"}}
9) Ideia:
{"type":"create_idea","summary":"Ideia: Script backup automático","payload":{"title":"Script backup automático","description":"","tags":"ti,automacao","impact":4,"effort":2}}

Contexto atual do banco local do usuário:
${contextSummary}`;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

async function callGeminiModel(
  modelId: string,
  apiKey: string,
  systemInstruction: string,
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
  fetchFn: typeof fetch,
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const url = `${GEMINI_API_BASE}/${modelId}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      if (errJson.error?.message) msg = errJson.error.message;
    } catch {
      // ignore
    }
    return { ok: false, status: res.status, message: msg };
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  const allParts = data.candidates?.[0]?.content?.parts ?? [];
  const visibleParts = allParts.filter((p) => !p.thought && typeof p.text === 'string' && p.text.trim());
  const sourceParts = visibleParts.length > 0 ? visibleParts : allParts;
  const text = sourceParts
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) {
    return { ok: false, status: 502, message: 'O modelo retornou uma resposta vazia.' };
  }
  return { ok: true, text };
}

function isFallbackableStatus(status: number): boolean {
  return status === 429 || status === 404 || status === 503 || status === 502 || status === 500;
}

export async function testGeminiConnection(
  apiKey: string,
  preferredModel: GeminiModelId = 'auto',
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; modelUsed: ConcreteGeminiModelId; reply: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Informe sua chave API do Google AI Studio.');
  }
  const chain = buildModelChain(preferredModel);

  let lastErr = '';
  for (const modelId of chain) {
    const res = await callGeminiModel(
      modelId,
      cleanKey,
      'Responda apenas OK em português.',
      [{ role: 'user', parts: [{ text: 'Teste de conexão. Responda apenas OK.' }] }],
      fetchFn,
    );
    if (res.ok) {
      return { ok: true, modelUsed: modelId, reply: res.text };
    }
    lastErr = `${modelId}: ${res.message}`;
    if (!isFallbackableStatus(res.status)) {
      break;
    }
  }
  throw new Error(`Falha ao conectar no Gemini (${lastErr}).`);
}

function formatHistoryTurnForModel(m: AiChatMessage): string {
  if (m.role !== 'assistant') return m.text;
  const notes = m.actionResultNotes?.filter(Boolean) ?? [];
  if (notes.length > 0) {
    return `${m.text}\n[Ações executadas no banco: ${notes.join(' | ')}]`;
  }
  if (m.actions && m.actions.length > 0) {
    const summaries = m.actions.map((a) => a.summary).join(' | ');
    return `${m.text}\n[Ações sugeridas: ${summaries}]`;
  }
  return m.text;
}

export async function askLifeHubAssistant(
  db: SqlExecutor,
  config: GeminiAiConfig,
  history: AiChatMessage[],
  userPrompt: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ text: string; actions: ProposedAiAction[]; modelUsed: ConcreteGeminiModelId }> {
  const cleanKey = config.apiKey.trim();
  if (!cleanKey) {
    throw new Error('Configure sua chave API Gemini nas Configurações ou no painel da IA.');
  }

  const contextSummary = await buildCompactLifeHubContext(db, config.shareFinancialContext);
  const systemInstruction = buildSystemInstruction(contextSummary);

  const recentHistory = history.slice(-12).map((m) => ({
    role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: [{ text: formatHistoryTurnForModel(m) }],
  }));
  const contents = [...recentHistory, { role: 'user' as const, parts: [{ text: userPrompt.trim() }] }];

  const chain = buildModelChain(config.model);

  let lastErr = '';
  for (const modelId of chain) {
    const res = await callGeminiModel(modelId, cleanKey, systemInstruction, contents, fetchFn);
    if (res.ok) {
      const { cleanText, actions } = extractProposedActions(res.text);
      return { text: cleanText, actions, modelUsed: modelId };
    }
    lastErr = `${modelId}: ${res.message}`;
    // Automatic fallback from best -> lighter models on 429, 404, 503, 502 (empty), or 500
    if (!isFallbackableStatus(res.status)) {
      throw new Error(`Erro Gemini API: ${res.message}`);
    }
  }

  throw new Error(
    `Não foi possível obter resposta dos modelos Gemini no momento. Detalhe: ${lastErr}`,
  );
}

async function resolveTargetTransaction(
  db: SqlExecutor,
  transactionId?: string,
  matchDescription?: string,
) {
  const all = await listTransactions(db);
  if (transactionId) {
    const exact = all.find((t) => t.id === transactionId.trim());
    if (exact) return exact;
  }
  if (matchDescription && matchDescription.trim()) {
    const needle = matchDescription.trim().toLowerCase();
    const matched = all.find((t) => t.description.toLowerCase().includes(needle));
    if (matched) return matched;
  }
  return null;
}

export async function executeProposedAiAction(
  db: SqlExecutor,
  settings: Settings,
  action: ProposedAiAction,
): Promise<string> {
  const today = todayISO();

  if (action.type === 'create_transaction') {
    const [accounts, categories] = await Promise.all([listAccounts(db), listCategories(db)]);
    const targetAcc = accounts[0]?.id ?? 'acc_principal';
    const requestedCatId = action.payload.category_id ?? null;
    const validCatId =
      requestedCatId && categories.some((c) => c.id === requestedCatId)
        ? requestedCatId
        : categories.find((c) => c.kind === action.payload.txType)?.id ?? null;

    const created = await createTransaction(db, {
      account_id: targetAcc,
      category_id: validCatId,
      type: action.payload.txType,
      source_type: action.payload.source_type ?? 'outros',
      description: action.payload.description,
      amount: action.payload.amount,
      date: action.payload.date ?? today,
      due_date: action.payload.due_date ?? null,
      status: action.payload.status ?? 'realized',
      notes: action.payload.notes ?? '',
    });
    const first = created[0];
    const statusLabel = (first?.status ?? action.payload.status) === 'planned' ? 'Previsto' : 'Realizado';
    return `Transação salva [${first?.id ?? 'ok'}] (${statusLabel}): ${first?.description ?? action.payload.description} (${formatBRL(first?.amount ?? action.payload.amount)}).`;
  }

  if (action.type === 'update_transaction') {
    const target = await resolveTargetTransaction(
      db,
      action.payload.transaction_id,
      action.payload.match_description,
    );
    if (!target) {
      throw new Error('Não encontrei o lançamento original para corrigir no Financeiro.');
    }
    const categories = await listCategories(db);
    const nextType = action.payload.txType ?? (target.type === 'transfer' ? 'expense' : target.type);
    const requestedCatId = action.payload.category_id;
    const nextCatId =
      requestedCatId !== undefined
        ? requestedCatId && categories.some((c) => c.id === requestedCatId)
          ? requestedCatId
          : target.category_id
        : target.category_id;

    const updated = await updateTransaction(db, target.id, {
      account_id: target.account_id,
      destination_account_id: target.destination_account_id,
      category_id: nextCatId,
      type: nextType,
      source_type: action.payload.source_type ?? target.source_type,
      description: action.payload.description ?? target.description,
      amount: action.payload.amount ?? target.amount,
      date: action.payload.date ?? target.date,
      due_date: action.payload.due_date !== undefined ? action.payload.due_date : target.due_date,
      status: action.payload.status ?? target.status,
      notes: action.payload.notes ?? target.notes,
    });
    const statusLabel = updated.status === 'planned' ? 'Previsto' : 'Realizado';
    return `Lançamento corrigido [${updated.id}]: ${updated.description} → ${statusLabel} em ${updated.date} (${formatBRL(updated.amount)}).`;
  }

  if (action.type === 'delete_transaction') {
    const target = await resolveTargetTransaction(
      db,
      action.payload.transaction_id,
      action.payload.match_description,
    );
    if (!target) {
      throw new Error('Não encontrei o lançamento para remover.');
    }
    await deleteTransaction(db, target.id);
    return `Lançamento removido [${target.id}]: ${target.description} (${formatBRL(target.amount)}).`;
  }

  if (action.type === 'create_recurring_rule') {
    const [accounts, categories] = await Promise.all([listAccounts(db), listCategories(db)]);
    const targetAcc = accounts[0]?.id ?? 'acc_principal';
    const requestedCatId = action.payload.category_id ?? null;
    const validCatId =
      requestedCatId && categories.some((c) => c.id === requestedCatId)
        ? requestedCatId
        : categories.find((c) => c.kind === action.payload.txType)?.id ?? null;

    const rule = await createRecurringRule(db, {
      account_id: targetAcc,
      category_id: validCatId,
      type: action.payload.txType,
      source_type: action.payload.source_type ?? 'outros',
      description: action.payload.description,
      amount: action.payload.amount,
      day_of_month: action.payload.day_of_month,
      notes: action.payload.notes ?? '',
    });
    return `Recorrência mensal salva: ${rule.description} (${formatBRL(rule.amount)} · dia ${String(rule.day_of_month).padStart(2, '0')}).`;
  }

  if (action.type === 'save_memory') {
    const item = addAiMemoryFact(action.payload.fact);
    return `Memória salva: "${item.fact}"`;
  }

  if (action.type === 'create_work_session') {
    const accounts = await listAccounts(db);
    const platform: WorkPlatform = action.payload.platform;
    const fuelCost = action.payload.fuel_cost ?? 0;
    const tolls = action.payload.tolls_parking ?? 0;
    const created = await createWorkSession(
      db,
      {
        date: action.payload.date ?? today,
        platform,
        start_time: action.payload.start_time ?? '07:00',
        end_time: action.payload.end_time ?? '12:30',
        gross_amount: action.payload.gross_amount,
        km_total: action.payload.km_total,
        fuel_cost: fuelCost,
        tolls_parking: tolls,
        notes: action.payload.notes ?? '',
      },
      settings,
    );

    if (action.payload.syncFinance && accounts[0]) {
      if (action.payload.gross_amount > 0) {
        await createTransaction(db, {
          account_id: accounts[0].id,
          category_id: 'cat_apps',
          type: 'income',
          source_type: 'aplicativos',
          description: `Jornada ${platform === 'uber_moto' ? 'Uber Moto' : platform === '99_moto' ? '99Moto' : 'Uber/99'} (${created.km_total} km)`,
          amount: action.payload.gross_amount,
          date: created.date,
          status: 'realized',
        });
      }
      if (fuelCost + tolls > 0) {
        await createTransaction(db, {
          account_id: accounts[0].id,
          category_id: 'cat_combustivel',
          type: 'expense',
          source_type: 'aplicativos',
          description: `Combustível/pedágio jornada (${created.km_total} km)`,
          amount: fuelCost + tolls,
          date: created.date,
          status: 'realized',
        });
      }
    }

    return `Jornada registrada (${formatBRL(created.gross_amount)} · ${created.km_total} km).`;
  }

  if (action.type === 'create_task') {
    const created = await createTask(db, {
      title: action.payload.title,
      priority: action.payload.priority ?? 'medium',
      due_date: action.payload.due_date ?? today,
      category: action.payload.category ?? 'geral',
    });
    return `Tarefa criada: ${created.title}.`;
  }

  if (action.type === 'create_event') {
    const date = action.payload.date ?? today;
    const created = await createCalendarEvent(db, {
      title: action.payload.title,
      category: (action.payload.category ?? 'geral') as EventCategory,
      start_at: `${date}T${action.payload.start_time}:00`,
      end_at: `${date}T${action.payload.end_time}:00`,
      notes: action.payload.notes ?? '',
    });
    return `Compromisso agendado: ${created.title} (${date} ${action.payload.start_time}).`;
  }

  const createdIdea = await createIdea(db, {
    title: action.payload.title,
    description: action.payload.description ?? '',
    tags: action.payload.tags ?? '',
    impact: action.payload.impact ?? 4,
    effort: action.payload.effort ?? 2,
  });
  return `Ideia capturada: ${createdIdea.title}.`;
}
