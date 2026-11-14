import { describe, expect, it } from "vitest";
import { defaultDeviceLabel, isPlaceholderDeviceName } from "./deviceLabel";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const CHROMEOS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("default device label", () => {
  it("names the browser and the system, so two browsers differ", () => {
    expect(defaultDeviceLabel("web", CHROME_WINDOWS)).toBe("Chrome on Windows");
    expect(defaultDeviceLabel("web", FIREFOX_LINUX)).toBe("Firefox on Linux");
    expect(defaultDeviceLabel("web", SAFARI_IPHONE)).toBe("Safari on iOS");
    expect(defaultDeviceLabel("web", CHROMEOS)).toBe("Chrome on ChromeOS");
  });

  it("reads Chromium-derived browsers before the engine they embed", () => {
    expect(defaultDeviceLabel("web", EDGE_WINDOWS)).toBe("Edge on Windows");
    expect(defaultDeviceLabel(
      "web",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36 SamsungBrowser/23.0",
    )).toBe("Samsung Internet on Android");
  });

  it("uses the Android model a Capacitor WebView reports", () => {
    expect(defaultDeviceLabel(
      "android",
      "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36",
    )).toBe("Pixel 7");
    expect(defaultDeviceLabel("android", CHROME_ANDROID)).toBe("Pixel 7");
  });

  it("falls back to a plain platform name instead of guessing", () => {
    expect(defaultDeviceLabel("web", "")).toBe("Browser");
    expect(defaultDeviceLabel("web", null)).toBe("Browser");
    expect(defaultDeviceLabel("android", "")).toBe("Android device");
    expect(defaultDeviceLabel("android", "Mozilla/5.0 (Linux; Android 14; K)")).toBe("Android device");
    expect(defaultDeviceLabel("web", "SomethingElse/1.0")).toBe("Browser");
  });

  it("never emits a control character, even from a hostile user agent", () => {
    expect(defaultDeviceLabel("android", "Android 14; Pixel\u00007 Build/X")).toBe("Pixel7");
    expect(defaultDeviceLabel("web", "Chrome/\u0007 141.0 Windows")).toBe("Chrome on Windows");
  });

  it("names an emulator by what it is, not by its build target", () => {
    expect(defaultDeviceLabel(
      "android",
      "Mozilla/5.0 (Linux; Android 16; sdk_gphone64_x86_64 Build/BP2A.250705.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36",
    )).toBe("Android emulator");
  });

  it("recognises the defaults older builds stored", () => {
    expect(isPlaceholderDeviceName("Browser")).toBe(true);
    expect(isPlaceholderDeviceName(" android device ")).toBe(true);
    expect(isPlaceholderDeviceName("Device")).toBe(true);
    expect(isPlaceholderDeviceName("sdk_gphone64_x86_64")).toBe(true);
    expect(isPlaceholderDeviceName("Chrome on Windows")).toBe(false);
    expect(isPlaceholderDeviceName("Sheikh's laptop")).toBe(false);
  });
});
