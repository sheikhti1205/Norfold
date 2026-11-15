// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PeerChatComposer } from "./PeerChatComposer";

afterEach(cleanup);

/** Controlled wrapper: the composer's restore rule is a pure function of the
 * draft, so the test must actually clear it the way the screen does. */
function Harness({ connected = true, voiceAvailable = false, onVoice, onPickKlipy, onFiles }: {
  connected?: boolean;
  voiceAvailable?: boolean;
  onVoice?: () => void;
  onPickKlipy?: (item: { mediaUrl: string }) => void;
  onFiles?: (files: File[]) => void;
}) {
  const [value, setValue] = useState("Keep draft");
  return <PeerChatComposer value={value} onChange={setValue} onSend={() => setValue("")}
    inputRef={createRef()} busy={false} locked={false} canSend={!!value.trim()}
    photoAllowed={connected} onCamera={() => undefined} onPhotos={() => undefined}
    voiceAvailable={voiceAvailable} onVoice={onVoice}
    {...(onFiles ? { onFiles } : {})}
    {...(onPickKlipy ? { onPickKlipy: onPickKlipy as never } : {})} />;
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
  // Owner order 2026-11-12 (R5): emoji is reachable while composing; there is
  // still no general "attach" or "add to message" plus-menu.
  expect(screen.getByRole("button", { name: "Emoji" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /add to message/i })).toBeNull();
});

// Owner rule 2026-11-08: reaching the field is not a reason to hide the
// attachments. Only text in the field does that; `>` brings them back.
it("keeps the attachments on focus, collapses them once text exists, and reopens on request", async () => {
  render(<Harness />);
  const field = screen.getByRole("textbox", { name: "Message" });
  const attachments = () => document.querySelector(".fb-peer-attachments")?.getAttribute("data-reveal");
  fireEvent.focus(field);
  // Focus never hides the cluster; it stays on the width default.
  expect(attachments()).toBe("auto");
  expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
  fireEvent.change(field, { target: { value: "and more" } });
  const reveal = await screen.findByRole("button", { name: "Show attachments" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull());
  expect(attachments()).toBe("off");
  fireEvent.click(reveal);
  await waitFor(() => expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy());
  expect(attachments()).toBe("on");
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
  fireEvent.click(screen.getByRole("button", { name: "More attachments" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Voice message" }));
  expect(onVoice).toHaveBeenCalledTimes(1);
  expect(unavailable).not.toHaveBeenCalled();
});

it("withdraws camera and photos from a request", () => {
  render(<Harness connected={false} />);
  expect((screen.getByRole("button", { name: "Take photo" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Choose photo" }) as HTMLButtonElement).disabled).toBe(true);
});

it("inserts a picked emoji at the caret (owner order 2026-11-12, R5)", () => {
  render(<Harness />);
  const field = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Hi there" } });
  field.setSelectionRange(2, 2);
  fireEvent.click(screen.getByRole("button", { name: "Emoji" }));
  fireEvent.click(screen.getByRole("button", { name: "party popper" }));
  expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Hi🎉 there");
});

it("offers the shared sticker/GIF picker only with a provider key", () => {
  vi.stubEnv("VITE_KLIPY_API_KEY", "");
  const withoutKey = render(<Harness onPickKlipy={() => undefined} />);
  expect(screen.queryByRole("menuitem", { name: "Stickers and GIFs" })).toBeNull();
  withoutKey.unmount();
  vi.stubEnv("VITE_KLIPY_API_KEY", "testing-key");
  render(<Harness onPickKlipy={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "More attachments" }));
  expect(screen.getByRole("menuitem", { name: "Stickers and GIFs" })).toBeTruthy();
  vi.unstubAllEnvs();
});

// The width decision itself is a container query in `peerComposer.css` (it
// cannot race layout, which a measured state could). What is testable here is
// the state it reads: the cluster and `>` coexist on "auto", so either can be
// displayed without the other being unmounted on a guess.
it("renders both attachment states while the width decides which one shows", () => {
  render(<Harness />);
  const attachments = document.querySelector(".fb-peer-attachments");
  expect(attachments?.getAttribute("data-reveal")).toBe("auto");
  expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show attachments" })).toBeTruthy();
});

it("a deliberate reveal outranks the width and survives leaving the field", () => {
  render(<Harness />);
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Show attachments" }));
  expect(document.querySelector(".fb-peer-attachments")?.getAttribute("data-reveal")).toBe("on");
  fireEvent.blur(field);
  // Blur returns to the width default, not to a hidden cluster.
  expect(document.querySelector(".fb-peer-attachments")?.getAttribute("data-reveal")).toBe("auto");
  expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
});

it("sends any file type, not only images", () => {
  const onFiles = vi.fn();
  render(<Harness onFiles={onFiles} />);
  const picker = screen.getByLabelText("Choose files") as HTMLInputElement;
  // No accept filter: the picker must offer documents, video, audio, archives.
  expect(picker.getAttribute("accept")).toBeNull();
  expect(picker.multiple).toBe(true);
  const picked = [
    new File(["a"], "brief.pdf", { type: "application/pdf" }),
    new File(["b"], "clip.mp4", { type: "video/mp4" }),
    new File(["c"], "song.mp3", { type: "audio/mpeg" }),
    new File(["d"], "layers.psd", { type: "" }),
  ];
  fireEvent.change(picker, { target: { files: picked } });
  expect(onFiles).toHaveBeenCalledTimes(1);
  expect(onFiles.mock.calls[0]?.[0]).toHaveLength(4);
  // The input is cleared so the same file can be picked again.
  expect(picker.value).toBe("");
});
