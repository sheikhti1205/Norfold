/**
 * The default name an installation enrolls under.
 *
 * The server stores one name per installation and Devices shows it. Every web
 * browser used to enroll as "Browser", so a list with two of them could not
 * tell the rows apart. The user agent is the only hardware description a web
 * build has, and a Capacitor Android WebView carries the device model in the
 * same string, so a specific default needs no permission prompt and no plugin.
 *
 * The name is a label, not telemetry: only the short string below is sent to
 * the server, never the user agent. Anything unreadable falls back to the
 * plain platform name, and the reader can still rename the device.
 */
export type EnrollmentPlatform = "web" | "android";

/** Defaults earlier builds sent; a stored name equal to one is not a choice. */
const PLACEHOLDER_NAMES = new Set(["browser", "android device", "device", "norfold app"]);

/** AOSP emulator images report a build target, not a retail model. */
const EMULATOR_MODEL = /^(sdk_gphone|sdk_google|google_sdk|emulator|android sdk built for)/i;

// A user agent can carry raw control characters; stripping them is the point.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const ANDROID_BUILD_SUFFIX = /\s+build[/:].*$/i;

function browserName(userAgent: string): string | null {
  if (/\bEdg[A-Z]?\//.test(userAgent)) return "Edge";
  if (/\bOPR\/|\bOpera[ /]/.test(userAgent)) return "Opera";
  if (/\bSamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/\bCriOS\//.test(userAgent)) return "Chrome";
  if (/\bFxiOS\//.test(userAgent)) return "Firefox";
  if (/\bFirefox\//.test(userAgent)) return "Firefox";
  if (/\bChrome\/|\bChromium\//.test(userAgent)) return "Chrome";
  if (/\bSafari\//.test(userAgent)) return "Safari";
  return null;
}

function osName(userAgent: string): string | null {
  // Android user agents contain "Linux" and iOS agents contain "like Mac OS X",
  // so the specific systems have to be read first.
  if (/Android/.test(userAgent)) return "Android";
  if (/\biPhone\b|\biPad\b|\biPod\b/.test(userAgent)) return "iOS";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/CrOS/.test(userAgent)) return "ChromeOS";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "macOS";
  if (/Linux|X11/.test(userAgent)) return "Linux";
  return null;
}

function androidModel(userAgent: string): string | null {
  const match = /Android\s+[\d.]+;\s*([^;)]+)/.exec(userAgent);
  if (!match) return null;
  const model = match[1]!
    .replace(ANDROID_BUILD_SUFFIX, "")
    .replace(/\s+wv$/i, "")
    .replace(CONTROL_CHARACTERS, "")
    .trim();
  // A single letter or a WebView marker is not a model name.
  if (model.length < 2 || model.length > 40 || /^(wv|k|mobile|linux)$/i.test(model)) return null;
  // An emulator's model is its build target; the reader gets the plain name.
  if (EMULATOR_MODEL.test(model)) return "Android emulator";
  return model;
}

/** A specific default name for one installation, from its user agent. */
export function defaultDeviceLabel(platform: EnrollmentPlatform, userAgent: string | null | undefined): string {
  const agent = (userAgent ?? "").replace(CONTROL_CHARACTERS, "").trim();
  if (agent === "") return platform === "android" ? "Android device" : "Browser";
  if (platform === "android") return androidModel(agent) ?? "Android device";

  const browser = browserName(agent);
  const system = osName(agent);
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  if (browser !== null) return browser;
  if (system !== null) return `Browser on ${system}`;
  return "Browser";
}

/** The name for this installation, read from the browser it is running in. */
export function currentDeviceLabel(platform: EnrollmentPlatform): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return defaultDeviceLabel(platform, agent);
}

/** True when a stored name is a default this build should replace with a real one. */
export function isPlaceholderDeviceName(name: string): boolean {
  const trimmed = name.trim();
  return PLACEHOLDER_NAMES.has(trimmed.toLowerCase()) || EMULATOR_MODEL.test(trimmed);
}
