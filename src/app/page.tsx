'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Github, Sparkles, ArrowRight, Clock, Star, Loader2, Settings } from 'lucide-react';
import styles from './page.module.css';
import SettingsModal from '@/components/SettingsModal';

interface Repository {
  id: number;
  url: string;
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  lastFetched: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const router = useRouter();

  /**
   * Validate GitHub repository URL in real-time
   * Accepts: github.com/owner/repo, https://github.com/owner/repo, owner/repo
   * Rejects: just usernames, random text, invalid formats
   */
  function validateRepoUrl(input: string): { valid: boolean; error: string | null } {
    const trimmed = input.trim();

    if (!trimmed) {
      return { valid: false, error: null }; // Empty is not an error, just not valid
    }

    // Normalize the input: remove protocol, www, trailing slashes, .git suffix
    let normalized = trimmed
      .replace(/^(https?:\/\/)?(www\.)?/i, '')
      .replace(/\.git\/?$/, '')
      .replace(/\/+$/, '');

    // Handle github.com/owner/repo format
    if (normalized.toLowerCase().startsWith('github.com/')) {
      normalized = normalized.substring('github.com/'.length);
    }

    // Now we should have owner/repo format
    const parts = normalized.split('/').filter(Boolean);

    // Check if it's just a username (single part)
    if (parts.length === 1) {
      // Check if it looks like a GitHub username
      if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(parts[0])) {
        return { valid: false, error: 'Please enter a repository, not just a username (e.g., owner/repo)' };
      }
      return { valid: false, error: 'Invalid format. Try: github.com/owner/repo or owner/repo' };
    }

    // Check for valid owner/repo format
    if (parts.length === 2) {
      const [owner, repo] = parts;

      // Validate owner (GitHub username rules)
      if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(owner)) {
        return { valid: false, error: 'Invalid repository owner name' };
      }

      // Validate repo name (GitHub repo rules - alphanumeric, hyphens, underscores, dots)
      if (!/^[a-zA-Z0-9._-]+$/.test(repo)) {
        return { valid: false, error: 'Invalid repository name' };
      }

      return { valid: true, error: null };
    }

    // More than 2 parts - might be a subdirectory path, not a repo URL
    if (parts.length > 2) {
      return { valid: false, error: 'Please enter just the repository URL, not a file path' };
    }

    return { valid: false, error: 'Invalid GitHub repository URL' };
  }

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newUrl = e.target.value;
    setUrl(newUrl);
    const result = validateRepoUrl(newUrl);
    setIsValid(result.valid);
    setValidationError(result.error);
    // Clear server error when user starts typing
    if (error) setError(null);
  }

  useEffect(() => {
    async function fetchRepositories() {
      try {
        const res = await fetch('/api/repos');
        const data = await res.json() as { repositories?: Repository[] };
        setRepositories(data.repositories || []);
      } catch (err) {
        console.error('Failed to fetch repositories:', err);
      }
    }
    fetchRepositories();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    setError(null);

    try {
      // Fetch or find the repository
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json() as {
        error?: string;
        repository?: Repository;
        jobId?: string;
        cached?: boolean;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch repository');
      }

      // If cached, navigate directly
      if (data.cached && data.repository) {
        router.push(`/explore/${data.repository.id}`);
        return;
      }

      // If job started, poll for completion then navigate
      if (data.jobId) {
        // Poll for job completion
        let attempts = 0;
        const maxAttempts = 60; // 2 minutes max

        const poll = async (): Promise<void> => {
          attempts++;
          const jobRes = await fetch(`/api/jobs/${data.jobId}`);
          const jobData = await jobRes.json() as {
            status: string;
            repository?: Repository;
            error?: string;
          };

          if (jobData.status === 'completed' && jobData.repository) {
            router.push(`/explore/${jobData.repository.id}`);
            return;
          } else if (jobData.status === 'failed') {
            throw new Error(jobData.error || 'Failed to fetch repository');
          } else if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return poll();
          } else {
            throw new Error('Repository fetch timed out');
          }
        };

        await poll();
        return;
      }

      // Fallback: direct repository response
      if (data.repository) {
        router.push(`/explore/${data.repository.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch repository');
    }
  }

  return (
    <main className={styles.main}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <BookOpen size={28} />
          <span>Grepbase</span>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={20} />
          Settings
        </button>
      </header>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.badge}>
            <Sparkles size={14} />
            <span>AI-Powered Code Learning</span>
          </div>

          <h1 className={styles.title}>
            Understand Code <br />
            <span className="text-gradient">Through Time</span>
          </h1>

          <p className={styles.subtitle}>
            Walk through any open source project&apos;s git history like a book.
            Let AI explain each chapter of the codebase evolution.
          </p>

          {/* URL Input */}
          <form onSubmit={handleSubmit} className={styles.searchForm}>
            <div className={styles.inputWrapper}>
              <Github size={20} className={styles.inputIcon} />
              <input
                type="text"
                className={`${styles.searchInput} ${validationError ? styles.searchInputError : ''}`}
                placeholder="Enter GitHub URL (e.g., github.com/sindresorhus/is)"
                value={url}
                onChange={handleUrlChange}
                disabled={loading}
                aria-invalid={!!validationError}
                aria-describedby={validationError ? 'url-error' : undefined}
              />
              {validationError && (
                <div id="url-error" className={styles.validationError} role="alert">
                  {validationError}
                </div>
              )}
            </div>
            <button
              type="submit"
              className={`btn btn-primary ${styles.submitBtn}`}
              disabled={loading || !isValid}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className={styles.spinner} />
                  Loading...
                </>
              ) : (
                <>
                  Explore
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}

          {/* Features */}
          <div className={styles.features}>
            <div className={styles.feature}>
              <Clock size={18} />
              <span>Time-travel through commits</span>
            </div>
            <div className={styles.feature}>
              <Sparkles size={18} />
              <span>AI explanations at each step</span>
            </div>
            <div className={styles.feature}>
              <BookOpen size={18} />
              <span>Learn like reading a book</span>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Repositories */}
      {repositories.length > 0 && (
        <section className={styles.recentSection}>
          <h2 className={styles.sectionTitle}>Recent Explorations</h2>
          <div className={styles.repoGrid}>
            {repositories.slice(0, 6).map((repo) => (
              <button
                key={repo.id}
                className={styles.repoCard}
                onClick={() => router.push(`/explore/${repo.id}`)}
              >
                <div className={styles.repoHeader}>
                  <Github size={18} />
                  <span className={styles.repoName}>
                    {repo.owner}/{repo.name}
                  </span>
                </div>
                {repo.description && (
                  <p className={styles.repoDesc}>{repo.description}</p>
                )}
                <div className={styles.repoMeta}>
                  <span className={styles.stars}>
                    <Star size={14} />
                    {repo.stars.toLocaleString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </main>
  );
}
