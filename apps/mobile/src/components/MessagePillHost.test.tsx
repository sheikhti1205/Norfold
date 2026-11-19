// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatFileBody, type ChatFileMeta } from "../services/messaging/files";
import { MessagePillHost } from "./MessagePillHost";

const meta: ChatFileMeta = {
  key: "files/u-1/c-1/00000000-0000-4000-8000-000000000000-report.pdf",
  name: "report.pdf",
  mime: "application/pdf",
  byteSize: 4096,
  kind: "pdf",
};

type ConversationRow = {
  conversationId: string;
  unreadCount: number;
  cachedProjection: null;
  lastMessage: { authorId: string; body: string; messageType?: string };
};
const state = vi.hoisted(() => ({ conversations: [] as ConversationRow[] }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "me" }, booting: false, needsProfile: false }) }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => ({
  accountId: "me", status: "ready", conversations: state.conversations, currentProjections: null,
}) }));
vi.mock("./UserAvatar", () => ({ UserAvatar: () => null }));

function row(id: string, body: string) {
  return { conversationId: id, unreadCount: 1, cachedProjection: null,
    lastMessage: { authorId: "other", body, messageType: "TEXT" } };
}

function Harness() {
  const navigate = useNavigate();
  return <><MessagePillHost /><button onClick={() => navigate("/chats/a")}>Open a</button>
    <button onClick={() => navigate("/search")}>Search</button><Routes><Route path="*" element={null} /></Routes></>;
}

function mount(path = "/search") {
  return render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>);
}

beforeEach(() => { state.conversations = []; });
afterEach(cleanup);

describe("MessagePillHost", () => {
  it("renders nothing without an unseen message or for an own message", () => {
    const view = mount();
    expect(screen.queryByRole("status")).toBeNull();
    state.conversations = [{ ...row("a", "Mine"), lastMessage: { authorId: "me", body: "Mine" } }];
    view.rerender(<MemoryRouter initialEntries={["/search"]}><Harness /></MemoryRouter>);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows one unseen message and opens its conversation", () => {
    state.conversations = [row("a", "Hello")];
    mount();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Hello/ }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("replaces the pill when a newer conversation arrives", () => {
    state.conversations = [row("a", "First")];
    const view = mount();
    state.conversations = [row("b", "Second"), ...state.conversations];
    view.rerender(<MemoryRouter initialEntries={["/search"]}><Harness /></MemoryRouter>);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.queryByText("First")).toBeNull();
  });

  it("suppresses the pill on an open conversation", () => {
    state.conversations = [row("a", "Hello")];
    mount("/chats/a");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses only that conversation for the session", () => {
    state.conversations = [row("a", "First"), row("b", "Second")];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message from Member" }));
    expect(screen.getByText("Second")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message from Member" }));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByText("Open a"));
    fireEvent.click(screen.getByText("Search"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not render on a public route", () => {
    state.conversations = [row("a", "Hello")];
    mount("/privacy");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never shows a serialized file marker in the pill", () => {
    state.conversations = [row("a", chatFileBody(meta, "Here is the report"))];
    mount();
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.queryByText(/norfold-file:/)).toBeNull();
    expect(screen.queryByText(/files\/u-1/)).toBeNull();
  });

  it("shows a neutral File preview for a malformed or future marker", () => {
    state.conversations = [row("a", "norfold-file:v2:AAAA")];
    mount();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.queryByText(/norfold-file:/)).toBeNull();
  });

  it("keeps the existing typed and GIF preview copy", () => {
    const view = mount();
    state.conversations = [{ ...row("a", ""),
      lastMessage: { authorId: "other", body: "", messageType: "VOICE" } }];
    view.rerender(<MemoryRouter initialEntries={["/search"]}><Harness /></MemoryRouter>);
    expect(screen.getByText("Voice message")).toBeTruthy();
    state.conversations = [row("a", "https://media.klipy.com/a.gif")];
    view.rerender(<MemoryRouter initialEntries={["/search"]}><Harness /></MemoryRouter>);
    expect(screen.getByText("GIF")).toBeTruthy();
  });
});
