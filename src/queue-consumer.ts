/**
 * Cloudflare Queue Consumer for background repository ingestion
 * This runs as a separate worker that processes queued repo ingest jobs
 */

import { getDb } from '@/lib/db';
import { repositories, commits, ingestJobs } from '@/db';
import { eq } from 'drizzle-orm';
import { fetchRepository, fetchReadme, fetchCommitHistory } from '@/services/github';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';

const queueLogger = logger.child({ service: 'queue-consumer' });

interface IngestMessage {
    jobId: string;
    url: string;
    clientId?: string;
}

export default {
    async queue(
        batch: MessageBatch<IngestMessage>,
        env: CloudflareEnv
    ): Promise<void> {
        const db = getDb();

        for (const message of batch.messages) {
            const { jobId, url } = message.body;

            queueLogger.info({ jobId, url }, 'Processing ingest job');

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

                // Check if repo already exists
                const existing = await db
                    .select()
                    .from(repositories)
                    .where(eq(repositories.url, sanitizedUrl))
                    .limit(1);

                let repoId: number;

                if (existing.length > 0) {
                    repoId = existing[0].id;
                    queueLogger.info({ jobId, repoId }, 'Repository already exists');

                    // Update job as completed
                    await db
                        .update(ingestJobs)
                        .set({
                            status: 'completed',
                            repoId,
                            progress: 100,
                            updatedAt: new Date(),
                        })
                        .where(eq(ingestJobs.jobId, jobId));

                    message.ack();
                    continue;
                }

                // Fetch repository data
                queueLogger.info({ jobId, owner, repo: repoName }, 'Fetching repository from GitHub');
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
                queueLogger.info({ jobId }, 'Fetching commit history');
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

                repoId = newRepo.id;

                // Update progress
                await db
                    .update(ingestJobs)
                    .set({
                        progress: 80,
                        repoId,
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

                queueLogger.info(
                    { jobId, repoId, commitsCount: commitHistory.length },
                    'Repository ingestion completed'
                );

                message.ack();
            } catch (error) {
                queueLogger.error(
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

                // Retry if possible
                message.retry();
            }
        }
    },
};
