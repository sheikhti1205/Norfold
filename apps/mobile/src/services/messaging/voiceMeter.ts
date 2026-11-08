/**
 * Live input level while a note is being recorded.
 *
 * The recorder only knows "still recording"; the shape of what is being said
 * lives on the same microphone stream. One AnalyserNode reads the time domain
 * every tick, which is a few hundred samples — cheap enough to run next to the
 * recorder and enough for forty bars.
 *
 * Nothing here decides anything: no bars is a valid state and the screen falls
 * back to the decoded envelope of the finished note.
 */
export interface VoiceMeter {
  /** Current level, 0..1, relative to full scale. 0 when the graph is silent. */
  read(): number;
  close(): void;
}

type AudioContextCtor = new (options?: { sampleRate?: number }) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** `null` when this runtime cannot measure; a note still records without bars. */
export function createInputMeter(stream: MediaStream): VoiceMeter | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  let context: AudioContext | null = null;
  try {
    context = new Ctor();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    // Deliberately not connected to the destination: monitoring a recording
    // into the speaker is feedback.
    const frame = new Float32Array(analyser.fftSize);
    return {
      read() {
        analyser.getFloatTimeDomainData(frame);
        let peak = 0;
        for (const value of frame) {
          const magnitude = Math.abs(value);
          if (magnitude > peak) peak = magnitude;
        }
        // The graph can hand back more than full scale on a hot input.
        return Math.min(1, peak);
      },
      close() {
        try { void context?.close(); } catch { /* already closed */ }
        context = null;
      },
    };
  } catch {
    try { void context?.close(); } catch { /* already closed */ }
    return null;
  }
}
