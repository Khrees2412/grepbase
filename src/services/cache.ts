import { getRequestContext } from '@cloudflare/next-on-pages';

export const CACHE_TTL = {
    MINUTE: 60,
    HOUR: 3600,
    DAY: 86400,
    WEEK: 604800,
};

export class CacheService {
    private getKv(): KVNamespace | null {
        try {
            const { env } = getRequestContext<{ grepbase_cache: KVNamespace }>();
            return env.grepbase_cache;
        } catch (e) {
            // Silently fail if not in a request context (e.g. build time)
            return null;
        }
    }

    /**
     * Get a value from the cache
     */
    async get<T>(key: string): Promise<T | null> {
        const kv = this.getKv();
        if (!kv) return null;
        try {
            // Using "json" type automatically parses the value
            return await kv.get(key, 'json');
        } catch (e) {
            console.error(`Cache get failed for key ${key}:`, e);
            return null;
        }
    }

    /**
     * Set a value in the cache
     * @param ttl Time to live in seconds
     */
    async set(key: string, value: unknown, ttl?: number): Promise<void> {
        const kv = this.getKv();
        if (!kv) return;
        try {
            const options: KVNamespacePutOptions = {};
            if (ttl) {
                options.expirationTtl = ttl;
            }
            await kv.put(key, JSON.stringify(value), options);
        } catch (e) {
            console.error(`Cache set failed for key ${key}:`, e);
        }
    }

    /**
     * Delete a value from the cache
     */
    async delete(key: string): Promise<void> {
        const kv = this.getKv();
        if (!kv) return;
        try {
            await kv.delete(key);
        } catch (e) {
            console.error(`Cache delete failed for key ${key}:`, e);
        }
    }
}

export const cache = new CacheService();
