import { Hono } from 'hono';
import { ingestJobs, repositories } from '@/db';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { retryFailedJobs, getRetryStats } from '@/services/job-retry';
import type { Database } from '@/db';

type Variables = {
    db: Database;
};

const jobs = new Hono<{ Variables: Variables }>();

// GET /jobs/:jobId - Get job status
jobs.get('/:jobId', async (c) => {
  const requestLogger = logger.child({ endpoint: '/api/jobs/:jobId' });
  const jobId = c.req.param('jobId');
  const db = c.get('db');

  try {

    const job = await db
      .select()
      .from(ingestJobs)
      .where(eq(ingestJobs.jobId, jobId))
      .limit(1);

    if (job.length === 0) {
      requestLogger.warn({ jobId }, 'Job not found');
      return c.json({ error: 'Job not found' }, 404);
    }

    const jobData = job[0];

    if (jobData.status === 'completed' && jobData.repoId) {
      const repo = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, jobData.repoId))
        .limit(1);

      return c.json({
        jobId: jobData.jobId,
        status: jobData.status,
        progress: jobData.progress,
        totalCommits: jobData.totalCommits,
        processedCommits: jobData.processedCommits,
        repository: repo[0] || null,
        error: jobData.error,
        updatedAt: jobData.updatedAt,
      });
    }

    return c.json({
      jobId: jobData.jobId,
      status: jobData.status,
      progress: jobData.progress,
      totalCommits: jobData.totalCommits,
      processedCommits: jobData.processedCommits,
      error: jobData.error,
      updatedAt: jobData.updatedAt,
    });
  } catch (error) {
    requestLogger.error(
      { error, errorMessage: error instanceof Error ? error.message : 'Unknown error' },
      'Error fetching job status'
    );
    return c.json({ error: 'Failed to fetch job status' }, 500);
  }
});

// POST /jobs/retry - Retry failed jobs
jobs.post('/retry', async (c) => {
  const requestLogger = logger.child({ endpoint: '/api/jobs/retry' });
  const startTime = Date.now();
  const db = c.get('db');

  try {

    const retriedCount = await retryFailedJobs(db);
    const stats = await getRetryStats(db);
    const duration = Date.now() - startTime;

    requestLogger.info({ retriedCount, stats, duration }, 'Jobs retried successfully');

    return c.json({
      success: true,
      retriedCount,
      stats,
      duration,
      message: `Retried ${retriedCount} failed jobs`,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ error, duration }, 'Failed to retry jobs');

    return c.json(
      {
        success: false,
        error: 'Failed to retry jobs',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// GET /jobs/retry - Get retry statistics
jobs.get('/retry', async (c) => {
  const requestLogger = logger.child({ endpoint: '/api/jobs/retry' });
  const db = c.get('db');

  try {
    const stats = await getRetryStats(db);

    requestLogger.debug({ stats }, 'Retry stats retrieved');

    return c.json({
      success: true,
      stats,
    });
  } catch (error) {
    requestLogger.error({ error }, 'Failed to get retry stats');

    return c.json(
      {
        success: false,
        error: 'Failed to get retry stats',
      },
      500
    );
  }
});

export default jobs;
