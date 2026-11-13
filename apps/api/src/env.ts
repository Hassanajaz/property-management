function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Set by the CDK stack (infra/lib/platform-stack.ts). */
export const env = {
  DB_NAME: required('DB_NAME'),
  DB_CLUSTER_ARN: required('DB_CLUSTER_ARN'),
  DB_SECRET_ARN: required('DB_SECRET_ARN'),
  USER_POOL_ID: required('USER_POOL_ID'),
  USER_POOL_CLIENT_ID: required('USER_POOL_CLIENT_ID'),
  DOCUMENTS_BUCKET: required('DOCUMENTS_BUCKET'),
  /** Verified SES sender, e.g. no-reply@yourdomain.co.uk. Emails are skipped when empty. */
  EMAIL_FROM: process.env.EMAIL_FROM ?? '',
  /** GoCardless webhook endpoint secret. Webhooks are rejected when empty. */
  GOCARDLESS_WEBHOOK_SECRET: process.env.GOCARDLESS_WEBHOOK_SECRET ?? '',
};
