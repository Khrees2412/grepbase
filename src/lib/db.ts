import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';

// Get the database instance for the current request
// Must be called within an API route or server component
export function getDb() {
    const { env } = getRequestContext<{ grepbase_db: D1Database }>();
    return createDb(env.grepbase_db);
}
