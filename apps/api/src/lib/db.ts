import { getPlatformEnv } from './platform/context';
import { createDb } from '@/db';

// Get the database instance for the current request
// Must be called within an API route or server component
export function getDb() {
    const platform = getPlatformEnv();
    return createDb(platform.getDatabase());
}
