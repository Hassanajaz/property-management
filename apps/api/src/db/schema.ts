import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  DocumentType,
  MaintenanceCategory,
  MaintenanceStatus,
  MaintenanceUrgency,
  Nation,
  RentFrequency,
  Role,
} from '@lettly/core';

/**
 * An organisation is one landlord's account. Every table except
 * `organisations` and `payment_connections` carries
 * `org_id` and is protected by row-level security (see scripts/migrate.ts).
 * Money is stored as whole pence. Calendar dates use `date`; moments use `timestamptz`.
 */
const id = () => uuid('id').primaryKey().defaultRandom();
const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organisations.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const organisations = pgTable('organisations', {
  id: id(),
  name: text('name').notNull(),
  planId: text('plan_id').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: createdAt(),
});

/** Maps a GoCardless organisation to ours so webhooks can find the account. Holds no secrets. */
export const paymentConnections = pgTable('payment_connections', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organisations.id),
  gocardlessOrganisationId: text('gocardless_organisation_id').notNull().unique(),
  /** Secrets Manager ARN of the access token; the token itself is never stored here. */
  accessTokenSecretArn: text('access_token_secret_arn').notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    orgId: orgId(),
    cognitoSub: text('cognito_sub').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').$type<Role>().notNull(),
    /** Expo push tokens for this person's devices. */
    pushTokens: jsonb('push_tokens').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_cognito_sub_idx').on(t.cognitoSub), index('users_org_idx').on(t.orgId)],
);

export const properties = pgTable(
  'properties',
  {
    id: id(),
    orgId: orgId(),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    town: text('town').notNull(),
    postcode: text('postcode').notNull(),
    nation: text('nation').$type<Nation>().notNull(),
    hasGas: boolean('has_gas').notNull().default(true),
    isHmo: boolean('is_hmo').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('properties_org_idx').on(t.orgId)],
);

export const tenancies = pgTable(
  'tenancies',
  {
    id: id(),
    orgId: orgId(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    rentAmountPence: integer('rent_amount_pence').notNull(),
    rentFrequency: text('rent_frequency').$type<RentFrequency>().notNull().default('monthly'),
    depositPence: integer('deposit_pence').notNull().default(0),
    depositReceivedOn: date('deposit_received_on'),
    depositScheme: text('deposit_scheme'),
    status: text('status').$type<'draft' | 'active' | 'ended'>().notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [index('tenancies_org_idx').on(t.orgId), index('tenancies_property_idx').on(t.propertyId)],
);

/** A person on a tenancy. `userId` is set once they have been invited and can sign in. */
export const tenancyTenants = pgTable(
  'tenancy_tenants',
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid('tenancy_id')
      .notNull()
      .references(() => tenancies.id),
    userId: uuid('user_id').references(() => users.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    isGuarantor: boolean('is_guarantor').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('tenancy_tenants_tenancy_idx').on(t.tenancyId), index('tenancy_tenants_user_idx').on(t.userId)],
);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    orgId: orgId(),
    type: text('type').$type<DocumentType>().notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    s3Key: text('s3_key').notNull(),
    propertyId: uuid('property_id').references(() => properties.id),
    tenancyId: uuid('tenancy_id').references(() => tenancies.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    /** Retention: a scheduled job removes the file after this date. */
    deleteAfter: date('delete_after'),
    createdAt: createdAt(),
  },
  (t) => [index('documents_org_idx').on(t.orgId), index('documents_property_idx').on(t.propertyId)],
);

export const complianceItems = pgTable(
  'compliance_items',
  {
    id: id(),
    orgId: orgId(),
    /** Id of the rule in @lettly/core COMPLIANCE_RULES. */
    ruleId: text('rule_id').notNull(),
    propertyId: uuid('property_id').references(() => properties.id),
    tenancyId: uuid('tenancy_id').references(() => tenancies.id),
    completedOn: date('completed_on'),
    expiresOn: date('expires_on'),
    dueDate: date('due_date'),
    documentId: uuid('document_id').references(() => documents.id),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('compliance_org_idx').on(t.orgId), index('compliance_property_idx').on(t.propertyId)],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orgId: orgId(),
    tenancyId: uuid('tenancy_id')
      .notNull()
      .references(() => tenancies.id),
    date: date('date').notNull(),
    amountPence: integer('amount_pence').notNull(),
    method: text('method').$type<'direct_debit' | 'bank_transfer' | 'cash' | 'benefit' | 'other'>().notNull(),
    status: text('status').$type<'pending' | 'confirmed' | 'failed' | 'cancelled'>().notNull().default('confirmed'),
    gocardlessPaymentId: text('gocardless_payment_id'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('payments_tenancy_idx').on(t.tenancyId), index('payments_gc_idx').on(t.gocardlessPaymentId)],
);

export const mandates = pgTable('mandates', {
  id: id(),
  orgId: orgId(),
  tenancyTenantId: uuid('tenancy_tenant_id')
    .notNull()
    .references(() => tenancyTenants.id),
  gocardlessMandateId: text('gocardless_mandate_id').notNull(),
  status: text('status').$type<'pending' | 'active' | 'failed' | 'cancelled'>().notNull().default('pending'),
  createdAt: createdAt(),
});

export const maintenanceRequests = pgTable(
  'maintenance_requests',
  {
    id: id(),
    orgId: orgId(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    tenancyId: uuid('tenancy_id').references(() => tenancies.id),
    reportedBy: uuid('reported_by')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: text('category').$type<MaintenanceCategory>().notNull(),
    urgency: text('urgency').$type<MaintenanceUrgency>().notNull(),
    status: text('status').$type<MaintenanceStatus>().notNull().default('reported'),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    /** First time the landlord acted on the report; used for response-time reporting. */
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    appointmentAt: timestamp('appointment_at', { withTimezone: true }),
    photoDocumentIds: jsonb('photo_document_ids').$type<string[]>().notNull().default([]),
    contractorName: text('contractor_name'),
    quotePence: integer('quote_pence'),
  },
  (t) => [index('maintenance_org_idx').on(t.orgId), index('maintenance_tenancy_idx').on(t.tenancyId)],
);

/** Timeline of a maintenance request. `internal` notes are the landlord's own and hidden from tenants. */
export const maintenanceUpdates = pgTable(
  'maintenance_updates',
  {
    id: id(),
    orgId: orgId(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => maintenanceRequests.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    authorRole: text('author_role').$type<Role>().notNull(),
    status: text('status').$type<MaintenanceStatus>(),
    message: text('message'),
    internal: boolean('internal').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('maintenance_updates_request_idx').on(t.requestId)],
);

export const referencingApplications = pgTable('referencing_applications', {
  id: id(),
  orgId: orgId(),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id),
  applicantName: text('applicant_name').notNull(),
  email: text('email').notNull(),
  monthlyRentPence: integer('monthly_rent_pence').notNull(),
  annualIncomePence: integer('annual_income_pence'),
  status: text('status').$type<'invited' | 'submitted' | 'in_review' | 'passed' | 'failed' | 'withdrawn'>().notNull().default('invited'),
  decisionReason: text('decision_reason'),
  createdAt: createdAt(),
});

export const referencingChecks = pgTable('referencing_checks', {
  id: id(),
  orgId: orgId(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => referencingApplications.id),
  kind: text('kind').$type<'identity' | 'right_to_rent' | 'income' | 'employer' | 'landlord' | 'credit' | 'guarantor'>().notNull(),
  status: text('status').$type<'pending' | 'passed' | 'failed' | 'not_required'>().notNull().default('pending'),
  documentId: uuid('document_id').references(() => documents.id),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    orgId: orgId(),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_org_idx').on(t.orgId, t.createdAt)],
);

/** Tables protected by row-level security on org_id. */
export const ORG_SCOPED_TABLES = [
  users,
  properties,
  tenancies,
  tenancyTenants,
  documents,
  complianceItems,
  payments,
  mandates,
  maintenanceRequests,
  maintenanceUpdates,
  referencingApplications,
  referencingChecks,
  auditLog,
] as const;
