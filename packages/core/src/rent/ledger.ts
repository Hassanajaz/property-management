import { diffDays, type IsoDate } from '../dates.ts';
import type { Payment, RentCharge } from '../types.ts';

export interface UnpaidCharge {
  dueDate: IsoDate;
  amountPence: number;
  outstandingPence: number;
}

export interface ArrearsSummary {
  chargedPence: number;
  paidPence: number;
  /** Positive: the tenant owes this much. Negative: the tenant is in credit. */
  balancePence: number;
  unpaid: UnpaidCharge[];
  oldestUnpaidDueDate?: IsoDate;
  daysInArrears: number;
}

/**
 * Position of a rent account on a given day. Payments are applied to the
 * oldest charges first, which is how arrears are normally stated to a tenant
 * or a tribunal.
 */
export function arrears(charges: readonly RentCharge[], payments: readonly Payment[], asOf: IsoDate): ArrearsSummary {
  const due = charges.filter((c) => c.dueDate <= asOf).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const paidPence = payments.filter((p) => p.date <= asOf).reduce((sum, p) => sum + p.amountPence, 0);
  const chargedPence = due.reduce((sum, c) => sum + c.amountPence, 0);

  let remaining = paidPence;
  const unpaid: UnpaidCharge[] = [];
  for (const charge of due) {
    const applied = Math.min(remaining, charge.amountPence);
    remaining -= applied;
    const outstandingPence = charge.amountPence - applied;
    if (outstandingPence > 0) unpaid.push({ dueDate: charge.dueDate, amountPence: charge.amountPence, outstandingPence });
  }

  const oldestUnpaidDueDate = unpaid[0]?.dueDate;
  return {
    chargedPence,
    paidPence,
    balancePence: chargedPence - paidPence,
    unpaid,
    oldestUnpaidDueDate,
    daysInArrears: oldestUnpaidDueDate ? diffDays(oldestUnpaidDueDate, asOf) : 0,
  };
}

export function formatPence(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100).toLocaleString('en-GB');
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, '0')}`;
}
