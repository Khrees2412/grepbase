/**
 * API route for generating AI summary of a repository
 * POST - Generate streaming AI analysis of the repository
 */

import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { repositories } from '@/db';
import { eq } from 'drizzle-orm';
import { createAIProviderAsync, type AIProviderType } from '@/services/ai-providers';
import { streamText } from 'ai';

export const runtime = 'edge';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const db = getDb();
        const { id } = await params;
        const body = await request.json() as {
            provider: AIProviderType;
            apiKey?: string;
            model?: string;
            baseUrl?: string;
        };
        const { provider, apiKey, model, baseUrl } = body;

        // Fetch repository from database
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, parseInt(id)))
            .limit(1);

        if (repo.length === 0) {
            return Response.json({ error: 'Repository not found' }, { status: 404 });
        }

        const repository = repo[0];

        // Create AI provider
        const isLocalProvider = provider === 'ollama' || provider === 'lmstudio';
        if (!isLocalProvider && !apiKey) {
            return Response.json({ error: 'API key is required' }, { status: 400 });
        }

        const aiModel = await createAIProviderAsync({
            type: provider,
            apiKey: apiKey,
            model: model,
            baseUrl: baseUrl,
        });

        // Build the prompt
        const systemPrompt = `You are an expert at explaining software projects to developers. 
Your role is to provide a clear, engaging overview of a GitHub repository that helps newcomers understand:
1. What the project does and why it exists
2. The main technologies and patterns used
3. Key concepts someone should understand
4. How to get started exploring the codebase

Be concise but thorough. Use markdown formatting with headers and bullet points.
Write in an enthusiastic, welcoming tone that encourages exploration.`;

        const userPrompt = `Please analyze this GitHub repository and provide a comprehensive overview:

**Repository:** ${repository.owner}/${repository.name}
**Description:** ${repository.description || 'No description provided'}
**Stars:** ${repository.stars}

${repository.readme ? `**README Content:**\n${repository.readme.substring(0, 8000)}${repository.readme.length > 8000 ? '\n... (truncated)' : ''}` : 'No README available.'}

Please provide:
1. **What This Project Does** - A beginner-friendly explanation
2. **Key Technologies** - Main languages, frameworks, and tools used
3. **Core Concepts** - Important patterns or ideas to understand
4. **Where to Start** - Recommended files or areas to explore first
5. **Quick Tips** - Advice for someone new to this codebase`;

        // Stream the response
        const result = streamText({
            model: aiModel,
            system: systemPrompt,
            prompt: userPrompt,
            maxOutputTokens: 2000,
        });

        // Return streaming response
        return result.toTextStreamResponse();
    } catch (error) {
        console.error('Error generating summary:', error);
        return Response.json(
            { error: error instanceof Error ? error.message : 'Failed to generate summary' },
            { status: 500 }
        );
    }
}
