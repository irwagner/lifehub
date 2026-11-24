import type { SqlExecutor } from '../db/types';
import { resolveSessionKm, summarizeWorkSessions, type WorkPeriodSummary } from '../services/calculations';
import { createVehicleSchema, createWorkSessionSchema } from '../services/validation';
import type {
  Settings,
  Vehicle,
  VehicleExpense,
  VehicleExpenseCategory,
  WorkPlatform,
  WorkSession,
} from '../types/domain';
import { addDaysISO, createId, round2, startOfWeekISO } from '../utils/format';

export async function listVehicles(db: SqlExecutor): Promise<Vehicle[]> {
  return db.select<Vehicle>('SELECT * FROM vehicles ORDER BY is_active DESC, created_at ASC');
}

export async function createVehicle(
  db: SqlExecutor,
  rawInput: {
    name: string;
    model_year?: string;
    status?: 'owned' | 'financed' | 'planned';
    estimated_value?: number;
    financing_amount?: number;
    monthly_payment?: number;
    total_installments?: number;
    maintenance_per_km?: number;
    depreciation_per_km?: number;
    is_active?: number;
    notes?: string;
  },
): Promise<Vehicle> {
  const input = createVehicleSchema.parse(rawInput);
  const now = new Date().toISOString();
  const id = createId('veh');

  await db.transaction(async (tx) => {
    if (input.is_active === 1) {
      await tx.execute('UPDATE vehicles SET is_active = 0');
    }
    await tx.execute(
      `INSERT INTO vehicles (
        id, name, model_year, status, estimated_value, financing_amount,
        monthly_payment, total_installments, maintenance_per_km, depreciation_per_km,
        is_active, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        input.model_year,
        input.status,
        round2(input.estimated_value),
        round2(input.financing_amount),
        round2(input.monthly_payment),
        input.total_installments,
        round2(input.maintenance_per_km),
        round2(input.depreciation_per_km),
        input.is_active,
        input.notes,
        now,
        now,
      ],
    );
  });

  const rows = await db.select<Vehicle>('SELECT * FROM vehicles WHERE id = ?', [id]);
  return rows[0];
}

export async function setActiveVehicle(db: SqlExecutor, vehicleId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE vehicles SET is_active = 0, updated_at = ?', [now]);
    await tx.execute('UPDATE vehicles SET is_active = 1, updated_at = ? WHERE id = ?', [
      now,
      vehicleId,
    ]);
  });
}

export async function deleteVehicle(db: SqlExecutor, vehicleId: string): Promise<void> {
  await db.execute('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
}

export async function listVehicleExpenses(
  db: SqlExecutor,
  vehicleId?: string,
): Promise<VehicleExpense[]> {
  if (vehicleId) {
    return db.select<VehicleExpense>(
      'SELECT * FROM vehicle_expenses WHERE vehicle_id = ? ORDER BY date DESC, created_at DESC',
      [vehicleId],
    );
  }
  return db.select<VehicleExpense>(
    'SELECT * FROM vehicle_expenses ORDER BY date DESC, created_at DESC',
  );
}

export async function createVehicleExpense(
  db: SqlExecutor,
  input: {
    vehicle_id: string;
    date: string;
    category: VehicleExpenseCategory;
    description: string;
    amount: number;
    odometer_km?: number | null;
    notes?: string;
  },
): Promise<VehicleExpense> {
  if (!input.description.trim()) throw new Error('Informe a descrição da despesa do veículo.');
  if (!(input.amount > 0)) throw new Error('Valor da despesa deve ser maior que zero.');
  const now = new Date().toISOString();
  const id = createId('vexp');
  await db.execute(
    `INSERT INTO vehicle_expenses (id, vehicle_id, date, category, description, amount, odometer_km, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.vehicle_id,
      input.date,
      input.category,
      input.description.trim(),
      round2(input.amount),
      input.odometer_km ?? null,
      input.notes ?? '',
      now,
    ],
  );
  const rows = await db.select<VehicleExpense>('SELECT * FROM vehicle_expenses WHERE id = ?', [id]);
  return rows[0];
}

export async function deleteVehicleExpense(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM vehicle_expenses WHERE id = ?', [id]);
}

export async function listWorkSessions(
  db: SqlExecutor,
  options?: { startDate?: string; endDate?: string; platform?: WorkPlatform },
): Promise<WorkSession[]> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (options?.startDate) {
    clauses.push('date >= ?');
    params.push(options.startDate);
  }
  if (options?.endDate) {
    clauses.push('date <= ?');
    params.push(options.endDate);
  }
  if (options?.platform) {
    clauses.push('platform = ?');
    params.push(options.platform);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.select<WorkSession>(
    `SELECT * FROM work_sessions ${where} ORDER BY date DESC, start_time DESC`,
    params,
  );
}

export async function createWorkSession(
  db: SqlExecutor,
  rawInput: {
    vehicle_id?: string | null;
    date: string;
    platform: WorkPlatform;
    start_time: string;
    end_time: string;
    gross_amount: number;
    km_start?: number | null;
    km_end?: number | null;
    km_total?: number | null;
    fuel_liters?: number;
    fuel_cost?: number;
    tolls_parking?: number;
    maintenance_per_km_snapshot?: number;
    depreciation_per_km_snapshot?: number;
    notes?: string;
  },
  settings: Settings,
): Promise<WorkSession> {
  const input = createWorkSessionSchema.parse(rawInput);
  const kmTotal = resolveSessionKm({
    km_start: input.km_start,
    km_end: input.km_end,
    km_total: input.km_total,
  });

  let maintPerKm = input.maintenance_per_km_snapshot ?? settings.maintenance_per_km;
  let deprecPerKm = input.depreciation_per_km_snapshot ?? settings.depreciation_per_km;

  if (input.vehicle_id) {
    const vRows = await db.select<Vehicle>('SELECT * FROM vehicles WHERE id = ?', [
      input.vehicle_id,
    ]);
    if (vRows.length > 0) {
      if (input.maintenance_per_km_snapshot == null) maintPerKm = vRows[0].maintenance_per_km;
      if (input.depreciation_per_km_snapshot == null) deprecPerKm = vRows[0].depreciation_per_km;
    }
  }

  const now = new Date().toISOString();
  const id = createId('ws');

  await db.execute(
    `INSERT INTO work_sessions (
      id, vehicle_id, date, platform, start_time, end_time,
      gross_amount, km_start, km_end, km_total,
      fuel_liters, fuel_cost, tolls_parking,
      maintenance_per_km_snapshot, depreciation_per_km_snapshot,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.vehicle_id ?? null,
      input.date,
      input.platform,
      input.start_time,
      input.end_time,
      round2(input.gross_amount),
      input.km_start ?? null,
      input.km_end ?? null,
      kmTotal,
      round2(input.fuel_liters),
      round2(input.fuel_cost),
      round2(input.tolls_parking),
      round2(maintPerKm),
      round2(deprecPerKm),
      input.notes,
      now,
      now,
    ],
  );

  const rows = await db.select<WorkSession>('SELECT * FROM work_sessions WHERE id = ?', [id]);
  return rows[0];
}

export async function deleteWorkSession(db: SqlExecutor, id: string): Promise<void> {
  await db.execute('DELETE FROM work_sessions WHERE id = ?', [id]);
}

export async function updateWorkSession(
  db: SqlExecutor,
  id: string,
  rawInput: {
    vehicle_id?: string | null;
    date: string;
    platform: WorkPlatform;
    start_time: string;
    end_time: string;
    gross_amount: number;
    km_start?: number | null;
    km_end?: number | null;
    km_total?: number | null;
    fuel_liters?: number;
    fuel_cost?: number;
    tolls_parking?: number;
    notes?: string;
  },
): Promise<WorkSession> {
  const input = createWorkSessionSchema.parse(rawInput);
  const kmTotal = resolveSessionKm({
    km_start: input.km_start,
    km_end: input.km_end,
    km_total: input.km_total,
  });
  const now = new Date().toISOString();

  await db.execute(
    `UPDATE work_sessions
     SET vehicle_id = ?, date = ?, platform = ?, start_time = ?, end_time = ?,
         gross_amount = ?, km_start = ?, km_end = ?, km_total = ?,
         fuel_liters = ?, fuel_cost = ?, tolls_parking = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.vehicle_id ?? null,
      input.date,
      input.platform,
      input.start_time,
      input.end_time,
      round2(input.gross_amount),
      input.km_start ?? null,
      input.km_end ?? null,
      kmTotal,
      round2(input.fuel_liters),
      round2(input.fuel_cost),
      round2(input.tolls_parking),
      input.notes,
      now,
      id,
    ],
  );

  const rows = await db.select<WorkSession>('SELECT * FROM work_sessions WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error('Jornada não encontrada.');
  return rows[0];
}

export async function getWorkDashboardStats(
  db: SqlExecutor,
  settings: Settings,
  referenceDateISO: string,
): Promise<{
  currentWeek: WorkPeriodSummary;
  last7Days: WorkPeriodSummary;
  last30Days: WorkPeriodSummary;
  activeVehiclePayment: number;
}> {
  const vehicles = await listVehicles(db);
  const activeVehicle = vehicles.find((v) => v.is_active === 1);
  const activeVehiclePayment = activeVehicle
    ? activeVehicle.monthly_payment
    : settings.vehicle_monthly_payment;

  const weekStart = startOfWeekISO(referenceDateISO);
  const weekEnd = addDaysISO(weekStart, 6);
  const d7Start = addDaysISO(referenceDateISO, -6);
  const d30Start = addDaysISO(referenceDateISO, -29);

  const [weekSessions, last7Sessions, last30Sessions] = await Promise.all([
    listWorkSessions(db, { startDate: weekStart, endDate: weekEnd }),
    listWorkSessions(db, { startDate: d7Start, endDate: referenceDateISO }),
    listWorkSessions(db, { startDate: d30Start, endDate: referenceDateISO }),
  ]);

  return {
    currentWeek: summarizeWorkSessions(weekSessions, {
      monthlyVehiclePayment: activeVehiclePayment,
      periodDays: 7,
      monthlyNetGoal: settings.monthly_net_goal,
      workDaysPerWeek: settings.work_days_per_week,
    }),
    last7Days: summarizeWorkSessions(last7Sessions, {
      monthlyVehiclePayment: activeVehiclePayment,
      periodDays: 7,
      monthlyNetGoal: settings.monthly_net_goal,
      workDaysPerWeek: settings.work_days_per_week,
    }),
    last30Days: summarizeWorkSessions(last30Sessions, {
      monthlyVehiclePayment: activeVehiclePayment,
      periodDays: 30,
      monthlyNetGoal: settings.monthly_net_goal,
      workDaysPerWeek: settings.work_days_per_week,
    }),
    activeVehiclePayment,
  };
}
