/**
 * API route for AI explanations (streaming) - Hono format
 */

import { Hono } from 'hono';
import { repositories, commits } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { fetchCommitDiff } from '@/services/github';
import { explainCommit, explainProject, answerQuestion } from '@/services/explain';
import type { AIProviderConfig } from '@/services/ai-providers';
import { explainRequestSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS, AI_CONSTANTS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import type { Database } from '@/db';

type Variables = {
    db: Database;
};

const explain = new Hono<{ Variables: Variables }>();

function getClientIdFromHeaders(headers: Headers): string {
    const cfConnectingIp = headers.get('cf-connecting-ip');
    if (cfConnectingIp) return cfConnectingIp;

    const xForwardedFor = headers.get('x-forwarded-for');
    if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

    const xRealIp = headers.get('x-real-ip');
    if (xRealIp) return xRealIp;

    return 'unknown';
}

explain.post('/', async (c) => {
    const requestLogger = logger.child({ endpoint: '/api/explain' });
    const startTime = Date.now();

    try {
        const clientId = getClientIdFromHeaders(c.req.raw.headers);
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.EXPLAIN_API, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId, remaining: rateLimitResult.remaining }, 'Rate limit exceeded');

            await analytics.trackRateLimit({
                endpoint: '/api/explain',
                clientId,
                blocked: true,
            });

            return c.json(
                {
                    error: 'Rate limit exceeded',
                    limit: rateLimitResult.limit,
                    reset: rateLimitResult.reset,
                },
                429,
                {
                    'X-RateLimit-Limit': rateLimitResult.limit.toString(),
                    'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                    'X-RateLimit-Reset': rateLimitResult.reset.toString(),
                }
            );
        }

        await analytics.trackRateLimit({
            endpoint: '/api/explain',
            clientId,
            blocked: false,
        });

        const db = c.get('db');
        const rawBody = await c.req.json();

        const parseResult = explainRequestSchema.safeParse(rawBody);
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

        const body = parseResult.data;
        const {
            type,
            repoId,
            commitSha,
            question,
            provider,
            providerType,
            commits: dayCommits,
            projectName,
            projectOwner,
            apiKey,
            model,
            baseUrl,
        } = body;

        const providerConfig: AIProviderConfig = {
            type: provider?.type ?? providerType!,
            apiKey: provider?.apiKey || apiKey,
            baseUrl: provider?.baseUrl || baseUrl,
            model: provider?.model || model,
        };

        requestLogger.info({ type, repoId, provider: providerConfig.type }, 'Processing explain request');

        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            requestLogger.warn({ repoId }, 'Repository not found');
            return c.json({ error: 'Repository not found' }, 404);
        }

        // Use count query instead of loading all commits (performance fix)
        const commitCountResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(commits)
            .where(eq(commits.repoId, repoId));

        const totalCommits = Number(commitCountResult[0]?.count || 0);

        const projectContext = {
            name: repo[0].name,
            description: repo[0].description,
            readme: repo[0].readme,
            totalCommits,
            currentCommitIndex: 0,
        };

        let result;

        if (type === 'project') {
            result = await explainProject(projectContext, providerConfig);
        } else if (type === 'commit' && commitSha) {
            const commit = await db
                .select()
                .from(commits)
                .where(and(eq(commits.repoId, repoId), eq(commits.sha, commitSha)))
                .limit(1);

            if (commit.length === 0) {
                requestLogger.warn({ repoId, commitSha }, 'Commit not found');
                return c.json({ error: 'Commit not found' }, 404);
            }

            const diff = await fetchCommitDiff(repo[0].owner, repo[0].name, commitSha);

            const commitContext = {
                sha: commit[0].sha,
                message: commit[0].message,
                authorName: commit[0].authorName,
                date: commit[0].date,
                diff,
                filesChanged: [],
            };

            projectContext.currentCommitIndex = commit[0].order;

            result = await explainCommit(commitContext, projectContext, providerConfig);
        } else if (type === 'question' && question) {
            let commitContext;
            if (commitSha) {
                const commit = await db
                    .select()
                    .from(commits)
                    .where(and(eq(commits.repoId, repoId), eq(commits.sha, commitSha)))
                    .limit(1);

                if (commit.length > 0) {
                    commitContext = {
                        sha: commit[0].sha,
                        message: commit[0].message,
                        authorName: commit[0].authorName,
                        date: commit[0].date,
                        diff: null,
                        filesChanged: [],
                    };
                    projectContext.currentCommitIndex = commit[0].order;
                }
            }

            result = await answerQuestion(
                question,
                { commit: commitContext, project: projectContext },
                providerConfig
            );
        } else if (type === 'day-summary' && dayCommits && dayCommits.length > 0) {
            const { streamText } = await import('ai');
            const { createAIProviderAsync } = await import('@/services/ai-providers');

            const aiModel = await createAIProviderAsync(providerConfig);

            const commitsList = dayCommits.map((c: { sha: string; message: string; authorName: string | null; date: string }) =>
                `• ${c.sha?.substring(0, 7) || 'unknown'}: ${c.message?.split('\n')[0] || 'No message'} (by ${c.authorName || 'Unknown'})`
            ).join('\n');

            const systemPrompt = `You are an expert code reviewer helping developers understand commit activity.
Your job is to summarize what happened in a repository on a specific day.
Be concise but insightful. Focus on the narrative - what was the developer trying to accomplish?`;

            const userPrompt = `Summarize the following commits from ${projectOwner || 'a repository'}/${projectName || 'repo'}:

${commitsList}

Provide a brief, engaging summary of what was accomplished. Use markdown formatting.`;

            result = streamText({
                model: aiModel,
                system: systemPrompt,
                prompt: userPrompt,
                maxOutputTokens: AI_CONSTANTS.MAX_OUTPUT_TOKENS.DAY_SUMMARY,
            });
        } else {
            requestLogger.warn({ type }, 'Invalid request type');
            return c.json({ error: 'Invalid request type' }, 400);
        }

        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({
            provider: providerConfig.type,
            model: providerConfig.model,
            type,
            success: true,
            duration,
        });

        await analytics.trackRequest({
            endpoint: '/api/explain',
            method: 'POST',
            statusCode: 200,
            duration,
            clientId,
        });

        requestLogger.info({ type, repoId, duration }, 'Explanation generated successfully');
        return result.toTextStreamResponse();
    } catch (error) {
        const duration = Date.now() - startTime;
        const clientId = getClientIdFromHeaders(c.req.raw.headers);

        await analytics.trackRequest({
            endpoint: '/api/explain',
            method: 'POST',
            statusCode: 500,
            duration,
            clientId,
        });

        requestLogger.error({ error, errorMessage: error instanceof Error ? error.message : 'Unknown error', duration }, 'Error generating explanation');
        return c.json(
            {
                error: error instanceof Error ? error.message : 'Failed to generate explanation',
            },
            500
        );
    }
});

export default explain;
