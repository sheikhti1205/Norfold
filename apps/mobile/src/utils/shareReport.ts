import { Capacitor } from "@capacitor/core";
import { sharePreviewLink } from "./reportLinks";

/** Canonical public URL, without feed filters or a comments anchor. */
export function reportUrl(postId: string): string {
  return sharePreviewLink(postId);
}

/** How the native system sheet behaved. */
export type NativeShareOutcome = "shared" | "dismissed" | "failed";

/** The native system sheet (the Capacitor plugin by default). */
export type NativeShare = (payload: { title: string; url: string }) => Promise<NativeShareOutcome>;

let nativeShareOverride: NativeShare | null = null;

/** Test seam: replaces the native system sheet. `null` restores the real one. */
export function __setNativeShare(seam: NativeShare | null): void {
  nativeShareOverride = seam;
}

/** Test seam: drops the native system sheet override. */
export function __resetNativeShare(): void {
  nativeShareOverride = null;
}

/**
 * The Android system share sheet through `@capacitor/share`.
 *
 * The plugin rejects with "Share canceled" when the user closes the sheet:
 * that is a cancellation, not a failure, and it must never be reported as
 * one. Any other rejection (a plugin that was never synced into the native
 * project, a denied intent) falls through to the web/clipboard path so the
 * link is never silently dropped.
 */
async function shareThroughNativeSheet(payload: {
  title: string;
  url: string;
}): Promise<NativeShareOutcome> {
  try {
    const { Share } = await import("@capacitor/share");
    await Share.share(payload);
    return "shared";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message === "Share canceled" || message === "Share cancelled" || (error as DOMException)?.name === "AbortError") return "dismissed";
    return "failed";
  }
}

/**
 * The clipboard, when the platform exposes one. A refusal is NOT a copy:
 * the caller must offer a selectable field instead of claiming success.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one share path: copy the canonical link AND open the platform sheet.
 *
 * The owner asked for both in one tap: the link is on the clipboard if the
 * share is cancelled, and the sheet still opens on Android/web. Both actions
 * start in the same tick so the web share call keeps its transient user
 * activation while the clipboard write runs alongside it.
 *
 * Cancellation is not a failure; a failed sheet is not a dismissal. The
 * returned sentence is the consumer-facing outcome and is announced as-is.
 */
export async function shareReport(postId: string, _title: string): Promise<string> {
  const url = reportUrl(postId);
  // The report's raw title may contain contact/address details. The server
  // supplies safe item-specific metadata; system share payloads stay generic.
  const title = "Norfold report";
  const copiedPromise = writeToClipboard(url);
  const native =
    nativeShareOverride ?? (Capacitor.isNativePlatform() ? shareThroughNativeSheet : null);
  let outcome: NativeShareOutcome | "unsupported" = "unsupported";
  if (native) {
    outcome = await native({ title, url });
  }
  if (outcome !== "shared" && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      outcome = "shared";
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") outcome = "dismissed";
      else if (outcome === "unsupported") outcome = "failed";
    }
  }
  const copied = await copiedPromise;
  if (outcome === "shared") return copied ? "Link copied and shared." : "Link shared.";
  if (outcome === "dismissed") return copied ? "Link copied." : "Share dismissed.";
  if (copied) return "Link copied to clipboard.";
  throw new Error("Sharing is not supported on this device.");
}

export type CopyLinkResult = { status: "copied" } | { status: "manual"; url: string };

/**
 * The one copy path. The link is the same public URL the share sends.
 *
 * "manual" means the platform exposed no working clipboard (an Android
 * WebView often does not): the caller shows the link in a selectable field
 * rather than claiming a copy that never happened.
 */
export async function copyReportLink(postId: string): Promise<CopyLinkResult> {
  const url = reportUrl(postId);
  if (await writeToClipboard(url)) return { status: "copied" };
  return { status: "manual", url };
}
