import { defineConfig } from 'drizzle-kit';

/** `npm run db:generate` writes SQL migrations into ./drizzle from src/db/schema.ts. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
