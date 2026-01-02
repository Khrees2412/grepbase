/**
 * API routes for repository management
 * POST - Fetch and cache a new repository
 * GET - List all cached repositories
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { repositories, commits } from '@/db';
import { eq, desc } from 'drizzle-orm';
import {
    fetchRepository,
    fetchReadme,
    fetchCommitHistory,
} from '@/services/github';
import { ingestRepoSchema } from '@/lib/validation';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';

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

        // Fetch repository data from GitHub
        requestLogger.info({ owner, repo: repoName }, 'Fetching repository from GitHub');
        const repoData = await fetchRepository(owner, repoName);
        const readme = await fetchReadme(owner, repoName);

        // Fetch commit history
        requestLogger.info({ owner, repo: repoName }, 'Fetching commit history');
        const commitHistory = await fetchCommitHistory(owner, repoName, 100);

        // Save to database
        const now = new Date();
        const [newRepo] = await db
            .insert(repositories)
            .values({
                url: repoData.url,
                owner: repoData.owner,
                name: repoData.name,
                description: repoData.description,
                stars: repoData.stars,
                defaultBranch: repoData.defaultBranch,
                readme: readme,
                lastFetched: now,
                createdAt: now,
            })
            .returning();

        // Save commits
        if (commitHistory.length > 0) {
            await db.insert(commits).values(
                commitHistory.map((commit, index) => ({
                    repoId: newRepo.id,
                    sha: commit.sha,
                    message: commit.message,
                    authorName: commit.authorName,
                    authorEmail: commit.authorEmail,
                    date: commit.date,
                    order: index + 1,
                }))
            );
        }

        const duration = Date.now() - startTime;

        // Track successful ingest
        await analytics.trackRepoIngest({
            owner,
            repo: repoName,
            commitsCount: commitHistory.length,
            cached: false,
            duration,
        });

        requestLogger.info({ owner, repo: repoName, commitsCount: commitHistory.length, duration }, 'Repository ingested successfully');

        return NextResponse.json({
            repository: newRepo,
            commitsCount: commitHistory.length,
            cached: false,
        });
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
