import type { AdvertDto, ComplianceItemDto, Condition, ExpenseDto, InventoryDto, InventoryItemDto, MileageDto, PossessionStage, PropertyDto, RightToRentDto, TenancyDto } from './client.ts';
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

export function csvCell(value: string | number): string {
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

// --------------------------------------------------------------- inventories
export const CONDITIONS: readonly Condition[] = ['new', 'good', 'fair', 'poor', 'damaged'];
export const CONDITION_LABEL: Record<Condition, string> = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor', damaged: 'Damaged' };

/** Items whose condition at check-out is worse than at check-in. */
export function inventoryChanges(items: readonly InventoryItemDto[]): InventoryItemDto[] {
  return items.filter((item) => item.checkOut !== null && CONDITIONS.indexOf(item.checkOut) > CONDITIONS.indexOf(item.checkIn));
}

/**
 * Check-in and check-out report as plain text, ending with the items that got
 * worse. Useful as the starting point for a deposit discussion or dispute;
 * fair wear and tear is not the tenant's responsibility.
 */
export function inventoryReport(inventory: InventoryDto): string {
  const rooms = [...new Set(inventory.items.map((i) => i.room))];
  const lines: string[] = [`INVENTORY: ${inventory.propertyAddress}`, `Tenants: ${inventory.tenantNames.join(' and ')}`, ''];
  for (const room of rooms) {
    lines.push(room.toUpperCase());
    for (const item of inventory.items.filter((i) => i.room === room)) {
      const out = item.checkOut ? `, check-out: ${CONDITION_LABEL[item.checkOut]}${item.checkOutNote ? ` (${item.checkOutNote})` : ''}` : '';
      lines.push(`- ${item.item}. Check-in: ${CONDITION_LABEL[item.checkIn]}${item.checkInNote ? ` (${item.checkInNote})` : ''}${out}`);
    }
    lines.push('');
  }
  const worse = inventoryChanges(inventory.items);
  lines.push(`ITEMS IN WORSE CONDITION AT CHECK-OUT: ${worse.length}`);
  for (const item of worse) {
    lines.push(`- ${item.room}: ${item.item}. ${CONDITION_LABEL[item.checkIn]} to ${CONDITION_LABEL[item.checkOut!]}${item.checkOutNote ? ` (${item.checkOutNote})` : ''}`);
  }
  if (worse.length > 0) lines.push('', 'Allow for fair wear and tear before proposing any deduction from the deposit.');
  return lines.join('\n');
}

// ------------------------------------------------------------- right to rent
export type RightToRentState = 'valid' | 'follow_up_due' | 'expired';

/**
 * A check on someone with time-limited permission needs a follow-up check
 * before that permission runs out. This flags it from 28 days before.
 */
export function rightToRentState(check: Pick<RightToRentDto, 'expiresOn'>, today: IsoDate): RightToRentState {
  if (!check.expiresOn) return 'valid';
  const daysLeft = diffDays(today, check.expiresOn);
  if (daysLeft < 0) return 'expired';
  return daysLeft <= 28 ? 'follow_up_due' : 'valid';
}

// --------------------------------------------------------- spreadsheet import
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t') {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const NATION_NAMES: Record<string, Nation> = { england: 'england', wales: 'wales', scotland: 'scotland', 'northern ireland': 'northern_ireland', northern_ireland: 'northern_ireland', ni: 'northern_ireland' };
const yes = (text: string | undefined, fallback: boolean) => (text === undefined || text === '' ? fallback : /^(y|yes|true|1)$/i.test(text));

/**
 * Reads properties from rows copied out of a spreadsheet (comma or tab
 * separated). Columns, in order: address, town, postcode, nation, gas (yes/no),
 * HMO (yes/no). A first row of headings is skipped. Rows with problems are
 * reported and left out.
 */
export function parsePropertiesCsv(text: string): { rows: Omit<PropertyDto, 'id'>[]; errors: string[] } {
  const rows: Omit<PropertyDto, 'id'>[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  lines.forEach((line, index) => {
    const [address, town, postcode, nationText, gas, hmo] = parseCsvLine(line);
    if (index === 0 && /^address/i.test(address ?? '')) return;
    const nation = NATION_NAMES[(nationText ?? '').toLowerCase()];
    const problems: string[] = [];
    if (!address) problems.push('no address');
    if (!town) problems.push('no town');
    if (!postcode || postcode.length < 5 || postcode.length > 8) problems.push('postcode missing or not valid');
    if (!nation) problems.push('nation must be England, Wales, Scotland or Northern Ireland');
    if (problems.length > 0 || !address || !town || !postcode || !nation) {
      errors.push(`Row ${index + 1}: ${problems.join('; ')}`);
      return;
    }
    rows.push({ addressLine1: address, addressLine2: null, town, postcode: postcode.toUpperCase(), nation, hasGas: yes(gas, true), isHmo: yes(hmo, false) });
  });
  return { rows, errors };
}

// ------------------------------------------------------------------ adverts
/** Advert wording to paste into a listing site or share directly. */
export function advertText(property: PropertyDto, advert: AdvertDto): string {
  return [
    advert.headline,
    '',
    `${property.town} ${property.postcode.split(' ')[0] ?? ''}`.trim(),
    `Rent: ${formatPence(advert.rentPence)} a month`,
    `Available from: ${advert.availableFrom}`,
    '',
    advert.description,
    '',
    'The rent shown is the rent: offers above it cannot be invited or accepted.',
  ].join('\n');
}

// ---------------------------------------------------------------- possession
export const POSSESSION_STAGES: readonly PossessionStage[] = [
  'notice_served', 'notice_expired', 'claim_issued', 'hearing_listed', 'order_made', 'enforcement_requested', 'possession_recovered',
];

export const POSSESSION_STAGE_LABEL: Record<PossessionStage, string> = {
  notice_served: 'Notice served',
  notice_expired: 'Notice period ended',
  claim_issued: 'Court or tribunal claim issued',
  hearing_listed: 'Hearing listed',
  order_made: 'Possession order made',
  enforcement_requested: 'Enforcement requested',
  possession_recovered: 'Possession recovered',
  withdrawn: 'Withdrawn or settled',
};

/** A case can move forward to any later stage, or be withdrawn; it cannot move backwards. */
export function canAdvancePossession(from: PossessionStage, to: PossessionStage): boolean {
  if (from === 'possession_recovered' || from === 'withdrawn') return false;
  if (to === 'withdrawn') return true;
  return POSSESSION_STAGES.indexOf(to) > POSSESSION_STAGES.indexOf(from);
}

// ------------------------------------------------------------------ templates
/** Placeholders a landlord can use in their own document templates. */
export const TEMPLATE_FIELDS = ['landlord_name', 'tenant_names', 'property_address', 'rent', 'rent_frequency', 'deposit', 'deposit_scheme', 'arrears', 'start_date', 'today'] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

export function templateValues(tenancy: TenancyDto, landlordName: string, today: IsoDate): Record<TemplateField, string> {
  return {
    landlord_name: landlordName,
    tenant_names: tenancy.tenantNames.join(' and '),
    property_address: tenancy.propertyAddress,
    rent: formatPence(tenancy.rentAmountPence),
    rent_frequency: tenancy.rentFrequency.replace('_', ' '),
    deposit: formatPence(tenancy.depositPence),
    deposit_scheme: tenancy.depositScheme ?? '[name of deposit scheme]',
    arrears: formatPence(Math.max(0, tenancy.balancePence)),
    start_date: tenancy.startDate,
    today,
  };
}

/**
 * Fills {{placeholders}} in a template. Returns the text and any placeholders
 * it did not recognise, which are left in place so they are easy to spot.
 */
export function fillTemplate(body: string, values: Record<string, string>): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (Object.hasOwn(values, key)) return values[key]!;
    unknown.add(key);
    return whole;
  });
  return { text, unknown: [...unknown] };
}

// ---------------------------------------------------------------------- packs
/** A property's compliance position as text, to send to a lender, insurer or council. */
export function compliancePack(property: PropertyDto, items: readonly ComplianceItemDto[], today: IsoDate): string {
  const lines = [`COMPLIANCE SUMMARY: ${property.addressLine1}, ${property.town} ${property.postcode}`, `As at ${today}`, ''];
  for (const item of items.filter((i) => i.propertyId === property.id && !i.upcoming)) {
    const due = item.expiresOn ?? item.dueDate;
    lines.push(`- ${item.title}: ${item.status.replace('_', ' ').toUpperCase()}${item.completedOn ? `, last done ${item.completedOn}` : ''}${due ? `, due ${due}` : ''}`);
  }
  return lines.join('\n');
}

/** The tax year's figures and every expense and trip behind them, for an accountant. */
export function accountantPack(summary: FinanceSummary, expenses: readonly ExpenseDto[], mileage: readonly MileageDto[]): string {
  const within = (date: IsoDate) => date >= summary.taxYear.start && date <= summary.taxYear.end;
  const lines = [
    `RENTAL INCOME AND EXPENSES, TAX YEAR ${summary.taxYear.label} (${summary.taxYear.start} to ${summary.taxYear.end})`,
    '',
    `Rent received: ${formatPence(summary.incomePence)}`,
    `Allowable expenses: ${formatPence(summary.allowableExpensesPence)}`,
    `Mileage: ${summary.miles} miles, ${formatPence(summary.mileagePence)}`,
    `Profit before finance costs: ${formatPence(summary.profitPence)}`,
    `Residential finance costs: ${formatPence(summary.financeCostsPence)}`,
    '',
    'EXPENSES',
    'Date,Category,Description,Property,Amount',
    ...expenses.filter((e) => within(e.date)).map((e) => [e.date, EXPENSE_CATEGORY_LABEL[e.category], e.description, e.propertyAddress ?? 'Whole portfolio', (e.amountPence / 100).toFixed(2)].map(csvCell).join(',')),
    '',
    'MILEAGE',
    'Date,Purpose,Miles',
    ...mileage.filter((m) => within(m.date)).map((m) => [m.date, m.purpose, m.miles].map(csvCell).join(',')),
  ];
  return lines.join('\n');
}

// ----------------------------------------------------------------------- PDF
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const isHeading = (line: string) => line.length > 3 && /[A-Z]/.test(line) && line === line.toUpperCase() && !/^[\d\W]+$/.test(line) && !line.includes(',');
const isCsvHeader = (line: string) => /^[A-Z][A-Za-z ]*(,[A-Z][A-Za-z ]*)+$/.test(line);

/**
 * Turns a plain-text report or letter into a simple printable page: lines in
 * capitals become headings, lines starting with "- " become a list, and a
 * block of comma-separated rows under a row of column names becomes a table.
 * The PDF versions of every report are made from this.
 */
export function textToHtml(title: string, text: string): string {
  const out: string[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trimEnd();
    if (line.trim() === '') {
      i += 1;
    } else if (isCsvHeader(line)) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() !== '') {
        rows.push(parseCsvLine(lines[i]!));
        i += 1;
      }
      const [head, ...body] = rows;
      out.push(
        `<table><thead><tr>${head!.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) {
        items.push(`<li>${escapeHtml(lines[i]!.slice(2))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
    } else if (isHeading(line)) {
      out.push(`<h2>${escapeHtml(line)}</h2>`);
      i += 1;
    } else {
      // Consecutive lines stay together as one block, each on its own line (addresses, label and value pairs).
      const block: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.startsWith('- ') && !isHeading(lines[i]!.trimEnd()) && !isCsvHeader(lines[i]!.trimEnd())) {
        block.push(escapeHtml(lines[i]!.trimEnd()));
        i += 1;
      }
      out.push(`<p>${block.join('<br>')}</p>`);
    }
  }
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: A4; margin: 20mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #16212e; }
h2 { font-size: 12pt; margin: 18pt 0 6pt; letter-spacing: 0.02em; }
h2:first-child { font-size: 15pt; margin-top: 0; }
p { margin: 0 0 9pt; }
ul { margin: 0 0 9pt; padding-left: 16pt; }
li { margin-bottom: 3pt; }
table { border-collapse: collapse; width: 100%; margin: 0 0 12pt; font-size: 9.5pt; }
th, td { border: 0.5pt solid #b9c2cc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #eef1f4; }
</style></head><body>${out.join('\n')}</body></html>`;
}
