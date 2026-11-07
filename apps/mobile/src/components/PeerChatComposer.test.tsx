// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PeerChatComposer } from "./PeerChatComposer";

afterEach(cleanup);

/** Controlled wrapper: the composer's restore rule is a pure function of the
 * draft, so the test must actually clear it the way the screen does. */
function Harness({ connected = true, voiceAvailable = false, onVoice }: {
  connected?: boolean;
  voiceAvailable?: boolean;
  onVoice?: () => void;
}) {
  const [value, setValue] = useState("Keep draft");
  return <PeerChatComposer value={value} onChange={setValue} onSend={() => setValue("")}
    inputRef={createRef()} busy={false} locked={false} canSend={!!value.trim()}
    photoAllowed={connected} onCamera={() => undefined} onPhotos={() => undefined}
    voiceAvailable={voiceAvailable} onVoice={onVoice} />;
}

it("shows exactly camera and photos on the left while voice is unavailable", () => {
  render(<Harness />);
  const camera = screen.getByRole("button", { name: "Take photo" });
  const photos = screen.getByRole("button", { name: "Choose photo" });
  const field = screen.getByRole("textbox", { name: "Message" });
  const send = screen.getByRole("button", { name: "Send message" });
  for (const control of [camera, photos]) {
    expect(control.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(field.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Voice message" })).toBeNull();
  expect(screen.queryByRole("button", { name: /add to message|emoji|attach/i })).toBeNull();
});

it("collapses behind `>` on focus and expands again on request", async () => {
  render(<Harness />);
  fireEvent.focus(screen.getByRole("textbox", { name: "Message" }));
  const reveal = await screen.findByRole("button", { name: "Show attachments" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull());
  fireEvent.click(reveal);
  await waitFor(() => expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy());
});

it("collapses again when typing and restores after the draft is cleared or sent", async () => {
  render(<Harness />);
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "and more" } });
  await screen.findByRole("button", { name: "Show attachments" });
  fireEvent.change(field, { target: { value: "" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy());
  fireEvent.change(field, { target: { value: "Hello" } });
  await screen.findByRole("button", { name: "Show attachments" });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy());
});

it("offers voice only when a real recording path is present", () => {
  const unavailable = vi.fn();
  const first = render(<Harness voiceAvailable={false} onVoice={unavailable} />);
  expect(screen.queryByRole("button", { name: "Voice message" })).toBeNull();
  first.unmount();
  const onVoice = vi.fn();
  render(<Harness voiceAvailable onVoice={onVoice} />);
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  expect(onVoice).toHaveBeenCalledTimes(1);
  expect(unavailable).not.toHaveBeenCalled();
});

it("withdraws camera and photos from a request", () => {
  render(<Harness connected={false} />);
  expect((screen.getByRole("button", { name: "Take photo" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Choose photo" }) as HTMLButtonElement).disabled).toBe(true);
});
