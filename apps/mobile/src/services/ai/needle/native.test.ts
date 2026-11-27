/**
 * Native Needle bridge tests (C2): factory binds the probed dimension and
 * fails closed without the engine. Fake bridge — no JNI, no weights.
 */
import { describe, expect, it } from "vitest";
import {
  NEEDLE_MODEL_ID,
  NeedleLowMemoryError,
  isNeedleLowMemoryError,
  type NativeNeedleBridge,
} from "./embedder";
import { createNativeNeedleEmbedder } from "./native";

function fakeLoadableBridge(opts?: {
  dimension?: number;
  loadThrows?: boolean;
}): NativeNeedleBridge & {
  loadModel(args: { modelId: string; installedPath?: string }): Promise<number>;
  loads: { modelId: string }[];
} {
  const loads: { modelId: string }[] = [];
  return {
    loads,
    bridgeName: "test-needle-native",
    isNeedleAvailable: async () => true,
    embeddingDimension: async () => opts?.dimension ?? 5,
    embedNeedleTexts: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5]),
    loadModel: async (args: { modelId: string }) => {
      loads.push({ modelId: args.modelId });
      if (opts?.loadThrows === true) throw new Error("model_not_installed");
      return opts?.dimension ?? 5;
    },
  };
}

describe("createNativeNeedleEmbedder", () => {
  it("loads the pinned model and binds the probed dimension", async () => {
    const bridge = fakeLoadableBridge({ dimension: 5 });
    const embedder = await createNativeNeedleEmbedder(bridge);
    expect(embedder.modelId).toBe(NEEDLE_MODEL_ID);
    expect(embedder.dimension).toBe(5);
    expect(bridge.loads).toEqual([{ modelId: NEEDLE_MODEL_ID }]);
    await expect(embedder.embedNeedleTexts(["hello"])).resolves.toEqual([
      [0.1, 0.2, 0.3, 0.4, 0.5],
    ]);
  });

  it("fails closed while weights are absent", async () => {
    const bridge = fakeLoadableBridge({ loadThrows: true });
    await expect(createNativeNeedleEmbedder(bridge)).rejects.toThrow(/model_not_installed/);
  });
});

describe("isNeedleLowMemoryError", () => {
  it("recognises the plugin's code, the typed error, and the native message", () => {
    expect(isNeedleLowMemoryError(new NeedleLowMemoryError())).toBe(true);
    expect(isNeedleLowMemoryError({ code: "insufficient_memory" })).toBe(true);
    expect(isNeedleLowMemoryError({ code: "LOW_MEMORY" })).toBe(true);
    expect(isNeedleLowMemoryError(new Error("insufficient_memory: load refused"))).toBe(true);
    expect(isNeedleLowMemoryError(new Error("Not enough free memory to load the on-device helper right now."))).toBe(true);
  });

  it("does not claim an unrelated runtime failure", () => {
    expect(isNeedleLowMemoryError(new Error("runtime_load_failed"))).toBe(false);
    expect(isNeedleLowMemoryError({ code: "runtime_unavailable" })).toBe(false);
    expect(isNeedleLowMemoryError(null)).toBe(false);
  });
});
