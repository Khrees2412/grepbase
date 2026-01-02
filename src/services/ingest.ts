/**
 * Background repository ingestion service
 * Uses waitUntil() for non-blocking processing on Cloudflare free tier
 */

import { getDb } from '@/lib/db';
import { repositories, commits, ingestJobs } from '@/db';
import { eq } from 'drizzle-orm';
import { fetchRepository, fetchReadme, fetchCommitHistory } from '@/services/github';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';

const ingestLogger = logger.child({ service: 'ingest' });

export interface IngestJobParams {
    jobId: string;
    url: string;
    clientId?: string;
}

/**
 * Process repository ingestion in the background
 * This function should be called via ctx.waitUntil() for non-blocking execution
 */
export async function processRepoIngestion(params: IngestJobParams): Promise<void> {
    const { jobId, url } = params;
    const db = getDb();

    ingestLogger.info({ jobId, url }, 'Starting background ingestion');

    try {
        // Update job status to processing
        await db
            .update(ingestJobs)
            .set({
                status: 'processing',
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));

        // Sanitize and parse URL
        const sanitizedUrl = sanitizeGitHubUrl(url);
        const { owner, repo: repoName } = parseGitHubUrl(sanitizedUrl);

        // Check if repo already exists (race condition check)
        const existing = await db
            .select()
            .from(repositories)
            .where(eq(repositories.url, sanitizedUrl))
            .limit(1);

        if (existing.length > 0) {
            ingestLogger.info({ jobId, repoId: existing[0].id }, 'Repository already exists');
            await db
                .update(ingestJobs)
                .set({
                    status: 'completed',
                    repoId: existing[0].id,
                    progress: 100,
                    updatedAt: new Date(),
                })
                .where(eq(ingestJobs.jobId, jobId));
            return;
        }

        // Fetch repository data
        ingestLogger.info({ jobId, owner, repo: repoName }, 'Fetching repository from GitHub');
        const repoData = await fetchRepository(owner, repoName);
        const readme = await fetchReadme(owner, repoName);

        // Update progress
        await db
            .update(ingestJobs)
            .set({
                progress: 20,
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));

        // Fetch commit history
        ingestLogger.info({ jobId }, 'Fetching commit history');
        const commitHistory = await fetchCommitHistory(owner, repoName, 100);

        // Update progress
        await db
            .update(ingestJobs)
            .set({
                progress: 60,
                totalCommits: commitHistory.length,
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));

        // Save repository
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

        // Update progress
        await db
            .update(ingestJobs)
            .set({
                progress: 80,
                repoId: newRepo.id,
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));

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

        // Mark job as completed
        await db
            .update(ingestJobs)
            .set({
                status: 'completed',
                progress: 100,
                processedCommits: commitHistory.length,
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));

        ingestLogger.info(
            { jobId, repoId: newRepo.id, commitsCount: commitHistory.length },
            'Repository ingestion completed'
        );
    } catch (error) {
        ingestLogger.error(
            { jobId, error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Failed to process ingest job'
        );

        // Update job status to failed
        await db
            .update(ingestJobs)
            .set({
                status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));
    }
}
