/**
 * Job retry system
 *
 * Provides retry logic with exponential backoff for failed background jobs.
 * Uses D1 database for tracking retry state (no Cloudflare Queues needed).
 */

import { ingestJobs } from '@/db';
import { eq, and, lt } from 'drizzle-orm';
import type { Database } from '@/db';
import { processRepoIngestion } from './ingest';
import { logger } from '@/lib/logger';

const retryLogger = logger.child({ service: 'job-retry' });

/**
 * Retry delays with exponential backoff
 * [5 minutes, 15 minutes, 1 hour]
 */
const RETRY_DELAYS = [
  5 * 60 * 1000,      // 5 minutes
  15 * 60 * 1000,     // 15 minutes
  60 * 60 * 1000,     // 1 hour
];

/**
 * Schedule a job for retry with exponential backoff
 *
 * @param db - Database instance
 * @param jobId - Job ID to retry
 * @param error - Error that caused the failure
 */
export async function scheduleJobRetry(
  db: Database,
  jobId: string,
  error: Error
): Promise<void> {
  try {
    // Get current job state
    const [job] = await db
      .select()
      .from(ingestJobs)
      .where(eq(ingestJobs.jobId, jobId))
      .limit(1);

    if (!job) {
      retryLogger.warn({ jobId }, 'Job not found for retry scheduling');
      return;
    }

    const retryCount = (job.retryCount || 0) + 1;
    const maxRetries = job.maxRetries || 3;

    // Check if max retries exceeded
    if (retryCount > maxRetries) {
      retryLogger.error({ jobId, retryCount, maxRetries }, 'Max retries exceeded');

      await db
        .update(ingestJobs)
        .set({
          status: 'failed',
          lastError: error.message,
          updatedAt: new Date(),
        })
        .where(eq(ingestJobs.jobId, jobId));

      return;
    }

    // Calculate next retry time with exponential backoff
    const delayIndex = Math.min(retryCount - 1, RETRY_DELAYS.length - 1);
    const delay = RETRY_DELAYS[delayIndex];
    const nextRetryAt = new Date(Date.now() + delay);

    retryLogger.info(
      { jobId, retryCount, maxRetries, nextRetryAt, delay },
      'Scheduling job retry'
    );

    // Update job for retry
    await db
      .update(ingestJobs)
      .set({
        status: 'pending', // Back to pending for retry
        retryCount,
        lastError: error.message,
        lastRetryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ingestJobs.jobId, jobId));
  } catch (retryError) {
    retryLogger.error({ error: retryError, jobId }, 'Failed to schedule retry');
  }
}

/**
 * Scan for failed jobs that need retry and process them
 *
 * Should be called periodically (e.g., via cron trigger or manual endpoint)
 *
 * @param db - Database instance
 * @returns Number of jobs retried
 */
export async function retryFailedJobs(db: Database): Promise<number> {
  try {
    const now = new Date();
    const retryThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

    // Find jobs that are pending and past their retry time
    const jobsToRetry = await db
      .select()
      .from(ingestJobs)
      .where(
        and(
          eq(ingestJobs.status, 'pending'),
          lt(ingestJobs.lastRetryAt, retryThreshold)
        )
      )
      .limit(10); // Process 10 at a time to avoid overwhelming

    retryLogger.info({ count: jobsToRetry.length, now }, 'Found jobs to retry');

    let retriedCount = 0;

    for (const job of jobsToRetry) {
      // Skip if retry count exceeds max
      if ((job.retryCount || 0) > (job.maxRetries || 3)) {
        retryLogger.warn({ jobId: job.jobId }, 'Skipping - max retries exceeded');

        await db
          .update(ingestJobs)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(ingestJobs.jobId, job.jobId));

        continue;
      }

      try {
        retryLogger.info(
          { jobId: job.jobId, retryCount: job.retryCount },
          'Retrying failed job'
        );

        // Execute the job directly (not using waitUntil in retry context)
        await processRepoIngestion({
          jobId: job.jobId,
          url: job.url,
          db,
        });

        retriedCount++;
      } catch (error) {
        retryLogger.error({ error, jobId: job.jobId }, 'Retry failed');

        // Schedule another retry
        await scheduleJobRetry(db, job.jobId, error as Error);
      }
    }

    retryLogger.info({ retriedCount }, 'Job retry batch complete');
    return retriedCount;
  } catch (error) {
    retryLogger.error({ error }, 'Failed to retry jobs');
    return 0;
  }
}

/**
 * Get retry statistics for monitoring
 *
 * @param db - Database instance
 * @returns Retry statistics
 */
export async function getRetryStats(db: Database) {
  try {
    const jobs = await db
      .select({
        status: ingestJobs.status,
        retryCount: ingestJobs.retryCount,
        lastError: ingestJobs.lastError,
      })
      .from(ingestJobs);

    const stats = {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      processing: jobs.filter((j) => j.status === 'processing').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      needsRetry: jobs.filter(
        (j) => j.status === 'pending' && (j.retryCount || 0) > 0
      ).length,
      maxRetriesExceeded: jobs.filter(
        (j) => j.status === 'failed' && (j.retryCount || 0) >= 3
      ).length,
    };

    return stats;
  } catch (error) {
    retryLogger.error({ error }, 'Failed to get retry stats');
    return null;
  }
}
