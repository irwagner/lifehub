import type { SqlExecutor } from './types';

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const CURRENT_SCHEMA_VERSION = 2;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        user_name TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'BRL',
        theme TEXT NOT NULL DEFAULT 'dark',
        routine_mode TEXT NOT NULL DEFAULT 'clt',
        work_days_per_week INTEGER NOT NULL DEFAULT 5,
        monthly_net_goal REAL NOT NULL DEFAULT 3500,
        clt_reference_net REAL NOT NULL DEFAULT 2745,
        maintenance_per_km REAL NOT NULL DEFAULT 0.18,
        depreciation_per_km REAL NOT NULL DEFAULT 0.10,
        vehicle_monthly_payment REAL NOT NULL DEFAULT 0,
        child_weekend_mode TEXT NOT NULL DEFAULT 'alternating',
        child_weekend_anchor TEXT,
        commute_minutes INTEGER NOT NULL DEFAULT 60,
        wake_time TEXT NOT NULL DEFAULT '05:15',
        sleep_time TEXT NOT NULL DEFAULT '22:00',
        study_weekly_goal_hours REAL NOT NULL DEFAULT 6,
        onboarding_completed INTEGER NOT NULL DEFAULT 0,
        demo_data_loaded INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'conta_corrente',
        initial_balance REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'expense',
        color TEXT NOT NULL DEFAULT '#6366f1',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        destination_account_id TEXT,
        category_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
        source_type TEXT NOT NULL DEFAULT 'outros',
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        date TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'realized' CHECK (status IN ('realized', 'planned')),
        installment_group_id TEXT,
        installment_number INTEGER,
        installment_total INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY (destination_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      )`,

      `CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_amount REAL NOT NULL CHECK (target_amount > 0),
        current_amount REAL NOT NULL DEFAULT 0,
        target_date TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model_year TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned', 'financed', 'planned')),
        estimated_value REAL NOT NULL DEFAULT 0,
        financing_amount REAL NOT NULL DEFAULT 0,
        monthly_payment REAL NOT NULL DEFAULT 0,
        total_installments INTEGER NOT NULL DEFAULT 0,
        maintenance_per_km REAL NOT NULL DEFAULT 0.18,
        depreciation_per_km REAL NOT NULL DEFAULT 0.10,
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS vehicle_expenses (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        date TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'manutencao',
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        odometer_km REAL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS work_sessions (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT,
        date TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('uber_moto', '99_moto', 'ambos')),
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        gross_amount REAL NOT NULL CHECK (gross_amount >= 0),
        km_start REAL,
        km_end REAL,
        km_total REAL NOT NULL CHECK (km_total >= 0),
        fuel_liters REAL NOT NULL DEFAULT 0,
        fuel_cost REAL NOT NULL DEFAULT 0,
        tolls_parking REAL NOT NULL DEFAULT 0,
        maintenance_per_km_snapshot REAL NOT NULL DEFAULT 0.18,
        depreciation_per_km_snapshot REAL NOT NULL DEFAULT 0.10,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
      )`,

      `CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'geral',
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        color TEXT NOT NULL DEFAULT '#6366f1',
        location TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        source_template TEXT,
        recurrence_rule TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        due_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        category TEXT NOT NULL DEFAULT 'geral',
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'outro',
        weekly_target INTEGER NOT NULL DEFAULT 3,
        unit TEXT NOT NULL DEFAULT 'sessão',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS habit_logs (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL,
        date TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 1,
        duration_minutes INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS family_plans (
        id TEXT PRIMARY KEY,
        weekend_start TEXT NOT NULL,
        title TEXT NOT NULL,
        budget_amount REAL NOT NULL DEFAULT 0,
        checklist_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS study_tracks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
        target_hours REAL NOT NULL DEFAULT 20,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS study_sessions (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        date TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        topic TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (track_id) REFERENCES study_tracks(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS job_applications (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        link TEXT NOT NULL DEFAULT '',
        applied_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'applied',
        salary_info TEXT NOT NULL DEFAULT '',
        next_step TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS ideas (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planning', 'doing', 'done', 'paused')),
        impact INTEGER NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
        effort INTEGER NOT NULL DEFAULT 3 CHECK (effort BETWEEN 1 AND 5),
        checklist_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS weekly_reviews (
        id TEXT PRIMARY KEY,
        week_start TEXT NOT NULL UNIQUE,
        gross_earned REAL NOT NULL DEFAULT 0,
        net_left REAL NOT NULL DEFAULT 0,
        work_hours REAL NOT NULL DEFAULT 0,
        workouts_count INTEGER NOT NULL DEFAULT 0,
        study_hours REAL NOT NULL DEFAULT 0,
        applications_count INTEGER NOT NULL DEFAULT 0,
        family_notes TEXT NOT NULL DEFAULT '',
        lessons_learned TEXT NOT NULL DEFAULT '',
        next_week_focus TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`,
      `CREATE INDEX IF NOT EXISTS idx_work_sessions_date ON work_sessions(date)`,
      `CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_date)`,
      `CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date)`,
      `CREATE INDEX IF NOT EXISTS idx_study_sessions_date ON study_sessions(date)`,
    ],
  },
  {
    version: 2,
    name: '002_import_hash_recurring_budgets_reminders',
    statements: [
      `ALTER TABLE transactions ADD COLUMN external_hash TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_hash ON transactions(external_hash) WHERE external_hash IS NOT NULL`,
      `ALTER TABLE settings ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 1`,
      `CREATE TABLE IF NOT EXISTS recurring_rules (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        category_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        source_type TEXT NOT NULL DEFAULT 'outros',
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      )`,
      `CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        category_id TEXT NOT NULL,
        limit_amount REAL NOT NULL CHECK (limit_amount > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(month, category_id),
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month)`,
    ],
  },
];

const DEFAULT_CATEGORIES: Array<{
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
  color: string;
}> = [
  { id: 'cat_salario', name: 'Salário CLT', kind: 'income', color: '#10b981' },
  { id: 'cat_apps', name: 'Renda Aplicativos (Uber/99)', kind: 'income', color: '#6366f1' },
  { id: 'cat_servicos_ti', name: 'Serviços Técnicos / TI', kind: 'income', color: '#3b82f6' },
  { id: 'cat_outras_receitas', name: 'Outras Receitas', kind: 'income', color: '#14b8a6' },
  { id: 'cat_moradia', name: 'Moradia / Contas da Casa', kind: 'expense', color: '#ef4444' },
  { id: 'cat_alimentacao', name: 'Alimentação', kind: 'expense', color: '#f97316' },
  { id: 'cat_combustivel', name: 'Combustível', kind: 'expense', color: '#eab308' },
  { id: 'cat_moto', name: 'Moto (Manutenção / Parcela)', kind: 'expense', color: '#f59e0b' },
  { id: 'cat_familia', name: 'Filho / Família', kind: 'expense', color: '#ec4899' },
  { id: 'cat_saude', name: 'Saúde / Academia', kind: 'expense', color: '#22c55e' },
  { id: 'cat_estudos', name: 'Estudos / Carreira', kind: 'expense', color: '#0ea5e9' },
  { id: 'cat_transporte', name: 'Transporte / Deslocamento', kind: 'expense', color: '#64748b' },
  { id: 'cat_lazer', name: 'Lazer / Pessoal', kind: 'expense', color: '#a855f7' },
  { id: 'cat_outros', name: 'Outros', kind: 'both', color: '#94a3b8' },
];

const DEFAULT_HABITS: Array<{
  id: string;
  name: string;
  category: string;
  weekly_target: number;
  unit: string;
}> = [
  { id: 'hab_academia', name: 'Academia', category: 'academia', weekly_target: 3, unit: 'treino' },
  { id: 'hab_corrida', name: 'Corrida', category: 'corrida', weekly_target: 2, unit: 'corrida' },
  { id: 'hab_sono', name: 'Dormir no horário (22h)', category: 'sono', weekly_target: 5, unit: 'noite' },
  { id: 'hab_agua', name: 'Hidratação diária', category: 'agua', weekly_target: 7, unit: 'dia' },
];

const DEFAULT_STUDY_TRACKS: Array<{
  id: string;
  name: string;
  status: 'planned' | 'active';
  target_hours: number;
}> = [
  { id: 'trk_suporte', name: 'Suporte / Windows', status: 'active', target_hours: 30 },
  { id: 'trk_redes', name: 'Redes e Infraestrutura', status: 'active', target_hours: 40 },
  { id: 'trk_m365', name: 'Microsoft 365', status: 'planned', target_hours: 25 },
  { id: 'trk_linux', name: 'Linux', status: 'planned', target_hours: 35 },
  { id: 'trk_powershell', name: 'PowerShell', status: 'planned', target_hours: 20 },
  { id: 'trk_python', name: 'Python e Automação', status: 'planned', target_hours: 40 },
  { id: 'trk_seguranca', name: 'Segurança da Informação', status: 'planned', target_hours: 30 },
];

/**
 * Applies pending migrations and ensures clean structural defaults (NO fictional financial data).
 */
export async function runMigrations(db: SqlExecutor): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = await db.select<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  const applied = new Set(appliedRows.map((r) => r.version));

  const now = new Date().toISOString();

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    await db.transaction(async (tx) => {
      for (const stmt of migration.statements) {
        await tx.execute(stmt);
      }
      await tx.execute(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, now],
      );
    });
  }

  await ensureStructuralDefaults(db);
}

/**
 * Ensures singleton settings row, baseline account, categories, habits, and TI study tracks exist.
 * Never inserts invented transactions, work sessions, or fictional financial balances.
 */
export async function ensureStructuralDefaults(db: SqlExecutor): Promise<void> {
  const now = new Date().toISOString();

  const existingSettings = await db.select<{ id: number }>(
    'SELECT id FROM settings WHERE id = 1',
  );
  if (existingSettings.length === 0) {
    await db.execute(
      `INSERT INTO settings (
        id, user_name, currency, theme, routine_mode, work_days_per_week,
        monthly_net_goal, clt_reference_net, maintenance_per_km, depreciation_per_km,
        vehicle_monthly_payment, child_weekend_mode, child_weekend_anchor,
        commute_minutes, wake_time, sleep_time, study_weekly_goal_hours,
        onboarding_completed, demo_data_loaded, updated_at
      ) VALUES (1, '', 'BRL', 'dark', 'clt', 5, 3500, 2745, 0.18, 0.10, 0, 'alternating', NULL, 60, '05:15', '22:00', 6, 0, 0, ?)`,
      [now],
    );
  }

  const existingAccounts = await db.select<{ count: number }>(
    'SELECT COUNT(*) as count FROM accounts',
  );
  if ((existingAccounts[0]?.count ?? 0) === 0) {
    await db.execute(
      `INSERT INTO accounts (id, name, type, initial_balance, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ['acc_principal', 'Conta Principal', 'conta_corrente', 0, now, now],
    );
    await db.execute(
      `INSERT INTO accounts (id, name, type, initial_balance, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ['acc_carteira', 'Carteira / Dinheiro', 'carteira', 0, now, now],
    );
  }

  const existingCats = await db.select<{ count: number }>(
    'SELECT COUNT(*) as count FROM categories',
  );
  if ((existingCats[0]?.count ?? 0) === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      await db.execute(
        `INSERT OR IGNORE INTO categories (id, name, kind, color, is_default, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [cat.id, cat.name, cat.kind, cat.color, now],
      );
    }
  }

  const existingHabits = await db.select<{ count: number }>(
    'SELECT COUNT(*) as count FROM habits',
  );
  if ((existingHabits[0]?.count ?? 0) === 0) {
    for (const habit of DEFAULT_HABITS) {
      await db.execute(
        `INSERT OR IGNORE INTO habits (id, name, category, weekly_target, unit, active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [habit.id, habit.name, habit.category, habit.weekly_target, habit.unit, now],
      );
    }
  }

  const existingTracks = await db.select<{ count: number }>(
    'SELECT COUNT(*) as count FROM study_tracks',
  );
  if ((existingTracks[0]?.count ?? 0) === 0) {
    for (const track of DEFAULT_STUDY_TRACKS) {
      await db.execute(
        `INSERT OR IGNORE INTO study_tracks (id, name, status, target_hours, notes, created_at)
         VALUES (?, ?, ?, ?, '', ?)`,
        [track.id, track.name, track.status, track.target_hours, now],
      );
    }
  }
}
