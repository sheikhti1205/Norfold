/**
 * A voice note's real envelope.
 *
 * WhatsApp paints measured amplitude, not a decorative pattern, and the owner
 * asked for the same. The measurement is taken twice in a note's life:
 *
 *  - while recording, from the live microphone (see `voiceMeter.ts`);
 *  - everywhere else, by decoding the container the device actually holds.
 *
 * Decoding is bounded on purpose: a five minute stereo note at the device rate
 * is ~115 MB of floats before any windowing. The decoder context therefore asks
 * the platform for 8 kHz mono, which is still 20x the resolution the bars need.
 * If a runtime refuses that rate, the default context is used and the peaks are
 * still computed from a single channel.
 */

/** Bars in a bubble. Dense enough to read as speech, few enough to repaint. */
export const VOICE_BARS = 40;

export interface VoicePeaks {
  /** One 0..1 amplitude per bar, in playback order. */
  bars: number[];
  /** True when these came from decoded audio rather than a fallback pattern. */
  measured: boolean;
}

/** Quiet speech must still show: raw maxima collapse most bars to nothing. */
const GAMMA = 0.6;

/**
 * Window the samples and keep the loudest absolute value per bar.
 *
 * Peak, not RMS: a waveform is a shape, and RMS flattens the attack of a word
 * into the same rounded block as the vowel after it.
 */
export function peaksFromSamples(samples: Float32Array, bars = VOICE_BARS): number[] {
  const count = Math.max(1, Math.floor(bars));
  const out: number[] = [];
  if (samples.length === 0) return new Array(count).fill(0);
  const width = samples.length / count;
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * width);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * width)));
    let peak = 0;
    for (let cursor = start; cursor < end; cursor++) {
      const value = Math.abs(samples[cursor] ?? 0);
      if (value > peak) peak = value;
    }
    out.push(peak);
  }
  const loudest = Math.max(...out);
  if (!(loudest > 0)) return new Array(count).fill(0);
  return out.map((value) => Math.min(1, Math.pow(value / loudest, GAMMA)));
}

/** Bar height in percent. A silent bar is a dot, never a gap. */
export function peakPercent(value: number): number {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return 14 + Math.round(clamped * 86);
}

/**
 * Live samples arrive relative to the device's microphone level, which differs
 * between a phone held close and one across the room. Normalising against the
 * note's own loudest moment is what makes the drawn shape readable either way.
 */
export function normalizePeaks(values: readonly number[]): number[] {
  const loudest = values.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0);
  if (!(loudest > 0)) return values.map(() => 0);
  return values.map((value) => Math.min(1, Math.pow(Math.max(0, value) / loudest, GAMMA)));
}

type AudioContextCtor = new (options?: { sampleRate?: number }) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

let decoder: AudioContext | null = null;

/** A low-rate context keeps the decoded buffer small; the default is the fallback. */
function decodeContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (decoder) return decoder;
  try {
    decoder = new Ctor({ sampleRate: 8_000 });
  } catch {
    try { decoder = new Ctor(); } catch { return null; }
  }
  return decoder;
}

/**
 * Decode a container and return its envelope, or `null` when this runtime
 * cannot decode it (no AudioContext, unsupported codec, corrupt bytes).
 *
 * The caller owns the fallback; this function never invents a shape.
 */
export async function decodeVoicePeaks(bytes: ArrayBuffer, bars = VOICE_BARS): Promise<number[] | null> {
  const context = decodeContext();
  if (!context) return null;
  // `decodeAudioData` detaches the buffer it is given, and the caller still
  // needs the bytes for playback.
  const copy = bytes.slice(0);
  try {
    const buffer = await context.decodeAudioData(copy);
    const samples = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
    const peaks = peaksFromSamples(samples, bars);
    return peaks;
  } catch {
    return null;
  }
}

/** One bounded cache: the same note keeps the same bars across remounts. */
const cache = new Map<string, VoicePeaks>();
const CACHE_LIMIT = 120;

/** Re-bucket a measured (or live) sequence into exactly `bars` values. */
export function resamplePeaks(values: readonly number[], bars = VOICE_BARS): number[] {
  if (values.length === 0) return new Array(bars).fill(0);
  if (values.length === bars) return normalizePeaks(values);
  const out: number[] = [];
  const width = values.length / bars;
  for (let index = 0; index < bars; index++) {
    const start = Math.floor(index * width);
    const end = Math.min(values.length, Math.max(start + 1, Math.floor((index + 1) * width)));
    let peak = 0;
    for (let cursor = start; cursor < end; cursor++) {
      const value = values[cursor] ?? 0;
      if (value > peak) peak = value;
    }
    out.push(peak);
  }
  return normalizePeaks(out);
}

/**
 * One decode at a time. A thread can hold dozens of notes, and each decode
 * allocates a full float buffer; letting them all run at once is how a phone
 * runs out of memory while scrolling.
 */
let decodeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = decodeChain.then(work, work);
  decodeChain = next.catch(() => undefined);
  return next;
}

/** Decode through the shared queue, so a burst of notes cannot stack up. */
export function queueVoicePeaks(bytes: ArrayBuffer, bars = VOICE_BARS): Promise<number[] | null> {
  return serialized(() => decodeVoicePeaks(bytes, bars));
}

export function cachedVoicePeaks(key: string): VoicePeaks | null {
  return cache.get(key) ?? null;
}

export function rememberVoicePeaks(key: string, peaks: VoicePeaks): void {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, peaks);
}

/** Test seam: the cache is module state. */
export function clearVoicePeakCache(): void {
  cache.clear();
}
