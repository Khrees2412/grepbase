/**
 * Background repository ingestion service
 * Uses waitUntil() for non-blocking processing on Cloudflare free tier
 */

import { repositories, commits, ingestJobs } from '@/db';
import { eq, sql } from 'drizzle-orm';
import { fetchRepository, fetchReadme, fetchCommitHistory } from '@/services/github';
import { parseGitHubUrl, sanitizeGitHubUrl } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import type { Database } from '@/db';
import { ingestFilesForCommit } from './file-ingest';
import { scheduleJobRetry } from './job-retry';

const ingestLogger = logger.child({ service: 'ingest' });

export interface IngestJobParams {
    jobId: string;
    url: string;
    clientId?: string;
    db: Database;  // Database must be passed in since getRequestContext() isn't available in waitUntil()
}

/**
 * Process repository ingestion in the background
 * This function should be called via ctx.waitUntil() for non-blocking execution
 * IMPORTANT: The database must be passed in as getRequestContext() is not available inside waitUntil()
 */
export async function processRepoIngestion(params: IngestJobParams): Promise<void> {
    const { jobId, url, db } = params;

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
            const existingRepo = existing[0];

            // Check if commits exist for this repo
            const existingCommits = await db
                .select({ count: sql<number>`count(*)` })
                .from(commits)
                .where(eq(commits.repoId, existingRepo.id));

            const commitCount = Number(existingCommits[0]?.count || 0);

            if (commitCount > 0) {
                // Repo and commits exist, we're done
                ingestLogger.info({ jobId, repoId: existingRepo.id, commitCount }, 'Repository already exists with commits');
                await db
                    .update(ingestJobs)
                    .set({
                        status: 'completed',
                        repoId: existingRepo.id,
                        progress: 100,
                        processedCommits: commitCount,
                        updatedAt: new Date(),
                    })
                    .where(eq(ingestJobs.jobId, jobId));
                return;
            }

            // Repo exists but no commits - fetch and store commits
            ingestLogger.info({ jobId, repoId: existingRepo.id }, 'Repository exists but has no commits, fetching...');

            await db
                .update(ingestJobs)
                .set({
                    progress: 40,
                    repoId: existingRepo.id,
                    updatedAt: new Date(),
                })
                .where(eq(ingestJobs.jobId, jobId));

            // Fetch commit history
            const commitHistory = await fetchCommitHistory(owner, repoName, 100);

            if (commitHistory.length > 0) {
                // Insert commits in batches of 10 to avoid D1 limits
                const BATCH_SIZE = 10;
                for (let i = 0; i < commitHistory.length; i += BATCH_SIZE) {
                    const batch = commitHistory.slice(i, i + BATCH_SIZE);
                    try {
                        await db.insert(commits).values(
                            batch.map((commit, batchIndex) => ({
                                repoId: existingRepo.id,
                                sha: commit.sha,
                                message: commit.message,
                                authorName: commit.authorName,
                                authorEmail: commit.authorEmail,
                                date: new Date(commit.date),
                                order: i + batchIndex + 1,
                            }))
                        );
                        ingestLogger.debug({ jobId, batch: Math.floor(i / BATCH_SIZE) + 1, count: batch.length }, 'Commit batch inserted');
                    } catch (insertError) {
                        ingestLogger.error(
                            { jobId, batch: Math.floor(i / BATCH_SIZE) + 1, error: insertError instanceof Error ? insertError.message : 'Unknown insert error' },
                            'Failed to insert commit batch'
                        );
                        throw insertError; // Re-throw to trigger job failure
                    }
                }
            }

            await db
                .update(ingestJobs)
                .set({
                    status: 'completed',
                    repoId: existingRepo.id,
                    progress: 100,
                    totalCommits: commitHistory.length,
                    processedCommits: commitHistory.length,
                    updatedAt: new Date(),
                })
                .where(eq(ingestJobs.jobId, jobId));

            ingestLogger.info(
                { jobId, repoId: existingRepo.id, commitsCount: commitHistory.length },
                'Commits fetched for existing repository'
            );
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

        // Save commits in batches
        if (commitHistory.length > 0) {
            const BATCH_SIZE = 10;
            for (let i = 0; i < commitHistory.length; i += BATCH_SIZE) {
                const batch = commitHistory.slice(i, i + BATCH_SIZE);
                try {
                    await db.insert(commits).values(
                        batch.map((commit, batchIndex) => ({
                            repoId: newRepo.id,
                            sha: commit.sha,
                            message: commit.message,
                            authorName: commit.authorName,
                            authorEmail: commit.authorEmail,
                            date: new Date(commit.date),
                            order: i + batchIndex + 1,
                        }))
                    );
                    ingestLogger.debug({ jobId, batch: Math.floor(i / BATCH_SIZE) + 1, count: batch.length }, 'Commit batch inserted');
                } catch (insertError) {
                    ingestLogger.error(
                        { jobId, batch: Math.floor(i / BATCH_SIZE) + 1, error: insertError instanceof Error ? insertError.message : 'Unknown insert error' },
                        'Failed to insert commit batch'
                    );
                    throw insertError;
                }
            }
        }

        // Update progress to 80% (commits done, starting files)
        await db
            .update(ingestJobs)
            .set({
                progress: 80,
                updatedAt: new Date(),
            })
            .where(eq(ingestJobs.jobId, jobId));

        // Ingest file content for each commit
        ingestLogger.info({ jobId, repoId: newRepo.id }, 'Starting file content ingestion');

        let totalFilesIngested = 0;
        let totalDbFiles = 0;
        let totalR2Files = 0;

        for (let i = 0; i < commitHistory.length; i++) {
            const commit = commitHistory[i];

            // Get commit ID from database
            const [dbCommit] = await db
                .select()
                .from(commits)
                .where(eq(commits.sha, commit.sha))
                .limit(1);

            if (!dbCommit) {
                ingestLogger.warn({ jobId, sha: commit.sha }, 'Commit not found in database, skipping file ingestion');
                continue;
            }

            try {
                const fileResult = await ingestFilesForCommit(
                    db,
                    dbCommit.id,
                    owner,
                    repoName,
                    commit.sha
                );

                totalFilesIngested += fileResult.ingestedFiles;
                totalDbFiles += fileResult.dbStoredFiles;
                totalR2Files += fileResult.r2StoredFiles;

                // Update progress (commits are 80%, files are 80-100%)
                const fileProgress = 80 + Math.floor((i / commitHistory.length) * 20);
                await db
                    .update(ingestJobs)
                    .set({
                        progress: fileProgress,
                        updatedAt: new Date(),
                    })
                    .where(eq(ingestJobs.jobId, jobId));

                ingestLogger.debug(
                    { jobId, sha: commit.sha, filesIngested: fileResult.ingestedFiles },
                    'Files ingested for commit'
                );
            } catch (fileError) {
                ingestLogger.error(
                    { error: fileError, jobId, commitId: dbCommit.id, sha: commit.sha },
                    'File ingestion failed for commit - continuing with next commit'
                );
                // Continue with next commit - don't fail entire job for one commit's files
            }
        }

        ingestLogger.info(
            { jobId, totalFilesIngested, totalDbFiles, totalR2Files },
            'File content ingestion completed'
        );

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
            { jobId, repoId: newRepo.id, commitsCount: commitHistory.length, filesCount: totalFilesIngested },
            'Repository ingestion completed'
        );
    } catch (error) {
        ingestLogger.error(
            { jobId, error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
            'Failed to process ingest job'
        );

        // Schedule retry instead of marking as failed immediately
        await scheduleJobRetry(db, jobId, error instanceof Error ? error : new Error('Unknown error'));
    }
}
