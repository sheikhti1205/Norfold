/** Telegram webhook. Deploy with --no-verify-jwt; Telegram authenticates with
 * TELEGRAM_WEBHOOK_SECRET. TELEGRAM_BOT_TOKEN is used only to send replies.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime. */
import { createClient } from "npm:@supabase/supabase-js@2";

async function secretMatches(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export default {
  async fetch(req: Request): Promise<Response> {
    const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const supplied = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!secret || !await secretMatches(supplied, secret)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

    let update;
    try {
      update = await req.json();
    } catch {
      return Response.json({ ok: true });
    }
    const message = update?.message;
    const sender = message?.from?.id;
    const chat = message?.chat;
    if (!Number.isSafeInteger(sender) || chat?.type !== "private" || chat?.id !== sender) {
      return Response.json({ ok: true });
    }
    if (!message.contact && typeof message.text !== "string") return Response.json({ ok: true });

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) {
      return Response.json({ error: "webhook not configured" }, { status: 503 });
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    let reply: string;

    if (message.contact) {
      if (message.contact.user_id !== sender || typeof message.contact.phone_number !== "string") {
        reply = "Please share your own contact, not someone else's.";
      } else {
        const rawPhone = message.contact.phone_number;
        const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
        const { data, error } = await admin.rpc("findback_telegram_set_phone", {
          p_telegram_id: sender,
          p_phone: phone,
        });
        reply = !error && data?.ok === true
          ? "Your phone number has been added to your Norfold connection."
          : "Could not save your number. Connect Norfold first and try again.";
      }
    } else {
      const text = message.text.trim();
      const start = /^\/start(?:@Norfold_auth_bot)?(?:\s+(.+))?$/i.exec(text);
      if (start && !start[1]) {
        reply = "Welcome to Norfold. Use this bot to connect or unlink your Telegram account.";
      } else if (start) {
        const { data, error } = await admin.rpc("findback_telegram_consume", {
          p_token: start[1],
          p_telegram_id: sender,
          p_telegram_username: typeof message.from.username === "string" ? message.from.username : null,
        });
        reply = !error && data?.linked === true
          ? "Telegram is connected to Norfold. You can unlink it here at any time with /unlink."
          : "That code is invalid or expired.";
      } else if (/^\/unlink(?:@Norfold_auth_bot)?$/i.test(text)) {
        const { data, error } = await admin.rpc("findback_telegram_unlink_by_telegram", {
          p_telegram_id: sender,
        });
        reply = !error && data?.unlinked === true
          ? "Telegram is unlinked from Norfold. This does not sign you out of the app."
          : "Could not unlink right now. Please try again.";
      } else {
        reply = "Use this bot to connect or unlink Telegram from Norfold.";
      }
    }

    // A committed single-use token cannot safely be retried after a send failure.
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat.id, text: reply }),
      });
    } catch {
      // Do not log URLs or Telegram payloads, which may contain secrets or phones.
    }
    return Response.json({ ok: true });
  },
};
