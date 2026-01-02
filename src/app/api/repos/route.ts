/**
 * API routes for repository management
 * POST - Fetch and cache a new repository (non-blocking with waitUntil)
 * GET - List all cached repositories
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { repositories, ingestJobs } from '@/db';
import { eq, desc } from 'drizzle-orm';
import { ingestRepoSchema } from '@/lib/validation';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { processRepoIngestion } from '@/services/ingest';

export const runtime = 'edge';

export async function GET() {
    const requestLogger = logger.child({ endpoint: '/api/repos' });

    try {
        const db = getDb();
        const repos = await db
            .select()
            .from(repositories)
            .orderBy(desc(repositories.lastFetched));

        requestLogger.info({ count: repos.length }, 'Repositories fetched');
        return NextResponse.json({ repositories: repos });
    } catch (error) {
        requestLogger.error({ error, errorMessage: error instanceof Error ? error.message : 'Unknown error' }, 'Error fetching repositories');
        return NextResponse.json(
            { error: 'Failed to fetch repositories' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: '/api/repos' });
    const startTime = Date.now();

    try {
        // Rate limiting
        const clientId = rateLimiter.getClientId(request);
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.REPO_INGEST, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId }, 'Rate limit exceeded');
            return NextResponse.json(
                {
                    error: 'Rate limit exceeded',
                    limit: rateLimitResult.limit,
                    reset: rateLimitResult.reset,
                },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
                        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
                    },
                }
            );
        }

        const db = getDb();
        const rawBody = await request.json();

        // Validate and sanitize input
        const parseResult = ingestRepoSchema.safeParse(rawBody);
        if (!parseResult.success) {
            requestLogger.warn({ errors: parseResult.error.issues }, 'Validation failed');
            return NextResponse.json(
                {
                    error: 'Validation failed',
                    details: parseResult.error.issues,
                },
                { status: 400 }
            );
        }

        const { url } = parseResult.data;
        const sanitizedUrl = sanitizeGitHubUrl(url);
        const { owner, repo: repoName } = parseGitHubUrl(sanitizedUrl);

        requestLogger.info({ owner, repo: repoName }, 'Processing repository ingest');

        // Check if repo already exists
        const existing = await db
            .select()
            .from(repositories)
            .where(eq(repositories.url, sanitizedUrl))
            .limit(1);

        if (existing.length > 0) {
            const duration = Date.now() - startTime;

            // Track cached repo request
            await analytics.trackRepoIngest({
                owner,
                repo: repoName,
                commitsCount: 0,
                cached: true,
                duration,
            });

            requestLogger.info({ owner, repo: repoName, duration }, 'Repository already cached');
            return NextResponse.json({ repository: existing[0], cached: true });
        }

        // Create job for background processing
        const jobId = crypto.randomUUID();
        const now = new Date();

        // Create job record
        await db.insert(ingestJobs).values({
            jobId,
            url: sanitizedUrl,
            status: 'pending',
            progress: 0,
            createdAt: now,
            updatedAt: now,
        });

        // Process in background using waitUntil (non-blocking)
        const { ctx } = getRequestContext();
        ctx.waitUntil(
            processRepoIngestion({
                jobId,
                url: sanitizedUrl,
                clientId,
            })
        );

        requestLogger.info({ jobId, owner, repo: repoName }, 'Repository ingest started in background');

        return NextResponse.json({
            jobId,
            status: 'processing',
            message: 'Repository ingestion started in background',
        }, { status: 202 });

    } catch (error) {
        const duration = Date.now() - startTime;

        await analytics.trackRequest({
            endpoint: '/api/repos',
            method: 'POST',
            statusCode: 500,
            duration,
            clientId: rateLimiter.getClientId(request),
        });

        requestLogger.error({ error, errorMessage: error instanceof Error ? error.message : 'Unknown error', duration }, 'Error creating repository');
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch repository' },
            { status: 500 }
        );
    }
}
