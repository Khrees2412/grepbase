import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb, type CloudflareEnv } from '@/db';

// Get the database instance for the current request
// Must be called within an API route or server component
export function getDb() {
    const { env } = getRequestContext<CloudflareEnv>();
    return createDb(env.DB);
}
