// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizePeaks, peakPercent, peaksFromSamples, resamplePeaks, VOICE_BARS } from "../services/messaging/voicePeaks";

/** A synthetic syllable: quiet, loud, quiet. Enough to prove the envelope
 * follows amplitude rather than a hash. */
function syllable(length: number): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const phase = index / length;
    const envelope = Math.sin(Math.PI * phase) ** 2;
    samples[index] = envelope * 0.8 * Math.sin(index / 3);
  }
  return samples;
}

describe("a voice note's envelope", () => {
  it("follows the audio, so a loud window is a tall bar and silence is a dot", () => {
    const samples = new Float32Array(8_000);
    // Only the middle 2 000 samples carry sound.
    for (let index = 3_000; index < 5_000; index++) samples[index] = index % 2 ? 0.9 : -0.9;
    const bars = peaksFromSamples(samples, 8);
    expect(bars).toHaveLength(8);
    const loud = bars[3] ?? 0;
    expect(loud).toBeCloseTo(1, 5);
    expect(bars[0] ?? 0).toBe(0);
    expect(bars[7] ?? 0).toBe(0);
    // Peak, not average: the loud window keeps its full height.
    expect(peakPercent(loud)).toBe(100);
    expect(peakPercent(0)).toBe(14);
  });

  it("keeps speech visible instead of collapsing quiet words to nothing", () => {
    const bars = peaksFromSamples(syllable(4_000), VOICE_BARS);
    expect(Math.max(...bars)).toBeCloseTo(1, 5);
    // A word at a tenth of the loudest amplitude still reads as a bar, not as
    // a gap: the gamma lift turns 0.1 into a quarter-height bar.
    const quiet = normalizePeaks([0.1, 1])[0] ?? 0;
    expect(peakPercent(quiet)).toBeGreaterThan(30);
  });

  it("normalises live readings against the note's own loudest moment", () => {
    const quiet = normalizePeaks([0.02, 0.04, 0.02]);
    const loud = normalizePeaks([0.4, 0.8, 0.4]);
    expect(quiet[1]).toBeCloseTo(1, 5);
    expect(loud[1]).toBeCloseTo(1, 5);
    expect(quiet[0]).toBeCloseTo(loud[0] ?? 0, 5);
  });

  it("re-buckets a live sequence into a fixed number of bars without inventing peaks", () => {
    const live = new Array(160).fill(0);
    live[80] = 1;
    const bars = resamplePeaks(live, 40);
    expect(bars).toHaveLength(40);
    expect(bars.filter((value) => value > 0)).toHaveLength(1);
    expect(bars[20]).toBeCloseTo(1, 5);
  });

  it("treats an empty note as a flat line of dots, never as NaN", () => {
    expect(resamplePeaks([], 12)).toEqual(new Array(12).fill(0));
    expect(peaksFromSamples(new Float32Array(0), 5)).toEqual(new Array(5).fill(0));
    expect(peakPercent(Number.NaN)).toBe(14);
  });
});
