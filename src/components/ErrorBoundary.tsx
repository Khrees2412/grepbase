'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '@/lib/logger';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Log error to our structured logger
        logger.error(
            {
                error: error.message,
                stack: error.stack,
                componentStack: errorInfo.componentStack,
            },
            'React Error Boundary caught error'
        );

        // Call optional error handler
        this.props.onError?.(error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            // Use custom fallback or default error UI
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div style={{
                    padding: '2rem',
                    maxWidth: '600px',
                    margin: '2rem auto',
                    border: '1px solid #e53e3e',
                    borderRadius: '8px',
                    backgroundColor: '#fff5f5',
                }}>
                    <h2 style={{ color: '#c53030', marginBottom: '1rem' }}>
                        Something went wrong
                    </h2>
                    <p style={{ color: '#742a2a', marginBottom: '1rem' }}>
                        We encountered an unexpected error. Please try refreshing the page.
                    </p>
                    {process.env.NODE_ENV === 'development' && this.state.error && (
                        <details style={{ marginTop: '1rem' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                                Error details
                            </summary>
                            <pre style={{
                                marginTop: '0.5rem',
                                padding: '1rem',
                                backgroundColor: '#f7fafc',
                                borderRadius: '4px',
                                overflow: 'auto',
                                fontSize: '0.875rem',
                            }}>
                                {this.state.error.message}
                                {'\n\n'}
                                {this.state.error.stack}
                            </pre>
                        </details>
                    )}
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '1rem',
                            padding: '0.5rem 1rem',
                            backgroundColor: '#3182ce',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }}
                    >
                        Refresh Page
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
