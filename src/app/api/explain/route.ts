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

export const runtime = 'edge';

export async function POST(request: NextRequest) {
    try {
        const db = getDb();
        const body = await request.json() as {
            type: 'commit' | 'project' | 'question' | 'day-summary';
            repoId: number;
            commitSha?: string;
            question?: string;
            provider?: AIProviderConfig;
            commits?: Array<{ sha: string; message: string; authorName: string | null; date: string }>;
            projectName?: string;
            projectOwner?: string;
            apiKey?: string;
            model?: string;
            baseUrl?: string;
        };
        const {
            type,
            repoId,
            commitSha,
            question,
            provider,
            commits: dayCommits,
            projectName,
            projectOwner,
            apiKey,
            model,
            baseUrl,
        } = body;

        // Validate provider config (local providers don't need API keys)
        const isLocalProvider = provider?.type === 'ollama' || provider?.type === 'lmstudio';
        if (!provider?.type || (!provider?.apiKey && !isLocalProvider)) {
            return new Response(
                JSON.stringify({ error: 'AI provider configuration is required' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Handle provider config - can come from nested object or flat params
        const providerType = provider?.type || body.provider;
        const providerApiKey = provider?.apiKey || apiKey;
        const providerBaseUrl = provider?.baseUrl || baseUrl;
        const providerModel = provider?.model || model;

        const providerConfig: AIProviderConfig = {
            type: providerType,
            apiKey: providerApiKey,
            baseUrl: providerBaseUrl,
            model: providerModel,
        };

        // Get repository info
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
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
                maxOutputTokens: 800,
            });
        } else {
            return new Response(
                JSON.stringify({ error: 'Invalid request type' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Return streaming response
        return result.toTextStreamResponse();
    } catch (error) {
        console.error('Error generating explanation:', error);
        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : 'Failed to generate explanation',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
