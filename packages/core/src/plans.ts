/**
 * Subscription tiers by number of properties. PLACEHOLDER PRICES AND LIMITS:
 * set your own before launch. Stripe price IDs are attached in the API config.
 */
export type AccountKind = 'agency' | 'landlord';

export interface Plan {
  id: string;
  kind: AccountKind;
  name: string;
  /** Inclusive upper limit; null means unlimited. */
  maxProperties: number | null;
  storageGb: number;
  monthlyPricePence: number;
}

export const PLANS: readonly Plan[] = [
  { id: 'landlord_free', kind: 'landlord', name: 'Free', maxProperties: 1, storageGb: 1, monthlyPricePence: 0 },
  { id: 'landlord_solo', kind: 'landlord', name: 'Solo', maxProperties: 3, storageGb: 5, monthlyPricePence: 1200 },
  { id: 'landlord_portfolio', kind: 'landlord', name: 'Portfolio', maxProperties: 20, storageGb: 30, monthlyPricePence: 2500 },
  { id: 'agency_starter', kind: 'agency', name: 'Agency Starter', maxProperties: 20, storageGb: 50, monthlyPricePence: 3500 },
  { id: 'agency_growth', kind: 'agency', name: 'Agency Growth', maxProperties: 50, storageGb: 100, monthlyPricePence: 6900 },
  { id: 'agency_plus', kind: 'agency', name: 'Agency Plus', maxProperties: 100, storageGb: 150, monthlyPricePence: 8900 },
  { id: 'agency_unlimited', kind: 'agency', name: 'Agency', maxProperties: null, storageGb: 250, monthlyPricePence: 11900 },
];

export function planById(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export function canAddProperty(plan: Plan, currentProperties: number): boolean {
  return plan.maxProperties === null || currentProperties < plan.maxProperties;
}

/** The cheapest plan of the same kind that fits a portfolio of this size. */
export function smallestPlanFor(kind: AccountKind, properties: number): Plan | undefined {
  return PLANS.filter((p) => p.kind === kind)
    .sort((a, b) => a.monthlyPricePence - b.monthlyPricePence)
    .find((p) => p.maxProperties === null || properties <= p.maxProperties);
}
