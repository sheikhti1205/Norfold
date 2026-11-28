// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PeerChatComposer, type ChatFileKind } from "./PeerChatComposer";
import { consumeBackIntercept, resetBackInterceptors } from "./backNavigation";

afterEach(() => { cleanup(); resetBackInterceptors(); vi.unstubAllEnvs(); });

/** Controlled wrapper: the composer always owns only a draft and callbacks. */
function Harness({ connected = true, voiceAvailable = false, locked = false, onVoice, onPickKlipy, onFiles, onLocation }: {
  connected?: boolean;
  voiceAvailable?: boolean;
  locked?: boolean;
  onVoice?: () => void;
  onPickKlipy?: (item: { mediaUrl: string }) => void;
  onFiles?: (files: File[], kind: ChatFileKind) => void;
  onLocation?: () => void;
}) {
  const [value, setValue] = useState("Keep draft");
  return <PeerChatComposer value={value} onChange={setValue} onSend={() => setValue("")}
    inputRef={createRef()} busy={false} locked={locked} canSend={!!value.trim()}
    photoAllowed={connected} onCamera={() => undefined} onPhotos={() => undefined}
    voiceAvailable={voiceAvailable} onVoice={onVoice}
    {...(onFiles ? { onFiles } : {})}
    {...(onLocation ? { onLocation } : {})}
    {...(onPickKlipy ? { onPickKlipy: onPickKlipy as never } : {})} />;
}

/** The shortcuts are sticky: expand only when the disclosure is folded. */
function openAttachments() {
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  if (disclosure.getAttribute("aria-expanded") !== "true") fireEvent.click(disclosure);
  return screen.getByRole("group", { name: "Add attachment" });
}

it("keeps one row of fixed targets: attachment, field, expressions and send", () => {
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

it("opens every real chat capability from the one disclosure", () => {
  const onFiles = vi.fn();
  const onLocation = vi.fn();
  render(<Harness onFiles={onFiles} onLocation={onLocation} />);
  const strip = openAttachments();
  for (const name of ["Documents", "Photos and videos", "Camera", "Location"]) {
    expect(within(strip).getByRole("button", { name })).toBeTruthy();
  }
  fireEvent.click(within(strip).getByRole("button", { name: "Location" }));
  expect(onLocation).toHaveBeenCalledOnce();
});

it("offers voice only when a real recording path is present", () => {
  const withoutCapability = render(<Harness voiceAvailable={false} onVoice={() => undefined} />);
  openAttachments();
  expect(screen.queryByRole("button", { name: "Voice note" })).toBeNull();
  withoutCapability.unmount();

  // A capability flag alone is not enough: the screen must own the action.
  const withoutHandler = render(<Harness voiceAvailable />);
  openAttachments();
  expect(screen.queryByRole("button", { name: "Voice note" })).toBeNull();
  withoutHandler.unmount();

  const onVoice = vi.fn();
  render(<Harness voiceAvailable onVoice={onVoice} />);
  fireEvent.click(within(openAttachments()).getByRole("button", { name: "Voice note" }));
  expect(onVoice).toHaveBeenCalledOnce();
  // One owner for the action: no standalone microphone beside the field.
  expect(screen.queryByRole("button", { name: "Voice message" })).toBeNull();
});

it("never moves the picker button or Send when the shortcuts open", () => {
  const view = render(<Harness voiceAvailable onVoice={() => undefined} />);
  const expressions = screen.getByRole("button", { name: "Emoji, GIFs and stickers" });
  const send = screen.getByRole("button", { name: "Send message" });
  openAttachments();
  // Same nodes, still adjacent: the shortcuts take the field's width, not
  // their slots.
  expect(screen.getByRole("button", { name: "Emoji, GIFs and stickers" })).toBe(expressions);
  expect(screen.getByRole("button", { name: "Send message" })).toBe(send);
  expect(expressions.nextElementSibling).toBe(send);
  view.unmount();

  // A read-only conversation keeps the row visible but inert, exactly as the
  // old attachment sheet's row behaved.
  render(<Harness voiceAvailable locked onVoice={() => undefined} />);
  expect((screen.getByRole("button", { name: "Add attachment" }) as HTMLButtonElement).disabled).toBe(true);
});

it("withdraws camera and photos from a request without hiding the shortcuts", () => {
  render(<Harness connected={false} onFiles={() => undefined} />);
  const strip = openAttachments();
  expect((within(strip).getByRole("button", { name: "Photos and videos" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(strip).getByRole("button", { name: "Camera" }) as HTMLButtonElement).disabled).toBe(true);
  // File types are still reachable: a request can carry a document.
  expect((within(strip).getByRole("button", { name: "Documents" }) as HTMLButtonElement).disabled).toBe(false);
});

it("forwards one merged media pick (videos included) and the documents picker", () => {
  const onFiles = vi.fn();
  render(<Harness onFiles={onFiles} />);
  const strip = openAttachments();
  fireEvent.click(within(strip).getByRole("button", { name: "Photos and videos" }));
  const media = screen.getByLabelText("Choose photos or videos") as HTMLInputElement;
  expect(media.getAttribute("accept")).toBe("image/*,video/*");
  expect(media.multiple).toBe(true);
  // A clip is selectable under "Photos and videos" (chat only).
  fireEvent.change(media, { target: { files: [new File(["a"], "clip.mp4", { type: "video/mp4" })] } });
  expect(onFiles).toHaveBeenCalledTimes(1);
  expect(onFiles.mock.calls.at(-1)?.[1]).toBe("video");
  expect(media.value).toBe("");

  fireEvent.click(within(strip).getByRole("button", { name: "Documents" }));
  const documents = screen.getByLabelText("Choose documents or audio") as HTMLInputElement;
  expect(documents.getAttribute("accept")).toContain("application/pdf");
  // Audio files are documents on the owner's list, not a second capability.
  expect(documents.getAttribute("accept")).toContain("audio/*");
  expect(documents.multiple).toBe(true);
  fireEvent.change(documents, { target: { files: [new File(["a"], "note.m4a", { type: "audio/mp4" })] } });
  expect(onFiles).toHaveBeenCalledTimes(2);
  expect(onFiles.mock.calls.at(-1)?.[1]).toBe("document");
  expect(documents.value).toBe("");
});

it("inserts a picked emoji at the caret through the docked unified picker", () => {
  vi.stubEnv("VITE_KLIPY_API_KEY", "");
  render(<Harness />);
  const field = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Hi there" } });
  field.setSelectionRange(2, 2);
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  expect(screen.getByRole("dialog", { name: "Emoji, GIFs and stickers picker" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Emoji" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "party popper" }));
  expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Hi🎉 there");
  // Picking an emoji leaves the pane open for the next one; it never summons
  // the keyboard underneath the dock.
  expect(screen.getByRole("dialog", { name: "Emoji, GIFs and stickers picker" })).toBeTruthy();
});

it("remembers a used emoji on this device and offers it as a recent", () => {
  localStorage.clear();
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  fireEvent.click(screen.getByRole("button", { name: "party popper" }));
  fireEvent.click(screen.getByRole("button", { name: "Close picker" }));
  expect(screen.queryByRole("dialog", { name: "Emoji, GIFs and stickers picker" })).toBeNull();
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

it("folds the shortcuts with Escape, keeps the draft and consumes that press", () => {
  render(<Harness />);
  const strip = openAttachments();
  const photos = within(strip).getByRole("button", { name: "Photos and videos" });
  photos.focus();
  const notCancelled = fireEvent.keyDown(photos, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Add attachment" })).toBeNull();
  // The conversation owns Escape; an unconsumed press would also leave it.
  expect(notCancelled).toBe(false);
  expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Keep draft");
  expect(screen.getByRole("button", { name: "Add attachment" })).toBe(document.activeElement);
});

it("closes the docked picker with Android Back, and only while it is open", () => {
  render(<Harness />);
  // Nothing is open: the composer owns no back press at all.
  expect(consumeBackIntercept()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  expect(screen.getByRole("dialog", { name: "Emoji, GIFs and stickers picker" })).toBeTruthy();
  // The pane is the top layer, so it answers the one press and the
  // conversation underneath never sees it.
  act(() => { expect(consumeBackIntercept()).toBe(true); });
  expect(screen.queryByRole("dialog", { name: "Emoji, GIFs and stickers picker" })).toBeNull();
  expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Keep draft");
});

it("closes the docked picker with Escape from a tab inside it and consumes the press", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  const tab = screen.getByRole("tab", { name: "Stickers" });
  tab.focus();
  const notCancelled = fireEvent.keyDown(tab, { key: "Escape" });
  expect(notCancelled).toBe(false);
  expect(screen.queryByRole("dialog", { name: "Emoji, GIFs and stickers picker" })).toBeNull();
});
