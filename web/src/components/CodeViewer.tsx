'use client';

import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';
import styles from './CodeViewer.module.css';

interface CodeViewerProps {
    code: string;
    language: string;
    filename: string;
}

export default function CodeViewer({ code, language, filename }: CodeViewerProps) {
    const [html, setHtml] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function highlight() {
            setLoading(true);
            try {
                // Map common language names to shiki language IDs
                const langMap: Record<string, string> = {
                    'javascript': 'javascript',
                    'typescript': 'typescript',
                    'jsx': 'jsx',
                    'tsx': 'tsx',
                    'python': 'python',
                    'rust': 'rust',
                    'go': 'go',
                    'java': 'java',
                    'cpp': 'cpp',
                    'c': 'c',
                    'ruby': 'ruby',
                    'php': 'php',
                    'swift': 'swift',
                    'kotlin': 'kotlin',
                    'markdown': 'markdown',
                    'json': 'json',
                    'yaml': 'yaml',
                    'toml': 'toml',
                    'css': 'css',
                    'scss': 'scss',
                    'html': 'html',
                    'xml': 'xml',
                    'sql': 'sql',
                    'bash': 'bash',
                    'shell': 'bash',
                    'plaintext': 'text',
                };

                const lang = langMap[language.toLowerCase()] || 'text';

                const highlighted = await codeToHtml(code, {
                    lang,
                    theme: 'github-dark-default',
                });

                setHtml(highlighted);
            } catch (err) {
                console.error('Syntax highlighting failed:', err);
                // Fallback to plain text
                setHtml(`<pre><code>${escapeHtml(code)}</code></pre>`);
            } finally {
                setLoading(false);
            }
        }

        if (code) {
            highlight();
        }
    }, [code, language]);

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <span className={styles.filename}>{filename}</span>
                </div>
                <div className={styles.loading}>
                    <div className={`skeleton ${styles.skeleton}`} />
                    <div className={`skeleton ${styles.skeleton}`} style={{ width: '80%' }} />
                    <div className={`skeleton ${styles.skeleton}`} style={{ width: '60%' }} />
                    <div className={`skeleton ${styles.skeleton}`} style={{ width: '70%' }} />
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <span className={styles.filename}>{filename}</span>
                <span className={styles.language}>{language}</span>
            </div>
            <div
                className={styles.code}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    );
}

// Helper to escape HTML
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
