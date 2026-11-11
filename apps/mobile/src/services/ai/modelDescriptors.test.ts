/**
 * Phase A (Step 2): canonical descriptor registry tests.
 *
 * No production logic may rely on catalogue position; these pin the named
 * lookup surface, catalogue derivation, duplicate rejection, and ABI truth
 * that Steps 3, 8, and 10 build on.
 */
import { describe, expect, it } from "vitest";
import {
  createModelRegistry,
  distributionPolicyOf,
  modelSupportsAbi,
  NEEDLE_DESCRIPTOR,
  productionModelRegistry,
} from "./modelDescriptors";
import { profileFor } from "./modelProfiles";
import { NEEDLE_MODEL_ID } from "./needle/embedder";

describe("modelDescriptors", () => {
  it("cannot accidentally re-enable cleanup-only records through an exposed descriptor", () => {
    const registry = productionModelRegistry();
    const retired = registry.descriptors.filter((d) => d.cleanupOnly);
    expect(retired.length).toBeGreaterThan(0);
    for (const descriptor of retired) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Reflect.set(descriptor, "cleanupOnly", false)).toBe(false);
      expect(Reflect.set(descriptor, "downloadable", true)).toBe(false);
      expect(Object.isFrozen(descriptor.taskRoles)).toBe(true);
    }
  });
  it("production catalogue offers the retained helper, not retired generative downloads", () => {
    const registry = productionModelRegistry();
    expect(registry.catalogue().map((item) => item.modelId).sort()).toEqual(
      ["needle3-cact-l20"],
    );
    expect(productionModelRegistry()).toBe(registry);
  });

  it("retains Qwen's historical identity only for cleanup", () => {
    const descriptor = productionModelRegistry().requireDescriptor("qwen3-0.6b-dynamic-int4");
    expect(profileFor(descriptor.modelId)).toBeUndefined();
    expect(descriptor.revision).toBe("a3c5d805ae362dff7f580bc25f2dfb9a5a7eaa76");
    expect(descriptor.sha256).toBe("03e7da1eb1108b50dffaa9bb52cc7bcbad2eb0c66ca990267f480c1e545d2856");
    expect(descriptor.fileName).toBe("Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm");
    expect(descriptor.bytes).toBe(344671744);
    expect(descriptor.url).toBe("");
    expect(descriptor.downloadable).toBe(false);
    expect(distributionPolicyOf(descriptor)).toBe("unavailable");
    expect(descriptor.taskRoles).toEqual([]);
    expect(descriptor.cleanupOnly).toBe(true);
  });

  it("never advertises an install action this build cannot perform", () => {
    const registry = productionModelRegistry();
    // Regression: Advanced rows once said "Available for import and evaluation"
    // while no import action existed anywhere. No note may mention an import
    // path this build does not ship.
    const PROMISES_IMPORT = /\bimport(?:s|ed|ing)?\b/i;
    for (const descriptor of registry.descriptors) {
      expect(descriptor.distributionNote ?? "").not.toMatch(PROMISES_IMPORT);
      if (!descriptor.downloadable) {
        // Cleanup identities retain their real historical URL/bytes; policy,
        // not erasing file identity, prevents new acquisition.
        if (!descriptor.cleanupOnly) expect(descriptor.url).toBe("");
        expect(distributionPolicyOf(descriptor)).not.toBe("downloadable");
      }
    }
  });

  it("rejects duplicate model ids instead of building a split-brain registry", () => {
    expect(() => createModelRegistry([NEEDLE_DESCRIPTOR, NEEDLE_DESCRIPTOR])).toThrow(/duplicate/i);
  });

  it("binds immutable pins from the model profiles, never invented values", () => {
    expect(NEEDLE_DESCRIPTOR.revision.length).toBeGreaterThan(0);
    expect(NEEDLE_DESCRIPTOR.sha256).toHaveLength(64);
    expect(NEEDLE_DESCRIPTOR.format).toBe("cact");
  });

  it("reports ABI truth: verified arm64 only, unknown ABI never counts", () => {
    expect(modelSupportsAbi(NEEDLE_DESCRIPTOR, "arm64-v8a")).toBe(true);
    expect(modelSupportsAbi(NEEDLE_DESCRIPTOR, "x86_64")).toBe(false);
    expect(modelSupportsAbi(NEEDLE_DESCRIPTOR, "")).toBe(false);
  });

  it("declares descriptor.taskRoles the ONE authoritative production role map (L-CONSOLIDATE)", () => {
    // Production advertised roles live on the descriptor, not the lab profile.
    expect([...NEEDLE_DESCRIPTOR.taskRoles]).toEqual([
      "extract-report-fields",
      "extract-search-filters",
      "classify-category",
      "embed-texts",
    ]);
    // Lab profile roles are descriptive evidence and may be narrower: the
    // needle lab pin evidences extraction only, yet production serves the
    // full descriptor set — routing must never read the profile field.
    const needleProfileRoles = profileFor(NEEDLE_MODEL_ID)?.roles ?? [];
    for (const role of needleProfileRoles) {
      expect(NEEDLE_DESCRIPTOR.taskRoles).toContain(role);
    }
    expect(needleProfileRoles).not.toContain("embed-texts");
    // Routing proof: embeddings are a descriptor role, so the routing
    // authority advertises it even though the lab profile omits it.
    expect(NEEDLE_DESCRIPTOR.taskRoles).toContain("embed-texts");
  });
});
