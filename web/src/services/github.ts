/**
 * GitHub API service for fetching repository data
 * Uses the public GitHub API (no auth required for public repos)
 */

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubRepo {
    owner: string;
    name: string;
    description: string | null;
    stars: number;
    defaultBranch: string;
    url: string;
}

export interface GitHubCommit {
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    date: Date;
}

export interface GitHubFile {
    path: string;
    type: 'file' | 'dir';
    size: number;
    sha: string;
}

/**
 * Parse a GitHub URL to extract owner and repo name
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    // Handle various GitHub URL formats
    const patterns = [
        /github\.com\/([^\/]+)\/([^\/\?#]+)/,  // https://github.com/owner/repo
        /^([^\/]+)\/([^\/]+)$/,                 // owner/repo shorthand
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return {
                owner: match[1],
                repo: match[2].replace(/\.git$/, ''),
            };
        }
    }

    return null;
}

/**
 * Fetch repository metadata
 */
export async function fetchRepository(owner: string, repo: string): Promise<GitHubRepo> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Grepbase',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch repository: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return {
        owner: data.owner.login,
        name: data.name,
        description: data.description,
        stars: data.stargazers_count,
        defaultBranch: data.default_branch,
        url: data.html_url,
    };
}

/**
 * Fetch README content
 */
export async function fetchReadme(owner: string, repo: string): Promise<string | null> {
    try {
        const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`, {
            headers: {
                'Accept': 'application/vnd.github.v3.raw',
                'User-Agent': 'Grepbase',
            },
        });

        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}

/**
 * Fetch all commits for a repository (paginated, oldest first)
 */
export async function fetchCommitHistory(
    owner: string,
    repo: string,
    maxCommits: number = 100
): Promise<GitHubCommit[]> {
    const allCommits: GitHubCommit[] = [];
    let page = 1;
    const perPage = Math.min(100, maxCommits);

    while (allCommits.length < maxCommits) {
        const response = await fetch(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Grepbase',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch commits: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (data.length === 0) break;

        for (const commit of data) {
            allCommits.push({
                sha: commit.sha,
                message: commit.commit.message,
                authorName: commit.commit.author?.name || null,
                authorEmail: commit.commit.author?.email || null,
                date: new Date(commit.commit.author?.date || commit.commit.committer?.date),
            });
        }

        if (data.length < perPage) break;
        page++;
    }

    // Reverse to get oldest first (chronological order)
    return allCommits.reverse().slice(0, maxCommits);
}

/**
 * Fetch file tree at a specific commit
 */
export async function fetchFilesAtCommit(
    owner: string,
    repo: string,
    sha: string
): Promise<GitHubFile[]> {
    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
        {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Grepbase',
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return data.tree
        .filter((item: { type: string }) => item.type === 'blob')
        .map((item: { path: string; type: string; size: number; sha: string }) => ({
            path: item.path,
            type: 'file' as const,
            size: item.size || 0,
            sha: item.sha,
        }));
}

/**
 * Fetch content of a specific file at a commit
 */
export async function fetchFileContent(
    owner: string,
    repo: string,
    sha: string,
    path: string
): Promise<string | null> {
    try {
        const response = await fetch(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${sha}`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3.raw',
                    'User-Agent': 'Grepbase',
                },
            }
        );

        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}

/**
 * Fetch diff between two commits
 */
export async function fetchCommitDiff(
    owner: string,
    repo: string,
    sha: string
): Promise<string | null> {
    try {
        const response = await fetch(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${sha}`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3.diff',
                    'User-Agent': 'Grepbase',
                },
            }
        );

        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}

/**
 * Get language for a file based on extension
 */
export function getLanguageFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        'js': 'javascript',
        'jsx': 'jsx',
        'ts': 'typescript',
        'tsx': 'tsx',
        'py': 'python',
        'rs': 'rust',
        'go': 'go',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'h': 'c',
        'hpp': 'cpp',
        'rb': 'ruby',
        'php': 'php',
        'swift': 'swift',
        'kt': 'kotlin',
        'md': 'markdown',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'toml': 'toml',
        'css': 'css',
        'scss': 'scss',
        'html': 'html',
        'xml': 'xml',
        'sql': 'sql',
        'sh': 'bash',
        'bash': 'bash',
        'zsh': 'bash',
    };
    return langMap[ext] || 'plaintext';
}
