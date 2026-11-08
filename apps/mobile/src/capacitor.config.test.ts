/**
 * Packaged Capacitor configuration contract.
 *
 * `loggingBehavior: "production"` makes the native bridge mirror every plugin
 * call parameter and result into logcat — including OAuth access tokens, SQL
 * text and message bodies. Release diagnostics stay available through the
 * explicitly enabled DevTools attach point; logging must never be a log sink.
 */
import { describe, expect, it } from "vitest";
import config from "../capacitor.config";

describe("packaged Capacitor config", () => {
  it("never mirrors bridge payloads into the system log", () => {
    expect(config.loggingBehavior ?? "none").toBe("none");
  });

  it("keeps the developer attach point as the only release diagnostic surface", () => {
    expect(config.android?.webContentsDebuggingEnabled).toBe(true);
  });
});
