import type { SqlExecutor } from '../db/types';
import {
  generateUpcomingChildWeekends,
  type ChildWeekendWindow,
} from '../services/recurrence';
import type {
  CalendarEvent,
  JobApplication,
  Settings,
  TaskItem,
  Transaction,
} from '../types/domain';
import { currentMonthISO, round2, todayISO } from '../utils/format';
import { getWeeklyStudyHours, listJobApplications } from './careerRepo';
import { listCalendarEvents, listTasks } from './calendarRepo';
import {
  getMonthlyFinanceSummary,
  listAccounts,
  listUpcomingBills,
  type AccountWithBalance,
  type MonthlyFinanceSummary,
} from './financeRepo';
import { listHabitsWithProgress, type HabitWithWeeklyProgress } from './habitsRepo';
import { getSettings } from './settingsRepo';
import { getWorkDashboardStats } from './workRepo';
import type { WorkPeriodSummary } from '../services/calculations';

export interface DashboardSnapshot {
  today: string;
  month: string;
  settings: Settings;
  accounts: AccountWithBalance[];
  totalBalance: number;
  monthlyFinance: MonthlyFinanceSummary;
  upcomingBills: Transaction[];
  workWeek: WorkPeriodSummary;
  workLast30Days: WorkPeriodSummary;
  todayEvents: CalendarEvent[];
  priorityTasks: TaskItem[];
  habits: HabitWithWeeklyProgress[];
  upcomingChildWeekends: ChildWeekendWindow[];
  weeklyStudyHours: number;
  activeApplications: JobApplication[];
  upcomingInterviews: JobApplication[];
}

export async function loadDashboardSnapshot(
  db: SqlExecutor,
  referenceDateISO = todayISO(),
): Promise<DashboardSnapshot> {
  const month = referenceDateISO.slice(0, 7) || currentMonthISO();
  const settings = await getSettings(db);

  const [
    accounts,
    monthlyFinance,
    upcomingBills,
    workStats,
    todayEvents,
    todoTasks,
    habits,
    weeklyStudyHours,
    allApplications,
  ] = await Promise.all([
    listAccounts(db),
    getMonthlyFinanceSummary(db, month),
    listUpcomingBills(db, referenceDateISO, 5),
    getWorkDashboardStats(db, settings, referenceDateISO),
    listCalendarEvents(db, {
      startISO: `${referenceDateISO}T00:00:00`,
      endISO: `${referenceDateISO}T23:59:59`,
    }),
    listTasks(db, 'todo'),
    listHabitsWithProgress(db, referenceDateISO),
    getWeeklyStudyHours(db, referenceDateISO),
    listJobApplications(db),
  ]);

  const totalBalance = round2(accounts.reduce((acc, a) => acc + a.current_balance, 0));
  const upcomingChildWeekends = generateUpcomingChildWeekends(
    referenceDateISO,
    3,
    settings.child_weekend_mode,
    settings.child_weekend_anchor,
  );

  const activeApplications = allApplications.filter(
    (j) => j.status !== 'rejected' && j.status !== 'offer',
  );
  const upcomingInterviews = allApplications.filter(
    (j) => j.status === 'interview' || j.status === 'technical',
  );

  return {
    today: referenceDateISO,
    month,
    settings,
    accounts,
    totalBalance,
    monthlyFinance,
    upcomingBills,
    workWeek: workStats.currentWeek,
    workLast30Days: workStats.last30Days,
    todayEvents,
    priorityTasks: todoTasks.slice(0, 6),
    habits,
    upcomingChildWeekends,
    weeklyStudyHours,
    activeApplications,
    upcomingInterviews,
  };
}
