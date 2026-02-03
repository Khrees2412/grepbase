/**
 * Hono router for repository management
 * Consolidated from Next.js API routes:
 * - GET/POST /api/repos
 * - GET /api/repos/:id/commits
 * - GET /api/repos/:id/commits/:sha
 * - GET /api/repos/:id/commits/:sha/content
 */

import { Hono, type Context } from 'hono';
import { repositories, ingestJobs, commits, files } from '@/db';
import { eq, desc, asc, sql, and } from 'drizzle-orm';
import { ingestRepoSchema } from '@/lib/validation';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS, PAGINATION } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import { processRepoIngestion } from '@/services/ingest';
import {
    fetchFilesAtCommit,
    getLanguageFromPath,
    fetchFileContent,
} from '@/services/github';
import type { Database } from '@/db';

type Variables = {
    db: Database;
};

const repos = new Hono<{ Variables: Variables }>();

// File extensions we want to fetch content for
const CODE_EXTENSIONS = [
    '.js', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go', '.java',
    '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
    '.md', '.json', '.yaml', '.yml', '.toml', '.css', '.scss',
    '.html', '.xml', '.sql', '.sh', '.bash',
];

const MAX_FILE_SIZE = 100000; // 100KB max for content fetching

function scheduleBackground(c: Context, task: Promise<void>): void {
    const guarded = task.catch((err) => {
        logger.error({ err }, 'Background ingestion failed');
    });

    // Try to use Cloudflare Workers waitUntil if available
    try {
        if (c.executionCtx?.waitUntil) {
            c.executionCtx.waitUntil(guarded);
            return;
        }
    } catch (err) {
        // executionCtx access failed, fall through to Node.js mode
    }

    // Node.js: just run the task in the background
    guarded.then(() => {
        logger.info('Background ingestion completed');
    });
}

/**
 * GET /api/repos - List all cached repositories
 */
repos.get('/', async (c) => {
    const requestLogger = logger.child({ endpoint: '/api/repos' });
    const db = c.get('db');

    try {
        const repoList = await db
            .select()
            .from(repositories)
            .orderBy(desc(repositories.lastFetched));

        requestLogger.info({ count: repoList.length }, 'Repositories fetched');
        return c.json({ repositories: repoList });
    } catch (error) {
        requestLogger.error({ error, errorMessage: error instanceof Error ? error.message : 'Unknown error' }, 'Error fetching repositories');
        return c.json({ error: 'Failed to fetch repositories' }, 500);
    }
});

/**
 * POST /api/repos - Fetch and cache a new repository (non-blocking background processing)
 */
repos.post('/', async (c) => {
    const requestLogger = logger.child({ endpoint: '/api/repos' });
    const startTime = Date.now();
    const db = c.get('db');

    try {
        // Rate limiting
        const clientId = rateLimiter.getClientId(c.req.raw);
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.REPO_INGEST, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId }, 'Rate limit exceeded');
            return c.json(
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

        const rawBody = await c.req.json();

        // Validate and sanitize input
        const parseResult = ingestRepoSchema.safeParse(rawBody);
        if (!parseResult.success) {
            requestLogger.warn({ errors: parseResult.error.issues }, 'Validation failed');
            return c.json(
                {
                    error: 'Validation failed',
                    details: parseResult.error.issues,
                },
                400
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
            const existingRepo = existing[0];

            // Check if commits exist
            const commitCount = await db
                .select({ count: sql<number>`count(*)` })
                .from(commits)
                .where(eq(commits.repoId, existingRepo.id));

            const hasCommits = Number(commitCount[0]?.count || 0) > 0;

            if (hasCommits) {
                // Repo fully cached with commits
                const duration = Date.now() - startTime;
                await analytics.trackRepoIngest({
                    owner,
                    repo: repoName,
                    commitsCount: Number(commitCount[0]?.count),
                    cached: true,
                    duration,
                });

                requestLogger.info({ owner, repo: repoName, duration }, 'Repository already cached with commits');
                return c.json({ repository: existingRepo, cached: true });
            }

            // Repo exists but has no commits - trigger background fetch
            requestLogger.info({ owner, repo: repoName }, 'Repository cached but missing commits, fetching...');

            const jobId = crypto.randomUUID();
            const now = new Date();

            await db.insert(ingestJobs).values({
                jobId,
                url: sanitizedUrl,
                status: 'pending',
                progress: 0,
                createdAt: now,
                updatedAt: now,
            });

            // Fire-and-forget background processing
            scheduleBackground(
                c,
                processRepoIngestion({
                    jobId,
                    url: sanitizedUrl,
                    clientId,
                    db,
                })
            );

            return c.json({
                jobId,
                status: 'processing',
                message: 'Fetching commits for existing repository',
                repository: existingRepo,
            }, 202);
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

        // Fire-and-forget background processing
        scheduleBackground(
            c,
            processRepoIngestion({
                jobId,
                url: sanitizedUrl,
                clientId,
                db,
            })
        );

        requestLogger.info({ jobId, owner, repo: repoName }, 'Repository ingest started in background');

        return c.json({
            jobId,
            status: 'processing',
            message: 'Repository ingestion started in background',
        }, 202);

    } catch (error) {
        const duration = Date.now() - startTime;

        await analytics.trackRequest({
            endpoint: '/api/repos',
            method: 'POST',
            statusCode: 500,
            duration,
            clientId: rateLimiter.getClientId(c.req.raw),
        });

        requestLogger.error({ error, errorMessage: error instanceof Error ? error.message : 'Unknown error', duration }, 'Error creating repository');

        return c.json(
            { error: 'Failed to fetch repository. Please try again later.' },
            500
        );
    }
});

/**
 * GET /api/repos/:id/commits - List commits for a repository
 */
repos.get('/:id/commits', async (c) => {
    const requestLogger = logger.child({ endpoint: '/api/repos/[id]/commits' });
    const db = c.get('db');

    try {
        const id = c.req.param('id');
        const repoId = parseInt(id, 10);

        if (isNaN(repoId)) {
            requestLogger.warn({ id }, 'Invalid repository ID');
            return c.json({ error: 'Invalid repository ID' }, 400);
        }

        // Parse pagination params from query string
        const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
        const limit = Math.min(
            PAGINATION.MAX_LIMIT,
            Math.max(1, parseInt(c.req.query('limit') || String(PAGINATION.DEFAULT_LIMIT), 10))
        );
        const offset = (page - 1) * limit;

        // Check if repo exists
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            requestLogger.warn({ repoId }, 'Repository not found');
            return c.json({ error: 'Repository not found' }, 404);
        }

        // Get total count
        const totalResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(commits)
            .where(eq(commits.repoId, repoId));
        const total = Number(totalResult[0]?.count || 0);

        // Fetch commits with pagination ordered by their position (oldest first)
        const repoCommits = await db
            .select()
            .from(commits)
            .where(eq(commits.repoId, repoId))
            .orderBy(asc(commits.order))
            .limit(limit)
            .offset(offset);

        requestLogger.info({ repoId, page, limit, total }, 'Commits fetched successfully');

        return c.json({
            repository: repo[0],
            commits: repoCommits,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: offset + limit < total,
                hasPrev: page > 1,
            },
        });
    } catch (error) {
        requestLogger.error({ error, errorMessage: error instanceof Error ? error.message : 'Unknown error' }, 'Error fetching commits');
        return c.json({ error: 'Failed to fetch commits' }, 500);
    }
});

/**
 * GET /api/repos/:id/commits/:sha - Get files at a specific commit
 */
repos.get('/:id/commits/:sha', async (c) => {
    const db = c.get('db');

    try {
        const id = c.req.param('id');
        const sha = c.req.param('sha');
        const repoId = parseInt(id, 10);

        if (isNaN(repoId)) {
            return c.json({ error: 'Invalid repository ID' }, 400);
        }

        // Get repo and commit info
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            return c.json({ error: 'Repository not found' }, 404);
        }

        const commit = await db
            .select()
            .from(commits)
            .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
            .limit(1);

        if (commit.length === 0) {
            return c.json({ error: 'Commit not found' }, 404);
        }

        // Check if we have cached files for this commit
        const cachedFiles = await db
            .select({
                id: files.id,
                path: files.path,
                size: files.size,
                language: files.language,
                hasContent: files.content,
            })
            .from(files)
            .where(eq(files.commitId, commit[0].id));

        if (cachedFiles.length > 0) {
            // Return metadata only (no content) to prevent stack overflow
            const fileList = cachedFiles.map(f => ({
                id: f.id,
                path: f.path,
                size: f.size,
                language: f.language,
                hasContent: !!f.hasContent,
            }));

            return c.json({
                commit: commit[0],
                files: fileList,
                cached: true,
            }, {
                headers: {
                    'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
                },
            });
        }

        // Fetch files from GitHub
        const { owner, name } = repo[0];
        const githubFiles = await fetchFilesAtCommit(owner, name, sha);

        // Filter to code files - but don't fetch content yet (lazy loading)
        const filesToSave = [];
        for (const file of githubFiles) {
            const ext = '.' + (file.path.split('.').pop() || '');
            const isCodeFile = CODE_EXTENSIONS.includes(ext.toLowerCase());
            const isSmallEnough = file.size <= MAX_FILE_SIZE;

            filesToSave.push({
                commitId: commit[0].id,
                path: file.path,
                content: null, // Content will be fetched lazily
                size: file.size,
                language: getLanguageFromPath(file.path),
                shouldFetchContent: isCodeFile && isSmallEnough,
            });
        }

        // Save file metadata to database (without content) in batches
        const dbFiles = filesToSave.map(f => ({
            commitId: f.commitId,
            path: f.path,
            content: null,
            size: f.size,
            language: f.language,
        }));

        if (dbFiles.length > 0) {
            const BATCH_SIZE = 10;
            for (let i = 0; i < dbFiles.length; i += BATCH_SIZE) {
                const batch = dbFiles.slice(i, i + BATCH_SIZE);
                await db.insert(files).values(batch);
            }
        }

        // Return file list with metadata only
        const fileList = filesToSave.map(f => ({
            path: f.path,
            size: f.size,
            language: f.language,
            hasContent: false,
            shouldFetchContent: f.shouldFetchContent,
        }));

        return c.json({
            commit: commit[0],
            files: fileList,
            cached: false,
        });
    } catch (error) {
        console.error('Error fetching files:', error);
        return c.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch files' },
            500
        );
    }
});

/**
 * GET /api/repos/:id/commits/:sha/content - Get file content (lazy loading)
 */
repos.get('/:id/commits/:sha/content', async (c) => {
    const db = c.get('db');

    try {
        const id = c.req.param('id');
        const sha = c.req.param('sha');
        const repoId = parseInt(id, 10);
        const filePath = c.req.query('path');

        if (isNaN(repoId)) {
            return c.json({ error: 'Invalid repository ID' }, 400);
        }

        if (!filePath) {
            return c.json({ error: 'File path is required' }, 400);
        }

        // Get repo info
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            return c.json({ error: 'Repository not found' }, 404);
        }

        // Get commit info
        const commit = await db
            .select()
            .from(commits)
            .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
            .limit(1);

        if (commit.length === 0) {
            return c.json({ error: 'Commit not found' }, 404);
        }

        // Check if we have cached content for this file
        const cachedFile = await db
            .select()
            .from(files)
            .where(and(eq(files.commitId, commit[0].id), eq(files.path, filePath)))
            .limit(1);

        if (cachedFile.length > 0 && cachedFile[0].content) {
            return c.json({
                path: cachedFile[0].path,
                content: cachedFile[0].content,
                language: cachedFile[0].language,
                cached: true,
            }, {
                headers: {
                    'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
                },
            });
        }

        // Fetch content from GitHub
        const { owner, name } = repo[0];
        const content = await fetchFileContent(owner, name, sha, filePath);

        if (content === null) {
            return c.json({ error: 'Failed to fetch file content' }, 404);
        }

        // Update cache in database
        if (cachedFile.length > 0) {
            await db
                .update(files)
                .set({ content })
                .where(eq(files.id, cachedFile[0].id));
        }

        return c.json({
            path: filePath,
            content,
            language: cachedFile[0]?.language || 'plaintext',
            cached: false,
        }, {
            headers: {
                'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
            },
        });
    } catch (error) {
        console.error('Error fetching file content:', error);
        return c.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch file content' },
            500
        );
    }
});

export default repos;
