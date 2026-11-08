// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceMessagePlayer, VoiceRecordingPanel } from "./VoiceNote";

afterEach(cleanup);
const peaks = [0, .25, 1, .5, 0];

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

  it("pauses a live recording and never enables send until a complete preview exists", () => {
    const pause = vi.fn();
    render(<VoiceRecordingPanel phase="recording" peaks={peaks} elapsedMs={3_000}
      percent={0} playing={false} onPreview={() => undefined} onPause={pause}
      onResume={() => undefined} onSend={() => undefined} onDiscard={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(pause).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Stop")).toBeNull();
    expect(screen.queryByText("Discard")).toBeNull();
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
