/**
 * API routes for repository management
 * POST - Fetch and cache a new repository
 * GET - List all cached repositories
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { repositories, commits } from '@/db';
import { eq, desc } from 'drizzle-orm';
import {
    parseGitHubUrl,
    fetchRepository,
    fetchReadme,
    fetchCommitHistory,
} from '@/services/github';

export const runtime = 'edge';

export async function GET() {
    try {
        const db = getDb();
        const repos = await db
            .select()
            .from(repositories)
            .orderBy(desc(repositories.lastFetched));

        return NextResponse.json({ repositories: repos });
    } catch (error) {
        console.error('Error fetching repositories:', error);
        return NextResponse.json(
            { error: 'Failed to fetch repositories' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const db = getDb();
        const body = await request.json() as { url: string };
        const { url } = body;

        if (!url) {
            return NextResponse.json(
                { error: 'GitHub URL is required' },
                { status: 400 }
            );
        }

        // Parse the GitHub URL
        const parsed = parseGitHubUrl(url);
        if (!parsed) {
            return NextResponse.json(
                { error: 'Invalid GitHub URL format' },
                { status: 400 }
            );
        }

        const { owner, repo: repoName } = parsed;

        // Check if repo already exists
        const existing = await db
            .select()
            .from(repositories)
            .where(eq(repositories.url, `https://github.com/${owner}/${repoName}`))
            .limit(1);

        if (existing.length > 0) {
            // Return existing repo
            return NextResponse.json({ repository: existing[0], cached: true });
        }

        // Fetch repository data from GitHub
        console.log(`Fetching repository: ${owner}/${repoName}`);
        const repoData = await fetchRepository(owner, repoName);
        const readme = await fetchReadme(owner, repoName);

        // Fetch commit history
        console.log('Fetching commit history...');
        const commitHistory = await fetchCommitHistory(owner, repoName, 100);

        // Save to database
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

        console.log(`Saved ${commitHistory.length} commits`);

        return NextResponse.json({
            repository: newRepo,
            commitsCount: commitHistory.length,
            cached: false,
        });
    } catch (error) {
        console.error('Error creating repository:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch repository' },
            { status: 500 }
        );
    }
}
