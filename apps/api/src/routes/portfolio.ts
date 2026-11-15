import { AdminCreateUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { arrears, canAddProperty, generateRequirements, generateSchedule, planById, today, type Role } from '@lettly/core';
import { canSeeProperty, canSeeTenancy, formatAddress, visibilityFor } from '../access.ts';
import { requireStaff, type AppEnv, type AuthContext } from '../auth.ts';
import { withOrg, type Tx } from '../db/client.ts';
import { auditLog, complianceItems, landlords, organisations, payments, properties, tenancies, tenancyTenants, users } from '../db/schema.ts';
import { env } from '../env.ts';

const cognito = new CognitoIdentityProviderClient({});
export const portfolio = new Hono<AppEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nation = z.enum(['england', 'wales', 'scotland', 'northern_ireland']);

// ------------------------------------------------------------------ landlords
const landlordInput = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  /** Nations the landlord lets in, to create the right registration requirements. */
  nations: z.array(nation).default([]),
});

portfolio.get('/landlords', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  return c.json(await withOrg(auth.orgId, (tx) => tx.select().from(landlords)));
});

portfolio.post('/landlords', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  const input = landlordInput.parse(await c.req.json());
  const landlord = await withOrg(auth.orgId, async (tx) => {
    const [row] = await tx
      .insert(landlords)
      .values({ orgId: auth.orgId, name: input.name, email: input.email, phone: input.phone, address: input.address })
      .returning();
    for (const n of input.nations) {
      const requirements = generateRequirements({ nation: n, scope: 'landlord' }, today());
      if (requirements.length > 0) {
        await tx.insert(complianceItems).values(requirements.map((r) => ({ orgId: auth.orgId, ruleId: r.ruleId, landlordId: row!.id })));
      }
    }
    return row!;
  });
  return c.json(landlord, 201);
});

// ----------------------------------------------------------------- properties
const propertyInput = z.object({
  addressLine1: z.string().min(1),
  addressLine2: z.string().nullable().optional(),
  town: z.string().min(1),
  postcode: z.string().min(5).max(8),
  nation,
  landlordId: z.string().uuid().nullable().optional(),
  hasGas: z.boolean().default(true),
  isHmo: z.boolean().default(false),
});

portfolio.get('/properties', async (c) => {
  const auth = c.get('auth');
  const rows = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    const all = await tx.select().from(properties);
    return all.filter((p) => canSeeProperty(v, p.id));
  });
  return c.json(rows);
});

portfolio.post('/properties', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  const input = propertyInput.parse(await c.req.json());

  const property = await withOrg(auth.orgId, async (tx) => {
    // Enforce the subscription's property limit.
    const [org] = await tx.select().from(organisations).where(eq(organisations.id, auth.orgId));
    const [{ total }] = (await tx.select({ total: count() }).from(properties)) as [{ total: number }];
    const plan = planById(org?.planId ?? '');
    if (plan && !canAddProperty(plan, total)) {
      throw new HTTPException(402, { message: `Your ${plan.name} plan covers ${plan.maxProperties} properties. Upgrade to add more.` });
    }

    const [row] = await tx.insert(properties).values({ ...input, orgId: auth.orgId }).returning();

    // Create the certificates and checks this property needs under its nation's rules.
    const requirements = generateRequirements(
      { nation: input.nation, scope: 'property', facts: { hasGas: input.hasGas, isHmo: input.isHmo } },
      today(),
    );
    if (requirements.length > 0) {
      await tx.insert(complianceItems).values(requirements.map((r) => ({ orgId: auth.orgId, ruleId: r.ruleId, propertyId: row!.id })));
    }
    await audit(tx, auth, 'property.created', 'property', row!.id);
    return row!;
  });
  return c.json(property, 201);
});

// ------------------------------------------------------------------ tenancies
const tenancyInput = z.object({
  propertyId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate.optional(),
  rentAmountPence: z.number().int().positive(),
  rentFrequency: z.enum(['weekly', 'fortnightly', 'four_weekly', 'monthly', 'quarterly']).default('monthly'),
  depositPence: z.number().int().min(0).default(0),
  depositReceivedOn: isoDate.optional(),
  tenants: z.array(z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().optional(), isGuarantor: z.boolean().default(false) })).min(1),
});

/** Tenancies the signed-in person may see, each with its current rent balance. */
portfolio.get('/tenancies', async (c) => {
  const auth = c.get('auth');
  const onDate = today();
  const rows = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    const visible = (await tx.select().from(tenancies)).filter((t) => canSeeTenancy(v, t.id));
    const props = await tx.select().from(properties);
    const people = await tx.select().from(tenancyTenants);
    const received = await tx.select().from(payments);
    return visible.map((t) => {
      const property = props.find((p) => p.id === t.propertyId);
      const charges = generateSchedule(
        { startDate: t.startDate, endDate: t.endDate ?? undefined, amountPence: t.rentAmountPence, frequency: t.rentFrequency },
        onDate,
      );
      const summary = arrears(charges, received.filter((p) => p.tenancyId === t.id && p.status === 'confirmed'), onDate);
      return {
        id: t.id,
        propertyId: t.propertyId,
        propertyAddress: property ? formatAddress(property) : '',
        tenantNames: people.filter((p) => p.tenancyId === t.id && !p.isGuarantor).map((p) => p.name),
        startDate: t.startDate,
        endDate: t.endDate,
        rentAmountPence: t.rentAmountPence,
        rentFrequency: t.rentFrequency,
        depositPence: t.depositPence,
        depositScheme: t.depositScheme,
        status: t.status,
        balancePence: summary.balancePence,
        daysInArrears: summary.daysInArrears,
      };
    });
  });
  return c.json(rows);
});

portfolio.post('/tenancies', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  const input = tenancyInput.parse(await c.req.json());

  const result = await withOrg(auth.orgId, async (tx) => {
    const [property] = await tx.select().from(properties).where(eq(properties.id, input.propertyId));
    if (!property) throw new HTTPException(404, { message: 'Property not found' });

    const { tenants, ...terms } = input;
    const [tenancy] = await tx.insert(tenancies).values({ ...terms, orgId: auth.orgId }).returning();
    const people = await tx
      .insert(tenancyTenants)
      .values(tenants.map((t) => ({ ...t, orgId: auth.orgId, tenancyId: tenancy!.id })))
      .returning();

    const requirements = generateRequirements(
      {
        nation: property.nation,
        scope: 'tenancy',
        facts: { depositTaken: input.depositPence > 0, hasGas: property.hasGas },
        tenancyStart: input.startDate,
        depositReceived: input.depositReceivedOn,
      },
      input.startDate,
    );
    if (requirements.length > 0) {
      await tx
        .insert(complianceItems)
        .values(requirements.map((r) => ({ orgId: auth.orgId, ruleId: r.ruleId, tenancyId: tenancy!.id, propertyId: property.id, dueDate: r.dueDate })));
    }
    await audit(tx, auth, 'tenancy.created', 'tenancy', tenancy!.id);
    return { ...tenancy!, tenants: people };
  });
  return c.json(result, 201);
});

// -------------------------------------------------------------------- invites
/**
 * Creates the sign-in for a tenant or landlord. Cognito emails them a
 * temporary password; they choose their own on first sign-in.
 */
async function invite(tx: Tx, auth: AuthContext, person: { email: string; name: string }, role: Role, landlordId: string | null) {
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: env.USER_POOL_ID,
      Username: person.email,
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: [
        { Name: 'email', Value: person.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: person.name },
        { Name: 'custom:org_id', Value: auth.orgId },
        { Name: 'custom:role', Value: role },
      ],
    }),
  );
  const sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) throw new HTTPException(500, { message: 'Could not create the sign-in' });
  const [user] = await tx
    .insert(users)
    .values({ orgId: auth.orgId, cognitoSub: sub, email: person.email, name: person.name, role, landlordId })
    .returning();
  await audit(tx, auth, `${role}.invited`, 'user', user!.id);
  return user!;
}

portfolio.post('/tenants/:tenancyTenantId/invite', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  const tenancyTenantId = c.req.param('tenancyTenantId');
  const user = await withOrg(auth.orgId, async (tx) => {
    const [person] = await tx.select().from(tenancyTenants).where(eq(tenancyTenants.id, tenancyTenantId));
    if (!person) throw new HTTPException(404, { message: 'Tenant not found' });
    if (person.userId) throw new HTTPException(409, { message: 'This tenant already has a sign-in' });
    const created = await invite(tx, auth, person, 'tenant', null);
    await tx.update(tenancyTenants).set({ userId: created.id }).where(eq(tenancyTenants.id, person.id));
    return created;
  });
  return c.json({ userId: user.id, email: user.email }, 201);
});

portfolio.post('/landlords/:landlordId/invite', async (c) => {
  const auth = c.get('auth');
  requireStaff(auth);
  const landlordId = c.req.param('landlordId');
  const user = await withOrg(auth.orgId, async (tx) => {
    const [landlord] = await tx.select().from(landlords).where(eq(landlords.id, landlordId));
    if (!landlord) throw new HTTPException(404, { message: 'Landlord not found' });
    if (!landlord.email) throw new HTTPException(400, { message: 'Add an email address for this landlord first' });
    return invite(tx, auth, { email: landlord.email, name: landlord.name }, 'landlord', landlord.id);
  });
  return c.json({ userId: user.id, email: user.email }, 201);
});

export async function audit(tx: Tx, auth: AuthContext, action: string, entity: string, entityId: string, detail?: unknown) {
  await tx.insert(auditLog).values({ orgId: auth.orgId, userId: auth.userId, action, entity, entityId, detail });
}
