/**
 * AI Provider types and configurations (frontend-only, no API keys)
 */

export type AIProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'lmstudio';

export const PROVIDER_NAMES: Record<AIProviderType, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  ollama: 'Ollama (Local)',
  lmstudio: 'LM Studio (Local)',
};

export const DEFAULT_MODELS: Record<AIProviderType, string[]> = {
  gemini: [
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-flash-thinking-preview',
  ],
  openai: [
    'gpt-5.2',
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o3-mini',
  ],
  anthropic: [
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-5-20251101',
    'claude-sonnet-3-7-20250219',
  ],
  ollama: [
    'llama3.2',
    'qwen2.5',
    'deepseek-r1',
  ],
  lmstudio: [
    'deepseek-r1-distill-llama-8b',
    'llama-3.2-3b',
  ],
};

export function getAvailableModels(provider: AIProviderType): string[] {
  return DEFAULT_MODELS[provider] || [];
}
