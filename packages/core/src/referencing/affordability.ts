import type { Nation } from '../types.ts';

export interface AffordabilityInput {
  monthlyRentPence: number;
  /** Combined gross annual income of the applicants being assessed. */
  annualIncomePence: number;
  /** Annual income required as a multiple of monthly rent. Agencies commonly use 30 (tenant) and 36 (guarantor). */
  multiplier?: number;
}

export interface AffordabilityResult {
  requiredAnnualIncomePence: number;
  passes: boolean;
  /** Share of gross monthly income taken by rent, 0 to 1 (or Infinity with no income). */
  rentToIncome: number;
}

export function affordability({ monthlyRentPence, annualIncomePence, multiplier = 30 }: AffordabilityInput): AffordabilityResult {
  const requiredAnnualIncomePence = monthlyRentPence * multiplier;
  return {
    requiredAnnualIncomePence,
    passes: annualIncomePence >= requiredAnnualIncomePence,
    rentToIncome: annualIncomePence > 0 ? (monthlyRentPence * 12) / annualIncomePence : Infinity,
  };
}

export interface OfferTerms {
  nation: Nation;
  advertisedRentPence: number;
  agreedRentPence: number;
  /** Months of rent requested before or at the start of the tenancy. */
  rentInAdvanceMonths: number;
}

/**
 * Warnings for offer terms that look inconsistent with the Renters' Rights Act
 * 2025 rules in England (in force from 1 May 2026). SEED LOGIC: confirm the
 * exact rules with a solicitor; this only flags the obvious cases for staff.
 */
export function offerWarnings(terms: OfferTerms): string[] {
  if (terms.nation !== 'england') return [];
  const warnings: string[] = [];
  if (terms.agreedRentPence > terms.advertisedRentPence) {
    warnings.push('Agreed rent is above the advertised rent. Inviting or accepting higher offers is not allowed in England.');
  }
  if (terms.rentInAdvanceMonths > 1) {
    warnings.push('More than one month of rent in advance has been requested. Rent in advance is restricted in England.');
  }
  return warnings;
}
