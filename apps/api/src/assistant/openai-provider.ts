import { z } from 'zod';
import type { AssistantProvider, AssistantRecommendation, Item } from '@garage/shared';

import { SYSTEM_PROMPT } from './prompt.js';

/**
 * One implementation covers both Azure OpenAI and GitHub Models — they are both
 * OpenAI-compatible chat-completions APIs, differing only in base URL, auth
 * header, and model name (technical-spec.md §6.3).
 */

const responseSchema = z.object({
  understoodAs: z.string(),
  garageItems: z.array(z.object({ id: z.string(), reason: z.string() })),
  notInGarage: z.array(z.object({ name: z.string(), reason: z.string() })),
});

/** Structured output, so the response is parsed rather than scraped. */
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'garage_recommendation',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['understoodAs', 'garageItems', 'notInGarage'],
      properties: {
        understoodAs: { type: 'string' },
        garageItems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'reason'],
            properties: { id: { type: 'string' }, reason: { type: 'string' } },
          },
        },
        notInGarage: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'reason'],
            properties: { name: { type: 'string' }, reason: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;

export interface OpenAiCompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Azure OpenAI uses an `api-key` header; GitHub Models uses `Authorization: Bearer`. */
  authStyle: 'api-key' | 'bearer';
}

export class OpenAiCompatibleProvider implements AssistantProvider {
  readonly name: string;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.name = options.name;
  }

  async recommend(input: {
    projectDescription: string;
    candidates: Item[];
  }): Promise<AssistantRecommendation> {
    // Candidates are sent as structured records. Note what is absent: no
    // locationId, no status, no stock level, no safety text. The model cannot
    // leak or paraphrase what it was never given.
    const candidates = input.candidates.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      tags: item.tags,
      goodFor: item.goodFor,
      description: item.description ?? '',
    }));

    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.2,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              projectDescription: input.projectDescription,
              candidates,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Assistant provider ${this.name} returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Assistant provider ${this.name} returned no content`);

    return responseSchema.parse(JSON.parse(content));
  }

  private endpoint(): string {
    const base = this.options.baseUrl.replace(/\/$/, '');
    return base.includes('/chat/completions') ? base : `${base}/chat/completions`;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.options.authStyle === 'api-key'
        ? { 'api-key': this.options.apiKey }
        : { authorization: `Bearer ${this.options.apiKey}` }),
    };
  }
}
