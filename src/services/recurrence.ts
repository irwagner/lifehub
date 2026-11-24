import type { ChildWeekendMode } from '../types/domain';
import { addDaysISO, formatDateBR, parseISODate, todayISO } from '../utils/format';

/**
 * Given any date (YYYY-MM-DD), returns the Saturday (YYYY-MM-DD) of its weekend.
 * Sunday maps to the preceding Saturday; Mon-Fri maps to the upcoming Saturday.
 */
export function normalizeToSaturday(isoDate: string): string {
  const dt = parseISODate(isoDate);
  const dow = dt.getDay(); // 0=Sun, 6=Sat
  if (dow === 6) return todayISO(dt);
  if (dow === 0) return addDaysISO(isoDate, -1);
  return addDaysISO(isoDate, 6 - dow);
}

/**
 * Returns whether a date falls on a weekend reserved for the child.
 * Crucial principle: for 'alternating' mode without a user-chosen anchorDate,
 * returns false instead of assuming an arbitrary start date.
 */
export function isChildWeekend(
  isoDate: string,
  mode: ChildWeekendMode,
  anchorDate: string | null,
): boolean {
  const dt = parseISODate(isoDate);
  const dow = dt.getDay();
  const isWeekendDay = dow === 6 || dow === 0;
  if (!isWeekendDay) return false;

  if (mode === 'all') return true;
  if (mode === 'custom') return false;

  // mode === 'alternating'
  if (!anchorDate) return false;

  const targetSat = parseISODate(normalizeToSaturday(isoDate));
  const anchorSat = parseISODate(normalizeToSaturday(anchorDate));
  const diffMs = targetSat.getTime() - anchorSat.getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));

  return Math.abs(diffWeeks) % 2 === 0;
}

export interface ChildWeekendWindow {
  saturday: string;
  sunday: string;
  label: string;
}

/**
 * Lists the next `count` reserved child weekends starting on or after `fromDateISO`.
 */
export function generateUpcomingChildWeekends(
  fromDateISO: string,
  count: number,
  mode: ChildWeekendMode,
  anchorDate: string | null,
): ChildWeekendWindow[] {
  if (mode === 'custom') return [];
  if (mode === 'alternating' && !anchorDate) return [];
  if (count <= 0) return [];

  const results: ChildWeekendWindow[] = [];
  let cursorSat = normalizeToSaturday(fromDateISO);

  // If fromDateISO is Sunday, normalizeToSaturday gives yesterday (Saturday), which is still the current weekend
  let safety = 0;
  while (results.length < count && safety < 200) {
    safety++;
    if (isChildWeekend(cursorSat, mode, anchorDate)) {
      const sunday = addDaysISO(cursorSat, 1);
      results.push({
        saturday: cursorSat,
        sunday,
        label: `${formatDateBR(cursorSat)} e ${formatDateBR(sunday)}`,
      });
    }
    cursorSat = addDaysISO(cursorSat, 7);
  }

  return results;
}
