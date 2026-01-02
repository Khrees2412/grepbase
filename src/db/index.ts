import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import * as schema from './schema';

// Type for Cloudflare environment with D1 binding
export interface CloudflareEnv {
    DB: D1Database;
}

// Create Drizzle ORM instance from D1 binding
// This should be called in each request handler with the env from the request context
export function createDb(d1: D1Database) {
    return drizzleD1(d1, { schema });
}

// Export schema for use in queries
export * from './schema';

// Type for the database instance
export type Database = ReturnType<typeof createDb>;
