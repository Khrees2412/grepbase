'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import styles from './AIPanel.module.css';
import { getAISettings } from './SettingsModal';

interface AIPanelProps {
    repository: {
        id: number;
        name: string;
        owner: string;
        description: string | null;
    };
    commit: {
        sha: string;
        message: string;
        authorName: string | null;
        date: string;
    };
    totalCommits: number;
    currentIndex: number;
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export default function AIPanel({ repository, commit, totalCommits, currentIndex }: AIPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [streaming, setStreaming] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset messages when commit changes
    useEffect(() => {
        setMessages([]);
        setError(null);
    }, [commit.sha]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function explainCommit() {
        const settings = getAISettings();
        if (!settings) {
            setError('Please configure your AI settings first (click the Settings button)');
            return;
        }

        setLoading(true);
        setError(null);
        setMessages([]);

        try {
            const response = await fetch('/api/explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'commit',
                    repoId: repository.id,
                    commitSha: commit.sha,
                    provider: {
                        type: settings.provider,
                        apiKey: settings.config.apiKey,
                        baseUrl: settings.config.baseUrl,
                        model: settings.config.model,
                    },
                }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to get explanation');
            }

            // Handle streaming response
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            setStreaming(true);
            setMessages([{ role: 'assistant', content: '' }]);

            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                fullText += chunk;

                setMessages([{ role: 'assistant', content: fullText }]);
            }

            setStreaming(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setLoading(false);
        }
    }

    async function askQuestion(e: React.FormEvent) {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const settings = getAISettings();
        if (!settings) {
            setError('Please configure your AI settings first');
            return;
        }

        const question = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: question }]);
        setLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'question',
                    repoId: repository.id,
                    commitSha: commit.sha,
                    question,
                    provider: {
                        type: settings.provider,
                        apiKey: settings.config.apiKey,
                        baseUrl: settings.config.baseUrl,
                        model: settings.config.model,
                    },
                }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to get answer');
            }

            // Handle streaming response
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            setStreaming(true);
            setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                fullText += chunk;

                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'assistant', content: fullText };
                    return newMessages;
                });
            }

            setStreaming(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    }

    const hasMessages = messages.length > 0;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Sparkles size={18} />
                <span>AI Assistant</span>
            </div>

            <div className={styles.content}>
                {/* Empty State */}
                {!hasMessages && !loading && !error && (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>
                            <Sparkles size={32} />
                        </div>
                        <h3>Understand This Commit</h3>
                        <p>
                            Let AI explain what this commit does and why it matters in the context of
                            this project&apos;s evolution.
                        </p>
                        <button
                            className="btn btn-primary"
                            onClick={explainCommit}
                            disabled={loading}
                        >
                            <Sparkles size={16} />
                            Explain This Commit
                        </button>
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className={styles.error}>
                        <AlertCircle size={16} />
                        <span>{error}</span>
                    </div>
                )}

                {/* Messages */}
                {hasMessages && (
                    <div className={styles.messages}>
                        {messages.map((message, index) => (
                            <div
                                key={index}
                                className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage
                                    }`}
                            >
                                <div className={styles.messageContent}>
                                    {message.content || (streaming && index === messages.length - 1 ? (
                                        <span className={styles.cursor}>▊</span>
                                    ) : null)}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}

                {/* Loading */}
                {loading && !streaming && (
                    <div className={styles.loading}>
                        <Loader2 size={20} className={styles.spinner} />
                        <span>Thinking...</span>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className={styles.footer}>
                {hasMessages && (
                    <button
                        className={`btn btn-ghost ${styles.refreshBtn}`}
                        onClick={explainCommit}
                        disabled={loading}
                        title="Re-explain this commit"
                    >
                        <RefreshCw size={16} />
                    </button>
                )}

                <form onSubmit={askQuestion} className={styles.inputForm}>
                    <input
                        ref={inputRef}
                        type="text"
                        className={styles.input}
                        placeholder="Ask a question..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        className={`btn btn-primary ${styles.sendBtn}`}
                        disabled={loading || !input.trim()}
                    >
                        <Send size={16} />
                    </button>
                </form>
            </div>
        </div>
    );
}
