export function formatBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(safe);
}

export function formatNumber(value: number, decimals = 1): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
}

export function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const datePart = isoDate.slice(0, 10);
  const parts = datePart.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatTimeBR(isoOrTime: string | null | undefined): string {
  if (!isoOrTime) return '—';
  if (isoOrTime.includes('T')) {
    return isoOrTime.slice(11, 16);
  }
  return isoOrTime.slice(0, 5);
}

export function todayISO(referenceDate = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const d = String(referenceDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentMonthISO(referenceDate = new Date()): string {
  return todayISO(referenceDate).slice(0, 7);
}

export function nowISO(referenceDate = new Date()): string {
  const date = todayISO(referenceDate);
  const hh = String(referenceDate.getHours()).padStart(2, '0');
  const mm = String(referenceDate.getMinutes()).padStart(2, '0');
  const ss = String(referenceDate.getSeconds()).padStart(2, '0');
  return `${date}T${hh}:${mm}:${ss}`;
}

export function parseISODate(isoDate: string): Date {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function addDaysISO(isoDate: string, days: number): string {
  const dt = parseISODate(isoDate);
  dt.setDate(dt.getDate() + days);
  return todayISO(dt);
}

export function addMonthsISO(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const targetMonth = (m - 1) + months;
  const targetYear = y + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  const dt = new Date(targetYear, normalizedMonth, clampedDay, 12, 0, 0, 0);
  return todayISO(dt);
}

/**
 * Returns Monday (YYYY-MM-DD) of the ISO week containing the given date.
 */
export function startOfWeekISO(isoDate: string): string {
  const dt = parseISODate(isoDate);
  const day = dt.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diffToMonday);
  return todayISO(dt);
}

export function endOfWeekISO(isoDate: string): string {
  return addDaysISO(startOfWeekISO(isoDate), 6);
}

export function greetingForHour(hour = new Date().getHours()): string {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
