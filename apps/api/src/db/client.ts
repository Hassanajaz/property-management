import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/aws-data-api/pg';
import { env } from '../env.ts';
import * as schema from './schema.ts';

/**
 * The API talks to Aurora through the RDS Data API (HTTPS), so the Lambda
 * function does not sit inside a private network and no NAT gateway is needed.
 */
export const db = drizzle(new RDSDataClient({}), {
  database: env.DB_NAME,
  resourceArn: env.DB_CLUSTER_ARN,
  secretArn: env.DB_SECRET_ARN,
  schema,
});

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in a transaction scoped to one organisation. Row-level security
 * policies read `app.org_id`, so queries inside can only see that
 * organisation's rows even if a `where` clause is forgotten.
 *
 * ALL tenant-data queries must go through this function.
 */
export function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
