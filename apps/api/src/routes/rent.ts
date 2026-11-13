import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { arrears, generateSchedule, today } from '@lettly/core';
import { canSeeTenancy, visibilityFor } from '../access.ts';
import { requireStaff, type AppEnv } from '../auth.ts';
import { db, withOrg } from '../db/client.ts';
import { paymentConnections, payments, tenancies } from '../db/schema.ts';
import { env } from '../env.ts';
import { audit } from './portfolio.ts';

export const rent = new Hono<AppEnv>();

/** Rent statement for a tenancy: charges from the rent terms, payments received, and the balance. */
rent.get('/tenancies/:id/ledger', async (c) => {
  const auth = c.get('auth');
  const tenancyId = c.req.param('id');
  const onDate = today();

  const result = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    const [tenancy] = await tx.select().from(tenancies).where(eq(tenancies.id, tenancyId));
    if (!tenancy || !canSeeTenancy(v, tenancy.id)) throw new HTTPException(404, { message: 'Tenancy not found' });

    const received = await tx.select().from(payments).where(eq(payments.tenancyId, tenancy.id));
    const charges = generateSchedule(
      { startDate: tenancy.startDate, endDate: tenancy.endDate ?? undefined, amountPence: tenancy.rentAmountPence, frequency: tenancy.rentFrequency },
      onDate,
    );
    const confirmed = received.filter((p) => p.status === 'confirmed');
    return { charges, payments: received, summary: arrears(charges, confirmed, onDate) };
  });
  return c.json(result);
});

const paymentInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountPence: z.number().int().positive(),
  method: z.enum(['bank_transfer', 'cash', 'benefit', 'other']),
  note: z.string().max(500).optional(),
});

/** Records a payment received outside Direct Debit (standing order, cash, housing benefit). */
rent.post('/tenancies/:id/payments', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  const input = paymentInput.parse(await c.req.json());
  const tenancyId = c.req.param('id');

  const payment = await withOrg(auth.orgId, async (tx) => {
    const [tenancy] = await tx.select().from(tenancies).where(eq(tenancies.id, tenancyId));
    if (!tenancy) throw new HTTPException(404, { message: 'Tenancy not found' });
    const [row] = await tx.insert(payments).values({ ...input, orgId: auth.orgId, tenancyId, status: 'confirmed' }).returning();
    await audit(tx, auth, 'payment.recorded', 'payment', row!.id, input);
    return row!;
  });
  return c.json(payment, 201);
});

// ------------------------------------------------------------------ webhooks
/**
 * GoCardless webhook. Not behind sign-in: authenticity is proved by the
 * signature header, an HMAC-SHA256 of the raw body using the endpoint secret.
 *
 * NOT YET TESTED AGAINST THE GOCARDLESS SANDBOX. Creating mandates and
 * payments (the outbound half) is the next piece of rent work.
 */
export const webhooks = new Hono();

const STATUS_BY_ACTION: Record<string, 'confirmed' | 'failed' | 'cancelled'> = {
  confirmed: 'confirmed',
  paid_out: 'confirmed',
  failed: 'failed',
  charged_back: 'failed',
  cancelled: 'cancelled',
};

webhooks.post('/webhooks/gocardless', async (c) => {
  const body = await c.req.text();
  const given = c.req.header('Webhook-Signature') ?? '';
  if (!env.GOCARDLESS_WEBHOOK_SECRET) return c.json({ error: 'Webhooks are not configured' }, 503);

  const expected = createHmac('sha256', env.GOCARDLESS_WEBHOOK_SECRET).update(body).digest('hex');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'Invalid signature' }, 498);

  const { events = [] } = JSON.parse(body) as {
    events?: { resource_type: string; action: string; links: { payment?: string; organisation?: string } }[];
  };

  for (const event of events) {
    const status = STATUS_BY_ACTION[event.action];
    if (event.resource_type !== 'payments' || !status || !event.links.payment || !event.links.organisation) continue;

    // payment_connections is the one lookup allowed outside an organisation scope.
    const [connection] = await db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.gocardlessOrganisationId, event.links.organisation));
    if (!connection) continue;

    await withOrg(connection.orgId, (tx) =>
      tx.update(payments).set({ status }).where(eq(payments.gocardlessPaymentId, event.links.payment!)),
    );
  }
  return c.body(null, 204);
});
