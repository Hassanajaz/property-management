import { eq } from 'drizzle-orm';
import { isStaff } from '@lettly/core';
import type { AuthContext } from './auth.ts';
import type { Tx } from './db/client.ts';
import { properties, tenancies, tenancyTenants } from './db/schema.ts';

/**
 * What a signed-in person may see inside their organisation.
 * Staff see everything. A landlord sees their own properties. A tenant sees
 * only the tenancies they are on. `null` means "no restriction".
 */
export interface Visibility {
  propertyIds: string[] | null;
  tenancyIds: string[] | null;
}

export async function visibilityFor(tx: Tx, auth: AuthContext): Promise<Visibility> {
  if (isStaff(auth.role)) return { propertyIds: null, tenancyIds: null };

  if (auth.role === 'landlord') {
    if (!auth.landlordId) return { propertyIds: [], tenancyIds: [] };
    const owned = await tx.select({ id: properties.id }).from(properties).where(eq(properties.landlordId, auth.landlordId));
    const propertyIds = owned.map((p) => p.id);
    const all = await tx.select({ id: tenancies.id, propertyId: tenancies.propertyId }).from(tenancies);
    return { propertyIds, tenancyIds: all.filter((t) => propertyIds.includes(t.propertyId)).map((t) => t.id) };
  }

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
