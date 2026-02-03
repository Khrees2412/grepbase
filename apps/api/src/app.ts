import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { createMiddleware } from 'hono/factory';
import { createHttpDb } from '@/db/http';
import { createDb, type Database } from '@/db';
import { createWorkerPlatformEnv, type WorkerBindings } from '@/lib/platform/worker';
import { setRuntimeEnv } from '@/lib/platform/runtime';
import repos from './routes/repos';
import explain from './routes/explain';
import jobs from './routes/jobs';
import testConnection from './routes/test-connection';

type Variables = {
  db: Database;
};

type Bindings = WorkerBindings;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function getNodeEnv(): NodeJS.ProcessEnv | undefined {
  return typeof process !== 'undefined' ? process.env : undefined;
}

const DEV_LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const DEV_LAN_ORIGIN_RE = /^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;

function resolveCorsOrigin(origin: string | undefined, c: { env?: Bindings }): string | undefined {
  const nodeEnv = getNodeEnv();
  const configured =
    (typeof c.env?.FRONTEND_URL === 'string' ? c.env.FRONTEND_URL : undefined) ||
    nodeEnv?.FRONTEND_URL;

  if (configured) return configured;

  // In dev, allow any localhost/LAN origin so the port can vary.
  if (nodeEnv?.NODE_ENV !== 'production' && origin) {
    if (DEV_LOCAL_ORIGIN_RE.test(origin) || DEV_LAN_ORIGIN_RE.test(origin)) {
      return origin;
    }
  }

  return 'http://localhost:3000';
}

// Database middleware - creates a database connection for each request
const dbMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
  if (c.env?.grepbase_db) {
    // Cloudflare Workers bindings
    setRuntimeEnv(createWorkerPlatformEnv(c.env, c.executionCtx));
    const db = createDb(c.env.grepbase_db);
    c.set('db', db as Database);
    await next();
    return;
  }

  const nodeEnv = getNodeEnv();
  const accountId = nodeEnv?.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = nodeEnv?.CLOUDFLARE_API_TOKEN;
  const databaseId = nodeEnv?.CLOUDFLARE_D1_DATABASE_ID;

  if (!accountId || !apiToken || !databaseId) {
    console.error('Missing Cloudflare credentials for database access');
    return c.json({ error: 'Database configuration error' }, 500);
  }

  const db = createHttpDb(accountId, databaseId, apiToken);
  c.set('db', db as Database);
  await next();
});

// Middleware
app.use('*', honoLogger());
app.use(
  '*',
  cors({
    origin: (origin, c) => resolveCorsOrigin(origin, c),
    credentials: true,
  })
);

// Health check (no db needed)
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply db middleware only where needed
app.use('/api/repos', dbMiddleware);
app.use('/api/repos/*', dbMiddleware);
app.use('/api/jobs', dbMiddleware);
app.use('/api/jobs/*', dbMiddleware);
app.use('/api/explain', dbMiddleware);

// Mount API routes
app.route('/api/repos', repos);
app.route('/api/explain', explain);
app.route('/api/jobs', jobs);
app.route('/api/test-connection', testConnection);

app.get('/', (c) => {
  return c.json({
    message: 'Grepbase API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      repos: '/api/repos',
      jobs: '/api/jobs',
      explain: '/api/explain',
    },
  });
});

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
      },
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404
  );
});

export { app };
