import type {
  ComplianceItemDto,
  ContractorDto,
  IncomePaymentDto,
  InspectionDto,
  LedgerDto,
  LicenceDto,
  LicenceKind,
  MeterKind,
  MeterOccasion,
  MeterReadingDto,
  RecurringExpenseDto,
  RecurringFrequency,
  RightToRentDto,
  TenancyDto,
} from './client.ts';
import { addDays, addMonths, diffDays, type IsoDate } from './dates.ts';
import { formatPence } from './rent/ledger.ts';
import { csvCell, parseCsvLine } from './tools.ts';

/**
 * Rent statements, bank statement import, repeating costs, meter readings,
 * licences, and the calendar and phone alerts made from every date the
 * landlord needs to remember.
 */

// ------------------------------------------------------------ rent statement
export interface StatementLine {
  date: IsoDate;
  description: string;
  chargedPence: number;
  paidPence: number;
  /** Positive: owed by the tenant after this line. */
  balancePence: number;
}

/** Every charge and payment on a rent account up to a date, oldest first, with a running balance. */
export function statementLines(ledger: Pick<LedgerDto, 'charges' | 'payments'>, asOf: IsoDate): StatementLine[] {
  const entries = [
    ...ledger.charges
      .filter((c) => c.dueDate <= asOf)
      .map((c) => ({ date: c.dueDate, order: 0, description: `Rent due, ${c.periodStart} to ${c.periodEnd}${c.proRata ? ' (part period)' : ''}`, chargedPence: c.amountPence, paidPence: 0 })),
    ...ledger.payments
      .filter((p) => p.date <= asOf && p.status === 'confirmed')
      .map((p) => ({ date: p.date, order: 1, description: `Payment received (${p.method.replace(/_/g, ' ')})`, chargedPence: 0, paidPence: p.amountPence })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let balance = 0;
  return entries.map(({ order: _order, ...entry }) => {
    balance += entry.chargedPence - entry.paidPence;
    return { ...entry, balancePence: balance };
  });
}

const money = (pence: number) => (pence / 100).toFixed(2);

/** The full rent statement as text, ready to share or turn into a PDF. */
export function rentStatement(input: { landlordName: string; tenancy: Pick<TenancyDto, 'tenantNames' | 'propertyAddress' | 'startDate'>; ledger: LedgerDto; asOf: IsoDate }): string {
  const lines = statementLines(input.ledger, input.asOf);
  const balance = lines.at(-1)?.balancePence ?? 0;
  const charged = lines.reduce((sum, l) => sum + l.chargedPence, 0);
  const paid = lines.reduce((sum, l) => sum + l.paidPence, 0);
  return [
    'RENT STATEMENT',
    '',
    `Tenant: ${input.tenancy.tenantNames.join(' and ')}`,
    `Property: ${input.tenancy.propertyAddress}`,
    `Landlord: ${input.landlordName}`,
    `Period: ${input.tenancy.startDate} to ${input.asOf}`,
    '',
    `Total rent charged: ${formatPence(charged)}`,
    `Total received: ${formatPence(paid)}`,
    balance > 0 ? `Balance owed: ${formatPence(balance)}` : balance < 0 ? `In credit by: ${formatPence(-balance)}` : 'Balance: nothing owed',
    '',
    'TRANSACTIONS',
    'Date,Description,Charged,Paid,Balance',
    ...lines.map((l) => [l.date, l.description, l.chargedPence ? money(l.chargedPence) : '', l.paidPence ? money(l.paidPence) : '', money(l.balancePence)].map(csvCell).join(',')),
    '',
    'Amounts are in pounds. A balance above zero is rent owed; below zero is credit.',
  ].join('\n');
}

// --------------------------------------------------------------- bank import
export interface BankRow {
  date: IsoDate;
  description: string;
  amountPence: number;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Reads the date formats UK banks use: 05/11/2026, 05-11-26, 2026-11-05, 5 Nov 2026. */
export function parseBankDate(text: string): IsoDate | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  const worded = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{2}|\d{4})$/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (numeric) [day, month, year] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  else if (worded) [day, month, year] = [Number(worded[1]), MONTHS.indexOf(worded[2]!.toLowerCase()) + 1, Number(worded[3])];
  else return null;
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMoney(text: string | undefined): number | null {
  if (text === undefined) return null;
  const cleaned = text.replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (cleaned === '' || !/^[+-]?\d*\.?\d+$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Reads a bank statement saved as a CSV file. The columns are found from the
 * row of headings, so the layout of any UK bank's export should work. Only
 * money coming in is kept.
 */
export function parseBankCsv(text: string): { rows: BankRow[]; errors: string[]; ignored: number } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headerIndex = lines.slice(0, 15).findIndex((line) => {
    const cells = parseCsvLine(line).map((c) => c.toLowerCase());
    return cells.some((c) => c.includes('date')) && cells.some((c) => /amount|paid in|credit|money in|value/.test(c));
  });
  if (headerIndex < 0) return { rows: [], errors: ['No row of column headings was found. The file needs a date column and an amount or "paid in" column.'], ignored: 0 };

  const header = parseCsvLine(lines[headerIndex]!).map((c) => c.toLowerCase());
  const find = (pattern: RegExp) => header.findIndex((c) => pattern.test(c));
  const dateCol = find(/date/);
  const creditCol = find(/paid in|credit|money in|deposits?$/);
  const amountCol = find(/^amount|^value|amount$/);
  const textCols = header.map((c, i) => (/desc|narrative|details|reference|memo|name|payee|counter ?party|transaction(?! date| type)/.test(c) && i !== dateCol ? i : -1)).filter((i) => i >= 0);

  const rows: BankRow[] = [];
  const errors: string[] = [];
  let ignored = 0;
  lines.slice(headerIndex + 1).forEach((line, index) => {
    const cells = parseCsvLine(line);
    const date = parseBankDate(cells[dateCol] ?? '');
    if (!date) {
      errors.push(`Row ${headerIndex + index + 2}: the date "${cells[dateCol] ?? ''}" was not understood.`);
      return;
    }
    const credit = creditCol >= 0 ? parseMoney(cells[creditCol]) : null;
    const amount = credit ?? (amountCol >= 0 ? parseMoney(cells[amountCol]) : null);
    if (amount === null || amount <= 0) {
      ignored += 1;
      return;
    }
    const description = textCols.map((i) => cells[i] ?? '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    rows.push({ date, description, amountPence: amount });
  });
  return { rows, errors, ignored };
}

export interface BankMatch {
  row: BankRow;
  /** The tenancy this payment looks like it belongs to, if one stands out. */
  tenancyId: string | null;
  reason: 'name' | 'amount' | null;
  /** A payment of the same amount on the same date is already recorded for that tenancy. */
  alreadyRecorded: boolean;
}

/**
 * Suggests which tenancy each payment belongs to: first by a tenant's surname
 * appearing in the bank's description, then by the amount matching exactly one
 * tenancy's rent. Anything unclear is left for the landlord to choose.
 */
export function matchBankRows(
  rows: readonly BankRow[],
  tenancies: readonly Pick<TenancyDto, 'id' | 'tenantNames' | 'rentAmountPence'>[],
  recorded: readonly Pick<IncomePaymentDto, 'tenancyId' | 'date' | 'amountPence'>[],
): BankMatch[] {
  const surnames = tenancies.map((t) => ({
    id: t.id,
    names: t.tenantNames.map((name) => name.trim().split(/\s+/).at(-1)!.toUpperCase()).filter((name) => name.length >= 3),
  }));
  const isRecorded = (tenancyId: string, row: BankRow) => recorded.some((p) => p.tenancyId === tenancyId && p.date === row.date && p.amountPence === row.amountPence);

  return rows.map((row) => {
    const words = new Set(row.description.toUpperCase().split(/[^A-Z']+/));
    const byName = surnames.filter((t) => t.names.some((name) => words.has(name)));
    const byAmount = tenancies.filter((t) => t.rentAmountPence === row.amountPence);
    let tenancyId: string | null = null;
    let reason: BankMatch['reason'] = null;
    if (byName.length === 1) [tenancyId, reason] = [byName[0]!.id, 'name'];
    else if (byName.length === 0 && byAmount.length === 1) [tenancyId, reason] = [byAmount[0]!.id, 'amount'];
    else if (byName.length > 1) {
      // Several tenants share the surname: the rent amount may settle it.
      const both = byName.filter((t) => byAmount.some((a) => a.id === t.id));
      if (both.length === 1) [tenancyId, reason] = [both[0]!.id, 'name'];
    }
    return { row, tenancyId, reason, alreadyRecorded: tenancyId !== null && isRecorded(tenancyId, row) };
  });
}

// ---------------------------------------------------------- repeating costs
export const RECURRING_FREQUENCY_LABEL: Record<RecurringFrequency, string> = { monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
const RECURRING_MONTHS: Record<RecurringFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** The dates a repeating cost falls due after `postedThrough`, up to and including `through`. */
export function recurringDueDates(expense: Pick<RecurringExpenseDto, 'startDate' | 'endDate' | 'frequency' | 'postedThrough'>, through: IsoDate): IsoDate[] {
  const last = expense.endDate !== null && expense.endDate < through ? expense.endDate : through;
  const dates: IsoDate[] = [];
  // Always counted from the start date, so a cost on the 31st does not drift to the 28th.
  for (let n = 0; n < 1200; n += 1) {
    const date = addMonths(expense.startDate, n * RECURRING_MONTHS[expense.frequency]);
    if (date > last) break;
    if (expense.postedThrough === null || date > expense.postedThrough) dates.push(date);
  }
  return dates;
}

/** What a repeating cost adds up to over a year. */
export function recurringYearlyPence(expense: Pick<RecurringExpenseDto, 'amountPence' | 'frequency'>): number {
  return (expense.amountPence * 12) / RECURRING_MONTHS[expense.frequency];
}

// ------------------------------------------------------------ meter readings
export const METER_KINDS: readonly MeterKind[] = ['gas', 'electricity', 'water'];
export const METER_LABEL: Record<MeterKind, string> = { gas: 'Gas', electricity: 'Electricity', water: 'Water' };
export const METER_OCCASION_LABEL: Record<MeterOccasion, string> = { move_in: 'Move-in', move_out: 'Move-out', routine: 'Routine' };

/** The latest reading for each meter at a property, and how much was used since the one before. */
export function latestReadings(readings: readonly MeterReadingDto[], propertyId: string): { meter: MeterKind; latest: MeterReadingDto; usedSincePrevious: number | null }[] {
  return METER_KINDS.flatMap((meter) => {
    const own = readings.filter((r) => r.propertyId === propertyId && r.meter === meter).sort((a, b) => b.date.localeCompare(a.date));
    const [latest, previous] = own;
    if (!latest) return [];
    return [{ meter, latest, usedSincePrevious: previous && latest.reading >= previous.reading ? latest.reading - previous.reading : null }];
  });
}

/** Meter readings for one property as text, to send to a supplier or keep with the inventory. */
export function meterReport(propertyAddress: string, readings: readonly MeterReadingDto[]): string {
  const rows = [...readings].sort((a, b) => a.date.localeCompare(b.date) || a.meter.localeCompare(b.meter));
  return [
    'METER READINGS',
    '',
    `Property: ${propertyAddress}`,
    '',
    'Date,Meter,Reading,Occasion,Photo,Recorded by',
    ...rows.map((r) => [r.date, METER_LABEL[r.meter], r.reading, METER_OCCASION_LABEL[r.occasion], r.photoDocumentId ? 'Yes' : 'No', r.recordedBy === 'tenant' ? 'Tenant' : 'Landlord'].map(csvCell).join(',')),
  ].join('\n');
}

// ------------------------------------------------------------------ licences
export const LICENCE_KINDS: readonly LicenceKind[] = ['hmo_mandatory', 'hmo_additional', 'selective', 'landlord_registration', 'other'];
export const LICENCE_KIND_LABEL: Record<LicenceKind, string> = {
  hmo_mandatory: 'HMO licence (mandatory)',
  hmo_additional: 'HMO licence (additional)',
  selective: 'Selective licence',
  landlord_registration: 'Landlord registration',
  other: 'Other licence',
};

export type LicenceState = 'valid' | 'renew_soon' | 'expired';

/** Councils can take months to process a renewal, so the warning starts 90 days ahead. */
export function licenceState(licence: Pick<LicenceDto, 'expiresOn'>, today: IsoDate): LicenceState {
  const daysLeft = diffDays(today, licence.expiresOn);
  return daysLeft < 0 ? 'expired' : daysLeft <= 90 ? 'renew_soon' : 'valid';
}

// ------------------------------------------------- calendar and phone alerts
export interface CalendarEntry {
  /** Stable, so the same entry replaces itself when the calendar is exported again. */
  id: string;
  date: IsoDate;
  title: string;
  detail: string;
}

/** Every dated thing the landlord should not miss, from today onwards, soonest first. */
export function calendarEntries(
  input: {
    compliance: readonly ComplianceItemDto[];
    inspections: readonly InspectionDto[];
    licences: readonly LicenceDto[];
    rightToRent: readonly RightToRentDto[];
    contractors: readonly ContractorDto[];
  },
  today: IsoDate,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const item of input.compliance) {
    const due = item.expiresOn ?? item.dueDate;
    if (due && !item.upcoming) entries.push({ id: `compliance-${item.id}`, date: due, title: `${item.title} due`, detail: item.propertyAddress ?? 'Whole portfolio' });
  }
  for (const inspection of input.inspections) {
    if (inspection.status === 'planned') entries.push({ id: `inspection-${inspection.id}`, date: inspection.date, title: 'Property inspection', detail: inspection.propertyAddress });
  }
  for (const licence of input.licences) {
    entries.push({ id: `licence-${licence.id}`, date: licence.expiresOn, title: `${LICENCE_KIND_LABEL[licence.kind]} expires`, detail: `${licence.propertyAddress} (${licence.authority})` });
  }
  for (const check of input.rightToRent) {
    if (check.expiresOn) entries.push({ id: `right-to-rent-${check.id}`, date: check.expiresOn, title: `Right to Rent follow-up check, ${check.tenantName}`, detail: check.propertyAddress });
  }
  for (const contractor of input.contractors) {
    if (contractor.insuranceExpiry) entries.push({ id: `insurance-${contractor.id}`, date: contractor.insuranceExpiry, title: `${contractor.name}: insurance expires`, detail: contractor.trade });
  }
  return entries.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

const icsText = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/**
 * The entries as a calendar file (.ics) that Apple Calendar, Google Calendar
 * and Outlook can all add. Each is an all-day event with an alert a week before.
 */
export function calendarIcs(entries: readonly CalendarEntry[], stamp: string): string {
  const compact = (date: IsoDate) => date.replace(/-/g, '');
  const dtstamp = `${stamp.replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lettly//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const entry of entries) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${entry.id}@lettly`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(entry.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(entry.date, 1))}`,
      `SUMMARY:${icsText(entry.title)}`,
      `DESCRIPTION:${icsText(entry.detail)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(entry.title)}`,
      'TRIGGER:-P7D',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export interface PhoneAlert {
  /** Local date and time, e.g. 2026-12-01T09:00. */
  at: string;
  title: string;
  body: string;
}

export const ALERT_DAYS_BEFORE = [30, 7, 0] as const;
/** iPhones hold at most 64 waiting alerts for one app. */
export const MAX_PHONE_ALERTS = 60;

/**
 * The alerts to set on the phone: 30 days before, 7 days before and on the
 * day, at 9am, for each entry. Only those still to come, soonest first.
 */
export function phoneAlerts(entries: readonly CalendarEntry[], now: string): PhoneAlert[] {
  const alerts: PhoneAlert[] = [];
  for (const entry of entries) {
    for (const days of ALERT_DAYS_BEFORE) {
      const at = `${addDays(entry.date, -days)}T09:00`;
      if (at <= now.slice(0, 16)) continue;
      alerts.push({
        at,
        title: days === 0 ? `Today: ${entry.title}` : `In ${days} days: ${entry.title}`,
        body: `${entry.detail}. Due ${entry.date}.`,
      });
    }
  }
  return alerts.sort((a, b) => a.at.localeCompare(b.at)).slice(0, MAX_PHONE_ALERTS);
}
