import { describe, expect, it, vi } from "vitest";
import { ChatController } from "../chatController";
import { ChatStore } from "../chatStore";
import type { ChatPersistenceAdapter } from "../chatStore";
import type { ModelRecord, ProviderAdapter } from "../providerContract";

describe("failed provider turns", () => {
  it.each(["response-refused", "response-incomplete", "empty"])("does not persist %s", async (failure) => {
    const save = vi.fn(async () => {});
    const persistence: ChatPersistenceAdapter = {
      storageKind: "in-memory-test", load: async () => null, save, knownAccounts: async () => [],
    };
    const store = new ChatStore(persistence, { debounceMs: 60_000 });
    const chat = store.createChat("account", "Help");
    await store.flushDrafts();
    save.mockClear();
    const adapter: ProviderAdapter = {
      id: "openrouter",
      capabilities: () => ({ vision: { state: "unknown" }, maxImagesPerCall: { state: "unknown" }, contextTokens: { state: "known", value: 200_000 }, maxOutputTokens: { state: "known", value: 4096 }, streaming: { state: "known", value: true } }),
      async *complete() {
        if (failure !== "empty") {
          yield { kind: "text", attempt: 1, delta: "partial" };
          yield { kind: "error", attempt: 1, code: failure, message: "failed", retryable: false };
          yield { kind: "done", attempt: 1, stopReason: "error" };
        } else {
          yield { kind: "done", attempt: 1, stopReason: "complete" };
        }
      },
    };
    const model = { provider: "openrouter", id: "free", input: ["text"], output: ["text"], contextTokens: 200_000, prices: [{ amountDecimal: "0", currency: "USD", unit: "token", dimension: "input", sourceField: "pricing.prompt" }, { amountDecimal: "0", currency: "USD", unit: "token", dimension: "output", sourceField: "pricing.completion" }], priceClass: "free", entitlement: "verified", retrievedAt: "2026-09-26T00:00:00.000Z" } as ModelRecord;
    const controller = new ChatController({ store, adapter, selection: { accountId: "account", provider: "openrouter", modelId: "free", mode: "free-only" }, systemPolicy: { version: "1", text: "policy" }, knowledge: { version: "1", text: "help" }, budget: { verifiedContextWindow: 200_000, reservedOutput: 4096, imageAllowance: 0, protocolOverhead: 1000, safetyMargin: 2000 }, catalog: [model] });
    await expect(controller.send(chat.id, "question")).rejects.toThrow();
    expect(store.continueChat("account", chat.id).turns).toEqual([]);
    await store.flushDrafts();
    expect(save).not.toHaveBeenCalled();
  });
});
