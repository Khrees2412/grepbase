/**
 * API route for fetching files at a specific commit
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, commits, repositories, files } from '@/db';
import { eq, and } from 'drizzle-orm';
import {
    fetchFilesAtCommit,
    fetchFileContent,
    getLanguageFromPath,
} from '@/services/github';

// File extensions we want to fetch content for
const CODE_EXTENSIONS = [
    '.js', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go', '.java',
    '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
    '.md', '.json', '.yaml', '.yml', '.toml', '.css', '.scss',
    '.html', '.xml', '.sql', '.sh', '.bash',
];

const MAX_FILE_SIZE = 100000; // 100KB max for content fetching

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sha: string }> }
) {
    try {
        const { id, sha } = await params;
        const repoId = parseInt(id, 10);

        if (isNaN(repoId)) {
            return NextResponse.json(
                { error: 'Invalid repository ID' },
                { status: 400 }
            );
        }

        // Get repo and commit info
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

        // Check if we have cached files for this commit
        const cachedFiles = await db
            .select()
            .from(files)
            .where(eq(files.commitId, commit[0].id));

        if (cachedFiles.length > 0) {
            return NextResponse.json({
                commit: commit[0],
                files: cachedFiles,
                cached: true,
            });
        }

        // Fetch files from GitHub
        const { owner, name } = repo[0];
        const githubFiles = await fetchFilesAtCommit(owner, name, sha);

        // Filter to code files and fetch content for small files
        const filesToSave = [];
        for (const file of githubFiles) {
            const ext = '.' + (file.path.split('.').pop() || '');
            const isCodeFile = CODE_EXTENSIONS.includes(ext.toLowerCase());
            const isSmallEnough = file.size <= MAX_FILE_SIZE;

            let content = null;
            if (isCodeFile && isSmallEnough) {
                content = await fetchFileContent(owner, name, sha, file.path);
            }

            filesToSave.push({
                commitId: commit[0].id,
                path: file.path,
                content,
                size: file.size,
                language: getLanguageFromPath(file.path),
            });
        }

        // Save to database
        if (filesToSave.length > 0) {
            await db.insert(files).values(filesToSave);
        }

        return NextResponse.json({
            commit: commit[0],
            files: filesToSave,
            cached: false,
        });
    } catch (error) {
        console.error('Error fetching files:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch files' },
            { status: 500 }
        );
    }
}
