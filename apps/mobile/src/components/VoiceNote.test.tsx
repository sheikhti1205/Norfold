// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceMessagePlayer, VoiceRecordingPanel } from "./VoiceNote";

afterEach(cleanup);
const peaks = [0, .25, 1, .5, 0];
const noop = () => undefined;

function progress(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="progressbar"]');
}

function fillWidth(container: HTMLElement): string | null {
  return container.querySelector<HTMLElement>(".fb-chat-voice-progress-fill")?.style.width ?? null;
}

function barAfter(container: HTMLElement, rowSelector: string): boolean {
  const row = container.querySelector(rowSelector);
  const bar = container.querySelector(".fb-chat-voice-progress");
  return !!row && !!bar && row.nextElementSibling === bar;
}

describe("one continuous voice progress indicator", () => {
  it("draws one progress bar and no waveform in the delivered note", () => {
    const { container } = render(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={0}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(container.querySelectorAll(".fb-chat-voice-progress")).toHaveLength(1);
    expect(container.querySelectorAll(".fb-chat-voice-bar")).toHaveLength(0);
    expect(container.querySelectorAll(".fb-chat-voice-cursor")).toHaveLength(0);
    expect(container.querySelectorAll(".fb-voice-capture-fill")).toHaveLength(0);
    expect(progress(container)?.getAttribute("aria-valuemin")).toBe("0");
    expect(progress(container)?.getAttribute("aria-valuemax")).toBe("100");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("0");
    expect(progress(container)?.getAttribute("aria-valuetext")).toBe("0:00 of 0:08, 0:08 left");
    expect(fillWidth(container)).toBe("0%");
    expect(container.textContent).toContain("0:00");
    expect(container.textContent).toContain("0:08 left");
    expect(barAfter(container, ".fb-chat-voice-row")).toBe(true);
  });

  it("moves the delivered clock and bar with playback and honours an explicit zero", () => {
    const { container, rerender } = render(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={0}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    rerender(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={2_000}
      playing ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.textContent).toContain("0:02");
    expect(container.textContent).toContain("0:06 left");
    expect(fillWidth(container)).toBe("25%");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByRole("button", { name: "Pause voice message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Playback speed 1×" })).toBeTruthy();
    // The owner pauses on this note: it keeps showing where the take stopped.
    rerender(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={2_000}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.textContent).toContain("0:02");
    expect(container.textContent).toContain("0:06 left");
    // While the element holds a different note the clock is withheld, and this
    // bubble keeps its own last position instead of reading a stranger's.
    rerender(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={undefined}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.textContent).toContain("0:02");
    expect(container.textContent).toContain("0:06 left");
    expect(fillWidth(container)).toBe("25%");
    // A supplied 0 is the owner speaking: a seek to the start, or a reset.
    rerender(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={0}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.querySelector(".fb-chat-voice-time")?.textContent).toBe("0:00");
    expect(container.querySelector(".fb-chat-voice-remaining")?.textContent).toBe("0:08 left");
    expect(fillWidth(container)).toBe("0%");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("0");
  });

  it("ends at the full duration and clamps non-finite input", () => {
    const { container, rerender } = render(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={8_000}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.textContent).toContain("0:08");
    expect(container.textContent).toContain("0:00 left");
    expect(fillWidth(container)).toBe("100%");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("100");
    rerender(<VoiceMessagePlayer peaks={peaks} durationMs={Number.NaN} positionMs={Number.NaN}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.textContent).toContain("0:00");
    expect(container.textContent).toContain("0:00 left");
    expect(fillWidth(container)).toBe("0%");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("0");
    expect((screen.getByRole("button", { name: "Play voice message" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<VoiceMessagePlayer peaks={peaks} durationMs={Number.POSITIVE_INFINITY} positionMs={3_000}
      playing={false} ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(fillWidth(container)).toBe("0%");
    expect((screen.getByRole("button", { name: "Play voice message" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the elapsed and remaining clocks on one whole-second line", () => {
    const { container } = render(<VoiceMessagePlayer peaks={peaks} durationMs={8_400} positionMs={5_900}
      playing ready avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect(container.querySelector(".fb-chat-voice-time")?.textContent).toBe("0:05");
    expect(container.querySelector(".fb-chat-voice-remaining")?.textContent).toBe("0:03 left");
    expect(fillWidth(container)).toBe("70%");
  });

  it("keeps the play control disabled until the note is ready", () => {
    render(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={0} playing={false}
      ready={false} avatar={<span>Alex</span>} onToggle={noop} rate={1} onRate={noop} />);
    expect((screen.getByRole("button", { name: "Play voice message" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("recorder progress and clocks", () => {
  const cases: Array<[number, string, string, string]> = [
    [0, "0%", "0:00", "5:00 left"],
    [60_000, "20%", "1:00", "4:00 left"],
    [240_000, "80%", "4:00", "1:00 left"],
    [300_000, "100%", "5:00", "0:00 left"],
  ];
  for (const [elapsed, width, left, right] of cases) {
    it(`shows ${width} at ${elapsed}ms with elapsed and remaining labels`, () => {
      const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks}
        elapsedMs={elapsed} captureElapsedMs={elapsed} percent={0} playing={false}
        onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
      expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
      expect(container.querySelectorAll(".fb-chat-voice-bar")).toHaveLength(0);
      expect(container.querySelectorAll(".fb-voice-capture-fill")).toHaveLength(0);
      expect(container.querySelectorAll(".fb-voice-capture-mark")).toHaveLength(0);
      expect(fillWidth(container)).toBe(width);
      expect(progress(container)?.getAttribute("aria-valuenow")).toBe(String(Number.parseInt(width, 10)));
      expect(container.textContent).toContain(left);
      expect(container.textContent).toContain(right);
      expect(barAfter(container, ".fb-voice-panel-actions")).toBe(true);
    });
  }

  it("uses the five-minute ceiling but never sends on its own", () => {
    const send = vi.fn();
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={300_000}
      captureElapsedMs={300_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={send} />);
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("100");
    expect(container.querySelector(".fb-voice-panel-remaining")).toBeNull();
    expect(send).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledOnce();
  });

  it("reads capture time, never the preview percent, while recording", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={95_000}
      captureElapsedMs={95_000} percent={75} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(fillWidth(container)).toBe("32%");
    expect(container.textContent).toContain("1:35");
    expect(container.textContent).toContain("3:25 left");
  });

  it("falls back to the elapsed clock when the capture clock is not supplied", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={61_000}
      percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(fillWidth(container)).toBe("20%");
    expect(container.textContent).toContain("1:01");
    expect(container.textContent).toContain("3:59 left");
  });

  it("clamps non-finite capture values to the five-minute window", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks}
      elapsedMs={Number.POSITIVE_INFINITY} captureElapsedMs={Number.POSITIVE_INFINITY}
      captureLimitMs={Number.NaN} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(fillWidth(container)).toBe("0%");
    expect(container.textContent).toContain("0:00");
    expect(container.textContent).toContain("5:00 left");
  });

  it("uses the recorded total and playback position in review", () => {
    const { container, rerender } = render(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={125_000} captureElapsedMs={125_000} percent={0} playing={false}
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.textContent).toContain("0:00");
    expect(container.textContent).toContain("2:05 left");
    expect(fillWidth(container)).toBe("0%");
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={25_000} positionMs={25_000} captureElapsedMs={125_000} percent={20} playing
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.textContent).toContain("0:25");
    expect(container.textContent).toContain("1:40 left");
    expect(fillWidth(container)).toBe("20%");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("20");
  });

  it("derives the review position from percent when no explicit position is supplied", () => {
    const { container } = render(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={50_000} captureElapsedMs={125_000} percent={40} playing
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.textContent).toContain("0:50");
    expect(container.textContent).toContain("1:15 left");
    expect(fillWidth(container)).toBe("40%");
  });

  it("holds its own position when the clock is withheld but resets on an explicit zero", () => {
    const { container, rerender } = render(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={25_000} positionMs={25_000} captureElapsedMs={125_000} percent={20} playing
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.textContent).toContain("0:25");
    // The owner pauses: it still reports this take's exact stopped position.
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={25_000} positionMs={25_000} captureElapsedMs={125_000} percent={20} playing={false}
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.textContent).toContain("0:25");
    expect(container.textContent).toContain("1:40 left");
    // While the element holds another clip the clock is withheld, and no
    // legacy percent arrives, so this take keeps its own last position.
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={125_000} positionMs={undefined} captureElapsedMs={125_000} percent={0} playing={false}
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.textContent).toContain("0:25");
    expect(container.textContent).toContain("1:40 left");
    expect(fillWidth(container)).toBe("20%");
    // An explicit zero is the owner speaking: a preview seek to the start.
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={125_000} positionMs={0} captureElapsedMs={125_000} percent={0} playing={false}
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.querySelector(".fb-chat-voice-time")?.textContent).toBe("0:00");
    expect(container.querySelector(".fb-chat-voice-remaining")?.textContent).toBe("2:05 left");
    expect(fillWidth(container)).toBe("0%");
    // A new take must not inherit the previous take's retained position.
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={60_000} positionMs={undefined} captureElapsedMs={60_000} percent={0} playing={false}
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(container.textContent).toContain("0:00");
    expect(container.textContent).toContain("1:00 left");
    expect(fillWidth(container)).toBe("0%");
  });

  it("reaches the exact recorded total and a full bar at the end of review", () => {
    const { container } = render(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={8_000} positionMs={8_000} durationMs={8_000} captureElapsedMs={8_000}
      percent={100} playing={false} previewReady canResume onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelector(".fb-chat-voice-time")?.textContent).toBe("0:08");
    expect(container.querySelector(".fb-chat-voice-remaining")?.textContent).toBe("0:00 left");
    expect(fillWidth(container)).toBe("100%");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("100");
    expect(container.textContent).toContain("of 0:08, 0:00 left");
  });

  it("clamps a non-finite review duration instead of dividing by it", () => {
    const { container } = render(<VoiceRecordingPanel phase="review" peaks={peaks}
      elapsedMs={Number.NaN} positionMs={Number.NaN} durationMs={Number.POSITIVE_INFINITY}
      captureElapsedMs={Number.NaN} percent={100} playing={false}
      previewReady canResume onPreview={noop} onPause={noop} onResume={noop}
      onDiscard={noop} onSend={noop} />);
    expect(fillWidth(container)).toBe("0%");
    expect(progress(container)?.getAttribute("aria-valuenow")).toBe("0");
    expect(container.textContent).toContain("0:00 left");
  });

  it("keeps the elapsed and remaining labels as separate nowrap units", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    const labels = container.querySelectorAll(".fb-voice-panel-clock > *");
    expect(labels).toHaveLength(2);
    expect(labels[0]?.classList.contains("fb-chat-voice-time")).toBe(true);
    expect(labels[1]?.classList.contains("fb-chat-voice-remaining")).toBe(true);
    expect(labels[0]?.textContent).toBe("4:15");
    expect(labels[1]?.textContent).toBe("0:45 left");
  });
});

describe("recorder status and warnings", () => {
  it("announces the last minute once at the four-minute threshold", () => {
    const { rerender } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={239_999}
      captureElapsedMs={239_999} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording");
    rerender(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={240_000}
      captureElapsedMs={240_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording. One minute left");
    rerender(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording. One minute left");
  });

  it("marks the remaining label in the final minute without adding marks", () => {
    const { container, rerender } = render(<VoiceRecordingPanel phase="recording" peaks={peaks}
      elapsedMs={239_999} captureElapsedMs={239_999} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelector(".fb-voice-panel-remaining")).toBeNull();
    rerender(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={240_000}
      captureElapsedMs={240_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelector(".fb-voice-panel-remaining")?.textContent).toBe("1:00 left");
    expect(container.querySelectorAll(".fb-voice-capture-mark")).toHaveLength(0);
    rerender(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelector(".fb-voice-panel-remaining")?.textContent).toBe("0:45 left");
  });

  it("keeps sending, preparing and review notices ahead of the minute warning", () => {
    const { rerender } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false} sending
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Sending voice message");
    rerender(<VoiceRecordingPanel phase="pausing" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Preparing preview");
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false} previewReady canResume
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording paused. Preview, resume or send.");
  });
});

describe("recorder actions and admission", () => {
  it("uses separate compact controls with real resume and icon actions", () => {
    const preview = vi.fn(), resume = vi.fn(), send = vi.fn(), discard = vi.fn();
    render(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={8_000}
      captureElapsedMs={8_000} percent={0} playing={false} previewReady canResume
      onPreview={preview} onPause={noop} onResume={resume} onSend={send} onDiscard={discard} />);
    const panel = screen.getByRole("group", { name: "Voice message ready" });
    const actions = panel.querySelector(".fb-voice-panel-actions");
    for (const name of ["Discard recording", "Play voice preview", "Resume recording", "Send voice message"]) {
      expect(actions?.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: "Play voice preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    expect(preview).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();
    expect(panel.querySelector("textarea")).toBeNull();
    expect(screen.getByRole("button", { name: "Send voice message" }).textContent).toBe("");
  });

  it("sends a live recording without forcing the reader to stop first", () => {
    const send = vi.fn();
    render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={3_000}
      captureElapsedMs={3_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={send} />);
    const button = screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeTruthy();
  });

  it("keeps send unavailable while the take is still being prepared", () => {
    render(<VoiceRecordingPanel phase="pausing" peaks={peaks} elapsedMs={3_000}
      captureElapsedMs={3_000} percent={0} playing={false}
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect((screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("locks pause, discard and send while a live take is being finalized", () => {
    render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={3_000}
      captureElapsedMs={3_000} percent={0} playing={false} sending
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    for (const name of ["Pause recording", "Discard recording", "Sending voice message"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("locks review controls during durable admission", () => {
    render(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={8_000}
      captureElapsedMs={8_000} percent={0} playing={false} previewReady canResume sending
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    for (const name of ["Discard recording", "Resume recording", "Sending voice message"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("voice-note compact and motion contract", () => {
  // Vitest runs from apps/mobile. This repo's jsdom source readers resolve from
  // process.cwd(); a file-URL read is the failure mode this environment hit
  // before, so the CSS contract uses the same absolute path as the others.
  const css = readFileSync(resolve(process.cwd(), "src/components/voiceNote.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();

  /** Declarations of the one rule whose selector is exactly `selector`. */
  function ruleBody(selector: string): string | undefined {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\}\\s*)${escaped}\\s*\\{([^{}]*)\\}`).exec(css)?.[1];
  }

  /** Every rule in the sheet. A whole match always fills both required groups;
   * the guard turns a parser miss into a failing test instead of an assertion
   * that silently skips. */
  function allRules(): Array<{ selector: string; body: string }> {
    return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => {
      const selector = match[1];
      const body = match[2];
      if (selector === undefined || body === undefined) {
        throw new Error("voice-note css parser: rule match without selector or body");
      }
      return { selector: selector.trim(), body };
    });
  }

  it("owns one thin progress bar and no waveform or second capture line", () => {
    expect(ruleBody(".fb-chat-voice-progress")).toMatch(/height:3px/);
    expect(ruleBody(".fb-chat-voice-progress-fill")).toMatch(/background:var\(--fb-primary\)/);
    expect(css).not.toMatch(/fb-chat-voice-bar|fb-chat-voice-track|fb-chat-voice-cursor|fb-voice-capture-/);
    const barRules = allRules()
      .filter(({ selector }) => /(^|[ .>])\.fb-chat-voice-progress(?![-\w])/.test(selector))
      .map(({ selector }) => selector);
    expect(barRules).toEqual([".fb-chat-voice-progress", ".fb-chat-voice-panel .fb-chat-voice-progress"]);
    expect(ruleBody(".fb-chat-voice-panel .fb-chat-voice-progress")).toMatch(/margin-top:\.35rem/);
  });

  it("keeps the delivered and recorder widths compact and pixel-bounded", () => {
    expect(ruleBody(".fb-chat-voice")).toMatch(/width:260px/);
    expect(ruleBody(".fb-chat-voice")).toMatch(/max-width:100%/);
    expect(ruleBody(".fb-chat-voice-panel")).toMatch(/max-width:300px/);
    expect(ruleBody(".fb-chat-voice-panel")).toMatch(/align-self:flex-start/);
    expect(css).not.toMatch(/18\.5rem|54px 44px|max-width:45%/);
  });

  it("lets elapsed and remaining labels wrap as whole units, never per character", () => {
    expect(ruleBody(".fb-chat-voice-time")).toMatch(/white-space:nowrap/);
    expect(ruleBody(".fb-chat-voice-remaining")).toMatch(/white-space:nowrap/);
    expect(ruleBody(".fb-chat-voice-clock")).toMatch(/flex-wrap:wrap/);
    expect(ruleBody(".fb-voice-panel-clock")).toMatch(/flex-wrap:wrap/);
    expect(ruleBody(".fb-chat-message-voice .fb-chat-time")).toMatch(/white-space:nowrap/);
  });

  it("puts the voice timestamp and status in normal flow, never over the bar", () => {
    const status = ruleBody(".fb-chat-message-voice .fb-chat-message-status") ?? "";
    expect(status).toMatch(/position:static/);
    expect(status).toMatch(/max-width:none/);
    expect(status).not.toMatch(/position:absolute|calc\(100% - 5rem\)/);
  });

  it("pulses the last-minute warning once, not on a loop, and holds the bar still under reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion:no-preference) { .fb-voice-panel-remaining { animation:fb-voice-warning .4s var(--ease-fb) 1; }");
    expect(css).toContain("@keyframes fb-voice-warning {");
    expect(css).not.toMatch(/fb-voice-warning[^;]*infinite/);
    expect(css).toContain("@media (prefers-reduced-motion:reduce) { .fb-chat-voice-progress-fill { transition:none; } }");
  });
});
