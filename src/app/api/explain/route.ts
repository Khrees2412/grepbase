/**
 * API route for AI explanations (streaming)
 */

import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { repositories, commits } from '@/db';
import { eq, and } from 'drizzle-orm';
import { fetchCommitDiff } from '@/services/github';
import { explainCommit, explainProject, answerQuestion } from '@/services/explain';
import type { AIProviderConfig } from '@/services/ai-providers';
import { explainRequestSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rate-limit';
import { RATE_LIMITS, AI_CONSTANTS } from '@/lib/constants';
import { analytics } from '@/lib/analytics';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
    const requestLogger = logger.child({ endpoint: '/api/explain' });
    const startTime = Date.now();

    try {
        // Rate limiting
        const clientId = rateLimiter.getClientId(request);
        const rateLimitResult = await rateLimiter.checkLimit(clientId, RATE_LIMITS.EXPLAIN_API, 60);

        if (!rateLimitResult.success) {
            requestLogger.warn({ clientId, remaining: rateLimitResult.remaining }, 'Rate limit exceeded');

            // Track rate limit event
            await analytics.trackRateLimit({
                endpoint: '/api/explain',
                clientId,
                blocked: true,
            });

            return new Response(
                JSON.stringify({
                    error: 'Rate limit exceeded',
                    limit: rateLimitResult.limit,
                    reset: rateLimitResult.reset,
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
                        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
                    },
                }
            );
        }

        // Track successful rate limit check
        await analytics.trackRateLimit({
            endpoint: '/api/explain',
            clientId,
            blocked: false,
        });

        const db = getDb();
        const rawBody = await request.json();

        // Validate request with Zod
        const parseResult = explainRequestSchema.safeParse(rawBody);
        if (!parseResult.success) {
            requestLogger.warn({ errors: parseResult.error.issues }, 'Validation failed');
            return new Response(
                JSON.stringify({
                    error: 'Validation failed',
                    details: parseResult.error.issues,
                }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
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

        // Handle provider config - can come from nested object or flat params
        // The schema validates that either provider.type or providerType exists
        const providerConfig: AIProviderConfig = {
            type: provider?.type ?? providerType!,
            apiKey: provider?.apiKey || apiKey,
            baseUrl: provider?.baseUrl || baseUrl,
            model: provider?.model || model,
        };

        requestLogger.info({ type, repoId, provider: providerConfig.type }, 'Processing explain request');

        // Get repository info
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            requestLogger.warn({ repoId }, 'Repository not found');
            return new Response(
                JSON.stringify({ error: 'Repository not found' }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Get commit count
        const allCommits = await db
            .select()
            .from(commits)
            .where(eq(commits.repoId, repoId));

        const projectContext = {
            name: repo[0].name,
            description: repo[0].description,
            readme: repo[0].readme,
            totalCommits: allCommits.length,
            currentCommitIndex: 0,
        };

        let result;

        if (type === 'project') {
            // Explain the entire project
            result = await explainProject(projectContext, providerConfig);
        } else if (type === 'commit' && commitSha) {
            // Explain a specific commit
            const commit = await db
                .select()
                .from(commits)
                .where(and(eq(commits.repoId, repoId), eq(commits.sha, commitSha)))
                .limit(1);

            if (commit.length === 0) {
                requestLogger.warn({ repoId, commitSha }, 'Commit not found');
                return new Response(
                    JSON.stringify({ error: 'Commit not found' }),
                    { status: 404, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // Fetch diff from GitHub
            const diff = await fetchCommitDiff(repo[0].owner, repo[0].name, commitSha);

            const commitContext = {
                sha: commit[0].sha,
                message: commit[0].message,
                authorName: commit[0].authorName,
                date: commit[0].date,
                diff,
                filesChanged: [], // We could extract this from diff if needed
            };

            projectContext.currentCommitIndex = commit[0].order;

            result = await explainCommit(commitContext, projectContext, providerConfig);
        } else if (type === 'question' && question) {
            // Answer a question
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
            // Generate summary for all commits on a specific day
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
            return new Response(
                JSON.stringify({ error: 'Invalid request type' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Track AI usage
        const duration = Date.now() - startTime;
        await analytics.trackAIUsage({
            provider: providerConfig.type,
            model: providerConfig.model,
            type,
            success: true,
            duration,
        });

        // Track request
        await analytics.trackRequest({
            endpoint: '/api/explain',
            method: 'POST',
            statusCode: 200,
            duration,
            clientId: rateLimiter.getClientId(request),
        });

        // Return streaming response
        requestLogger.info({ type, repoId, duration }, 'Explanation generated successfully');
        return result.toTextStreamResponse();
    } catch (error) {
        const duration = Date.now() - startTime;

        // Track failed request
        await analytics.trackRequest({
            endpoint: '/api/explain',
            method: 'POST',
            statusCode: 500,
            duration,
            clientId: rateLimiter.getClientId(request),
        });

        requestLogger.error({ error, errorMessage: error instanceof Error ? error.message : 'Unknown error', duration }, 'Error generating explanation');
        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : 'Failed to generate explanation',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
