import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { COMPLIANCE_RULES, complianceScore, nextDue, statusOf, today, type RequirementState } from '@lettly/core';
import { canSeeProperty, formatAddress, visibilityFor } from '../access.ts';
import { requireStaff, type AppEnv } from '../auth.ts';
import { withOrg } from '../db/client.ts';
import { complianceItems, properties } from '../db/schema.ts';
import { audit } from './portfolio.ts';

export const compliance = new Hono<AppEnv>();

const rulesById = new Map(COMPLIANCE_RULES.map((rule) => [rule.id, rule]));

type ItemRow = typeof complianceItems.$inferSelect;

function present(item: ItemRow, address: string | null, onDate: string) {
  const rule = rulesById.get(item.ruleId);
  if (!rule) return null; // rule retired from the rule set
  const state: RequirementState = {
    rule,
    completedOn: item.completedOn ?? undefined,
    expiresOn: item.expiresOn ?? undefined,
    dueDate: item.dueDate ?? undefined,
  };
  return {
    state,
    dto: {
      id: item.id,
      ruleId: item.ruleId,
      title: rule.title,
      severity: rule.severity,
      upcoming: rule.status === 'upcoming',
      status: statusOf(state, onDate),
      propertyId: item.propertyId,
      tenancyId: item.tenancyId,
      propertyAddress: address,
      completedOn: item.completedOn,
      expiresOn: item.expiresOn ?? (item.completedOn ? (nextDue(rule, item.completedOn) ?? null) : null),
      dueDate: item.dueDate,
      documentId: item.documentId,
    },
  };
}

/** Staff see every item; landlords see items for their own properties. */
compliance.get('/compliance', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'tenant') throw new HTTPException(403, { message: 'Not available for tenant accounts' });
  const onDate = today();

  const rows = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    const items = await tx.select().from(complianceItems);
    const props = await tx.select().from(properties);
    const addresses = new Map(props.map((p) => [p.id, formatAddress(p)]));
    return items
      .filter((item) => v.propertyIds === null || canSeeProperty(v, item.propertyId))
      .map((item) => present(item, item.propertyId ? (addresses.get(item.propertyId) ?? null) : null, onDate))
      .filter((x) => x !== null);
  });

  const order = { overdue: 0, missing: 1, due_soon: 2, valid: 3 } as const;
  const items = rows.map((r) => r.dto).sort((a, b) => order[a.status] - order[b.status]);
  return c.json({ score: complianceScore(rows.map((r) => r.state), onDate), items });
});

const completeInput = z.object({
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  documentId: z.string().uuid().optional(),
});

/** Records that a requirement has been met, with the certificate as evidence. */
compliance.post('/compliance/:id/complete', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  const input = completeInput.parse(await c.req.json());
  const itemId = c.req.param('id');

  const updated = await withOrg(auth.orgId, async (tx) => {
    const [row] = await tx
      .update(complianceItems)
      .set({ completedOn: input.completedOn, expiresOn: input.expiresOn ?? null, documentId: input.documentId ?? null })
      .where(eq(complianceItems.id, itemId))
      .returning();
    if (!row) throw new HTTPException(404, { message: 'Compliance item not found' });
    await audit(tx, auth, 'compliance.completed', 'compliance_item', row.id, input);
    return row;
  });

  const presented = present(updated, null, today());
  if (!presented) throw new HTTPException(404, { message: 'Rule no longer exists' });
  return c.json(presented.dto);
});
