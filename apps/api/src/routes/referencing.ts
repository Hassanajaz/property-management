import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { affordability } from '@lettly/core';
import { canSeeProperty, formatAddress, visibilityFor } from '../access.ts';
import type { AppEnv } from '../auth.ts';
import { withOrg } from '../db/client.ts';
import { properties, referencingApplications, referencingChecks } from '../db/schema.ts';

export const referencing = new Hono<AppEnv>();

/**
 * Applicants and the progress of their checks, for the landlord only.
 * Creating applications and recording checks is the next piece of referencing work.
 */
referencing.get('/referencing/applications', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'tenant') throw new HTTPException(403, { message: 'Not available for tenant accounts' });

  const rows = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    const applications = (await tx.select().from(referencingApplications)).filter((a) => canSeeProperty(v, a.propertyId));
    const checks = await tx.select().from(referencingChecks);
    const props = await tx.select().from(properties);
    return applications.map((a) => {
      const property = props.find((p) => p.id === a.propertyId);
      return {
        id: a.id,
        propertyId: a.propertyId,
        propertyAddress: property ? formatAddress(property) : '',
        applicantName: a.applicantName,
        status: a.status,
        monthlyRentPence: a.monthlyRentPence,
        annualIncomePence: a.annualIncomePence,
        affordable:
          a.annualIncomePence === null ? null : affordability({ monthlyRentPence: a.monthlyRentPence, annualIncomePence: a.annualIncomePence }).passes,
        checks: checks.filter((ch) => ch.applicationId === a.id).map((ch) => ({ kind: ch.kind, status: ch.status })),
        decisionReason: a.decisionReason,
        createdAt: a.createdAt.toISOString(),
      };
    });
  });
  return c.json(rows);
});
