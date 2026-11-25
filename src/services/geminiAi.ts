import { z } from 'zod';
import type { SqlExecutor } from '../db/types';
import { createCalendarEvent, createTask } from '../repositories/calendarRepo';
import { loadDashboardSnapshot } from '../repositories/dashboardRepo';
import { createTransaction, listAccounts, listCategories } from '../repositories/financeRepo';
import { createIdea } from '../repositories/ideasRepo';
import { createWorkSession } from '../repositories/workRepo';
import type { EventCategory, Settings, WorkPlatform } from '../types/domain';
import { formatBRL, formatNumber, todayISO } from '../utils/format';

/**
 * Ordered strictly from BEST / MOST CAPABLE -> LIGHTEST / FALLBACK.
 * When `auto` is selected (default), the app starts at the top and falls back
 * down the chain automatically on quota (429), unavailable (404), or overload (503).
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
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modelUsed?: string;
  actions?: ProposedAiAction[];
  executedActionIds?: string[];
  autoExecuted?: boolean;
  createdAt: string;
}

const AI_CONFIG_STORAGE_KEY = 'lifehub_gemini_ai_config_v1';
const CURRENT_AI_CONFIG_VERSION = 2;
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
  // Handle Brazilian formatting like "1.500,50" or "48,90"
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
  // Convert DD/MM/YYYY -> YYYY-MM-DD
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

const proposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_transaction'),
    summary: z.string().min(1).max(160),
    payload: z.object({
      txType: z.preprocess(normalizeTxType, z.enum(['income', 'expense'])),
      description: z.string().min(1).max(140),
      amount: flexiblePositiveNumber,
      date: optionalNormalizedDate,
      category_id: z.string().nullable().optional(),
      source_type: z.enum(['salario', 'aplicativos', 'servicos_ti', 'outros']).optional(),
      status: z.enum(['realized', 'planned']).optional(),
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
      // Migrate v1 default ('gemini-3.5-flash-lite') to 'auto' (best-first order)
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
      JSON.stringify({ ...cfg, configVersion: CURRENT_AI_CONFIG_VERSION }),
    );
  } catch {
    // ignore storage errors
  }
}

export async function buildCompactLifeHubContext(
  db: SqlExecutor,
  shareFinancialContext: boolean,
): Promise<string> {
  const today = todayISO();
  const [snap, categories] = await Promise.all([
    loadDashboardSnapshot(db, today),
    listCategories(db),
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

export function extractProposedActions(rawText: string): {
  cleanText: string;
  actions: ProposedAiAction[];
} {
  const actions: ProposedAiAction[] = [];
  // Primary: ```lifehub_actions or ```lifehub_action
  const primaryRegex = /```lifehub_actions?\s*([\s\S]*?)```/gi;
  let workingText = rawText.replace(primaryRegex, (_full, inner: string) => {
    try {
      actions.push(...tryParseActionsFromJsonString(inner));
    } catch {
      // ignore malformed block
    }
    return '';
  });

  // Fallback: if LLM wrote ```json containing LifeHub action objects
  if (actions.length === 0) {
    const jsonFenceRegex = /```json\s*([\s\S]*?)```/gi;
    workingText = workingText.replace(jsonFenceRegex, (full, inner: string) => {
      if (
        !inner.includes('create_transaction') &&
        !inner.includes('create_work_session') &&
        !inner.includes('create_task') &&
        !inner.includes('create_event') &&
        !inner.includes('create_idea')
      ) {
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
  return `Você é o Assistente IA pessoal integrado ao LifeHub (app desktop e mobile em português do Brasil).
Regras obrigatórias:
- Responda em português do Brasil, de forma prática, direta e em parágrafos curtos ou listas.
- NUNCA mencione nem sugira iFood (apenas Uber Moto e 99Moto para aplicativos).
- Respeite sempre os fins de semana com o filho e o equilíbrio entre trabalho, saúde e estudos de TI.
- REGRA DE LANÇAMENTO AUTOMÁTICO: SEMPRE que o usuário relatar qualquer ganho, recebimento, parcela, salário, gasto, despesa, corrida/jornada Uber/99, nova tarefa, compromisso ou ideia — MESMO em frase natural/informal sem dizer explicitamente "registre" (exemplos: "ganhei 1200 da primeira parcela hj", "recebi 350 de freela", "paguei 85 de internet", "gastei 35 de gasolina", "rodei 80km e fiz 190", "tenho médico amanhã às 15h") — você DEVE incluir ao final UM bloco \`\`\`lifehub_actions com um array JSON válido para lançar no banco do usuário!
- Use SEMPRE número puro em JSON para valores monetários (ex: 1200 ou 48.5, sem "R$").
- Quando o usuário disser "hoje" ou "hj", use exatamente a Data de hoje informada no contexto abaixo (formato YYYY-MM-DD).
- Para ganhos/recebimentos/salário/13º/parcela recebida, use "txType":"income" e "status":"realized" (use "source_type":"salario" para salário/13º/parcela CLT, "aplicativos" para Uber/99, "servicos_ti" para freela TI, ou "outros").

Formatos permitidos no bloco \`\`\`lifehub_actions:
1) Receita (ex. ganhei 1200 da primeira parcela hj):
{"type":"create_transaction","summary":"Receita: Primeira parcela R$ 1.200,00","payload":{"txType":"income","description":"Primeira parcela","amount":1200,"date":"YYYY-MM-DD","category_id":"cat_salario","source_type":"salario","status":"realized"}}
2) Despesa:
{"type":"create_transaction","summary":"Despesa: Mercado R$ 48,00","payload":{"txType":"expense","description":"Mercado","amount":48,"date":"YYYY-MM-DD","category_id":"cat_alimentacao","source_type":"outros","status":"realized"}}
3) Jornada Uber/99:
{"type":"create_work_session","summary":"Uber Moto: R$ 210 bruto · 95 km · Comb. R$ 35","payload":{"platform":"uber_moto","date":"YYYY-MM-DD","start_time":"07:00","end_time":"12:30","gross_amount":210,"km_total":95,"fuel_cost":35,"syncFinance":true,"notes":""}}
4) Tarefa:
{"type":"create_task","summary":"Tarefa: Revisar currículo TI","payload":{"title":"Revisar currículo TI","priority":"high","due_date":"YYYY-MM-DD","category":"carreira"}}
5) Evento:
{"type":"create_event","summary":"Evento: Estudar Redes 19:00-20:30","payload":{"title":"Estudar Redes","category":"estudos","date":"YYYY-MM-DD","start_time":"19:00","end_time":"20:30"}}
6) Ideia:
{"type":"create_idea","summary":"Ideia: Script backup automático","payload":{"title":"Script backup automático","description":"","tags":"ti,automacao","impact":4,"effort":2}}

Não inclua \`\`\`lifehub_actions quando o usuário estiver apenas fazendo uma pergunta, pedindo resumo ou análise sem relatar um novo lançamento.

Contexto atual do banco local do usuário:
${contextSummary}`;
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
        maxOutputTokens: 1200,
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
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim() ?? '';

  if (!text) {
    return { ok: false, status: 502, message: 'O modelo retornou uma resposta vazia.' };
  }
  return { ok: true, text };
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
    if (res.status !== 404 && res.status !== 429 && res.status !== 503) {
      break;
    }
  }
  throw new Error(`Falha ao conectar no Gemini (${lastErr}).`);
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

  const recentHistory = history.slice(-6).map((m) => ({
    role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: [{ text: m.text }],
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
    lastErr = res.message;
    // Automatic fallback from best -> lighter models on rate-limit (429), unavailable (404), or overload (503)
    if (res.status !== 429 && res.status !== 404 && res.status !== 503) {
      throw new Error(`Erro Gemini API: ${res.message}`);
    }
  }

  throw new Error(
    `Limite de cota (429) ou indisponibilidade temporária nos modelos Gemini. Detalhe: ${lastErr}`,
  );
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
      status: action.payload.status ?? 'realized',
    });
    const first = created[0];
    return `Transação salva no Financeiro: ${first?.description ?? action.payload.description} (${formatBRL(first?.amount ?? action.payload.amount)}).`;
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
