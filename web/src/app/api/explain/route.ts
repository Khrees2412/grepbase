/**
 * API route for AI explanations (streaming)
 */

import { NextRequest } from 'next/server';
import { db, repositories, commits } from '@/db';
import { eq, and } from 'drizzle-orm';
import { fetchCommitDiff } from '@/services/github';
import { explainCommit, explainProject, answerQuestion } from '@/services/explain';
import type { AIProviderConfig } from '@/services/ai-providers';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            type, // 'commit' | 'project' | 'question'
            repoId,
            commitSha,
            question,
            provider, // AIProviderConfig
        } = body;

        // Validate provider config (local providers don't need API keys)
        const isLocalProvider = provider?.type === 'ollama' || provider?.type === 'lmstudio';
        if (!provider?.type || (!provider?.apiKey && !isLocalProvider)) {
            return new Response(
                JSON.stringify({ error: 'AI provider configuration is required' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const providerConfig: AIProviderConfig = {
            type: provider.type,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: provider.model,
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
