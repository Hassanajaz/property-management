import { addDays, addMonths, diffDays, type IsoDate } from '../dates.ts';
import type { RentCharge, RentFrequency, RentTerms } from '../types.ts';

/** Start of period `index` (0-based), always computed from the tenancy start so month-end dates do not drift. */
function periodStart(start: IsoDate, frequency: RentFrequency, index: number): IsoDate {
  switch (frequency) {
    case 'weekly':
      return addDays(start, 7 * index);
    case 'fortnightly':
      return addDays(start, 14 * index);
    case 'four_weekly':
      return addDays(start, 28 * index);
    case 'monthly':
      return addMonths(start, index);
    case 'quarterly':
      return addMonths(start, 3 * index);
  }
}

/**
 * Rent charges due on or before `until`. Rent is charged in advance on the
 * first day of each period. If the tenancy ends part-way through a period, the
 * final charge is reduced in proportion to the days occupied.
 */
export function generateSchedule(terms: RentTerms, until: IsoDate): RentCharge[] {
  if (!Number.isInteger(terms.amountPence) || terms.amountPence < 0) {
    throw new Error('amountPence must be a non-negative whole number of pence');
  }
  if (terms.endDate && terms.endDate < terms.startDate) {
    throw new Error('endDate is before startDate');
  }

  const charges: RentCharge[] = [];
  for (let index = 0; ; index += 1) {
    const start = periodStart(terms.startDate, terms.frequency, index);
    if (start > until) break;
    if (terms.endDate && start > terms.endDate) break;

    const fullEnd = addDays(periodStart(terms.startDate, terms.frequency, index + 1), -1);
    const cutShort = terms.endDate !== undefined && terms.endDate < fullEnd;
    const end = cutShort ? terms.endDate! : fullEnd;

    const fullDays = diffDays(start, fullEnd) + 1;
    const days = diffDays(start, end) + 1;
    const amountPence = cutShort ? Math.round((terms.amountPence * days) / fullDays) : terms.amountPence;

    charges.push({ dueDate: start, periodStart: start, periodEnd: end, amountPence, proRata: cutShort });
  }
  return charges;
}

/** Rent expressed per calendar month, for affordability checks and comparisons. */
export function monthlyEquivalentPence(amountPence: number, frequency: RentFrequency): number {
  const perYear = { weekly: 52, fortnightly: 26, four_weekly: 13, monthly: 12, quarterly: 4 }[frequency];
  return Math.round((amountPence * perYear) / 12);
}
