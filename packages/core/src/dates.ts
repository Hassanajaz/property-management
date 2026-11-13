/**
 * Calendar-date helpers. All dates are ISO strings (YYYY-MM-DD) with no time
 * or time zone, because tenancy and compliance dates are calendar dates.
 */
export type IsoDate = string;

const DAY_MS = 86_400_000;

function toUtc(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${date}`);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Adds months, clamping to the last day of a shorter month (31 Jan + 1 = 28/29 Feb). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const monthIndex = ((total % 12) + 12) % 12;
  const day = Math.min(d, daysInMonth(year, monthIndex));
  return fromUtc(Date.UTC(year, monthIndex, day));
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/**
 * Adds working days, skipping Saturdays and Sundays.
 * Bank holidays are NOT skipped yet: pass them in `holidays` when a calendar is available.
 */
export function addWorkingDays(date: IsoDate, days: number, holidays: ReadonlySet<IsoDate> = new Set()): IsoDate {
  let current = date;
  let remaining = days;
  while (remaining > 0) {
    current = addDays(current, 1);
    const weekday = new Date(toUtc(current)).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(current)) remaining -= 1;
  }
  return current;
}

export function today(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}
