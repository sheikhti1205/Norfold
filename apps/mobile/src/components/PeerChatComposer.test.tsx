// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PeerChatComposer, type ChatFileKind } from "./PeerChatComposer";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

/** Controlled wrapper: the composer always owns only a draft and callbacks. */
function Harness({ connected = true, voiceAvailable = false, onVoice, onPickKlipy, onFiles, onLocation }: {
  connected?: boolean;
  voiceAvailable?: boolean;
  onVoice?: () => void;
  onPickKlipy?: (item: { mediaUrl: string }) => void;
  onFiles?: (files: File[], kind: ChatFileKind) => void;
  onLocation?: () => void;
}) {
  const [value, setValue] = useState("Keep draft");
  return <PeerChatComposer value={value} onChange={setValue} onSend={() => setValue("")}
    inputRef={createRef()} busy={false} locked={false} canSend={!!value.trim()}
    photoAllowed={connected} onCamera={() => undefined} onPhotos={() => undefined}
    voiceAvailable={voiceAvailable} onVoice={onVoice}
    {...(onFiles ? { onFiles } : {})}
    {...(onLocation ? { onLocation } : {})}
    {...(onPickKlipy ? { onPickKlipy: onPickKlipy as never } : {})} />;
}

function openAttachments() {
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  return screen.getByRole("menu", { name: "Add attachment" });
}

it("keeps four targets in one row: attachment, field, expressions and send", () => {
  render(<Harness />);
  const attach = screen.getByRole("button", { name: "Add attachment" });
  const field = screen.getByRole("textbox", { name: "Message" });
  const expressions = screen.getByRole("button", { name: "Emoji, GIFs and stickers" });
  const send = screen.getByRole("button", { name: "Send message" });
  expect(attach.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(field.compareDocumentPosition(expressions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(expressions.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The old cluster of camera/photos/more/sticker/emoji controls is gone.
  expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Choose photo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stickers and GIFs" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show attachments" })).toBeNull();
});

it("opens every real capability from the one attachment sheet", () => {
  const onFiles = vi.fn();
  const onLocation = vi.fn();
  render(<Harness onFiles={onFiles} onLocation={onLocation} />);
  const menu = openAttachments();
  for (const name of ["Photos", "Camera", "Video", "Document", "Audio", "Location"]) {
    expect(within(menu).getByRole("menuitem", { name })).toBeTruthy();
  }
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Location" }));
  expect(onLocation).toHaveBeenCalledOnce();
});

it("offers voice only when a real recording path is present", () => {
  const first = render(<Harness voiceAvailable={false} onVoice={() => undefined} />);
  expect(within(openAttachments()).queryByRole("menuitem", { name: "Voice message" })).toBeNull();
  first.unmount();
  const onVoice = vi.fn();
  render(<Harness voiceAvailable onVoice={onVoice} />);
  fireEvent.click(within(openAttachments()).getByRole("menuitem", { name: "Voice message" }));
  expect(onVoice).toHaveBeenCalledOnce();
});

it("withdraws camera and photos from a request without hiding the sheet", () => {
  render(<Harness connected={false} onFiles={() => undefined} />);
  const menu = openAttachments();
  expect((within(menu).getByRole("menuitem", { name: "Photos" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(menu).getByRole("menuitem", { name: "Camera" }) as HTMLButtonElement).disabled).toBe(true);
  // File types are still reachable: a request can carry a document.
  expect((within(menu).getByRole("menuitem", { name: "Document" }) as HTMLButtonElement).disabled).toBe(false);
});

it("opens a picker narrowed to each file type and forwards the kind", () => {
  const onFiles = vi.fn();
  render(<Harness onFiles={onFiles} />);
  const cases: Array<[string, ChatFileKind, string]> = [
    ["Document", "document", "application/pdf"],
    ["Audio", "audio", "audio/*"],
    ["Video", "video", "video/*"],
  ];
  for (const [label, kind, accept] of cases) {
    onFiles.mockClear();
    fireEvent.click(within(openAttachments()).getByRole("menuitem", { name: label }));
    const picker = screen.getByLabelText(`Choose ${kind}`) as HTMLInputElement;
    if (kind === "document") expect(picker.getAttribute("accept")).toContain(accept);
    else expect(picker.getAttribute("accept")).toBe(accept);
    expect(picker.multiple).toBe(true);
    const picked = [new File(["a"], `one.${kind}`, { type: accept })];
    fireEvent.change(picker, { target: { files: picked } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls.at(-1)?.[1]).toBe(kind);
    expect(picker.value).toBe("");
  }
});

it("inserts a picked emoji at the caret through the unified picker", () => {
  vi.stubEnv("VITE_KLIPY_API_KEY", "");
  render(<Harness />);
  const field = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Hi there" } });
  field.setSelectionRange(2, 2);
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  expect(screen.getByRole("tab", { name: "Emoji" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "party popper" }));
  expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Hi🎉 there");
});

it("remembers a used emoji on this device and offers it as a recent", () => {
  localStorage.clear();
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  fireEvent.click(screen.getByRole("button", { name: "party popper" }));
  fireEvent.click(screen.getByRole("button", { name: "Close picker" }));
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  expect(screen.getByRole("button", { name: "Recent 🎉" })).toBeTruthy();
});

it("keeps GIFs and stickers honest when the provider is not configured", () => {
  vi.stubEnv("VITE_KLIPY_API_KEY", "");
  render(<Harness onPickKlipy={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  fireEvent.click(screen.getByRole("tab", { name: "GIFs" }));
  expect(screen.getByTestId("chat-expression-unavailable")).toBeTruthy();
  expect(screen.getByTestId("chat-expression-unavailable").textContent).toMatch(/aren't available/i);
  expect(screen.queryByTestId("chat-expression-search")).toBeNull();
});
