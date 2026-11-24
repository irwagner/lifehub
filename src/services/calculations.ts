import type { WorkDaysPerWeek, WorkSession } from '../types/domain';
import { addMonthsISO, round2, todayISO } from '../utils/format';

export function parseTimeToMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Horário inválido: ${timeStr}`);
  }
  return h * 60 + m;
}

export function calculateSessionDurationHours(startTime: string, endTime: string): number {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  let diff = endMin - startMin;
  if (diff <= 0) {
    // Handles overnight shift crossing midnight
    diff += 24 * 60;
  }
  return round2(diff / 60);
}

export function resolveSessionKm(input: {
  km_start?: number | null;
  km_end?: number | null;
  km_total?: number | null;
}): number {
  const hasStart = typeof input.km_start === 'number' && Number.isFinite(input.km_start);
  const hasEnd = typeof input.km_end === 'number' && Number.isFinite(input.km_end);

  if (hasStart && hasEnd) {
    if ((input.km_end as number) < (input.km_start as number)) {
      throw new Error('Quilometragem final não pode ser menor que a inicial.');
    }
    return round2((input.km_end as number) - (input.km_start as number));
  }

  if (typeof input.km_total === 'number' && Number.isFinite(input.km_total) && input.km_total >= 0) {
    return round2(input.km_total);
  }

  throw new Error('Informe quilometragem inicial/final ou a quilometragem total válida.');
}

export interface WorkSessionMetrics {
  durationHours: number;
  km: number;
  gross: number;
  fuelCost: number;
  tollsParking: number;
  estimatedMaintenance: number;
  estimatedDepreciation: number;
  operationalCosts: number;
  operationalNet: number;
  netAfterDepreciation: number;
  grossPerHour: number;
  operationalNetPerHour: number;
  grossPerKm: number;
  operationalNetPerKm: number;
}

export function calculateWorkSessionMetrics(session: WorkSession): WorkSessionMetrics {
  const durationHours = calculateSessionDurationHours(session.start_time, session.end_time);
  const km = round2(session.km_total);
  const gross = round2(session.gross_amount);
  const fuelCost = round2(session.fuel_cost);
  const tollsParking = round2(session.tolls_parking);
  const estimatedMaintenance = round2(km * session.maintenance_per_km_snapshot);
  const estimatedDepreciation = round2(km * session.depreciation_per_km_snapshot);

  const operationalCosts = round2(fuelCost + tollsParking + estimatedMaintenance);
  const operationalNet = round2(gross - operationalCosts);
  const netAfterDepreciation = round2(operationalNet - estimatedDepreciation);

  return {
    durationHours,
    km,
    gross,
    fuelCost,
    tollsParking,
    estimatedMaintenance,
    estimatedDepreciation,
    operationalCosts,
    operationalNet,
    netAfterDepreciation,
    grossPerHour: durationHours > 0 ? round2(gross / durationHours) : 0,
    operationalNetPerHour: durationHours > 0 ? round2(operationalNet / durationHours) : 0,
    grossPerKm: km > 0 ? round2(gross / km) : 0,
    operationalNetPerKm: km > 0 ? round2(operationalNet / km) : 0,
  };
}

export interface WorkPeriodSummary {
  sessionsCount: number;
  totalHours: number;
  totalKm: number;
  totalGross: number;
  totalFuelCost: number;
  totalFuelLiters: number;
  totalTollsParking: number;
  totalMaintenance: number;
  totalDepreciation: number;
  totalOperationalCosts: number;
  totalOperationalNet: number;
  totalNetAfterDepreciation: number;
  proportionalVehiclePayment: number;
  totalNetAfterVehicle: number;
  grossPerHour: number;
  operationalNetPerHour: number;
  grossPerKm: number;
  operationalNetPerKm: number;
  weeklyNetGoal: number;
  dailyNetGoal: number;
  weeklyGoalProgressPct: number;
}

const WEEKS_PER_MONTH = 4.3333;

export function calculateWeeklyAndDailyGoals(
  monthlyNetGoal: number,
  monthlyVehiclePayment: number,
  workDaysPerWeek: WorkDaysPerWeek,
): {
  weeklyNetGoal: number;
  weeklyOperationalTarget: number;
  dailyOperationalTarget: number;
} {
  const weeklyNetGoal = round2(monthlyNetGoal / WEEKS_PER_MONTH);
  const weeklyVehicleShare = round2(monthlyVehiclePayment / WEEKS_PER_MONTH);
  const weeklyOperationalTarget = round2(weeklyNetGoal + weeklyVehicleShare);
  const dailyOperationalTarget = round2(weeklyOperationalTarget / workDaysPerWeek);

  return {
    weeklyNetGoal,
    weeklyOperationalTarget,
    dailyOperationalTarget,
  };
}

export function summarizeWorkSessions(
  sessions: WorkSession[],
  options: {
    monthlyVehiclePayment: number;
    periodDays: number;
    monthlyNetGoal: number;
    workDaysPerWeek: WorkDaysPerWeek;
  },
): WorkPeriodSummary {
  let totalHours = 0;
  let totalKm = 0;
  let totalGross = 0;
  let totalFuelCost = 0;
  let totalFuelLiters = 0;
  let totalTollsParking = 0;
  let totalMaintenance = 0;
  let totalDepreciation = 0;

  for (const s of sessions) {
    const m = calculateWorkSessionMetrics(s);
    totalHours += m.durationHours;
    totalKm += m.km;
    totalGross += m.gross;
    totalFuelCost += m.fuelCost;
    totalFuelLiters += s.fuel_liters;
    totalTollsParking += m.tollsParking;
    totalMaintenance += m.estimatedMaintenance;
    totalDepreciation += m.estimatedDepreciation;
  }

  totalHours = round2(totalHours);
  totalKm = round2(totalKm);
  totalGross = round2(totalGross);
  totalFuelCost = round2(totalFuelCost);
  totalFuelLiters = round2(totalFuelLiters);
  totalTollsParking = round2(totalTollsParking);
  totalMaintenance = round2(totalMaintenance);
  totalDepreciation = round2(totalDepreciation);

  const totalOperationalCosts = round2(totalFuelCost + totalTollsParking + totalMaintenance);
  const totalOperationalNet = round2(totalGross - totalOperationalCosts);
  const totalNetAfterDepreciation = round2(totalOperationalNet - totalDepreciation);

  const proportionalVehiclePayment = round2(
    (options.monthlyVehiclePayment / 30) * options.periodDays,
  );
  const totalNetAfterVehicle = round2(totalOperationalNet - proportionalVehiclePayment);

  const goals = calculateWeeklyAndDailyGoals(
    options.monthlyNetGoal,
    options.monthlyVehiclePayment,
    options.workDaysPerWeek,
  );

  const weeklyGoalProgressPct =
    goals.weeklyNetGoal > 0
      ? round2(Math.min(200, Math.max(0, (totalNetAfterVehicle / goals.weeklyNetGoal) * 100)))
      : 0;

  return {
    sessionsCount: sessions.length,
    totalHours,
    totalKm,
    totalGross,
    totalFuelCost,
    totalFuelLiters,
    totalTollsParking,
    totalMaintenance,
    totalDepreciation,
    totalOperationalCosts,
    totalOperationalNet,
    totalNetAfterDepreciation,
    proportionalVehiclePayment,
    totalNetAfterVehicle,
    grossPerHour: totalHours > 0 ? round2(totalGross / totalHours) : 0,
    operationalNetPerHour: totalHours > 0 ? round2(totalOperationalNet / totalHours) : 0,
    grossPerKm: totalKm > 0 ? round2(totalGross / totalKm) : 0,
    operationalNetPerKm: totalKm > 0 ? round2(totalOperationalNet / totalKm) : 0,
    weeklyNetGoal: goals.weeklyNetGoal,
    dailyNetGoal: goals.dailyOperationalTarget,
    weeklyGoalProgressPct,
  };
}

export interface InstallmentEntry {
  installment_number: number;
  installment_total: number;
  date: string;
  due_date: string;
  amount: number;
  description: string;
}

/**
 * Generates exact monthly installments with cent-accurate reconciliation on the final installment.
 */
export function generateInstallmentPlan(params: {
  totalAmount: number;
  installmentsCount: number;
  firstDateISO: string;
  description: string;
}): InstallmentEntry[] {
  const { totalAmount, installmentsCount, firstDateISO, description } = params;
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('Valor total do parcelamento deve ser maior que zero.');
  }
  if (!Number.isInteger(installmentsCount) || installmentsCount < 1 || installmentsCount > 120) {
    throw new Error('Número de parcelas deve estar entre 1 e 120.');
  }

  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / installmentsCount);
  const remainderCents = totalCents - baseCents * installmentsCount;

  const entries: InstallmentEntry[] = [];
  for (let i = 0; i < installmentsCount; i++) {
    const isLast = i === installmentsCount - 1;
    const cents = isLast ? baseCents + remainderCents : baseCents;
    const date = addMonthsISO(firstDateISO, i);
    entries.push({
      installment_number: i + 1,
      installment_total: installmentsCount,
      date,
      due_date: date,
      amount: round2(cents / 100),
      description:
        installmentsCount > 1
          ? `${description} (${i + 1}/${installmentsCount})`
          : description,
    });
  }

  return entries;
}

/**
 * Counts working days in a given month (1-12) for 4, 5, or 6 workdays/week,
 * excluding any explicitly blocked dates (e.g., child weekends or holidays).
 */
export function calculateWorkingDaysInMonth(
  year: number,
  month1Based: number,
  workDaysPerWeek: WorkDaysPerWeek,
  excludedDates: string[] = [],
): number {
  const excludedSet = new Set(excludedDates);
  const daysInMonth = new Date(year, month1Based, 0).getDate();
  let count = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(year, month1Based - 1, day, 12, 0, 0, 0);
    const dow = dt.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const iso = todayISO(dt);
    if (excludedSet.has(iso)) continue;

    if (workDaysPerWeek === 4 && dow >= 1 && dow <= 4) {
      count++;
    } else if (workDaysPerWeek === 5 && dow >= 1 && dow <= 5) {
      count++;
    } else if (workDaysPerWeek === 6 && dow >= 1 && dow <= 6) {
      count++;
    }
  }

  return count;
}

export interface ScenarioInput {
  workDaysPerWeek: WorkDaysPerWeek;
  hoursPerDay: number;
  grossPerHour: number;
  kmPerHour: number;
  fuelCostPerKm: number;
  maintenancePerKm: number;
  depreciationPerKm: number;
  vehicleMonthlyPayment: number;
  monthlyNetGoal: number;
}

export interface ScenarioResult {
  workDaysPerMonth: number;
  monthlyHours: number;
  monthlyKm: number;
  monthlyGross: number;
  monthlyFuel: number;
  monthlyMaintenance: number;
  monthlyDepreciation: number;
  monthlyOperationalNet: number;
  monthlyNetAfterVehicle: number;
  monthlyNetAfterVehicleAndDepreciation: number;
  goalGap: number;
  meetsGoal: boolean;
}

export function simulateWorkScenario(input: ScenarioInput): ScenarioResult {
  const workDaysPerMonth = round2(input.workDaysPerWeek * WEEKS_PER_MONTH);
  const monthlyHours = round2(workDaysPerMonth * input.hoursPerDay);
  const monthlyKm = round2(monthlyHours * input.kmPerHour);
  const monthlyGross = round2(monthlyHours * input.grossPerHour);
  const monthlyFuel = round2(monthlyKm * input.fuelCostPerKm);
  const monthlyMaintenance = round2(monthlyKm * input.maintenancePerKm);
  const monthlyDepreciation = round2(monthlyKm * input.depreciationPerKm);

  const monthlyOperationalNet = round2(monthlyGross - monthlyFuel - monthlyMaintenance);
  const monthlyNetAfterVehicle = round2(monthlyOperationalNet - input.vehicleMonthlyPayment);
  const monthlyNetAfterVehicleAndDepreciation = round2(
    monthlyNetAfterVehicle - monthlyDepreciation,
  );
  const goalGap = round2(monthlyNetAfterVehicle - input.monthlyNetGoal);

  return {
    workDaysPerMonth,
    monthlyHours,
    monthlyKm,
    monthlyGross,
    monthlyFuel,
    monthlyMaintenance,
    monthlyDepreciation,
    monthlyOperationalNet,
    monthlyNetAfterVehicle,
    monthlyNetAfterVehicleAndDepreciation,
    goalGap,
    meetsGoal: monthlyNetAfterVehicle >= input.monthlyNetGoal,
  };
}
