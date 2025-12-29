/**
 * AI Provider service using Vercel AI SDK
 * Supports multiple providers with BYOK (Bring Your Own Key)
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export type AIProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'lmstudio';

export interface AIProviderConfig {
    type: AIProviderType;
    apiKey?: string;
    baseUrl?: string; // For Ollama or custom endpoints
    model?: string;
}

// Default models for each provider
const DEFAULT_MODELS: Record<AIProviderType, string> = {
    gemini: 'gemini-2.0-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest',
    ollama: 'llama3.2',
    lmstudio: 'deepseek-r1-distill-llama-8b',
};

/**
 * Create an AI provider instance based on configuration
 */
export function createAIProvider(config: AIProviderConfig): LanguageModel {
    const model = config.model || DEFAULT_MODELS[config.type];

    switch (config.type) {
        case 'gemini': {
            if (!config.apiKey) throw new Error('Gemini API key is required');
            const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
            return google(model);
        }

        case 'openai': {
            if (!config.apiKey) throw new Error('OpenAI API key is required');
            const openai = createOpenAI({ apiKey: config.apiKey });
            return openai(model);
        }

        case 'anthropic': {
            if (!config.apiKey) throw new Error('Anthropic API key is required');
            const anthropic = createAnthropic({ apiKey: config.apiKey });
            return anthropic(model);
        }

        case 'ollama': {
            // Ollama uses OpenAI-compatible API
            const baseURL = config.baseUrl || 'http://localhost:11434/v1';
            const ollama = createOpenAICompatible({
                name: 'ollama',
                baseURL,
                apiKey: 'ollama', // Ollama doesn't need a real key
            });
            return ollama(model);
        }

        case 'lmstudio': {
            // LMStudio uses OpenAI-compatible API
            const lmstudioURL = config.baseUrl || 'http://127.0.0.1:1234/v1';
            const lmstudio = createOpenAICompatible({
                name: 'lmstudio',
                baseURL: lmstudioURL,
                apiKey: 'lmstudio', // LMStudio doesn't need a real key
            });
            return lmstudio(model);
        }

        default:
            throw new Error(`Unknown provider type: ${config.type}`);
    }
}

/**
 * Get available models for a provider
 */
export function getAvailableModels(type: AIProviderType): string[] {
    switch (type) {
        case 'gemini':
            return ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
        case 'openai':
            return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
        case 'anthropic':
            return ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'];
        case 'ollama':
            return ['llama3.2', 'llama3.1', 'codellama', 'mistral', 'phi3'];
        case 'lmstudio':
            return ['deepseek-r1-distill-llama-8b', 'meta-llama-3.1-8b-instruct'];
        default:
            return [];
    }
}

/**
 * Provider display names
 */
export const PROVIDER_NAMES: Record<AIProviderType, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    ollama: 'Ollama (Local)',
    lmstudio: 'LMStudio (Local)',
};
