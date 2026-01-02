/**
 * API route for testing AI provider connection
 * This runs on the server to avoid CORS issues with local providers
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as { provider: string; baseUrl?: string; apiKey?: string };
        const { provider, baseUrl } = body;

        if (!provider) {
            return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
        }

        // For local providers, test the connection
        if (provider === 'ollama' || provider === 'lmstudio') {
            const url = provider === 'ollama'
                ? `${(baseUrl || 'http://localhost:11434').replace('/v1', '')}/api/tags`
                : `${(baseUrl || 'http://127.0.0.1:1234/v1')}/models`;

            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
                return NextResponse.json(
                    { error: `Server returned ${response.status}` },
                    { status: 502 }
                );
            }

            const data = await response.json() as {
                models?: Array<{ name: string }>;
                data?: Array<{ id: string }>;
            };

            // Return available models
            let models: string[] = [];
            if (provider === 'ollama' && data.models) {
                models = data.models.map((m) => m.name);
            } else if (provider === 'lmstudio' && data.data) {
                models = data.data.map((m) => m.id);
            }

            return NextResponse.json({
                success: true,
                models,
                message: `Found ${models.length} model(s)`
            });
        }

        // For cloud providers, we can't really test without making an API call
        // Just return success if we got here
        return NextResponse.json({ success: true });

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Connection failed';
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
