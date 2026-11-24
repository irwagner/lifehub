import type { CalendarEvent, TaskItem, Transaction } from '../types/domain';
import { addDaysISO, formatDateBR, formatTimeBR } from '../utils/format';

export interface DiscreteReminder {
  id: string;
  kind: 'bill_due' | 'event_today' | 'task_due';
  severity: 'info' | 'warning';
  title: string;
  /**
   * Privacy-safe notification body: NEVER includes currency amounts or sensitive financial figures.
   */
  discreteMessage: string;
  dateISO: string;
}

/**
 * Computes local reminders for upcoming bills (next 3 days), today's events, and due tasks.
 * Strictly obeys Blueprint 6.2: never exposes financial values (R$) in notification messages.
 */
export function buildDiscreteReminders(params: {
  todayISO: string;
  upcomingBills: Transaction[];
  todayEvents: CalendarEvent[];
  pendingTasks: TaskItem[];
}): DiscreteReminder[] {
  const { todayISO, upcomingBills, todayEvents, pendingTasks } = params;
  const horizon3d = addDaysISO(todayISO, 3);
  const reminders: DiscreteReminder[] = [];

  // 1. Bills due within 3 days — NO monetary values in discreteMessage
  const dueSoonBills = upcomingBills.filter((b) => {
    const due = b.due_date ?? b.date;
    return due >= todayISO && due <= horizon3d;
  });

  for (const bill of dueSoonBills) {
    const due = bill.due_date ?? bill.date;
    const isToday = due === todayISO;
    reminders.push({
      id: `rem_bill_${bill.id}`,
      kind: 'bill_due',
      severity: isToday ? 'warning' : 'info',
      title: isToday ? 'Conta com vencimento hoje' : 'Vencimento próximo',
      discreteMessage: isToday
        ? `Verifique "${bill.description}" no módulo Financeiro (vence hoje, ${formatDateBR(due)}).`
        : `Lembrete: "${bill.description}" vence em ${formatDateBR(due)}. Abra o Financeiro para conferir.`,
      dateISO: due,
    });
  }

  // 2. Today's calendar events
  for (const ev of todayEvents.slice(0, 5)) {
    reminders.push({
      id: `rem_evt_${ev.id}`,
      kind: 'event_today',
      severity: 'info',
      title: `Agenda hoje · ${formatTimeBR(ev.start_at)}`,
      discreteMessage: `${ev.title} (${formatTimeBR(ev.start_at)}–${formatTimeBR(ev.end_at)}).`,
      dateISO: todayISO,
    });
  }

  // 3. Tasks due today or overdue
  for (const task of pendingTasks) {
    if (!task.due_date || task.due_date > todayISO) continue;
    const overdue = task.due_date < todayISO;
    reminders.push({
      id: `rem_tsk_${task.id}`,
      kind: 'task_due',
      severity: overdue ? 'warning' : 'info',
      title: overdue ? 'Tarefa em atraso' : 'Tarefa vence hoje',
      discreteMessage: `${task.title} (prazo: ${formatDateBR(task.due_date)}).`,
      dateISO: task.due_date,
    });
  }

  return reminders;
}

export async function dispatchLocalNotification(reminder: DiscreteReminder): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  new Notification(`LifeHub — ${reminder.title}`, {
    body: reminder.discreteMessage,
    silent: false,
  });
  return true;
}
