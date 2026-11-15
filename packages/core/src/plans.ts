/**
 * Subscription tiers by number of properties. PLACEHOLDER PRICES AND LIMITS:
 * set your own before launch. Stripe price IDs are attached in the API config.
 */
export interface Plan {
  id: string;
  name: string;
  /** Inclusive upper limit; null means unlimited. */
  maxProperties: number | null;
  storageGb: number;
  monthlyPricePence: number;
}

export const PLANS: readonly Plan[] = [
  { id: 'free', name: 'Free', maxProperties: 1, storageGb: 1, monthlyPricePence: 0 },
  { id: 'solo', name: 'Solo', maxProperties: 3, storageGb: 5, monthlyPricePence: 1200 },
  { id: 'portfolio', name: 'Portfolio', maxProperties: 20, storageGb: 30, monthlyPricePence: 2500 },
  { id: 'unlimited', name: 'Unlimited', maxProperties: null, storageGb: 100, monthlyPricePence: 4900 },
];

export function planById(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export function canAddProperty(plan: Plan, currentProperties: number): boolean {
  return plan.maxProperties === null || currentProperties < plan.maxProperties;
}

/** The cheapest plan that fits a portfolio of this size. */
export function smallestPlanFor(properties: number): Plan | undefined {
  return [...PLANS].sort((a, b) => a.monthlyPricePence - b.monthlyPricePence).find((p) => p.maxProperties === null || properties <= p.maxProperties);
}
