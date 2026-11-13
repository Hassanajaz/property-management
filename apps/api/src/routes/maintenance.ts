import { asc, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { STAFF_ROLES, TENANT_STATUS_LABEL, canTransition, isStaff } from '@lettly/core';
import { canSeeProperty, canSeeTenancy, formatAddress, visibilityFor } from '../access.ts';
import type { AppEnv, AuthContext } from '../auth.ts';
import { withOrg, type Tx } from '../db/client.ts';
import { maintenanceRequests, maintenanceUpdates, properties, tenancies, tenancyTenants, users } from '../db/schema.ts';
import { notify, type Recipient } from '../notify.ts';
import { audit } from './portfolio.ts';

export const maintenance = new Hono<AppEnv>();

type RequestRow = typeof maintenanceRequests.$inferSelect;

function toDto(row: RequestRow, address: string) {
  return {
    id: row.id,
    propertyId: row.propertyId,
    propertyAddress: address,
    title: row.title,
    description: row.description,
    category: row.category,
    urgency: row.urgency,
    status: row.status,
    reportedAt: row.reportedAt.toISOString(),
    appointmentAt: row.appointmentAt?.toISOString() ?? null,
    photoDocumentIds: row.photoDocumentIds,
  };
}

async function addressOf(tx: Tx, propertyId: string): Promise<string> {
  const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
  return property ? formatAddress(property) : '';
}

/** Loads a request if the signed-in person is allowed to see it. */
async function loadVisible(tx: Tx, auth: AuthContext, id: string): Promise<RequestRow> {
  const [row] = await tx.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id));
  if (!row) throw new HTTPException(404, { message: 'Request not found' });
  const v = await visibilityFor(tx, auth);
  const allowed = auth.role === 'tenant' ? canSeeTenancy(v, row.tenancyId) : canSeeProperty(v, row.propertyId);
  if (!allowed) throw new HTTPException(404, { message: 'Request not found' });
  return row;
}

async function staffRecipients(tx: Tx): Promise<Recipient[]> {
  return tx.select({ email: users.email, pushTokens: users.pushTokens }).from(users).where(inArray(users.role, [...STAFF_ROLES]));
}

async function tenantRecipients(tx: Tx, tenancyId: string | null): Promise<Recipient[]> {
  if (!tenancyId) return [];
  return tx
    .select({ email: users.email, pushTokens: users.pushTokens })
    .from(tenancyTenants)
    .innerJoin(users, eq(users.id, tenancyTenants.userId))
    .where(eq(tenancyTenants.tenancyId, tenancyId));
}

async function landlordRecipients(tx: Tx, propertyId: string): Promise<Recipient[]> {
  const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
  if (!property?.landlordId) return [];
  return tx.select({ email: users.email, pushTokens: users.pushTokens }).from(users).where(eq(users.landlordId, property.landlordId));
}

// ----------------------------------------------------------------------- list
maintenance.get('/maintenance', async (c) => {
  const auth = c.get('auth');
  const result = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    const rows = await tx.select().from(maintenanceRequests).orderBy(desc(maintenanceRequests.reportedAt));
    const props = await tx.select().from(properties);
    const addresses = new Map(props.map((p) => [p.id, formatAddress(p)]));
    return rows
      .filter((r) => (auth.role === 'tenant' ? canSeeTenancy(v, r.tenancyId) : canSeeProperty(v, r.propertyId)))
      .map((r) => toDto(r, addresses.get(r.propertyId) ?? ''));
  });
  return c.json(result);
});

// --------------------------------------------------------------------- report
const reportInput = z.object({
  tenancyId: z.string().uuid().optional(),
  title: z.string().min(3).max(120),
  description: z.string().min(1).max(4000),
  category: z.enum(['plumbing', 'heating', 'electrical', 'appliance', 'damp_mould', 'structural', 'security', 'pest', 'garden_exterior', 'other']),
  urgency: z.enum(['emergency', 'urgent', 'routine']),
  photoDocumentIds: z.array(z.string().uuid()).max(10).default([]),
});

maintenance.post('/maintenance', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'landlord') throw new HTTPException(403, { message: 'Landlords cannot report repairs here; contact the agency' });
  const input = reportInput.parse(await c.req.json());

  const { dto, staff } = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);

    // A tenant reports against their own tenancy; staff must say which one.
    let tenancyId = input.tenancyId;
    if (auth.role === 'tenant') {
      if (tenancyId && !canSeeTenancy(v, tenancyId)) throw new HTTPException(403, { message: 'Not your tenancy' });
      tenancyId ??= v.tenancyIds?.[0];
    }
    if (!tenancyId) throw new HTTPException(400, { message: 'Choose the tenancy this repair is for' });
    const [tenancy] = await tx.select().from(tenancies).where(eq(tenancies.id, tenancyId));
    if (!tenancy) throw new HTTPException(404, { message: 'Tenancy not found' });

    const [row] = await tx
      .insert(maintenanceRequests)
      .values({
        orgId: auth.orgId,
        propertyId: tenancy.propertyId,
        tenancyId,
        reportedBy: auth.userId,
        title: input.title,
        description: input.description,
        category: input.category,
        urgency: input.urgency,
        photoDocumentIds: input.photoDocumentIds,
      })
      .returning();
    await tx.insert(maintenanceUpdates).values({ orgId: auth.orgId, requestId: row!.id, authorId: auth.userId, authorRole: auth.role, status: 'reported' });
    await audit(tx, auth, 'maintenance.reported', 'maintenance_request', row!.id);
    return { dto: toDto(row!, await addressOf(tx, tenancy.propertyId)), staff: await staffRecipients(tx) };
  });

  const flag = dto.urgency === 'emergency' ? 'EMERGENCY repair' : 'New repair';
  await notify(staff, `${flag}: ${dto.title}`, `${dto.propertyAddress}\n\n${dto.description}`, { maintenanceId: dto.id });
  return c.json(dto, 201);
});

// --------------------------------------------------------------------- detail
maintenance.get('/maintenance/:id', async (c) => {
  const auth = c.get('auth');
  const result = await withOrg(auth.orgId, async (tx) => {
    const row = await loadVisible(tx, auth, c.req.param('id'));
    const updates = await tx
      .select()
      .from(maintenanceUpdates)
      .where(eq(maintenanceUpdates.requestId, row.id))
      .orderBy(asc(maintenanceUpdates.createdAt));
    return {
      ...toDto(row, await addressOf(tx, row.propertyId)),
      updates: updates
        .filter((u) => isStaff(auth.role) || !u.internal) // internal notes are staff-only
        .map((u) => ({ id: u.id, createdAt: u.createdAt.toISOString(), authorRole: u.authorRole, status: u.status, message: u.message })),
    };
  });
  return c.json(result);
});

// --------------------------------------------------------------------- update
const updateInput = z
  .object({
    status: z
      .enum(['reported', 'triaged', 'awaiting_landlord_approval', 'scheduled', 'in_progress', 'completed', 'confirmed', 'reopened', 'cancelled'])
      .optional(),
    message: z.string().min(1).max(4000).optional(),
    appointmentAt: z.string().datetime().optional(),
    /** Staff-only note that tenants and landlords never see. */
    internal: z.boolean().default(false),
  })
  .refine((v) => v.status || v.message || v.appointmentAt, { message: 'Nothing to update' });

/** Adds a status change and/or message to the timeline and tells the people affected. */
maintenance.post('/maintenance/:id/updates', async (c) => {
  const auth = c.get('auth');
  const input = updateInput.parse(await c.req.json());
  const staff = isStaff(auth.role);
  if (!staff && (input.internal || input.appointmentAt)) {
    throw new HTTPException(403, { message: 'Only agency staff can do this' });
  }

  const { dto, recipients } = await withOrg(auth.orgId, async (tx) => {
    const row = await loadVisible(tx, auth, c.req.param('id'));
    if (input.status && !canTransition(auth.role, row.status, input.status)) {
      throw new HTTPException(409, { message: `This request cannot be moved from "${row.status}" to "${input.status}" by your account` });
    }

    const [updated] = await tx
      .update(maintenanceRequests)
      .set({
        status: input.status ?? row.status,
        appointmentAt: input.appointmentAt ? new Date(input.appointmentAt) : row.appointmentAt,
        firstResponseAt: row.firstResponseAt ?? (staff ? new Date() : null),
      })
      .where(eq(maintenanceRequests.id, row.id))
      .returning();
    await tx.insert(maintenanceUpdates).values({
      orgId: auth.orgId,
      requestId: row.id,
      authorId: auth.userId,
      authorRole: auth.role,
      status: input.status ?? null,
      message: input.message ?? null,
      internal: input.internal,
    });
    await audit(tx, auth, 'maintenance.updated', 'maintenance_request', row.id, { status: input.status });

    // Staff updates go to the tenant (and the landlord when approval is needed);
    // tenant and landlord updates go to staff. Internal notes notify nobody.
    let recipients: Recipient[] = [];
    if (!input.internal) {
      if (staff) {
        recipients = await tenantRecipients(tx, row.tenancyId);
        if (input.status === 'awaiting_landlord_approval') recipients.push(...(await landlordRecipients(tx, row.propertyId)));
      } else {
        recipients = await staffRecipients(tx);
      }
    }
    return { dto: toDto(updated!, await addressOf(tx, row.propertyId)), recipients };
  });

  const lines = [
    input.status ? `Status: ${TENANT_STATUS_LABEL[input.status]}` : null,
    input.appointmentAt ? `Appointment: ${new Date(input.appointmentAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}` : null,
    input.message ?? null,
  ].filter(Boolean);
  await notify(recipients, `Repair update: ${dto.title}`, lines.join('\n'), { maintenanceId: dto.id });
  return c.json(dto);
});
