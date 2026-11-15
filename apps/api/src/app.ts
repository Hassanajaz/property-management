import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { ZodError, z } from 'zod';
import { requireAuth, type AppEnv } from './auth.ts';
import { withOrg } from './db/client.ts';
import { organisations, users } from './db/schema.ts';
import { compliance } from './routes/compliance.ts';
import { documentRoutes } from './routes/documents.ts';
import { maintenance } from './routes/maintenance.ts';
import { portfolio } from './routes/portfolio.ts';
import { referencing } from './routes/referencing.ts';
import { rent, webhooks } from './routes/rent.ts';

export const app = new Hono();

app.use('*', cors({ origin: (process.env.ALLOWED_ORIGINS ?? '*').split(','), allowHeaders: ['Authorization', 'Content-Type'] }));

app.get('/health', (c) => c.json({ ok: true }));
app.route('/', webhooks); // signature-verified, no sign-in

const api = new Hono<AppEnv>();
api.use('*', requireAuth);

/** Who am I? Used by the apps after sign-in to choose which screens to show. */
api.get('/me', async (c) => {
  const auth = c.get('auth');
  const [org] = await withOrg(auth.orgId, (tx) => tx.select().from(organisations).where(eq(organisations.id, auth.orgId)));
  return c.json({ userId: auth.userId, email: auth.email, role: auth.role, organisation: org ? { id: org.id, name: org.name } : null });
});

/** Registers this device for push notifications (repair updates, reminders). */
api.post('/me/push-token', async (c) => {
  const auth = c.get('auth');
  const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await c.req.json());
  await withOrg(auth.orgId, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, auth.userId));
    if (user && !user.pushTokens.includes(token)) {
      await tx.update(users).set({ pushTokens: [...user.pushTokens, token].slice(-5) }).where(eq(users.id, auth.userId));
    }
  });
  return c.body(null, 204);
});

api.route('/', portfolio);
api.route('/', compliance);
api.route('/', maintenance);
api.route('/', documentRoutes);
api.route('/', rent);
api.route('/', referencing);
app.route('/', api);

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});
