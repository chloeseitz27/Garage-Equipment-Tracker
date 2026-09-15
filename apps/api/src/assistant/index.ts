import type { AssistantProvider } from '@garage/shared';

import { config } from '../config.js';
import { OpenAiCompatibleProvider } from './openai-provider.js';
import { StubAssistantProvider } from './stub-provider.js';

/**
 * Provider selection by env var (technical-spec.md §6.3). Which hosted model we
 * use isn't load-bearing — the interface is — so an unconfigured provider falls
 * back to the stub rather than breaking the app.
 */
export function createAssistantProvider(): AssistantProvider {
  const { provider, baseUrl, apiKey, model } = config.assistant;

  if (provider === 'stub') return new StubAssistantProvider();

  if (!baseUrl || !apiKey || !model) {
    console.warn(
      `[assistant] ASSISTANT_PROVIDER=${provider} but base URL, key, or model is missing — using the stub provider.`,
    );
    return new StubAssistantProvider();
  }

  if (provider === 'azure-openai' || provider === 'github-models') {
    return new OpenAiCompatibleProvider({
      name: provider,
      baseUrl,
      apiKey,
      model,
      authStyle: provider === 'azure-openai' ? 'api-key' : 'bearer',
    });
  }

  console.warn(`[assistant] Unknown ASSISTANT_PROVIDER "${provider}" — using the stub provider.`);
  return new StubAssistantProvider();
}

export { StubAssistantProvider, OpenAiCompatibleProvider };
