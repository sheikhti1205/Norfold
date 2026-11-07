/**
 * Browser push delivery for chat wakes.
 *
 * The Android path sends a content-free data message through FCM. This is the
 * web equivalent: the same eligible wakes, the same eligibility rules (checked
 * again server-side in `findback_web_push_wakes`), delivered to the browser's
 * own push endpoint with a payload that carries ids only.
 *
 * Two deliberate safety properties:
 * - `web-push` is imported lazily. If the package cannot be bundled or loaded
 *   in a particular runtime, the web lane reports itself unavailable and FCM
 *   delivery is untouched.
 * - Missing VAPID configuration is not an error: it means this deployment has
 *   no browser push, which the settings screen already states honestly.
 */

export interface WebPushRow {
  wake_id: string;
  recipient_id: string;
  conversation_id: string;
  kind: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushAdmin {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface WebPushConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Reads the deployment's VAPID material; null means "web push not configured". */
export function readWebPushConfig(read: (name: string) => string | undefined): WebPushConfig | null {
  const publicKey = read("WEB_PUSH_PUBLIC_KEY")?.trim();
  const privateKey = read("WEB_PUSH_PRIVATE_KEY")?.trim();
  const subject = read("WEB_PUSH_SUBJECT")?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: subject || "mailto:push@findbackapp.social" };
}

interface WebPushSender {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number },
  ): Promise<{ statusCode: number }>;
}

let senderPromise: Promise<WebPushSender | null> | null = null;

/** Lazy, single attempt: a packaging failure disables the lane, never the run. */
async function loadSender(): Promise<WebPushSender | null> {
  senderPromise ??= (async () => {
    try {
      // deno-lint-ignore no-import-prefix
      const module = await import("npm:web-push@3.6.7");
      const candidate = (module.default ?? module) as WebPushSender;
      return typeof candidate.setVapidDetails === "function" ? candidate : null;
    } catch (cause) {
      console.error("web-push unavailable; browser delivery skipped.", cause instanceof Error ? cause.message : "import failed");
      return null;
    }
  })();
  return senderPromise;
}

/** The push body is content-free: ids only, exactly like the FCM data message. */
export function buildWebPushPayload(row: Pick<WebPushRow, "wake_id" | "conversation_id" | "kind">): string {
  return JSON.stringify({
    type: row.kind,
    conversationId: row.conversation_id,
    notificationId: row.wake_id,
  });
}

export interface WebPushDrainResult {
  configured: boolean;
  sent: number;
  pruned: number;
  failed: number;
}

/**
 * One bounded drain. A wake is marked notified once every endpoint for it has
 * been attempted, so a dead browser cannot block the wake forever and a
 * network failure is retried only on the next scheduled run (a content-free
 * wake is safe to repeat; the service worker collapses by tag).
 */
export async function drainWebWakes(
  admin: WebPushAdmin,
  config: WebPushConfig | null,
  limit: number = 50,
): Promise<WebPushDrainResult> {
  if (!config) return { configured: false, sent: 0, pruned: 0, failed: 0 };
  const sender = await loadSender();
  if (!sender) return { configured: false, sent: 0, pruned: 0, failed: 0 };
  sender.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const { data, error } = await admin.rpc("findback_web_push_wakes", { p_limit: limit });
  if (error || !Array.isArray(data)) {
    throw new Error("Web push wakes unavailable");
  }
  const rows = data as WebPushRow[];
  const perWake = new Map<string, { sent: number; failed: number }>();
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  for (const row of rows) {
    const tally = perWake.get(row.wake_id) ?? { sent: 0, failed: 0 };
    try {
      await sender.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        buildWebPushPayload(row),
        { TTL: 86_400 },
      );
      tally.sent += 1;
      sent += 1;
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The browser is permanently gone; drop the endpoint.
        const removal = await admin.rpc("findback_prune_web_push_subscription", { p_endpoint: row.endpoint });
        if (!removal.error) pruned += 1;
      } else {
        tally.failed += 1;
        failed += 1;
      }
    }
    perWake.set(row.wake_id, tally);
  }

  for (const [wakeId, tally] of perWake) {
    // Mark a wake handled only when at least one endpoint accepted it or every
    // failure was a dead browser; a transient failure leaves it for the next run.
    if (tally.sent + 0 === 0 && tally.failed > 0) continue;
    const finished = await admin.rpc("findback_finish_web_push_wake", { p_wake_id: wakeId });
    if (finished.error) console.error("web-push: could not mark wake delivered.");
  }

  return { configured: true, sent, pruned, failed };
}
