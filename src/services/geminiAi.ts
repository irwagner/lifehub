import { z } from 'zod';
import type { SqlExecutor } from '../db/types';
import {
  applyScheduleTemplateToWeek,
  createCalendarEvent,
  createRecurringWeeklyEvents,
  createTask,
  deleteCalendarEvent,
  listCalendarEvents,
  listTasks,
  toggleTaskStatus,
} from '../repositories/calendarRepo';
import { createJobApplication } from '../repositories/careerRepo';
import { loadDashboardSnapshot } from '../repositories/dashboardRepo';
import {
  createGoal,
  createRecurringRule,
  createTransaction,
  deleteRecurringRule,
  deleteTransaction,
  generateMonthlyRecurringTransactions,
  listAccounts,
  listCategories,
  listGoals,
  listRecurringRules,
  listTransactions,
  updateRecurringRule,
  updateTransaction,
  upsertCategoryBudget,
} from '../repositories/financeRepo';
import { createHabit, listHabitsWithProgress, logHabitSession } from '../repositories/habitsRepo';
import { createIdea } from '../repositories/ideasRepo';
import { createProject } from '../repositories/projectsRepo';
import { createWorkSession } from '../repositories/workRepo';
import type {
  EventCategory,
  HabitCategory,
  JobApplicationStatus,
  ProjectCategory,
  Settings,
  WorkPlatform,
} from '../types/domain';
import {
  addDaysISO,
  addMonthsISO,
  formatBRL,
  formatNumber,
  round2,
  startOfWeekISO,
  todayISO,
} from '../utils/format';
import type { ScheduleTemplateId } from './scheduleTemplates';

/**
 * Ordered strictly from BEST / MOST CAPABLE -> LIGHTEST / FALLBACK.
 * When `auto` is selected, the app starts at the top and falls back
 * down the chain automatically on quota (429), unavailable (404), overload (503),
 * server error (500), or empty response (502).
 * When `smart` is selected (recommended default), the app routes each prompt to the
 * ideal Gemini model for that task type (saving the 20/day top models for planning/analysis).
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

export type PromptTaskProfile = 'quick_entry' | 'routine_planning' | 'deep_analysis';

export interface GeminiModelRoutingInfo {
  id: ConcreteGeminiModelId;
  name: string;
  tier: string;
  dailyQuota: string;
  bestFor: string;
  avoidFor: string;
  idealProfiles: PromptTaskProfile[];
}

export const GEMINI_MODEL_ROUTING_GUIDE: readonly GeminiModelRoutingInfo[] = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    tier: '1º · Topo (Raciocínio)',
    dailyQuota: '20 req/dia',
    bestFor:
      'Diagnóstico financeiro profundo, decisões estratégicas (CLT vs Uber/99 vs TI), planejamento mensal completo e pacotes com muitas ações simultâneas.',
    avoidFor: 'Gastar cota em lançamentos avulsos simples de 1 linha.',
    idealProfiles: ['deep_analysis'],
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    tier: '2º · Alta Inteligência',
    dailyQuota: '20 req/dia',
    bestFor:
      'Montar rotina semanal no calendário, organizar blocos de treino/estudos respeitando fins de semana com o filho e corrigir múltiplos lançamentos.',
    avoidFor: 'Perguntas banais quando o Flash Lite resolve em 1s.',
    idealProfiles: ['routine_planning'],
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    tier: '3º · Avançado Equilibrado',
    dailyQuota: '20 req/dia',
    bestFor:
      'Resumos semanais, criação de projetos/vagas de TI, metas financeiras e múltiplos parcelamentos/recorrências juntos.',
    avoidFor: 'Uso contínuo pesado sem necessidade.',
    idealProfiles: ['routine_planning', 'deep_analysis'],
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    tier: '4º · Melhor Dia a Dia',
    dailyQuota: '500 req/dia',
    bestFor:
      'Lançamentos rápidos: gasto/receita avulso, fixo mensal, parcelado 1x–120x (cartão/moto), ideias, tarefas, hábitos, eventos avulsos e jornadas Uber/99.',
    avoidFor: 'Análises financeiras muito longas com múltiplas simulações.',
    idealProfiles: ['quick_entry'],
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    tier: '5º · Econômico Contingência',
    dailyQuota: '500 req/dia',
    bestFor:
      'Backup instantâneo para lançamentos diários, edições rápidas e captura de ideias quando o 3.5 Flash Lite atingir limite.',
    avoidFor: 'Montagem complexa de agenda com muitas regras simultâneas.',
    idealProfiles: ['quick_entry'],
  },
  {
    id: 'gemma-4-31b-it',
    name: 'Gemma 4 31B',
    tier: '6º · Reserva Massiva',
    dailyQuota: '14.400 req/dia',
    bestFor:
      'Contingência de altíssima cota quando todos os modelos Flash esgotarem — ótimo para dúvidas diretas e lançamentos unitários.',
    avoidFor: 'JSON muito extenso com 8+ ações no mesmo turno.',
    idealProfiles: ['quick_entry'],
  },
] as const;

export const GEMINI_MODELS = [
  { id: 'smart', label: 'Inteligente por Tarefa (Recomendado · Economiza cota)' },
  { id: 'auto', label: 'Automático (Melhores primeiro → Fallback)' },
  { id: 'gemini-4-hydrogen', label: '1º · Gemini 4 Hydrogen (Topo · 20/dia)' },
  { id: 'gemini-3.8-flash', label: '2º · Gemini 3.8 Flash (Rotina & Agenda · 20/dia)' },
  { id: 'gemini-3.6-flash', label: '3º · Gemini 3.6 Flash (Avançado · 20/dia)' },
  { id: 'gemini-3.5-flash-lite', label: '4º · Gemini 3.5 Flash Lite (Dia a dia · 500/dia)' },
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
const CURRENT_AI_CONFIG_VERSION = 3;
const MAX_STORED_CHAT_MESSAGES = 40;
const MAX_STORED_MEMORIES = 15;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const isoMonth = /^\d{4}-\d{2}$/;
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

function stripAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

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

export function normalizeFlexibleTime(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim().toLowerCase();
  if (!trimmed) return undefined;
  // Matches "07:00", "7:00", "7:30:00", "7h", "7h30", "19h00", "07.30"
  const m = trimmed.match(/^(\d{1,2})(?:[:h.](\d{1,2}))?(?::\d{2})?\s*h?$/);
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function addMinutesToHHMM(start: string, deltaMinutes = 60): string {
  const [hStr, mStr] = start.split(':');
  const total = Math.min(23 * 60 + 59, Number(hStr) * 60 + Number(mStr) + deltaMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeTxType(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const lower = stripAccents(val);
  if (['income', 'receita', 'entrada', 'ganho', 'credito', 'salario'].includes(lower)) {
    return 'income';
  }
  if (['expense', 'despesa', 'gasto', 'saida', 'debito', 'conta', 'compra'].includes(lower)) {
    return 'expense';
  }
  return lower;
}

function normalizeStatus(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const lower = stripAccents(val);
  if (['planned', 'previsto', 'pendente', 'agendado', 'futuro', 'a pagar'].includes(lower)) {
    return 'planned';
  }
  if (['realized', 'realizado', 'pago', 'recebido', 'efetivado', 'quitado'].includes(lower)) {
    return 'realized';
  }
  return lower;
}

export function normalizeEventCategory(val: unknown): EventCategory {
  if (typeof val !== 'string') return 'geral';
  const clean = stripAccents(val);
  const valid: EventCategory[] = [
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
  ];
  if ((valid as string[]).includes(clean)) return clean as EventCategory;
  if (/(uber|99|clt|turno|plantao|servico|freela|job)/.test(clean)) return 'trabalho';
  if (/(filh|famil|crianca)/.test(clean)) return 'filho';
  if (/(academ|treino|muscul|gym)/.test(clean)) return 'academia';
  if (/(corrid|run|caminh|cardio)/.test(clean)) return 'corrida';
  if (/(estud|ti|curso|aula|linux|rede|codigo|program|facul)/.test(clean)) return 'estudos';
  if (/(entrev|vaga|rh|curric|carreir)/.test(clean)) return 'entrevista';
  if (/(saud|medic|dentist|consult|exame|terap)/.test(clean)) return 'saude';
  if (/(desloc|trajet|transito|onibus|viagem)/.test(clean)) return 'deslocamento';
  if (/(pausa|almoc|descans|lazer|sono|dormir)/.test(clean)) return 'pausa';
  return 'geral';
}

function normalizeInstallmentKind(val: unknown): 'cartao' | 'moto' | 'seguro' | 'outro' {
  if (typeof val !== 'string') return 'cartao';
  const clean = stripAccents(val);
  if (/(moto|veicul|financi)/.test(clean)) return 'moto';
  if (/(segur|protecao)/.test(clean)) return 'seguro';
  if (/(outro|carne|boleto|emprest|parcelad)/.test(clean)) return 'outro';
  return 'cartao';
}

function normalizeAmountMode(val: unknown): 'total' | 'per_parcel' {
  if (typeof val !== 'string') return 'total';
  const clean = stripAccents(val);
  if (/(per_parcel|parcela|mensal|cada|por_parcela|unit)/.test(clean)) return 'per_parcel';
  return 'total';
}

/**
 * Normalizes PT-BR or numeric weekdays into JS Date.getDay() indices (0=Dom, 1=Seg .. 6=Sab).
 */
export function normalizeWeekdays(val: unknown): number[] {
  const result = new Set<number>();
  const tokens: unknown[] = Array.isArray(val)
    ? val
    : typeof val === 'string'
      ? val.split(/[,;/\s]+/).filter(Boolean)
      : typeof val === 'number'
        ? [val]
        : [];

  const joined = typeof val === 'string' ? stripAccents(val) : '';
  if (/(seg.*sex|uteis|dias uteis|weekdays)/.test(joined)) {
    return [1, 2, 3, 4, 5];
  }
  if (/(todos|todo dia|diario|daily)/.test(joined)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  for (const raw of tokens) {
    if (typeof raw === 'number' && Number.isInteger(raw)) {
      if (raw >= 0 && raw <= 6) result.add(raw);
      else if (raw === 7) result.add(0);
      continue;
    }
    const s = stripAccents(String(raw));
    if (!s) continue;
    if (/^(0|7|dom|domingo|sun)/.test(s)) result.add(0);
    else if (/^(1|seg|segunda|mon)/.test(s)) result.add(1);
    else if (/^(2|ter|terca|tue)/.test(s)) result.add(2);
    else if (/^(3|qua|quarta|wed)/.test(s)) result.add(3);
    else if (/^(4|qui|quinta|thu)/.test(s)) result.add(4);
    else if (/^(5|sex|sexta|fri)/.test(s)) result.add(5);
    else if (/^(6|sab|sabado|sat)/.test(s)) result.add(6);
  }
  return Array.from(result).sort((a, b) => a - b);
}

function normalizeTemplateId(val: unknown): ScheduleTemplateId | undefined {
  if (typeof val !== 'string') return undefined;
  const clean = stripAccents(val);
  if (clean === 'apps_4d' || /4\s*d/.test(clean)) return 'apps_4d';
  if (clean === 'apps_6d' || /6\s*d/.test(clean)) return 'apps_6d';
  if (clean === 'apps_5d' || /(app|uber|99|5\s*d)/.test(clean)) return 'apps_5d';
  if (clean === 'clt' || /portaria|clt/.test(clean)) return 'clt';
  if (clean === 'ti' || /emprego.*ti|comercial/.test(clean)) return 'ti';
  return undefined;
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
const optionalFlexibleTime = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? undefined : normalizeFlexibleTime(v)),
  z.string().regex(hhmm).optional(),
);
const requiredFlexibleTime = z.preprocess(
  (v) => normalizeFlexibleTime(v),
  z.string().regex(hhmm),
);
const flexibleInstallmentsCount = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return 1;
  const parsed = Number(parseFlexibleNumber(v));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(120, Math.round(parsed));
}, z.number().int().min(1).max(120));

const proposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_transaction'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      txType: z.preprocess(normalizeTxType, z.enum(['income', 'expense'])),
      description: z.string().min(1).max(140),
      amount: flexiblePositiveNumber,
      date: optionalNormalizedDate,
      due_date: nullableNormalizedDate,
      category_id: z.string().nullable().optional(),
      source_type: z.enum(['salario', 'aplicativos', 'servicos_ti', 'outros']).optional(),
      status: optionalStatus,
      installments: flexibleInstallmentsCount.optional(),
      force_installment_group: z.boolean().optional(),
      amount_mode: z.preprocess(
        (v) => (v === undefined || v === null || v === '' ? undefined : normalizeAmountMode(v)),
        z.enum(['total', 'per_parcel']).optional(),
      ),
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_installment'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      kind: z.preprocess(normalizeInstallmentKind, z.enum(['cartao', 'moto', 'seguro', 'outro'])).optional(),
      description: z.string().min(1).max(140),
      amount: flexiblePositiveNumber,
      amount_mode: z.preprocess(normalizeAmountMode, z.enum(['total', 'per_parcel'])).optional(),
      installments: flexibleInstallmentsCount,
      first_date: optionalNormalizedDate,
      next_month: z.boolean().optional(),
      issuer: z.string().max(60).optional(),
      family: z.boolean().optional(),
      first_paid: z.boolean().optional(),
      category_id: z.string().nullable().optional(),
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('update_transaction'),
    summary: z.string().min(1).max(180),
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
    summary: z.string().min(1).max(180),
    payload: z.object({
      transaction_id: z.string().optional(),
      match_description: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('create_recurring_rule'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      txType: z.preprocess(
        (v) => (v === undefined || v === null || v === '' ? 'expense' : normalizeTxType(v)),
        z.enum(['income', 'expense']),
      ),
      description: z.string().min(1).max(140),
      amount: flexiblePositiveNumber,
      day_of_month: z.preprocess((v) => {
        if (v === undefined || v === null || v === '') return 1;
        const parsed = Number(parseFlexibleNumber(v));
        if (!Number.isFinite(parsed) || parsed < 1) return 1;
        return Math.min(31, Math.round(parsed));
      }, z.number().int().min(1).max(31)),
      category_id: z.string().nullable().optional(),
      source_type: z.enum(['salario', 'aplicativos', 'servicos_ti', 'outros']).optional(),
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('update_recurring_rule'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      rule_id: z.string().optional(),
      match_description: z.string().optional(),
      txType: z.preprocess(
        (v) => (v === undefined || v === null || v === '' ? undefined : normalizeTxType(v)),
        z.enum(['income', 'expense']).optional(),
      ),
      description: z.string().min(1).max(140).optional(),
      amount: z.preprocess(
        (v) => (v === undefined || v === null || v === '' ? undefined : parseFlexibleNumber(v)),
        z.number().positive().optional(),
      ),
      day_of_month: z.preprocess(
        (v) => {
          if (v === undefined || v === null || v === '') return undefined;
          const parsed = Number(parseFlexibleNumber(v));
          if (!Number.isFinite(parsed) || parsed < 1) return undefined;
          return Math.min(31, Math.round(parsed));
        },
        z.number().int().min(1).max(31).optional(),
      ),
      category_id: z.string().nullable().optional(),
      notes: z.string().max(400).optional(),
      sync_planned: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('delete_recurring_rule'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      rule_id: z.string().optional(),
      match_description: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('create_goal'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      name: z.string().min(1).max(140),
      target_amount: flexiblePositiveNumber,
      current_amount: flexibleNonNegativeNumber.optional(),
      target_date: nullableNormalizedDate,
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('upsert_budget'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      month: z.string().regex(isoMonth).optional(),
      category_id: z.string().min(1),
      limit_amount: flexiblePositiveNumber,
    }),
  }),
  z.object({
    type: z.literal('save_memory'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      fact: z.string().min(3).max(200),
    }),
  }),
  z.object({
    type: z.literal('create_work_session'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      // Explicitamente sem iFood conforme regras do projeto
      platform: z.enum(['uber_moto', '99_moto', 'ambos']),
      date: optionalNormalizedDate,
      start_time: optionalFlexibleTime,
      end_time: optionalFlexibleTime,
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
    summary: z.string().min(1).max(180),
    payload: z.object({
      title: z.string().min(1).max(140),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      due_date: nullableNormalizedDate,
      category: z.string().max(40).optional(),
    }),
  }),
  z.object({
    type: z.literal('complete_task'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      task_id: z.string().optional(),
      match_title: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('create_event'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      title: z.string().min(1).max(140),
      category: z.preprocess(normalizeEventCategory, z.enum([
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
      ])).optional(),
      date: optionalNormalizedDate,
      start_time: requiredFlexibleTime,
      end_time: optionalFlexibleTime,
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_routine_schedule'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      title: z.string().min(1).max(140),
      category: z.preprocess(normalizeEventCategory, z.enum([
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
      ])).optional(),
      weekdays: z.preprocess(normalizeWeekdays, z.array(z.number().int().min(0).max(6)).min(1)),
      start_time: requiredFlexibleTime,
      end_time: optionalFlexibleTime,
      weeks: z.preprocess((v) => {
        if (v === undefined || v === null || v === '') return 4;
        const parsed = Number(parseFlexibleNumber(v));
        if (!Number.isFinite(parsed) || parsed < 1) return 4;
        return Math.min(12, Math.round(parsed));
      }, z.number().int().min(1).max(12)).optional(),
      start_date: optionalNormalizedDate,
      skip_child_weekends: z.boolean().optional(),
      notes: z.string().max(400).optional(),
    }),
  }),
  z.object({
    type: z.literal('apply_schedule_template'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      template_id: z.preprocess(
        normalizeTemplateId,
        z.enum(['apps_5d', 'apps_4d', 'apps_6d', 'clt', 'ti']),
      ),
      date: optionalNormalizedDate,
      replace_existing: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('delete_event'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      event_id: z.string().optional(),
      match_title: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('log_habit'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      habit_id: z.string().optional(),
      habit_name: z.string().min(1).max(100).optional(),
      date: optionalNormalizedDate,
      duration_minutes: flexibleNonNegativeNumber.optional(),
      notes: z.string().max(300).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_idea'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      title: z.string().min(1).max(140),
      description: z.string().max(600).optional(),
      tags: z.string().max(120).optional(),
      impact: z.preprocess(parseFlexibleNumber, z.number().int().min(1).max(5)).optional(),
      effort: z.preprocess(parseFlexibleNumber, z.number().int().min(1).max(5)).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_project'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      title: z.string().min(1).max(140),
      category: z.enum(['portfolio_ti', 'pessoal', 'freelance']).optional(),
      deliverable: z.string().max(240).optional(),
      notes: z.string().max(500).optional(),
      initial_tasks: z.array(z.string().min(1).max(140)).max(12).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_job_application'),
    summary: z.string().min(1).max(180),
    payload: z.object({
      company: z.string().min(1).max(120),
      role: z.string().min(1).max(120),
      status: z
        .enum(['saved', 'applied', 'interview', 'technical_test', 'offer', 'rejected'])
        .optional(),
      applied_date: optionalNormalizedDate,
      salary_info: z.string().max(100).optional(),
      next_step: z.string().max(160).optional(),
      link: z.string().max(300).optional(),
      notes: z.string().max(400).optional(),
    }),
  }),
]);

export type ProposedAiAction = z.infer<typeof proposedActionSchema> & { id: string };

/**
 * Classifies a user prompt into the ideal Gemini task profile so `smart` mode
 * saves low-quota top models (20/day) for planning/analysis and uses fast high-quota
 * Flash Lite models (500/day) for everyday quick entries.
 */
export function classifyPromptTask(prompt: string): PromptTaskProfile {
  const clean = stripAccents(prompt);
  if (
    /(rotina|calendario|agenda da semana|semana toda|segunda a sexta|seg a sex|template|monta.*semana|organiza.*semana|cronograma|plano de estud|horario semanal|todos os dias|toda semana)/.test(
      clean,
    )
  ) {
    return 'routine_planning';
  }
  if (
    clean.length > 220 ||
    /(analis|diagnost|estrateg|compar|clt vs|vale a pena|resum[ao].*(mes|semana|financeir|geral|dia)|o que melhorar|planej.*mes|orcamento completo|como economizar|prioridades)/.test(
      clean,
    )
  ) {
    return 'deep_analysis';
  }
  return 'quick_entry';
}

export function buildModelChain(
  preferred: GeminiModelId,
  userPrompt?: string,
): ConcreteGeminiModelId[] {
  if (preferred === 'auto') {
    return [...ORDERED_GEMINI_FALLBACK_CHAIN];
  }
  if (preferred === 'smart') {
    const profile = userPrompt ? classifyPromptTask(userPrompt) : 'quick_entry';
    if (profile === 'deep_analysis') {
      return [
        'gemini-4-hydrogen',
        'gemini-3.8-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemma-4-31b-it',
      ];
    }
    if (profile === 'routine_planning') {
      return [
        'gemini-3.8-flash',
        'gemini-4-hydrogen',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemma-4-31b-it',
      ];
    }
    return [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-4-hydrogen',
      'gemma-4-31b-it',
    ];
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
        (parsed.model === 'gemini-3.5-flash-lite' || parsed.model === 'auto');
      const validModel: GeminiModelId = isLegacyDefault
        ? 'smart'
        : GEMINI_MODELS.some((m) => m.id === parsed.model)
          ? (parsed.model as GeminiModelId)
          : 'smart';
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
    model: 'smart',
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
  const [snap, categories, recentTxs, recurring, goals] = await Promise.all([
    loadDashboardSnapshot(db, today),
    listCategories(db),
    listTransactions(db),
    listRecurringRules(db),
    listGoals(db),
  ]);

  const money = (val: number) => (shareFinancialContext ? formatBRL(val) : '[OCULTO]');

  const eventsLine =
    snap.todayEvents.length > 0
      ? snap.todayEvents
          .slice(0, 10)
          .map(
            (e) =>
              `id=${e.id} ${e.start_at.slice(11, 16)}-${e.end_at.slice(11, 16)} ${e.title} (${e.category})`,
          )
          .join('; ')
      : 'nenhum';

  const tasksLine =
    snap.priorityTasks.length > 0
      ? snap.priorityTasks
          .slice(0, 10)
          .map(
            (t) =>
              `id=${t.id} [${t.priority}] ${t.title}${t.due_date ? ` (${t.due_date})` : ''}`,
          )
          .join('; ')
      : 'nenhuma';

  const habitsLine = snap.habits
    .map(
      (h) =>
        `id=${h.id} ${h.name}: ${h.completedThisWeek}/${h.weekly_target}${h.doneToday ? ' (feito hoje)' : ''}`,
    )
    .join('; ');

  const goalsLine =
    goals.length > 0
      ? goals
          .slice(0, 6)
          .map((g) => `${g.name}: ${money(g.current_amount)}/${money(g.target_amount)}`)
          .join('; ')
      : 'nenhuma';

  const catsLine = categories.map((c) => `${c.id}=${c.name}(${c.kind})`).join(', ');

  const recentTxLines =
    recentTxs.length > 0
      ? recentTxs
          .slice(0, 12)
          .map(
            (tx) =>
              `id=${tx.id} | ${tx.date} | ${tx.type} | ${tx.status} | ${money(tx.amount)} | ${tx.description}`,
          )
          .join('\n  ')
      : 'nenhuma';

  const recurringLines =
    recurring.length > 0
      ? recurring
          .slice(0, 12)
          .map(
            (r) =>
              `id=${r.id} | dia ${String(r.day_of_month).padStart(2, '0')} | ${r.type} | ${money(r.amount)} | ${r.description}`,
          )
          .join('\n  ')
      : 'nenhuma';

  const memories = loadAiMemory();
  const memoryLine =
    memories.length > 0 ? memories.map((m) => `- ${m.fact}`).join('\n  ') : 'nenhuma salva ainda';

  return [
    `Data de hoje: ${today}`,
    `Usuário: ${snap.settings.user_name || 'Usuário'} | Modo rotina: ${snap.settings.routine_mode} (${snap.settings.work_days_per_week}d/sem)`,
    `Financeiro: Saldo=${money(snap.totalBalance)}, Receita mês=${money(snap.monthlyFinance.realizedIncome)}, Despesa mês=${money(snap.monthlyFinance.realizedExpense)}, Meta mensal=${money(snap.settings.monthly_net_goal)}`,
    `Metas financeiras: ${goalsLine}`,
    `Uber/99 Semana: Bruto=${money(snap.workWeek.totalGross)}, Líquido oper=${money(snap.workWeek.totalOperationalNet)}, Combustível=${money(snap.workWeek.totalFuelCost)}, KM=${formatNumber(snap.workWeek.totalKm, 1)}`,
    `Estudos TI semana: ${formatNumber(snap.weeklyStudyHours, 1)}h / ${snap.settings.study_weekly_goal_hours}h | Vagas ativas: ${snap.activeApplications.length} | Entrevistas: ${snap.upcomingInterviews.length}`,
    `Fim de semana com filho: ${snap.upcomingChildWeekends[0]?.label ?? 'não configurado'}`,
    `Agenda de hoje: ${eventsLine}`,
    `Tarefas pendentes: ${tasksLine}`,
    `Hábitos semana: ${habitsLine}`,
    `Regras recorrentes mensais (use rule_id para editar/apagar):\n  ${recurringLines}`,
    `Últimas transações no banco (use transaction_id para corrigir/apagar):\n  ${recentTxLines}`,
    `Memória persistente sobre o usuário:\n  ${memoryLine}`,
    `Categorias válidas (use estes IDs ao sugerir transações/orçamentos): ${catsLine}`,
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
  'create_installment',
  'update_transaction',
  'delete_transaction',
  'create_recurring_rule',
  'update_recurring_rule',
  'delete_recurring_rule',
  'create_goal',
  'upsert_budget',
  'save_memory',
  'create_work_session',
  'create_task',
  'complete_task',
  'create_event',
  'create_routine_schedule',
  'apply_schedule_template',
  'delete_event',
  'log_habit',
  'create_idea',
  'create_project',
  'create_job_application',
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
    const anyFenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    workingText = workingText.replace(anyFenceRegex, (full, inner: string) => {
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
  return `Você é o Assistente IA pessoal integrado ao LifeHub (app desktop Windows, Android e iPhone em português do Brasil), com memória persistente e controle real completo sobre o banco SQLite do usuário.

Regras obrigatórias:
- Responda em português do Brasil, de forma prática, direta e em parágrafos curtos ou listas.
- NUNCA mencione nem sugira iFood (apenas Uber Moto e 99Moto para aplicativos).
- Respeite sempre os fins de semana com o filho e o equilíbrio entre trabalho, saúde e estudos de TI.
- REGRAS DE FINANÇAS (AVULSO, FIXO E PARCELADO):
  1) **Avulso (já pago/recebido)**: use \`create_transaction\` com \`"status":"realized"\` (ex: "gastei 35 de gasolina", "recebi 1514,79 do 13º hoje").
  2) **Fixo mensal (recorrência)**: use \`create_recurring_rule\` (ex: "gasto fixo de 620 de pensão dia 01", "aluguel 900 todo dia 05"). Para editar ou apagar uma recorrência existente, use \`update_recurring_rule\` ou \`delete_recurring_rule\`.
  3) **Parcelado ou Cartão (1x a 120x)**: use \`create_installment\`! Aceita **1x no cartão para o próximo mês** (\`"installments":1,"next_month":true,"kind":"cartao"\`), compras parceladas (\`"installments":6,"amount_mode":"total"\` ou \`"per_parcel"\`), financiamento de moto (\`"kind":"moto"\`), seguro (\`"kind":"seguro"\`) e contas da casa (\`"family":true\`).
  4) **Correções**: quando o usuário corrigir um lançamento recente, use \`update_transaction\` ou \`delete_transaction\` com o \`transaction_id\` do contexto — NUNCA crie duplicata!
- REGRAS DE CALENDÁRIO E ROTINA:
  1) Evento único: use \`create_event\` (horários em \`HH:mm\`, ex: \`"07:30"\`).
  2) Rotina recorrente semanal (ex: "academia seg/qua/sex 14h30", "estudar TI seg a sex 19h"): use \`create_routine_schedule\` com \`weekdays\` (ex: \`["seg","qua","sex"]\`) e \`weeks\` (padrão 4).
  3) Aplicar rotina semanal inteira pronta: use \`apply_schedule_template\` (\`apps_5d\`, \`apps_4d\`, \`apps_6d\`, \`clt\` ou \`ti\`).
- REGRAS DE IDEIAS, TAREFAS, HÁBITOS, METAS E CARREIRA TI:
  - Ideias: \`create_idea\` | Tarefas: \`create_task\` / \`complete_task\` | Hábitos: \`log_habit\` | Metas financeiras: \`create_goal\` | Orçamento mensal por categoria: \`upsert_budget\` | Projetos: \`create_project\` | Vagas TI: \`create_job_application\`.
- Use SEMPRE número puro em JSON para valores (ex: 1514.79 ou 620, sem "R$").
- Quando o usuário disser "hoje"/"hj", use a Data de hoje do contexto (YYYY-MM-DD).

Formatos permitidos no bloco \`\`\`lifehub_actions (array JSON válido, sem comentários):
1) Transação avulsa:
{"type":"create_transaction","summary":"Despesa: Gasolina R$ 35,00","payload":{"txType":"expense","description":"Gasolina","amount":35,"date":"YYYY-MM-DD","category_id":"cat_combustivel","source_type":"outros","status":"realized"}}
2) Parcelamento / Cartão (1x–120x):
{"type":"create_installment","summary":"Cartão 1x próx. mês: Fone R$ 180,00","payload":{"kind":"cartao","description":"Fone Bluetooth","amount":180,"amount_mode":"total","installments":1,"next_month":true,"issuer":"Nubank","family":false,"first_paid":false}}
3) Corrigir / apagar transação:
{"type":"update_transaction","summary":"Mover para Previsto dia 01","payload":{"transaction_id":"tx_xxx","status":"planned","date":"2026-12-01","due_date":"2026-12-01"}}
{"type":"delete_transaction","summary":"Remover duplicata","payload":{"transaction_id":"tx_xxx","match_description":"Pensão"}}
4) Recorrência mensal (criar / editar / apagar):
{"type":"create_recurring_rule","summary":"Fixo mensal: Internet R$ 119,90 (dia 10)","payload":{"txType":"expense","description":"Internet Fibra","amount":119.9,"day_of_month":10,"category_id":"cat_moradia"}}
{"type":"update_recurring_rule","summary":"Atualizar Internet para R$ 129,90","payload":{"rule_id":"rec_xxx","match_description":"Internet","amount":129.9,"day_of_month":10,"sync_planned":true}}
{"type":"delete_recurring_rule","summary":"Remover recorrência antiga","payload":{"rule_id":"rec_xxx","match_description":"Internet"}}
5) Meta financeira / Orçamento categoria:
{"type":"create_goal","summary":"Meta: Reserva de emergência R$ 5.000","payload":{"name":"Reserva de emergência","target_amount":5000,"current_amount":500,"target_date":"2027-06-01"}}
{"type":"upsert_budget","summary":"Orçamento Alimentação R$ 600/mês","payload":{"category_id":"cat_alimentacao","limit_amount":600}}
6) Agenda (evento único / rotina semanal / template semanal / apagar):
{"type":"create_event","summary":"Evento: Dentista 15:00-16:00","payload":{"title":"Dentista","category":"saude","date":"YYYY-MM-DD","start_time":"15:00","end_time":"16:00"}}
{"type":"create_routine_schedule","summary":"Rotina: Academia Seg/Qua/Sex 14:30","payload":{"title":"Academia","category":"academia","weekdays":["seg","qua","sex"],"start_time":"14:30","end_time":"15:30","weeks":4}}
{"type":"apply_schedule_template","summary":"Aplicar rotina Apps 5 dias na semana","payload":{"template_id":"apps_5d","date":"YYYY-MM-DD"}}
{"type":"delete_event","summary":"Remover evento","payload":{"event_id":"evt_xxx","match_title":"Dentista"}}
7) Tarefa / Concluir tarefa / Hábito:
{"type":"create_task","summary":"Tarefa: Revisar currículo TI","payload":{"title":"Revisar currículo TI","priority":"high","due_date":"YYYY-MM-DD","category":"carreira"}}
{"type":"complete_task","summary":"Concluir tarefa Revisar currículo","payload":{"task_id":"tsk_xxx","match_title":"Revisar currículo"}}
{"type":"log_habit","summary":"Registrar hábito Academia (60 min)","payload":{"habit_name":"Academia","duration_minutes":60}}
8) Jornada Uber/99 (sem iFood):
{"type":"create_work_session","summary":"Uber Moto: R$ 210 bruto · 95 km","payload":{"platform":"uber_moto","date":"YYYY-MM-DD","start_time":"07:00","end_time":"12:30","gross_amount":210,"km_total":95,"fuel_cost":35,"syncFinance":true}}
9) Ideia / Projeto / Vaga TI / Memória:
{"type":"create_idea","summary":"Ideia: App controle manutenção moto","payload":{"title":"App controle manutenção moto","description":"Lembrar troca de óleo por KM","tags":"moto,ti","impact":4,"effort":2}}
{"type":"create_project","summary":"Projeto: Lab Redes Home","payload":{"title":"Lab Redes Home","category":"portfolio_ti","deliverable":"Documentação no GitHub","initial_tasks":["Subir VM Linux","Configurar firewall"]}}
{"type":"create_job_application","summary":"Vaga: Suporte N2 na Empresa X","payload":{"company":"Empresa X","role":"Analista Suporte TI N2","status":"applied","salary_info":"R$ 3.500"}}
{"type":"save_memory","summary":"Lembrar preferência","payload":{"fact":"Pagamentos fixos mensais saem todo dia 01."}}

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
        temperature: 0.3,
        maxOutputTokens: 4096,
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
  preferredModel: GeminiModelId = 'smart',
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
): Promise<{
  text: string;
  actions: ProposedAiAction[];
  modelUsed: ConcreteGeminiModelId;
  taskProfile: PromptTaskProfile;
}> {
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

  const taskProfile = classifyPromptTask(userPrompt);
  const chain = buildModelChain(config.model, userPrompt);

  let lastErr = '';
  for (const modelId of chain) {
    const res = await callGeminiModel(modelId, cleanKey, systemInstruction, contents, fetchFn);
    if (res.ok) {
      const { cleanText, actions } = extractProposedActions(res.text);
      return { text: cleanText, actions, modelUsed: modelId, taskProfile };
    }
    lastErr = `${modelId}: ${res.message}`;
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
    const needle = stripAccents(matchDescription);
    const matched = all.find((t) => stripAccents(t.description).includes(needle));
    if (matched) return matched;
  }
  return null;
}

async function resolveTargetRecurringRule(
  db: SqlExecutor,
  ruleId?: string,
  matchDescription?: string,
) {
  const all = await listRecurringRules(db);
  if (ruleId) {
    const exact = all.find((r) => r.id === ruleId.trim());
    if (exact) return exact;
  }
  if (matchDescription && matchDescription.trim()) {
    const needle = stripAccents(matchDescription);
    const matched = all.find((r) => stripAccents(r.description).includes(needle));
    if (matched) return matched;
  }
  return null;
}

function firstDateForWeekday(baseISO: string, targetDayOfWeek: number): string {
  const [y, m, d] = baseISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const currentDow = dt.getDay(); // 0=Sun..6=Sat
  const delta = (targetDayOfWeek - currentDow + 7) % 7;
  return addDaysISO(baseISO, delta);
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

    const count = action.payload.installments ?? 1;
    const totalAmount =
      action.payload.amount_mode === 'per_parcel'
        ? round2(action.payload.amount * count)
        : action.payload.amount;

    const created = await createTransaction(db, {
      account_id: targetAcc,
      category_id: validCatId,
      type: action.payload.txType,
      source_type: action.payload.source_type ?? 'outros',
      description: action.payload.description,
      amount: totalAmount,
      date: action.payload.date ?? today,
      due_date: action.payload.due_date ?? null,
      status: action.payload.status ?? (count > 1 ? 'planned' : 'realized'),
      installments: count,
      force_installment_group: action.payload.force_installment_group ?? false,
      notes: action.payload.notes ?? '',
    });
    const first = created[0];
    const statusLabel = (first?.status ?? action.payload.status) === 'planned' ? 'Previsto' : 'Realizado';
    if (created.length > 1) {
      return `Parcelamento salvo (${created.length}x de ${formatBRL(first?.amount ?? totalAmount / count)}): ${action.payload.description}.`;
    }
    return `Transação salva [${first?.id ?? 'ok'}] (${statusLabel}): ${first?.description ?? action.payload.description} (${formatBRL(first?.amount ?? totalAmount)}).`;
  }

  if (action.type === 'create_installment') {
    const [accounts, categories] = await Promise.all([listAccounts(db), listCategories(db)]);
    const targetAcc = accounts[0]?.id ?? 'acc_principal';
    const kind = action.payload.kind ?? 'cartao';
    const kindTag =
      kind === 'cartao'
        ? '[Cartão]'
        : kind === 'moto'
          ? '[Moto]'
          : kind === 'seguro'
            ? '[Seguro]'
            : '[Parcelado]';

    const requestedCatId = action.payload.category_id ?? null;
    const defaultCatId =
      kind === 'moto' || kind === 'seguro'
        ? 'cat_moto'
        : categories.find((c) => c.kind === 'expense')?.id ?? null;
    const validCatId =
      requestedCatId && categories.some((c) => c.id === requestedCatId)
        ? requestedCatId
        : defaultCatId;

    const count = Math.min(120, Math.max(1, action.payload.installments));
    const totalAmount =
      action.payload.amount_mode === 'per_parcel'
        ? round2(action.payload.amount * count)
        : action.payload.amount;
    const firstDate =
      action.payload.first_date ??
      (action.payload.next_month ? addMonthsISO(today, 1) : today);

    const tagParts = [kindTag];
    if (action.payload.issuer?.trim()) {
      tagParts.push(`[${action.payload.issuer.trim()}]`);
    }
    if (action.payload.family) {
      tagParts.push('[Família]');
    }
    const cleanNotes = [tagParts.join(' '), action.payload.notes?.trim() ?? '']
      .filter(Boolean)
      .join(' · ');

    const created = await createTransaction(db, {
      account_id: targetAcc,
      category_id: validCatId,
      type: 'expense',
      source_type: 'outros',
      description: action.payload.description,
      amount: totalAmount,
      date: firstDate,
      due_date: firstDate,
      status: action.payload.first_paid ? 'realized' : 'planned',
      installments: count,
      force_installment_group: true,
      notes: cleanNotes,
    });
    const perParcel = created[0]?.amount ?? round2(totalAmount / count);
    return `Parcelamento ${kindTag} salvo: ${action.payload.description} (${count}x de ${formatBRL(perParcel)} · 1ª em ${firstDate}).`;
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

    const [yStr, mStr, dStr] = today.split('-');
    const todayYear = Number(yStr);
    const todayMonth = Number(mStr);
    const todayDay = Number(dStr);
    const targetMonth =
      rule.day_of_month >= todayDay
        ? `${todayYear}-${String(todayMonth).padStart(2, '0')}`
        : todayMonth === 12
          ? `${todayYear + 1}-01`
          : `${todayYear}-${String(todayMonth + 1).padStart(2, '0')}`;
    await generateMonthlyRecurringTransactions(db, targetMonth);

    return `Despesa/receita fixa salva: ${rule.description} (${formatBRL(rule.amount)} · dia ${String(rule.day_of_month).padStart(2, '0')}, já prevista em ${targetMonth}).`;
  }

  if (action.type === 'update_recurring_rule') {
    const target = await resolveTargetRecurringRule(
      db,
      action.payload.rule_id,
      action.payload.match_description,
    );
    if (!target) {
      throw new Error('Não encontrei a regra recorrente mensal para editar.');
    }
    const categories = await listCategories(db);
    const requestedCatId = action.payload.category_id;
    const nextCatId =
      requestedCatId !== undefined
        ? requestedCatId && categories.some((c) => c.id === requestedCatId)
          ? requestedCatId
          : target.category_id
        : target.category_id;

    const { rule, updatedPlannedCount } = await updateRecurringRule(db, target.id, {
      account_id: target.account_id,
      category_id: nextCatId,
      type: action.payload.txType ?? target.type,
      source_type: target.source_type,
      description: action.payload.description ?? target.description,
      amount: action.payload.amount ?? target.amount,
      day_of_month: action.payload.day_of_month ?? target.day_of_month,
      notes: action.payload.notes ?? target.notes,
      syncPlannedTransactions: action.payload.sync_planned !== false,
    });
    return `Recorrência atualizada [${rule.id}]: ${rule.description} (${formatBRL(rule.amount)} · dia ${String(rule.day_of_month).padStart(2, '0')}${updatedPlannedCount > 0 ? ` · ${updatedPlannedCount} previsto(s) atualizados` : ''}).`;
  }

  if (action.type === 'delete_recurring_rule') {
    const target = await resolveTargetRecurringRule(
      db,
      action.payload.rule_id,
      action.payload.match_description,
    );
    if (!target) {
      throw new Error('Não encontrei a recorrência mensal para remover.');
    }
    await deleteRecurringRule(db, target.id);
    return `Recorrência mensal removida: ${target.description} (${formatBRL(target.amount)}).`;
  }

  if (action.type === 'create_goal') {
    const goal = await createGoal(db, {
      name: action.payload.name,
      target_amount: action.payload.target_amount,
      current_amount: action.payload.current_amount ?? 0,
      target_date: action.payload.target_date ?? null,
      notes: action.payload.notes ?? '',
    });
    return `Meta financeira criada: ${goal.name} (alvo ${formatBRL(goal.target_amount)}).`;
  }

  if (action.type === 'upsert_budget') {
    const categories = await listCategories(db);
    const matchedCat =
      categories.find((c) => c.id === action.payload.category_id) ??
      categories.find((c) => stripAccents(c.name).includes(stripAccents(action.payload.category_id)));
    if (!matchedCat) {
      throw new Error(`Categoria "${action.payload.category_id}" não encontrada para orçamento.`);
    }
    const targetMonth = action.payload.month ?? today.slice(0, 7);
    await upsertCategoryBudget(db, targetMonth, matchedCat.id, action.payload.limit_amount);
    return `Orçamento salvo (${targetMonth}): ${matchedCat.name} até ${formatBRL(action.payload.limit_amount)}.`;
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

  if (action.type === 'complete_task') {
    const tasks = await listTasks(db, 'todo');
    const target = action.payload.task_id
      ? tasks.find((t) => t.id === action.payload.task_id)
      : action.payload.match_title
        ? tasks.find((t) =>
            stripAccents(t.title).includes(stripAccents(action.payload.match_title ?? '')),
          )
        : undefined;
    if (!target) {
      throw new Error('Não encontrei a tarefa pendente para concluir.');
    }
    await toggleTaskStatus(db, target.id);
    return `Tarefa concluída: ${target.title}.`;
  }

  if (action.type === 'create_event') {
    const date = action.payload.date ?? today;
    const startTime = action.payload.start_time;
    const rawEnd = action.payload.end_time;
    const endTime = rawEnd && rawEnd > startTime ? rawEnd : addMinutesToHHMM(startTime, 60);
    const created = await createCalendarEvent(db, {
      title: action.payload.title,
      category: (action.payload.category ?? 'geral') as EventCategory,
      start_at: `${date}T${startTime}:00`,
      end_at: `${date}T${endTime}:00`,
      notes: action.payload.notes ?? '',
    });
    return `Compromisso agendado: ${created.title} (${date} ${startTime}-${endTime}).`;
  }

  if (action.type === 'create_routine_schedule') {
    const baseDate = action.payload.start_date ?? today;
    const startTime = action.payload.start_time;
    const rawEnd = action.payload.end_time;
    const endTime = rawEnd && rawEnd > startTime ? rawEnd : addMinutesToHHMM(startTime, 60);
    const weeks = action.payload.weeks ?? 4;
    const category = (action.payload.category ?? 'geral') as EventCategory;
    const skipChild = action.payload.skip_child_weekends ?? category === 'trabalho';

    let totalCreated = 0;
    let totalSkipped = 0;
    for (const dow of action.payload.weekdays) {
      const firstOccurrence = firstDateForWeekday(baseDate, dow);
      const res = await createRecurringWeeklyEvents(
        db,
        {
          title: action.payload.title,
          category,
          date: firstOccurrence,
          start_time: startTime,
          end_time: endTime,
          weeks,
          notes: action.payload.notes ?? '',
          skipChildWeekends: skipChild,
        },
        settings,
      );
      totalCreated += res.created.length;
      totalSkipped += res.skippedChildWeekends;
    }
    return `Rotina semanal criada: ${action.payload.title} (${totalCreated} blocos em ${weeks} semana(s)${totalSkipped > 0 ? `, ${totalSkipped} fim(ns) de semana com filho preservado(s)` : ''}).`;
  }

  if (action.type === 'apply_schedule_template') {
    const refDate = action.payload.date ?? startOfWeekISO(today);
    const created = await applyScheduleTemplateToWeek(
      db,
      action.payload.template_id as ScheduleTemplateId,
      refDate,
      settings,
      action.payload.replace_existing !== false,
    );
    return `Template de rotina "${action.payload.template_id}" aplicado (${created.length} blocos criados na semana de ${startOfWeekISO(refDate)}).`;
  }

  if (action.type === 'delete_event') {
    const events = await listCalendarEvents(db);
    const target = action.payload.event_id
      ? events.find((e) => e.id === action.payload.event_id)
      : action.payload.match_title
        ? events.find((e) =>
            stripAccents(e.title).includes(stripAccents(action.payload.match_title ?? '')),
          )
        : undefined;
    if (!target) {
      throw new Error('Não encontrei o compromisso no calendário para remover.');
    }
    await deleteCalendarEvent(db, target.id);
    return `Compromisso removido: ${target.title} (${target.start_at.slice(0, 10)}).`;
  }

  if (action.type === 'log_habit') {
    const date = action.payload.date ?? today;
    const habits = await listHabitsWithProgress(db, date);
    let target = action.payload.habit_id
      ? habits.find((h) => h.id === action.payload.habit_id)
      : undefined;
    if (!target && action.payload.habit_name) {
      const needle = stripAccents(action.payload.habit_name);
      target = habits.find(
        (h) => stripAccents(h.name).includes(needle) || stripAccents(h.category).includes(needle),
      );
    }
    if (!target) {
      const name = action.payload.habit_name?.trim() || 'Hábito';
      const clean = stripAccents(name);
      const cat: HabitCategory = /academ|treino/.test(clean)
        ? 'academia'
        : /corrid/.test(clean)
          ? 'corrida'
          : /agua|hidrat/.test(clean)
            ? 'agua'
            : /descans|pausa/.test(clean)
              ? 'descanso'
              : /sono|dorm/.test(clean)
                ? 'sono'
                : 'outro';
      const createdHabit = await createHabit(db, { name, category: cat, weekly_target: 3 });
      await logHabitSession(db, {
        habit_id: createdHabit.id,
        date,
        duration_minutes: action.payload.duration_minutes ?? 30,
        notes: action.payload.notes ?? '',
      });
      return `Hábito criado e registrado hoje: ${createdHabit.name}.`;
    }
    await logHabitSession(db, {
      habit_id: target.id,
      date,
      duration_minutes: action.payload.duration_minutes ?? 30,
      notes: action.payload.notes ?? '',
    });
    return `Hábito registrado: ${target.name} (${date}).`;
  }

  if (action.type === 'create_project') {
    const created = await createProject(db, {
      title: action.payload.title,
      category: (action.payload.category ?? 'portfolio_ti') as ProjectCategory,
      deliverable: action.payload.deliverable ?? '',
      notes: action.payload.notes ?? '',
      initialTasks: action.payload.initial_tasks ?? [],
    });
    return `Projeto criado: ${created.title} (${created.tasks.length} etapa(s)).`;
  }

  if (action.type === 'create_job_application') {
    const created = await createJobApplication(db, {
      company: action.payload.company,
      role: action.payload.role,
      status: (action.payload.status ?? 'applied') as JobApplicationStatus,
      applied_date: action.payload.applied_date ?? today,
      salary_info: action.payload.salary_info ?? '',
      next_step: action.payload.next_step ?? '',
      link: action.payload.link ?? '',
      notes: action.payload.notes ?? '',
    });
    return `Vaga registrada: ${created.role} em ${created.company}.`;
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
