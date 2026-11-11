/**
 * Phase A (Step 2): canonical model descriptor registry.
 *
 * MODEL != RUNTIME != FORMAT != TASK. Every production fact about an
 * on-device model — display, artifact, pins, capabilities, permitted task
 * roles, maturity, trust, license, memory, ABIs — lives in exactly one
 * descriptor. No production logic may identify a model by list position
 * (`DOWNLOAD_MODELS[0]`/`[1]`); use `descriptorFor`,
 * capability lookup, or the descriptor's own `runtimeId`.
 *
 * Test-only third descriptors are first-class: build a custom registry with
 * `createModelRegistry([...production, third])` and inject it. Production
 * code paths use the frozen `productionModelRegistry()` singleton.
 */
import { NEEDLE_MODEL_ID } from "./needle/embedder";
import { profileFor } from "./modelProfiles";
import type { AiTaskId } from "./types";
import type { ModelArtifact } from "./modelSupply";
import { RETIRED_CURATED_CLEANUP } from "./retiredModelCleanup";

/** Retained runtime id; `test-*` ids exist only in test registries. */
export const NEEDLE_RUNTIME_ID = "needle-cact" as const;
/** Historical labels below exist only for upgrade-cleanup identities. */
/** Historical GGUF cleanup label; no executable adapter or product roles. */
export const LLAMA_CPP_RUNTIME_ID = "llamacpp-gguf" as const;

export type ModelArtifactFormat = "cact" | "litertlm" | "gguf" | "tflite";

export type ModelCapability = "text" | "embedding" | "matching";

export type ModelMaturity = "production" | "lab" | "experimental";

/**
 * Consumer catalogue tier. Recommended rows are verified, distributable,
 * and device-qualified; Advanced rows are visible but truthfully gated
 * (pin-verification-required, license-restricted, or unmeasured). The
 * default derives from maturity so older literals keep their meaning.
 */
export type ModelTier = "recommended" | "advanced";

/**
 * Distribution policy (gates check this, never prose):
 * - `downloadable`: verified pin + redistributable license, offered for download.
 * - `license-restricted`: operational policy only, not an upstream legal claim.
 * - `unavailable`: pending pin verification or measurement — visible with
 *   the consumer reason, no install path of any kind.
 */
export type DistributionPolicy = "downloadable" | "license-restricted" | "unavailable";

export type ModelTrust = "curated" | "imported";

export interface ModelDescriptor {
  /** Historical file identity retained for upgrade cleanup, never acquisition or inference. */
  readonly cleanupOnly?: boolean;
  readonly sources?: readonly string[];
  readonly companions?: readonly ModelArtifact[];
  readonly minRuntimeVersion?: string;
  readonly deviceQualifiedAbis?: readonly string[];
  readonly modelId: string;
  readonly displayName: string;
  /** Consumer catalogue copy (normal tier: no ids, checksums, or transfer jargon). */
  readonly consumerTitle: string;
  readonly consumerDetail: string;
  /** Physical runtime that executes this model (never an array index). */
  readonly runtimeId: string;
  readonly format: ModelArtifactFormat;
  /** Immutable catalogue revision; doubles as the install path segment. */
  readonly revision: string;
  /** SHA-256 of the exact downloadable bytes. */
  readonly sha256: string;
  readonly fileName: string;
  readonly url: string;
  readonly bytes: number;
  /** Vision is retained solely as historical cleanup modality metadata. */
  readonly capabilities: readonly (ModelCapability | "vision")[];
  /** Norfold task roles this model may serve in production. */
  readonly taskRoles: readonly AiTaskId[];
  readonly maturity: ModelMaturity;
  readonly trust: ModelTrust;
  /** Distribution/license policy label (gates check this, not prose). */
  readonly license: string;
  readonly minRamMb: number;
  readonly recommendedRamMb: number;
  /** Verified executable ABIs. Empty means unverified everywhere. */
  readonly abis: readonly string[];
  /** Listed on the consumer download catalogue. */
  readonly downloadable: boolean;
  /**
   * Consumer catalogue tier. Omitted means derived from maturity
   * (production → recommended, anything else → advanced).
   */
  readonly tier?: ModelTier;
  /**
   * True when the model's license would permit running a user-supplied local
   * copy (LFM license arms). This is a license fact only: Norfold ships no
   * download or import action for it, so the UI must show the restriction and
   * offer nothing.
   */
  readonly importable?: boolean;
  /**
   * Consumer-facing reason shown when the model cannot be installed
   * (legal restriction, pending verification). Normal tier copy: no ids,
   * hashes, or runtime jargon.
   */
  readonly distributionNote?: string;
  /**
   * Upstream repo (org/name) for Advanced transparency. Pins still live
   * in revision/sha256; this is provenance display only.
   */
  readonly upstreamRepo?: string;
  /**
   * True only for user-supplied files that were never curated/verified as a
   * known pin (identity stays `imported-<sha256>`, trust `imported`). The
   * production task seams refuse these: they are reachable only through the
   * explicit Advanced evaluation path, which runs them as an evaluation load.
   */
  readonly untrustedImport?: boolean;
}

/** Consumer tier of one descriptor (explicit tier wins, else maturity-derived). */
export function tierOf(descriptor: ModelDescriptor): ModelTier {
  if (descriptor.tier !== undefined) return descriptor.tier;
  return descriptor.maturity === "production" ? "recommended" : "advanced";
}

/** Machine-readable distribution policy derived from the descriptor. */
export function distributionPolicyOf(descriptor: ModelDescriptor): DistributionPolicy {
  if (descriptor.cleanupOnly) return "unavailable";
  if (descriptor.downloadable) return "downloadable";
  if (descriptor.importable === true) return "license-restricted";
  return "unavailable";
}

export interface ModelRegistry {
  readonly descriptors: readonly ModelDescriptor[];
  descriptorFor(modelId: string): ModelDescriptor | undefined;
  requireDescriptor(modelId: string): ModelDescriptor;
  /** All downloadable catalogue entries, in catalogue order. */
  catalogue(): readonly ModelDescriptor[];
}

function profilePin(modelId: string): { revision: string; sha256: string } {
  const profile = profileFor(modelId);
  if (profile === undefined) throw new Error(`No model profile for ${modelId}`);
  return { revision: profile.revision, sha256: profile.modelSha256 };
}

const NEEDLE_PIN = profilePin(NEEDLE_MODEL_ID);
/**
 * Audit closure: Needle's advertised roles are exactly what its native
 * path genuinely satisfies today — the record_item tool-constrained
 * structured path (slot extraction with strict validators) and the
 * embedding path (validated vectors). Each structured task has its own
 * tool schema. Intent tasks are deterministic-only with this descriptor;
 * local prose and photo-generation tasks are retired.
 */
const NEEDLE_TEXT_ROLES: readonly AiTaskId[] = [
  "extract-report-fields",
  "extract-search-filters",
  "classify-category",
  "embed-texts",
];

export const NEEDLE_DESCRIPTOR: ModelDescriptor = {
  modelId: NEEDLE_MODEL_ID,
  displayName: "Needle · structured text / matching challenger",
  consumerTitle: "Local text tools",
  consumerDetail: "Needle3",
  runtimeId: NEEDLE_RUNTIME_ID,
  format: "cact",
  revision: NEEDLE_PIN.revision,
  sha256: NEEDLE_PIN.sha256,
  fileName: "needle3.cact",
  url: "https://huggingface.co/Cactus-Compute/needle3/resolve/c7c415a3d1b3d929014bc6e866d51ebb971f7089/needle3.cact",
  bytes: 35335380,
  capabilities: ["text", "embedding", "matching"],
  taskRoles: NEEDLE_TEXT_ROLES,
  maturity: "production",
  trust: "curated",
  license: "redistributable-cactus",
  // Current effective assumption (was the coarse 1500 for every model).
  // A lower Needle-specific bound needs same-device measurement first.
  minRamMb: 1500,
  recommendedRamMb: 2048,
  // Verified: native needle target builds arm64-v8a only (CMake lab gate).
  abis: ["arm64-v8a"],
  downloadable: true,
};

/**
 * The retired generative descriptors survive ONLY as exact upgrade-cleanup
 * identities: pins, modality and file locations so an upgrade can still find
 * and remove bytes an older build downloaded. They are never downloadable,
 * never serve a task, and never appear on a catalogue.
 */
const ALL_DESCRIPTORS: readonly ModelDescriptor[] = [
  NEEDLE_DESCRIPTOR,
  ...RETIRED_CURATED_CLEANUP,
];

/** True when the descriptor verifies this ABI. Unknown ABI never counts. */
export function modelSupportsAbi(descriptor: ModelDescriptor, abi: string): boolean {
  return abi !== "" && descriptor.abis.includes(abi);
}

export function createModelRegistry(
  descriptors: readonly ModelDescriptor[],
): ModelRegistry {
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.modelId)) throw new Error(`Duplicate model descriptor ${descriptor.modelId}`);
    seen.add(descriptor.modelId);
  }
  const frozen = Object.freeze([...descriptors]);
  return {
    descriptors: frozen,
    descriptorFor: (modelId: string) => frozen.find((item) => item.modelId === modelId),
    requireDescriptor: (modelId: string) => {
      const found = frozen.find((item) => item.modelId === modelId);
      if (found === undefined) throw new Error("Unknown on-device model");
      return found;
    },
    catalogue: () => frozen.filter((item) => !item.cleanupOnly && item.downloadable && tierOf(item) === "recommended"),
  };
}

let production: ModelRegistry | undefined;

/**
 * Canonical production policy: retained narrow tools are active; rejected
 * generation records remain only as exact upgrade-cleanup identities. Raw
 * historical descriptor constants above are not the production catalogue.
 */
export function productionModelRegistry(): ModelRegistry {
  return (production ??= createModelRegistry(
    ALL_DESCRIPTORS,
  ));
}
