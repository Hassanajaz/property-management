import { eq } from 'drizzle-orm';
import { isLandlord } from '@lettly/core';
import type { AuthContext } from './auth.ts';
import type { Tx } from './db/client.ts';
import { tenancies, tenancyTenants } from './db/schema.ts';

/**
 * What a signed-in person may see inside the account. The landlord sees
 * everything. A tenant sees only the tenancies they are on. `null` means
 * "no restriction".
 */
export interface Visibility {
  propertyIds: string[] | null;
  tenancyIds: string[] | null;
}

export async function visibilityFor(tx: Tx, auth: AuthContext): Promise<Visibility> {
  if (isLandlord(auth.role)) return { propertyIds: null, tenancyIds: null };

  // Tenant
  const mine = await tx
    .select({ tenancyId: tenancyTenants.tenancyId, propertyId: tenancies.propertyId })
    .from(tenancyTenants)
    .innerJoin(tenancies, eq(tenancies.id, tenancyTenants.tenancyId))
    .where(eq(tenancyTenants.userId, auth.userId));
  return {
    propertyIds: [...new Set(mine.map((m) => m.propertyId))],
    tenancyIds: mine.map((m) => m.tenancyId),
  };
}

export function canSeeProperty(v: Visibility, propertyId: string | null): boolean {
  return v.propertyIds === null || (propertyId !== null && v.propertyIds.includes(propertyId));
}

export function canSeeTenancy(v: Visibility, tenancyId: string | null): boolean {
  return v.tenancyIds === null || (tenancyId !== null && v.tenancyIds.includes(tenancyId));
}

export function formatAddress(p: { addressLine1: string; town: string; postcode: string }): string {
  return `${p.addressLine1}, ${p.town} ${p.postcode}`;
}
