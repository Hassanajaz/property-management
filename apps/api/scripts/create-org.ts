/**
 * Creates a landlord's account and their sign-in. Use this for your own
 * account and for early customers until self-service sign-up is built.
 *
 *   npm run org:create -- "Ajaz Lettings" you@example.co.uk "Your Name" england wales
 *
 * The nations listed (default: england) decide which landlord registration
 * requirements are added to the account.
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

const NATIONS: readonly Nation[] = ['england', 'wales', 'scotland', 'northern_ireland'];
const [name, email, landlordName, ...nationArgs] = process.argv.slice(2);
const nations = (nationArgs.length ? nationArgs : ['england']) as Nation[];
if (!name || !email || !landlordName || nations.some((n) => !NATIONS.includes(n))) {
  console.error('Usage: npm run org:create -- "<account name>" <landlord email> "<landlord name>" [england wales scotland northern_ireland]');
  process.exit(1);
}

const db = drizzle(new RDSDataClient({}), {
  database: required('DB_NAME'),
  resourceArn: required('DB_CLUSTER_ARN'),
  secretArn: required('DB_ADMIN_SECRET_ARN'),
});

const [org] = await db.insert(organisations).values({ name, planId: 'solo' }).returning();

const created = await new CognitoIdentityProviderClient({}).send(
  new AdminCreateUserCommand({
    UserPoolId: required('USER_POOL_ID'),
    Username: email,
    DesiredDeliveryMediums: ['EMAIL'],
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: landlordName },
      { Name: 'custom:org_id', Value: org!.id },
      { Name: 'custom:role', Value: 'landlord' },
    ],
  }),
);
const sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
if (!sub) throw new Error('Cognito did not return a user id');

await db.insert(users).values({ orgId: org!.id, cognitoSub: sub, email, name: landlordName, role: 'landlord' });

// The landlord's own obligations (registration schemes, ICO fee) for each nation they let in.
const ruleIds = new Set<string>();
for (const nation of nations) {
  for (const r of generateRequirements({ nation, scope: 'landlord' }, today())) ruleIds.add(r.ruleId);
}
if (ruleIds.size > 0) {
  await db.insert(complianceItems).values([...ruleIds].map((ruleId) => ({ orgId: org!.id, ruleId })));
}

console.log(`Created account "${name}" (${org!.id}). ${email} has been emailed a temporary password.`);
