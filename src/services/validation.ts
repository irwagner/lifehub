import { z } from 'zod';

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const settingsUpdateSchema = z.object({
  user_name: z.string().trim().max(80).optional(),
  theme: z.enum(['dark', 'light']).optional(),
  routine_mode: z.enum(['clt', 'apps', 'ti']).optional(),
  work_days_per_week: z.union([z.literal(4), z.literal(5), z.literal(6)]).optional(),
  monthly_net_goal: z.number().min(0).max(1000000).optional(),
  clt_reference_net: z.number().min(0).max(1000000).optional(),
  maintenance_per_km: z.number().min(0).max(20).optional(),
  depreciation_per_km: z.number().min(0).max(20).optional(),
  vehicle_monthly_payment: z.number().min(0).max(50000).optional(),
  child_weekend_mode: z.enum(['all', 'alternating', 'custom']).optional(),
  child_weekend_anchor: z.string().regex(isoDateRegex).nullable().optional(),
  commute_minutes: z.number().int().min(0).max(360).optional(),
  wake_time: z.string().regex(timeRegex).optional(),
  sleep_time: z.string().regex(timeRegex).optional(),
  study_weekly_goal_hours: z.number().min(0).max(60).optional(),
  onboarding_completed: z.number().int().min(0).max(1).optional(),
  demo_data_loaded: z.number().int().min(0).max(1).optional(),
});

export const createTransactionSchema = z
  .object({
    account_id: z.string().min(1, 'Selecione uma conta'),
    destination_account_id: z.string().nullable().optional(),
    category_id: z.string().nullable().optional(),
    type: z.enum(['income', 'expense', 'transfer']),
    source_type: z.enum(['salario', 'aplicativos', 'servicos_ti', 'outros']).default('outros'),
    description: z.string().trim().min(1, 'Informe uma descrição').max(140),
    amount: z.number().positive('O valor deve ser maior que zero'),
    date: z.string().regex(isoDateRegex, 'Data inválida'),
    due_date: z.string().regex(isoDateRegex).nullable().optional(),
    status: z.enum(['realized', 'planned']).default('realized'),
    installments: z.number().int().min(1).max(120).default(1),
    notes: z.string().max(500).default(''),
  })
  .refine(
    (data) =>
      data.type !== 'transfer' ||
      (Boolean(data.destination_account_id) && data.destination_account_id !== data.account_id),
    {
      message: 'Para transferência, escolha uma conta de destino diferente da conta de origem.',
      path: ['destination_account_id'],
    },
  );

export const createWorkSessionSchema = z
  .object({
    vehicle_id: z.string().nullable().optional(),
    date: z.string().regex(isoDateRegex, 'Data inválida'),
    // Explicitamente sem iFood conforme blueprint
    platform: z.enum(['uber_moto', '99_moto', 'ambos']),
    start_time: z.string().regex(timeRegex, 'Hora inicial inválida (HH:mm)'),
    end_time: z.string().regex(timeRegex, 'Hora final inválida (HH:mm)'),
    gross_amount: z.number().min(0, 'Faturamento bruto não pode ser negativo'),
    km_start: z.number().min(0).nullable().optional(),
    km_end: z.number().min(0).nullable().optional(),
    km_total: z.number().min(0).nullable().optional(),
    fuel_liters: z.number().min(0).default(0),
    fuel_cost: z.number().min(0).default(0),
    tolls_parking: z.number().min(0).default(0),
    maintenance_per_km_snapshot: z.number().min(0).optional(),
    depreciation_per_km_snapshot: z.number().min(0).optional(),
    notes: z.string().max(500).default(''),
  })
  .refine(
    (data) => {
      if (data.km_start != null && data.km_end != null) {
        return data.km_end >= data.km_start;
      }
      return data.km_total != null && data.km_total >= 0;
    },
    {
      message: 'Informe km inicial/final válidos (final >= inicial) ou km total.',
      path: ['km_total'],
    },
  );

export const createCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1, 'Informe o título do compromisso').max(140),
    category: z.enum([
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
    ]),
    start_at: z.string().min(10, 'Início inválido'),
    end_at: z.string().min(10, 'Fim inválido'),
    all_day: z.number().int().min(0).max(1).default(0),
    color: z.string().optional(),
    location: z.string().max(140).default(''),
    notes: z.string().max(500).default(''),
    source_template: z.string().nullable().optional(),
    recurrence_rule: z.string().nullable().optional(),
  })
  .refine((data) => data.end_at >= data.start_at, {
    message: 'A hora de término deve ser posterior ao início.',
    path: ['end_at'],
  });

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Informe o título da tarefa').max(140),
  description: z.string().max(500).default(''),
  due_date: z.string().regex(isoDateRegex).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  category: z.string().trim().max(40).default('geral'),
});

export const createVehicleSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do veículo').max(100),
  model_year: z.string().trim().max(20).default(''),
  status: z.enum(['owned', 'financed', 'planned']).default('owned'),
  estimated_value: z.number().min(0).default(0),
  financing_amount: z.number().min(0).default(0),
  monthly_payment: z.number().min(0).default(0),
  total_installments: z.number().int().min(0).max(120).default(0),
  maintenance_per_km: z.number().min(0).max(20).default(0.18),
  depreciation_per_km: z.number().min(0).max(20).default(0.1),
  is_active: z.number().int().min(0).max(1).default(1),
  notes: z.string().max(500).default(''),
});

export const createIdeaSchema = z.object({
  title: z.string().trim().min(1, 'Informe o título da ideia').max(140),
  description: z.string().max(1000).default(''),
  tags: z.string().max(200).default(''),
  status: z.enum(['idea', 'planning', 'doing', 'done', 'paused']).default('idea'),
  impact: z.number().int().min(1).max(5).default(3),
  effort: z.number().int().min(1).max(5).default(3),
});
