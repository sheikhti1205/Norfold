// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceMessagePlayer, VoiceRecordingPanel } from "./VoiceNote";
import { VOICE_BARS } from "../services/messaging/voicePeaks";

afterEach(cleanup);
const peaks = [0, .25, 1, .5, 0];
const noop = () => undefined;

/** The one full-width sweep of the current minute, as a width string. */
function fillWidth(container: HTMLElement): string | null {
  return container.querySelector<HTMLElement>(".fb-voice-capture-fill")?.style.width ?? null;
}

describe("reference voice-note geometry", () => {
  it("uses separate waveform and action rows for review, with real resume and icon actions", () => {
    const resume = vi.fn(), send = vi.fn(), discard = vi.fn();
    const { container } = render(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={8_000}
      percent={0} playing={false} previewReady canResume onPreview={() => undefined}
      onPause={() => undefined} onResume={resume} onSend={send} onDiscard={discard} />);
    const panel = screen.getByRole("group", { name: "Voice message ready" });
    const row = panel.querySelector(".fb-voice-panel-wave");
    expect(row?.contains(screen.getByRole("button", { name: "Play voice preview" }))).toBe(true);
    expect(row?.textContent).toContain("0:08");
    const actions = panel.querySelector(".fb-voice-panel-actions");
    for (const name of ["Discard recording", "Resume recording", "Send voice message"]) {
      expect(actions?.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: "Resume recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    expect(resume).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce(); expect(discard).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByRole("button", { name: "Send voice message" }).textContent).toBe("");
  });

  it("sends a live recording without forcing the reader to stop first", () => {
    const send = vi.fn();
    render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={3_000}
      percent={0} playing={false} onPreview={() => undefined} onPause={() => undefined}
      onResume={() => undefined} onSend={send} onDiscard={() => undefined} />);
    const button = screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledOnce();
    // The pause control still owns the explicit stop.
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeTruthy();
  });

  it("keeps send unavailable while the take is still being prepared", () => {
    render(<VoiceRecordingPanel phase="pausing" peaks={peaks} elapsedMs={3_000}
      percent={0} playing={false} onPreview={() => undefined} onPause={() => undefined}
      onResume={() => undefined} onSend={() => undefined} onDiscard={() => undefined} />);
    expect((screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("locks pause, discard and send while a live take is being finalized", () => {
    render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={3_000}
      percent={0} playing={false} sending onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    for (const name of ["Pause recording", "Discard recording", "Sending voice message"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("locks review controls during durable admission", () => {
    render(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={8_000}
      percent={0} playing={false} previewReady canResume sending onPreview={() => undefined}
      onPause={() => undefined} onResume={() => undefined} onSend={() => undefined} onDiscard={() => undefined} />);
    for (const name of ["Discard recording", "Resume recording", "Sending voice message"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("puts the clock below the waveform and swaps avatar for working speed control during playback", () => {
    const rate = vi.fn();
    const { container, rerender } = render(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={0}
      playing={false} ready avatar={<span>Alex</span>} onToggle={() => undefined} rate={1} onRate={rate} />);
    expect(container.querySelector(".fb-chat-voice-timeline")?.textContent).toContain("0:08");
    expect(container.querySelector(".fb-chat-voice-identity")?.textContent).toBe("Alex");
    expect(screen.queryByRole("button", { name: /Playback speed/ })).toBeNull();
    rerender(<VoiceMessagePlayer peaks={peaks} durationMs={8_000} positionMs={2_000}
      playing ready avatar={<span>Alex</span>} onToggle={() => undefined} rate={1} onRate={rate} />);
    expect(screen.getByText("0:02")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Playback speed 1×" }));
    expect(rate).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".fb-chat-voice-bar")).toHaveLength(peaks.length);
  });
});

describe("canonical wave geometry", () => {
  it("draws recording, paused preview and review with the shared bar class", () => {
    const { container, rerender } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={3_000}
      percent={75} playing={false} onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    // No `.fb-chat-voice` ancestor: a cap scoped to the delivered bubble can
    // never reach the recorder, which is how the shipped thick bars survived.
    expect(container.querySelector(".fb-voice-panel-wave .fb-chat-voice")).toBeNull();
    expect(container.querySelectorAll(".fb-voice-capture-track .fb-chat-voice-bar")).toHaveLength(peaks.length);
    rerender(<VoiceRecordingPanel phase="pausing" peaks={peaks} elapsedMs={3_000}
      percent={0} playing={false} onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-voice-capture-track .fb-chat-voice-bar")).toHaveLength(peaks.length);
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={3_000}
      percent={75} playing={false} previewReady canResume onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-voice-capture-track .fb-chat-voice-bar")).toHaveLength(peaks.length);
  });
});

describe("capture time track", () => {
  it("sweeps the full track once for the current minute and banks the completed one as a mark", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={95_000}
      captureElapsedMs={95_000} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-voice-capture-mark")).toHaveLength(5);
    expect(container.querySelectorAll(".fb-voice-capture-mark[data-complete]")).toHaveLength(1);
    expect(container.querySelectorAll(".fb-voice-capture-fill")).toHaveLength(1);
    expect(fillWidth(container)).toBe("58%");
    expect(container.querySelector(".fb-voice-capture-fill[data-active]")).toBeTruthy();
    const panel = screen.getByRole("group", { name: "Recording voice message" });
    expect(panel.querySelector(".fb-voice-panel-clock")?.textContent).toBe("1:35");
  });

  // 0/59/60/119/120/240/300: each minute fills 0..100%, then restarts, and each
  // completed minute is banked as one mark.
  const minuteCases: Array<[number, string, number, boolean]> = [
    [0, "0%", 0, false],
    [59_000, "98%", 0, true],
    [60_000, "0%", 1, false],
    [119_000, "98%", 1, true],
    [120_000, "0%", 2, false],
    [240_000, "0%", 4, false],
    [300_000, "100%", 5, false],
  ];
  for (const [elapsed, width, complete, active] of minuteCases) {
    it(`fills ${width} with ${complete} banked minute(s) at ${elapsed}ms`, () => {
      const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks}
        elapsedMs={elapsed} captureElapsedMs={elapsed} percent={0} playing={false}
        onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
      expect(container.querySelectorAll(".fb-voice-capture-mark[data-complete]")).toHaveLength(complete);
      expect(fillWidth(container)).toBe(width);
      expect(container.querySelector(".fb-voice-capture-fill[data-active]") !== null).toBe(active);
    });
  }

  it("starts the fifth sweep empty at four minutes", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={240_000}
      captureElapsedMs={240_000} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-voice-capture-mark[data-complete]")).toHaveLength(4);
    expect(fillWidth(container)).toBe("0%");
    expect(screen.getByRole("group", { name: "Recording voice message" })
      .querySelector(".fb-voice-panel-clock")?.textContent).toBe("4:00 / 1:00 left");
  });

  it("stops at the ceiling with five marks, no sixth sweep, and no automatic send", () => {
    const send = vi.fn();
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={300_000}
      captureElapsedMs={300_000} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={send} />);
    expect(container.querySelectorAll(".fb-voice-capture-mark")).toHaveLength(5);
    expect(container.querySelectorAll(".fb-voice-capture-mark[data-complete]")).toHaveLength(5);
    expect(container.querySelectorAll(".fb-voice-capture-fill")).toHaveLength(1);
    expect(fillWidth(container)).toBe("100%");
    expect(container.querySelector(".fb-voice-capture-fill[data-active]")).toBeNull();
    expect(screen.getByRole("group", { name: "Recording voice message" })
      .querySelector(".fb-voice-panel-clock")?.textContent).toBe("5:00 / 0:00 left");
    expect(send).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledOnce();
  });

  it("shows the last-minute remaining after a real slash in the error colour", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-voice-capture-mark[data-complete]")).toHaveLength(4);
    expect(fillWidth(container)).toBe("25%");
    const clock = screen.getByRole("group", { name: "Recording voice message" }).querySelector(".fb-voice-panel-clock");
    expect(clock?.querySelector(".fb-chat-voice-time")?.textContent).toBe("4:15 / 0:45 left");
    expect(screen.getByText("/ 0:45 left").className).toContain("fb-voice-panel-remaining");
  });

  it("announces the last minute once at the four-minute threshold", () => {
    const { rerender } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={239_999}
      captureElapsedMs={239_999} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording");
    rerender(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={240_000}
      captureElapsedMs={240_000} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording. One minute left");
    rerender(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording. One minute left");
  });

  it("keeps sending, preparing and review notices ahead of the minute warning", () => {
    const { rerender } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false} sending onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Sending voice message");
    rerender(<VoiceRecordingPanel phase="pausing" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Preparing preview");
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={255_000}
      captureElapsedMs={255_000} percent={0} playing={false} previewReady canResume onPreview={noop}
      onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(screen.getByRole("status").textContent).toBe("Recording paused. Preview, resume or send.");
  });

  it("never forwards capture progress into the waveform and keeps preview progress on review", () => {
    const { container, rerender } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={95_000}
      captureElapsedMs={95_000} percent={75} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-chat-voice-bar[data-played]")).toHaveLength(0);
    expect(fillWidth(container)).toBe("58%");
    rerender(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={95_000}
      captureElapsedMs={95_000} percent={75} playing={false} previewReady canResume onPreview={noop}
      onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-chat-voice-bar[data-played]")).toHaveLength(4);
  });

  it("keeps the preview clock and the banked marks on separate clocks", () => {
    const { container } = render(<VoiceRecordingPanel phase="review" peaks={peaks} elapsedMs={2_000}
      captureElapsedMs={125_000} percent={0} playing={false} previewReady canResume
      onPreview={noop} onPause={noop} onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-voice-capture-mark[data-complete]")).toHaveLength(2);
    expect(container.querySelectorAll(".fb-voice-capture-fill")).toHaveLength(0);
    expect(screen.getByText("0:02")).toBeTruthy();
    expect(screen.queryByText(/ left$/)).toBeNull();
  });

  it("falls back to the elapsed clock when the capture clock is not supplied", () => {
    const { container } = render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={61_000}
      percent={0} playing={false} onPreview={noop} onPause={noop}
      onResume={noop} onDiscard={noop} onSend={noop} />);
    expect(container.querySelectorAll(".fb-voice-capture-mark[data-complete]")).toHaveLength(1);
    expect(fillWidth(container)).toBe("2%");
  });
});

describe("voice-note weight and motion contract", () => {
  // Vitest runs from apps/mobile. This repo's jsdom source readers resolve from
  // process.cwd(); a file-URL read is the failure mode this environment hit
  // before, so the CSS contract uses the same absolute path as the others.
  const css = readFileSync(resolve(process.cwd(), "src/components/voiceNote.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

  /** Declarations of the one rule whose selector is exactly `selector`. Scoped
   * checks are the point: a cap that also matches `.fb-chat-voice` passes a
   * loose substring search and still leaves the recorder full width. */
  function ruleBody(selector: string): string | undefined {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\}\\s*)${escaped}\\s*\\{([^{}]*)\\}`).exec(css)?.[1];
  }

  /** Every rule in the sheet, so a compound bar selector cannot hide. A whole
   * match always fills both required groups; the guard turns a parser miss into
   * a failing test instead of an assertion that silently skips. */
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

  it("caps every voice bar in the shared rule, so recording, paused preview and delivered all stay slender", () => {
    const base = ruleBody(".fb-chat-voice-bar");
    expect(base).toBeDefined();
    expect(base).toMatch(/max-width:2px/);
    // No other rule may grow a bar back, and the cap may not be re-scoped to
    // `.fb-chat-voice`, which the recorder's panel never matches.
    const blocked = /flex:[^;]*\b1 1 0\b|flex-grow\s*:\s*[1-9]|(?:^|;)\s*width\s*:\s*(?:[3-9]|\d{2,})px/;
    const widened = allRules()
      .filter(({ selector }) => /(^|[ .>])\.fb-chat-voice-bar(?![\w-])/.test(selector))
      .filter(({ body }) => blocked.test(body))
      .map(({ selector }) => selector);
    expect(widened).toEqual([]);
    expect(css).not.toMatch(/\.fb-chat-voice \.fb-chat-voice-track \.fb-chat-voice-bar/);
    expect(css).not.toMatch(/\.fb-voice-panel-wave \.fb-chat-voice-bar/);
  });

  it("spreads the slender bars across the whole track instead of growing each one", () => {
    expect(ruleBody(".fb-chat-voice-track")).toMatch(/justify-content:space-between/);
    expect(ruleBody(".fb-voice-panel-wave .fb-chat-voice-track")).toMatch(/flex:1/);
  });

  it("keeps 40 bars legible in a narrow delivered track, not hairlines", () => {
    const track = ruleBody(".fb-chat-voice-track") ?? "";
    const bar = ruleBody(".fb-chat-voice-bar") ?? "";
    const gap = Number(/(?:^|;)\s*gap\s*:\s*([\d.]+)px/.exec(track)?.[1]);
    const maxWidth = Number(/max-width\s*:\s*([\d.]+)px/.exec(bar)?.[1]);
    const minWidth = Number(/min-width\s*:\s*([\d.]+)px/.exec(bar)?.[1] ?? "0");
    expect(Number.isFinite(gap) && gap > 0).toBe(true);
    expect(Number.isFinite(maxWidth) && maxWidth <= 2).toBe(true);
    expect(Number.isFinite(minWidth)).toBe(true);
    // The delivered track measured at 84.08px in the 320px build, and the owner
    // named ~60px as the floor once 320px meets large text. Bars shrink with
    // flex, so the shared gap and the bar minimum decide whether they survive.
    const barWidth = (trackPx: number) => Math.max(
      minWidth,
      Math.min(maxWidth, (trackPx - (VOICE_BARS - 1) * gap) / VOICE_BARS),
    );
    for (const trackPx of [60, 84.08]) expect(barWidth(trackPx)).toBeGreaterThanOrEqual(1);
    expect(barWidth(84.08)).toBeLessThanOrEqual(maxWidth);
    // The minimum layout has to fit the narrowest track: no forced overflow.
    expect((VOICE_BARS - 1) * gap + VOICE_BARS * minWidth).toBeLessThanOrEqual(60);
    // No surface may widen the shared gap back into a hairline.
    const recorderGap = /(?:^|;)\s*gap\s*:\s*([\d.]+)px/.exec(ruleBody(".fb-voice-panel-wave .fb-chat-voice-track") ?? "")?.[1];
    if (recorderGap) expect(Number(recorderGap)).toBeLessThan(1);
  });

  it("draws one full-width sweep per minute, never a five-part cumulative bar", () => {
    expect(css).not.toMatch(/fb-voice-capture-slot/);
    expect(css).toMatch(/\.fb-voice-capture-fill \{ [^}]*border-block-end:2px/);
  });

  it("fills the minute as one horizontal rule, never an L-shaped vertical edge", () => {
    const fillRules = allRules().filter(({ selector }) => selector.includes(".fb-voice-capture-fill"));
    expect(fillRules.length).toBeGreaterThan(0);
    // A full-height end border on the fill drew the L beside the bottom rule.
    expect(css).not.toMatch(/border-(?:inline-(?:start|end)|left|right)(?![\w-])/);
    const offenders = fillRules.filter(({ body }) =>
      /border-block-start|border-inline-(?:start|end)|border-(?:left|right)(?![\w-])/.test(body)
      || /(?:^|;)\s*border\s*:/.test(body)
      || /(?:^|;)\s*width\s*:\s*(?:[1-9]|\d{2,})px/.test(body)
      || /(?:^|;)\s*height\s*:\s*[1-9]/.test(body)
    ).map(({ selector }) => selector);
    expect(offenders).toEqual([]);
    expect(fillRules.some(({ body }) => /border-block-end:2px/.test(body))).toBe(true);
  });

  it("pulses the last-minute warning once, not on a loop, and holds it still under reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion:no-preference) { .fb-voice-panel-remaining { animation:fb-voice-warning .4s var(--ease-fb) 1; }");
    expect(css).toContain("@keyframes fb-voice-warning {");
    expect(css).not.toMatch(/fb-voice-warning[^;]*infinite/);
    expect(css).not.toMatch(/fb-voice-pulse/);
  });
});
