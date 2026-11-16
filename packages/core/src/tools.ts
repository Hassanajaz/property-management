import type { ComplianceItemDto, PropertyDto, TenancyDto } from './client.ts';
import { addDays, addMonths, diffDays, type IsoDate } from './dates.ts';
import { formatPence, type ArrearsSummary } from './rent/ledger.ts';
import { monthlyEquivalentPence } from './rent/schedule.ts';
import type { Nation, Payment, RentCharge } from './types.ts';

/**
 * Landlord tools: finance and tax-year figures, mileage, portfolio insight,
 * rent reviews, inspections, reminders, receipts and exports.
 *
 * The tax and legal figures here are SEED VALUES written from general
 * knowledge. They are a working aid, not tax or legal advice: have an
 * accountant and a lettings solicitor confirm them before relying on them.
 */

// ------------------------------------------------------------------- finance
export type ExpenseCategory =
  | 'repairs'
  | 'insurance'
  | 'letting_fees'
  | 'utilities'
  | 'legal_professional'
  | 'services'
  | 'travel'
  | 'mortgage_interest'
  | 'other';

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  repairs: 'Repairs and maintenance',
  insurance: 'Insurance',
  letting_fees: 'Letting and management fees',
  utilities: 'Rates, council tax and utilities',
  legal_professional: 'Legal and professional fees',
  services: 'Services such as cleaning and gardening',
  travel: 'Travel',
  mortgage_interest: 'Mortgage interest and finance costs',
  other: 'Other allowable expenses',
};

export interface Expense {
  date: IsoDate;
  category: ExpenseCategory;
  amountPence: number;
}

export interface MileageTrip {
  date: IsoDate;
  miles: number;
}

export interface TaxYear {
  /** e.g. "2026-27" */
  label: string;
  start: IsoDate;
  end: IsoDate;
}

/** The UK tax year (6 April to 5 April) that contains a date. */
export function taxYearOf(date: IsoDate): TaxYear {
  const year = Number(date.slice(0, 4));
  const startYear = date >= `${year}-04-06` ? year : year - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  };
}

/** Simplified mileage allowance: 45p a mile for the first 10,000 business miles in the tax year, then 25p. */
export function mileageAllowancePence(miles: number): number {
  const first = Math.min(miles, 10_000);
  return Math.round(first * 45 + Math.max(0, miles - 10_000) * 25);
}

export interface FinanceSummary {
  taxYear: TaxYear;
  incomePence: number;
  expensesByCategory: Partial<Record<ExpenseCategory, number>>;
  /** Expenses deducted from income. Excludes finance costs, which get basic-rate relief instead. */
  allowableExpensesPence: number;
  miles: number;
  mileagePence: number;
  /** Rental income less allowable expenses and mileage. */
  profitPence: number;
  /** Residential mortgage interest and other finance costs (the "Section 24" restriction). */
  financeCostsPence: number;
  /** Basic-rate tax reduction on finance costs: 20%. */
  financeCostTaxReductionPence: number;
}

/** Income, expenses and profit for one tax year, in the shape the property pages of a tax return ask for. */
export function financeSummary(
  input: { payments: readonly Payment[]; expenses: readonly Expense[]; mileage: readonly MileageTrip[] },
  taxYear: TaxYear,
): FinanceSummary {
  const within = (date: IsoDate) => date >= taxYear.start && date <= taxYear.end;
  const incomePence = input.payments.filter((p) => within(p.date)).reduce((sum, p) => sum + p.amountPence, 0);

  const expensesByCategory: Partial<Record<ExpenseCategory, number>> = {};
  for (const expense of input.expenses.filter((e) => within(e.date))) {
    expensesByCategory[expense.category] = (expensesByCategory[expense.category] ?? 0) + expense.amountPence;
  }
  const financeCostsPence = expensesByCategory.mortgage_interest ?? 0;
  const allowableExpensesPence = Object.entries(expensesByCategory)
    .filter(([category]) => category !== 'mortgage_interest')
    .reduce((sum, [, amount]) => sum + (amount ?? 0), 0);

  const miles = input.mileage.filter((m) => within(m.date)).reduce((sum, m) => sum + m.miles, 0);
  const mileagePence = mileageAllowancePence(miles);

  return {
    taxYear,
    incomePence,
    expensesByCategory,
    allowableExpensesPence,
    miles,
    mileagePence,
    profitPence: incomePence - allowableExpensesPence - mileagePence,
    financeCostsPence,
    financeCostTaxReductionPence: Math.round(financeCostsPence * 0.2),
  };
}

// ----------------------------------------------------------------- insight
export interface PropertyMoney {
  equityPence: number | null;
  /** Loan to value as a fraction (0.75 = 75%). */
  loanToValue: number | null;
  /** Yearly rent as a fraction of the property's value. */
  grossYield: number | null;
}

export function propertyMoney(valuePence: number | null, mortgagePence: number | null, yearlyRentPence: number): PropertyMoney {
  if (!valuePence || valuePence <= 0) return { equityPence: null, loanToValue: null, grossYield: null };
  const mortgage = mortgagePence ?? 0;
  return { equityPence: valuePence - mortgage, loanToValue: mortgage / valuePence, grossYield: yearlyRentPence / valuePence };
}

export function yearlyRentPence(tenancy: Pick<TenancyDto, 'rentAmountPence' | 'rentFrequency'>): number {
  return monthlyEquivalentPence(tenancy.rentAmountPence, tenancy.rentFrequency) * 12;
}

/** Share of properties with a current tenancy, 0 to 1. */
export function occupancy(properties: readonly PropertyDto[], tenancies: readonly TenancyDto[]): number {
  if (properties.length === 0) return 0;
  const letIds = new Set(tenancies.filter((t) => t.status === 'active').map((t) => t.propertyId));
  return properties.filter((p) => letIds.has(p.id)).length / properties.length;
}

/**
 * Payment-rate score from 0 to 100: the share of rent charges that were fully
 * covered within `graceDays` of falling due. Payments clear the oldest charge first.
 */
export function paymentRate(charges: readonly RentCharge[], payments: readonly Payment[], asOf: IsoDate, graceDays = 3): number {
  const due = charges.filter((c) => addDays(c.dueDate, graceDays) <= asOf).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (due.length === 0) return 100;
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  let index = 0;
  let available = 0;
  let onTime = 0;
  for (const charge of due) {
    const deadline = addDays(charge.dueDate, graceDays);
    // Bring in every payment made by this charge's deadline.
    while (index < sorted.length && sorted[index]!.date <= deadline) {
      available += sorted[index]!.amountPence;
      index += 1;
    }
    if (available >= charge.amountPence) onTime += 1;
    // A shortfall carries forward as a debt that later payments must clear first.
    available -= charge.amountPence;
  }
  return Math.round((onTime / due.length) * 100);
}

// -------------------------------------------------------------- rent reviews
/** Minimum notice, in months, for a rent increase. SEED VALUES: confirm for each nation. */
const RENT_INCREASE_NOTICE_MONTHS: Record<Nation, number> = { england: 2, wales: 2, scotland: 3, northern_ireland: 3 };

export const RENT_INCREASE_ROUTE: Record<Nation, string> = {
  england: 'Section 13 notice (Form 4A)',
  wales: 'Notice of rent variation on the prescribed Welsh form',
  scotland: 'Rent-increase notice on the prescribed Scottish form',
  northern_ireland: 'Written notice of rent increase',
};

export interface RentReview {
  /** Earliest date a new rent can take effect: 12 months after the rent last changed. */
  earliestEffectiveDate: IsoDate;
  /** Latest date to serve notice for the increase to take effect on that earliest date. */
  serveNoticeBy: IsoDate;
  noticeMonths: number;
  /** True once the notice window has opened. */
  canServeNow: boolean;
  route: string;
}

/** When rent on a tenancy can next be increased: no more than once every 12 months, with the nation's notice period. */
export function rentReview(nation: Nation, rentLastChangedOn: IsoDate, today: IsoDate): RentReview {
  const noticeMonths = RENT_INCREASE_NOTICE_MONTHS[nation];
  const earliestEffectiveDate = addMonths(rentLastChangedOn, 12);
  const serveNoticeBy = addMonths(earliestEffectiveDate, -noticeMonths);
  return { earliestEffectiveDate, serveNoticeBy, noticeMonths, canServeNow: today >= serveNoticeBy, route: RENT_INCREASE_ROUTE[nation] };
}

// --------------------------------------------------------------- inspections
/** Landlords must give at least 24 hours' written notice before visiting. */
export type InspectionNotice = 'ok' | 'give_notice_now' | 'too_late';

export function inspectionNotice(inspectionDate: IsoDate, noticeGivenOn: IsoDate | null, today: IsoDate): InspectionNotice {
  if (noticeGivenOn && diffDays(noticeGivenOn, inspectionDate) >= 1) return 'ok';
  const daysAway = diffDays(today, inspectionDate);
  if (daysAway < 1) return 'too_late';
  return 'give_notice_now';
}

// ----------------------------------------------------------------- reminders
export const REMINDER_DAYS = [60, 30, 7] as const;

export interface Reminder {
  itemId: string;
  title: string;
  propertyAddress: string | null;
  due: IsoDate;
  daysLeft: number;
  /** Which reminder has most recently fallen due: 60, 30 or 7 days before, or 0 once overdue. */
  stage: 60 | 30 | 7 | 0;
  /** Date of the next reminder still to come, if any. */
  nextReminderOn: IsoDate | null;
}

/** The reminder ladder: every requirement due within 60 days (or overdue), soonest first. */
export function reminders(items: readonly ComplianceItemDto[], today: IsoDate): Reminder[] {
  const list: Reminder[] = [];
  for (const item of items) {
    const due = item.expiresOn ?? item.dueDate;
    if (!due || item.upcoming || item.status === 'valid') continue;
    const daysLeft = diffDays(today, due);
    if (daysLeft > 60) continue;
    const stage = daysLeft < 0 ? 0 : daysLeft <= 7 ? 7 : daysLeft <= 30 ? 30 : 60;
    const next = REMINDER_DAYS.find((days) => days < daysLeft);
    list.push({
      itemId: item.id,
      title: item.title,
      propertyAddress: item.propertyAddress,
      due,
      daysLeft,
      stage,
      nextReminderOn: next === undefined ? null : addDays(due, -next),
    });
  }
  return list.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ----------------------------------------------------------------- messages
/** Wording for a rent receipt, to share with the tenant. */
export function receiptText(input: { landlordName: string; tenantNames: string[]; propertyAddress: string; date: IsoDate; amountPence: number; method: string }): string {
  return [
    'RENT RECEIPT',
    '',
    `Received from: ${input.tenantNames.join(' and ')}`,
    `Property: ${input.propertyAddress}`,
    `Amount: ${formatPence(input.amountPence)}`,
    `Date received: ${input.date}`,
    `Method: ${input.method.replace('_', ' ')}`,
    '',
    `Issued by ${input.landlordName}`,
  ].join('\n');
}

/** A polite arrears reminder for the landlord to read, edit and send themselves. */
export function arrearsMessage(input: { tenantNames: string[]; propertyAddress: string; summary: ArrearsSummary; landlordName: string }): string {
  const first = input.tenantNames.map((name) => name.split(' ')[0]).join(' and ');
  return [
    `Dear ${first},`,
    '',
    `Our records show that ${formatPence(input.summary.balancePence)} of rent for ${input.propertyAddress} is outstanding. The oldest unpaid amount fell due on ${input.summary.oldestUnpaidDueDate ?? 'an earlier date'}.`,
    '',
    'Please pay the outstanding amount as soon as you can. If you have already paid, thank you, and please let me know the date so I can check my records.',
    '',
    'If you are having difficulty paying, please get in touch so we can talk about it.',
    '',
    'Kind regards,',
    input.landlordName,
  ].join('\n');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The properties table as CSV text, one row per property. */
export function propertiesCsv(properties: readonly PropertyDto[], tenancies: readonly TenancyDto[], compliance: readonly ComplianceItemDto[]): string {
  const header = ['Address', 'Town', 'Postcode', 'Nation', 'Status', 'Tenants', 'Rent', 'Frequency', 'Rent balance', 'Compliance items outstanding'];
  const rows = properties.map((property) => {
    const tenancy = tenancies.find((t) => t.propertyId === property.id && t.status === 'active');
    const outstanding = compliance.filter((i) => i.propertyId === property.id && !i.upcoming && i.severity === 'statutory' && i.status !== 'valid').length;
    return [
      property.addressLine1,
      property.town,
      property.postcode,
      property.nation.replace('_', ' '),
      tenancy ? 'Let' : 'Vacant',
      tenancy ? tenancy.tenantNames.join(' and ') : '',
      tenancy ? (tenancy.rentAmountPence / 100).toFixed(2) : '',
      tenancy ? tenancy.rentFrequency.replace('_', ' ') : '',
      tenancy ? (tenancy.balancePence / 100).toFixed(2) : '',
      outstanding,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
