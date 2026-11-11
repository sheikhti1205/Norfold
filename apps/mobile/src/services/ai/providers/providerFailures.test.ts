import { describe, expect, it } from "vitest";
import type { NormalizedRequest, ProviderAdapter, ProviderId, StreamEvent } from "../providerContract";
import { createAnthropicAdapter } from "./anthropic";
import { createCohereAdapter } from "./cohere";
import { createDeepSeekAdapter } from "./deepseek";
import { createGenericAdapter } from "./generic";
import { createGoogleAdapter } from "./google";
import { createGroqAdapter } from "./groq";
import { createMistralAdapter } from "./mistral";
import { createOpenAiAdapter } from "./openai";
import { createOpenRouterAdapter } from "./openrouter";
import { createXaiAdapter } from "./xai";

const factories = {
  openai: (fetchImpl: typeof fetch) => createOpenAiAdapter({ resolveCredential: () => "key", assembleSystemText: () => undefined, fetchImpl }),
  anthropic: (fetchImpl: typeof fetch) => createAnthropicAdapter({ getApiKey: async () => "key", fetchImpl }),
  google: (fetchImpl: typeof fetch) => createGoogleAdapter({ getApiKey: async () => "key", fetchImpl }),
  cohere: (fetchImpl: typeof fetch) => createCohereAdapter({ getApiKey: async () => "key", fetchImpl }),
  deepseek: (fetchImpl: typeof fetch) => createDeepSeekAdapter({ getApiKey: async () => "key", fetchImpl }),
  groq: (fetchImpl: typeof fetch) => createGroqAdapter({ getApiKey: async () => "key", fetchImpl }),
  mistral: (fetchImpl: typeof fetch) => createMistralAdapter({ getApiKey: async () => "key", fetchImpl }),
  openrouter: (fetchImpl: typeof fetch) => createOpenRouterAdapter({ getApiKey: async () => "key", fetchImpl }),
  xai: (fetchImpl: typeof fetch) => createXaiAdapter({ getApiKey: async () => "key", fetchImpl }),
  generic: (fetchImpl: typeof fetch) => createGenericAdapter({ baseURL: "http://localhost:11434/v1", getApiKey: async () => "key", fetchImpl }),
} satisfies Record<string, (fetchImpl: typeof fetch) => ProviderAdapter>;

type Provider = keyof typeof factories;
function request(provider: Provider): NormalizedRequest {
  return { selection: { accountId: "acct", provider: (provider === "generic" ? "openai" : provider) as ProviderId, modelId: "model", mode: "paid-explicit" }, task: "app-help", policyVersion: "1", knowledgeVersion: "1", recentTurns: [], currentText: "hello", approvedImageIds: [], authorizedResultIds: [], maxOutputTokens: 128, signal: new AbortController().signal };
}
async function events(provider: Provider, response: Response): Promise<StreamEvent[]> {
  const fetchImpl = (async () => response) as typeof fetch;
  const out: StreamEvent[] = [];
  for await (const event of factories[provider](fetchImpl).complete(request(provider))) out.push(event);
  return out;
}

describe("provider failure boundary", () => {
  for (const provider of Object.keys(factories) as Provider[]) {
    it.each([[401, "auth-invalid"], [403, "auth-forbidden"], [402, "payment-required"], [429, "rate-limited"]] as const)(`${provider}: HTTP %i maps to %s`, async (status, code) => {
      const response = new Response(JSON.stringify({ error: { message: "failure" } }), { status, headers: { "content-type": "application/json" } });
      expect(await events(provider, response)).toContainEqual(expect.objectContaining({ kind: "error", code }));
    });
  }
  for (const provider of ["groq", "mistral", "openrouter", "xai"] as const) {
    it.each([{ finish_reason: "content_filter", delta: { content: "not safe" } }, { delta: { refusal: "refused" } }])(`${provider}: refusal is not emitted as answer text`, async (choice) => {
      const response = new Response(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      const result = await events(provider, response);
      expect(result).toContainEqual(expect.objectContaining({ kind: "error", code: "response-refused" }));
      expect(result.some((event) => event.kind === "text")).toBe(false);
      expect(result.at(-1)).toMatchObject({ kind: "done", stopReason: "error" });
    });
  }
  it.each([
    ["groq", 'data: {"choices":[{"delta":{"content":"before"}}]}\n\ndata: {"error":{"message":"failure"},"choices":[{"delta":{"content":"leak"}}]}\n\ndata: {"choices":[{"delta":{"content":"after"}}]}\n\n'],
    ["google", 'data: {"candidates":[{"content":{"parts":[{"text":"before"}]}}]}\n\ndata: {"error":{"code":500,"message":"failure","status":"INTERNAL"},"candidates":[{"content":{"parts":[{"text":"leak"}]}}]}\n\n'],
    ["anthropic", 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"before"}}\n\nevent: error\ndata: {"type":"error","error":{"type":"api_error","message":"failure"}}\n\n'],
    ["cohere", 'data: {"type":"content-delta","delta":{"message":{"content":{"text":"before"}}}}\n\ndata: {"error":{"message":"failure"},"choices":[{"delta":{"content":"leak"}}]}\n\n'],
  ] as const)("%s mid-stream error stops answer emission", async (provider, body) => {
    const result = await events(provider, new Response(body, { headers: { "content-type": "text/event-stream" } }));
    expect(result).toContainEqual(expect.objectContaining({ kind: "error" }));
    expect(result.filter((event) => event.kind === "text").map((event) => event.delta).join("")).toBe("before");
    expect(result.at(-1)).toMatchObject({ kind: "done", stopReason: "error" });
  });
});
