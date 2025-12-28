/**
 * API route for fetching commits for a specific repository
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, commits, repositories } from '@/db';
import { eq, asc } from 'drizzle-orm';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const repoId = parseInt(id, 10);

        if (isNaN(repoId)) {
            return NextResponse.json(
                { error: 'Invalid repository ID' },
                { status: 400 }
            );
        }

        // Check if repo exists
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

        // Fetch commits ordered by their position (oldest first)
        const repoCommits = await db
            .select()
            .from(commits)
            .where(eq(commits.repoId, repoId))
            .orderBy(asc(commits.order));

        return NextResponse.json({
            repository: repo[0],
            commits: repoCommits,
        });
    } catch (error) {
        console.error('Error fetching commits:', error);
        return NextResponse.json(
            { error: 'Failed to fetch commits' },
            { status: 500 }
        );
    }
}
