'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
    BookOpen, ChevronLeft, ChevronRight, Home, Settings,
    Loader2, MessageSquare, FileCode, GitCommit, User, Calendar
} from 'lucide-react';
import styles from './page.module.css';
import SettingsModal from '@/components/SettingsModal';
import { getAISettings } from '@/components/SettingsModal';
import CodeViewer from '@/components/CodeViewer';
import AIPanel from '@/components/AIPanel';

interface Repository {
    id: number;
    name: string;
    owner: string;
    description: string | null;
    readme: string | null;
}

interface Commit {
    id: number;
    sha: string;
    message: string;
    authorName: string | null;
    date: string;
    order: number;
}

interface FileData {
    path: string;
    content: string | null;
    language: string;
    size: number;
}

export default function ExplorePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();

    const [repository, setRepository] = useState<Repository | null>(null);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [files, setFiles] = useState<FileData[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showAIPanel, setShowAIPanel] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const currentCommit = commits[currentIndex];

    // Fetch repository and commits on mount
    useEffect(() => {
        async function fetchData() {
            try {
                const res = await fetch(`/api/repos/${id}/commits`);
                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || 'Failed to fetch repository');
                }

                setRepository(data.repository);
                setCommits(data.commits);
                setLoading(false);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Something went wrong');
                setLoading(false);
            }
        }

        fetchData();
    }, [id]);

    // Fetch files when commit changes
    useEffect(() => {
        if (!currentCommit || !repository) return;

        async function fetchFiles() {
            setLoadingFiles(true);
            try {
                const res = await fetch(`/api/repos/${id}/commits/${currentCommit.sha}`);
                const data = await res.json();

                if (res.ok) {
                    setFiles(data.files || []);
                    // Auto-select first code file
                    const codeFile = data.files?.find((f: FileData) => f.content);
                    if (codeFile) {
                        setSelectedFile(codeFile);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch files:', err);
            } finally {
                setLoadingFiles(false);
            }
        }

        fetchFiles();
    }, [currentCommit, repository, id]);

    // Navigation
    function goToCommit(index: number) {
        if (index >= 0 && index < commits.length) {
            setCurrentIndex(index);
            setSelectedFile(null);
        }
    }

    function goNext() {
        goToCommit(currentIndex + 1);
    }

    function goPrev() {
        goToCommit(currentIndex - 1);
    }

    // Keyboard navigation
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                goNext();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                goPrev();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    });

    if (loading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={32} className={styles.spinner} />
                <p>Loading repository...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorState}>
                <p>{error}</p>
                <button className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    if (!repository || commits.length === 0) {
        return (
            <div className={styles.errorState}>
                <p>No commits found for this repository.</p>
                <button className="btn btn-primary" onClick={() => router.push('/')}>
                    Go Home
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button className="btn btn-ghost" onClick={() => router.push('/')}>
                        <Home size={18} />
                    </button>
                    <div className={styles.repoInfo}>
                        <BookOpen size={18} />
                        <span className={styles.repoName}>{repository.owner}/{repository.name}</span>
                    </div>
                </div>

                <div className={styles.headerCenter}>
                    <div className={styles.progress}>
                        <span className={styles.progressText}>
                            Chapter {currentIndex + 1} of {commits.length}
                        </span>
                        <div className={styles.progressBar}>
                            <div
                                className={styles.progressFill}
                                style={{ width: `${((currentIndex + 1) / commits.length) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>

                <div className={styles.headerRight}>
                    <button
                        className={`btn btn-ghost ${showAIPanel ? styles.active : ''}`}
                        onClick={() => setShowAIPanel(!showAIPanel)}
                    >
                        <MessageSquare size={18} />
                        AI
                    </button>
                    <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
                        <Settings size={18} />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <div className={styles.main}>
                {/* Sidebar - Commit Timeline */}
                <aside className={styles.sidebar}>
                    <h3 className={styles.sidebarTitle}>Commit Timeline</h3>
                    <div className={styles.timeline}>
                        {commits.map((commit, index) => (
                            <button
                                key={commit.id}
                                className={`${styles.timelineItem} ${index === currentIndex ? styles.timelineItemActive : ''}`}
                                onClick={() => goToCommit(index)}
                            >
                                <div className={styles.timelineMarker}>
                                    <div className={styles.timelineDot} />
                                    {index < commits.length - 1 && <div className={styles.timelineLine} />}
                                </div>
                                <div className={styles.timelineContent}>
                                    <span className={styles.timelineOrder}>#{index + 1}</span>
                                    <span className={styles.timelineMessage}>
                                        {commit.message.split('\n')[0].substring(0, 50)}
                                        {commit.message.length > 50 ? '...' : ''}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                {/* Center - Code Viewer */}
                <main className={styles.content}>
                    {/* Commit Info */}
                    <div className={styles.commitInfo}>
                        <div className={styles.commitHeader}>
                            <GitCommit size={18} />
                            <code className={styles.commitSha}>{currentCommit.sha.substring(0, 7)}</code>
                        </div>
                        <h2 className={styles.commitMessage}>{currentCommit.message.split('\n')[0]}</h2>
                        <div className={styles.commitMeta}>
                            <span>
                                <User size={14} />
                                {currentCommit.authorName || 'Unknown'}
                            </span>
                            <span>
                                <Calendar size={14} />
                                {new Date(currentCommit.date).toLocaleDateString()}
                            </span>
                        </div>
                    </div>

                    {/* File Tree & Code */}
                    <div className={styles.codeArea}>
                        {loadingFiles ? (
                            <div className={styles.loadingFiles}>
                                <Loader2 size={24} className={styles.spinner} />
                                <p>Loading files...</p>
                            </div>
                        ) : (
                            <>
                                {/* File List */}
                                <div className={styles.fileList}>
                                    {files.filter(f => f.content).slice(0, 20).map((file) => (
                                        <button
                                            key={file.path}
                                            className={`${styles.fileItem} ${selectedFile?.path === file.path ? styles.fileItemActive : ''}`}
                                            onClick={() => setSelectedFile(file)}
                                        >
                                            <FileCode size={14} />
                                            <span>{file.path.split('/').pop()}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Code Display */}
                                <div className={styles.codeDisplay}>
                                    {selectedFile ? (
                                        <CodeViewer
                                            code={selectedFile.content || ''}
                                            language={selectedFile.language}
                                            filename={selectedFile.path}
                                        />
                                    ) : (
                                        <div className={styles.noFile}>
                                            <FileCode size={48} />
                                            <p>Select a file to view its contents</p>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Navigation */}
                    <div className={styles.navigation}>
                        <button
                            className="btn btn-secondary"
                            onClick={goPrev}
                            disabled={currentIndex === 0}
                        >
                            <ChevronLeft size={18} />
                            Previous
                        </button>
                        <span className={styles.navInfo}>
                            Use arrow keys to navigate
                        </span>
                        <button
                            className="btn btn-primary"
                            onClick={goNext}
                            disabled={currentIndex === commits.length - 1}
                        >
                            Next
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </main>

                {/* Right Panel - AI */}
                {showAIPanel && (
                    <aside className={styles.aiPanel}>
                        <AIPanel
                            repository={repository}
                            commit={currentCommit}
                            totalCommits={commits.length}
                            currentIndex={currentIndex}
                        />
                    </aside>
                )}
            </div>

            {/* Settings Modal */}
            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}
