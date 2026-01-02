/**
 * API route for fetching file content (lazy loading)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { commits, repositories, files } from '@/db';
import { eq, and } from 'drizzle-orm';
import { fetchFileContent } from '@/services/github';

export const runtime = 'edge';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    try {
        const db = getDb();
        const { id, sha } = await params;
        const repoId = parseInt(id, 10);
        const filePath = request.nextUrl.searchParams.get('path');

        if (isNaN(repoId)) {
            return NextResponse.json(
                { error: 'Invalid repository ID' },
                { status: 400 }
            );
        }

        if (!filePath) {
            return NextResponse.json(
                { error: 'File path is required' },
                { status: 400 }
            );
        }

        // Get repo info
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, repoId))
            .limit(1);

        if (repo.length === 0) {
            return NextResponse.json(
                { error: 'Repository not found' },
                { status: 404 }
            );
        }

        // Get commit info
        const commit = await db
            .select()
            .from(commits)
            .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
            .limit(1);

        if (commit.length === 0) {
            return NextResponse.json(
                { error: 'Commit not found' },
                { status: 404 }
            );
        }

        // Check if we have cached content for this file
        const cachedFile = await db
            .select()
            .from(files)
            .where(and(eq(files.commitId, commit[0].id), eq(files.path, filePath)))
            .limit(1);

        if (cachedFile.length > 0 && cachedFile[0].content) {
            return NextResponse.json({
                path: cachedFile[0].path,
                content: cachedFile[0].content,
                language: cachedFile[0].language,
                cached: true,
            }, {
                headers: {
                    'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
                },
            });
        }

        // Fetch content from GitHub
        const { owner, name } = repo[0];
        const content = await fetchFileContent(owner, name, sha, filePath);

        if (content === null) {
            return NextResponse.json(
                { error: 'Failed to fetch file content' },
                { status: 404 }
            );
        }

        // Update cache in database
        if (cachedFile.length > 0) {
            await db
                .update(files)
                .set({ content })
                .where(eq(files.id, cachedFile[0].id));
        }

        return NextResponse.json({
            path: filePath,
            content,
            language: cachedFile[0]?.language || 'plaintext',
            cached: false,
        }, {
            headers: {
                'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
            },
        });
    } catch (error) {
        console.error('Error fetching file content:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch file content' },
            { status: 500 }
        );
    }
}
