// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPreferences: vi.fn(),
  setPreference: vi.fn(),
  backup: {
    status: vi.fn(() => ({ kind: "off", enabled: false })),
    subscribe: vi.fn(() => () => undefined),
    inspect: vi.fn(async () => ({ kind: "listed", backups: [] })),
  },
  update: vi.fn(),
}));

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "reader" } }) }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => ({ status: "ready" }) }));
vi.mock("../services/messaging/runtime", () => ({
  fetchMessagingPreferences: mocks.fetchPreferences,
  setMessagingPreference: mocks.setPreference,
  refreshMessaging: vi.fn(),
  webInstallationId: () => "device",
}));
vi.mock("../services/messaging/backupRuntime", () => ({ driveBackup: () => mocks.backup }));
vi.mock("../appearance", () => ({
  useAppearance: () => ({ settings: { highQualityPhoto: false }, update: mocks.update }),
  ACCENT_OPTIONS: [],
}));

import { MessagingPrivacy } from "./MessagingPrivacy";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Chat settings", () => {
  it("combines the three real sections under one page heading", async () => {
    mocks.fetchPreferences.mockResolvedValue({ openMessages: false, readReceipts: false });
    mocks.setPreference.mockResolvedValue({ openMessages: true, readReceipts: false });
    render(<MemoryRouter><MessagingPrivacy /></MemoryRouter>);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Chat" })).toBeTruthy();
    for (const name of ["Who can message you", "Chat backup", "Media & uploads"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
    fireEvent.click(await screen.findByRole("switch", { name: /Allow direct messages/ }));
    await waitFor(() => expect(mocks.setPreference).toHaveBeenCalledWith("reader", "openMessages", true));
    expect(screen.getByRole("button", { name: "Connect Google Drive" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /High quality photos/ }));
    expect(mocks.update).toHaveBeenCalledWith({ highQualityPhoto: true });
  });
});
