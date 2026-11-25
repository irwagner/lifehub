export type RoutineMode = 'clt' | 'apps' | 'ti';
export type ThemeMode = 'dark' | 'light';
export type UiSkin =
  | 'orbital'
  | 'emerald_noir'
  | 'amber_carbon'
  | 'cyber_neon'
  | 'nordic_frost'
  | 'retro_classic';
export type WorkDaysPerWeek = 4 | 5 | 6;
export type ChildWeekendMode = 'all' | 'alternating' | 'custom';

export interface Settings {
  id: number;
  user_name: string;
  currency: string;
  theme: ThemeMode;
  routine_mode: RoutineMode;
  work_days_per_week: WorkDaysPerWeek;
  monthly_net_goal: number;
  clt_reference_net: number;
  maintenance_per_km: number;
  depreciation_per_km: number;
  vehicle_monthly_payment: number;
  child_weekend_mode: ChildWeekendMode;
  child_weekend_anchor: string | null;
  commute_minutes: number;
  wake_time: string;
  sleep_time: string;
  study_weekly_goal_hours: number;
  onboarding_completed: number;
  demo_data_loaded: number;
  reminders_enabled: number;
  ui_skin: UiSkin;
  updated_at: string;
}

export type AccountType = 'carteira' | 'conta_corrente' | 'poupanca' | 'reserva' | 'outro';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
  color: string;
  is_default: number;
  created_at: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';
export type TransactionSourceType = 'salario' | 'aplicativos' | 'servicos_ti' | 'outros';
export type TransactionStatus = 'realized' | 'planned';

export interface Transaction {
  id: string;
  account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  type: TransactionType;
  source_type: TransactionSourceType;
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD
  due_date: string | null;
  status: TransactionStatus;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  external_hash: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RecurringRule {
  id: string;
  account_id: string;
  category_id: string | null;
  type: 'income' | 'expense';
  source_type: TransactionSourceType;
  description: string;
  amount: number;
  day_of_month: number;
  active: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CategoryBudget {
  id: string;
  month: string; // YYYY-MM
  category_id: string;
  limit_amount: number;
  created_at: string;
  updated_at: string;
}

export interface FinancialGoal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type VehicleStatus = 'owned' | 'financed' | 'planned';

export interface Vehicle {
  id: string;
  name: string;
  model_year: string;
  status: VehicleStatus;
  estimated_value: number;
  financing_amount: number;
  monthly_payment: number;
  total_installments: number;
  maintenance_per_km: number;
  depreciation_per_km: number;
  is_active: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type VehicleExpenseCategory =
  | 'manutencao'
  | 'seguro'
  | 'ipva'
  | 'financiamento'
  | 'pneu'
  | 'oleo'
  | 'outro';

export interface VehicleExpense {
  id: string;
  vehicle_id: string;
  date: string;
  category: VehicleExpenseCategory;
  description: string;
  amount: number;
  odometer_km: number | null;
  notes: string;
  created_at: string;
}

// iFood fora do escopo conforme blueprint
export type WorkPlatform = 'uber_moto' | '99_moto' | 'ambos';

export interface WorkSession {
  id: string;
  vehicle_id: string | null;
  date: string; // YYYY-MM-DD
  platform: WorkPlatform;
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  gross_amount: number;
  km_start: number | null;
  km_end: number | null;
  km_total: number;
  fuel_liters: number;
  fuel_cost: number;
  tolls_parking: number;
  maintenance_per_km_snapshot: number;
  depreciation_per_km_snapshot: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type EventCategory =
  | 'trabalho'
  | 'filho'
  | 'academia'
  | 'corrida'
  | 'estudos'
  | 'entrevista'
  | 'saude'
  | 'deslocamento'
  | 'pausa'
  | 'geral';

export interface CalendarEvent {
  id: string;
  title: string;
  category: EventCategory;
  start_at: string; // YYYY-MM-DDTHH:mm:ss
  end_at: string; // YYYY-MM-DDTHH:mm:ss
  all_day: number;
  color: string;
  location: string;
  notes: string;
  source_template: string | null;
  recurrence_rule: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'done';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  priority: TaskPriority;
  category: string;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type HabitCategory = 'academia' | 'corrida' | 'sono' | 'agua' | 'descanso' | 'outro';

export interface Habit {
  id: string;
  name: string;
  category: HabitCategory;
  weekly_target: number;
  unit: string;
  active: number;
  created_at: string;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  date: string;
  completed: number;
  duration_minutes: number;
  notes: string;
  created_at: string;
}

export interface FamilyChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface FamilyPlan {
  id: string;
  weekend_start: string; // Saturday YYYY-MM-DD
  title: string;
  budget_amount: number;
  checklist_json: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface StudyTrack {
  id: string;
  name: string;
  status: 'planned' | 'active' | 'completed';
  target_hours: number;
  checklist_json: string;
  notes: string;
  created_at: string;
}

export interface StudySession {
  id: string;
  track_id: string;
  date: string;
  duration_minutes: number;
  topic: string;
  notes: string;
  created_at: string;
}

export type JobApplicationStatus =
  | 'saved'
  | 'applied'
  | 'interview'
  | 'technical'
  | 'offer'
  | 'rejected';

export interface JobApplication {
  id: string;
  company: string;
  role: string;
  link: string;
  applied_date: string;
  status: JobApplicationStatus;
  salary_info: string;
  next_step: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type IdeaStatus = 'idea' | 'planning' | 'doing' | 'done' | 'paused';

export interface IdeaItem {
  id: string;
  title: string;
  description: string;
  tags: string;
  status: IdeaStatus;
  impact: number; // 1-5
  effort: number; // 1-5
  checklist_json: string;
  created_at: string;
  updated_at: string;
}

export type ProjectCategory = 'portfolio_ti' | 'sistema' | 'negocio' | 'pessoal';
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'paused';

export interface ProjectItem {
  id: string;
  title: string;
  category: ProjectCategory;
  status: ProjectStatus;
  repo_url: string;
  deliverable: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  done: number;
  created_at: string;
}

export interface WeeklyReview {
  id: string;
  week_start: string; // Monday YYYY-MM-DD
  gross_earned: number;
  net_left: number;
  work_hours: number;
  workouts_count: number;
  study_hours: number;
  applications_count: number;
  family_notes: string;
  lessons_learned: string;
  next_week_focus: string;
  created_at: string;
  updated_at: string;
}

export const EVENT_CATEGORY_META: Record<
  EventCategory,
  { label: string; color: string }
> = {
  trabalho: { label: 'Trabalho', color: '#6366f1' },
  filho: { label: 'Filho / Família', color: '#ec4899' },
  academia: { label: 'Academia', color: '#10b981' },
  corrida: { label: 'Corrida', color: '#14b8a6' },
  estudos: { label: 'Estudos', color: '#3b82f6' },
  entrevista: { label: 'Entrevista / Carreira', color: '#f59e0b' },
  saude: { label: 'Saúde', color: '#22c55e' },
  deslocamento: { label: 'Deslocamento', color: '#64748b' },
  pausa: { label: 'Almoço / Pausa', color: '#8b5cf6' },
  geral: { label: 'Compromisso Geral', color: '#94a3b8' },
};

export const PLATFORM_LABELS: Record<WorkPlatform, string> = {
  uber_moto: 'Uber Moto',
  '99_moto': '99Moto',
  ambos: 'Uber Moto + 99Moto',
};

export const ROUTINE_MODE_LABELS: Record<RoutineMode, string> = {
  clt: 'Trabalho CLT',
  apps: 'Trabalho por Aplicativos',
  ti: 'Emprego de TI',
};
