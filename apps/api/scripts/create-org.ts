/**
 * Creates an organisation (an agency or a self-managing landlord) and its
 * owner's sign-in. Use this for your own agency and for early customers until
 * self-service sign-up is built.
 *
 *   npm run org:create -- "Ajaz Lettings" owner@example.co.uk "Owner Name" agency
 *
 * Requires: DB_NAME, DB_CLUSTER_ARN, DB_ADMIN_SECRET_ARN, USER_POOL_ID and AWS credentials.
 */
import { AdminCreateUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { drizzle } from 'drizzle-orm/aws-data-api/pg';
import { generateRequirements, today, type Nation } from '@lettly/core';
import { complianceItems, organisations, users } from '../src/db/schema.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const [name, email, ownerName, kind = 'agency', ...nations] = process.argv.slice(2);
if (!name || !email || !ownerName || (kind !== 'agency' && kind !== 'landlord')) {
  console.error('Usage: npm run org:create -- "<organisation>" <owner email> "<owner name>" [agency|landlord] [england wales scotland northern_ireland]');
  process.exit(1);
}

const db = drizzle(new RDSDataClient({}), {
  database: required('DB_NAME'),
  resourceArn: required('DB_CLUSTER_ARN'),
  secretArn: required('DB_ADMIN_SECRET_ARN'),
});

const [org] = await db
  .insert(organisations)
  .values({ name, kind, planId: kind === 'agency' ? 'agency_starter' : 'landlord_solo' })
  .returning();

const created = await new CognitoIdentityProviderClient({}).send(
  new AdminCreateUserCommand({
    UserPoolId: required('USER_POOL_ID'),
    Username: email,
    DesiredDeliveryMediums: ['EMAIL'],
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: ownerName },
      { Name: 'custom:org_id', Value: org!.id },
      { Name: 'custom:role', Value: 'agency_owner' },
    ],
  }),
);
const sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
if (!sub) throw new Error('Cognito did not return a user id');

await db.insert(users).values({ orgId: org!.id, cognitoSub: sub, email, name: ownerName, role: 'agency_owner' });

// The agency's own obligations (scheme memberships, licences, ICO fee) for each nation it works in.
if (kind === 'agency') {
  const ruleIds = new Set<string>();
  for (const nation of (nations.length ? nations : ['england']) as Nation[]) {
    for (const r of generateRequirements({ nation, scope: 'agency' }, today())) ruleIds.add(r.ruleId);
  }
  if (ruleIds.size > 0) {
    await db.insert(complianceItems).values([...ruleIds].map((ruleId) => ({ orgId: org!.id, ruleId })));
  }
}

console.log(`Created ${kind} "${name}" (${org!.id}). ${email} has been emailed a temporary password.`);
