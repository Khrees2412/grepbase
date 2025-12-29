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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchRepositories();
  }, []);

  async function fetchRepositories() {
    try {
      const res = await fetch('/api/repos');
      const data = await res.json();
      setRepositories(data.repositories || []);
    } catch (err) {
      console.error('Failed to fetch repositories:', err);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch repository');
      }

      router.push(`/explore/${data.repository.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
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
                className={styles.searchInput}
                placeholder="Enter GitHub URL (e.g., github.com/sindresorhus/is)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              className={`btn btn-primary ${styles.submitBtn}`}
              disabled={loading || !url.trim()}
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
