/** Telegram webhook. Deploy with --no-verify-jwt; Telegram authenticates with
 * TELEGRAM_WEBHOOK_SECRET. TELEGRAM_BOT_TOKEN is used only to send replies.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime. */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  handleUpdate,
  SHARE_CONTACT_LABEL,
  type Keyboard,
  type TelegramAdmin,
} from "./handler.ts";

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

/** Reply keyboards are client state: "remove" clears the stale share button. */
function replyMarkup(keyboard: Keyboard | undefined): Record<string, unknown> | undefined {
  if (keyboard === "share") {
    return {
      keyboard: [[{ text: SHARE_CONTACT_LABEL, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  }
  if (keyboard === "remove") return { remove_keyboard: true };
  return undefined;
}

/** The function ships no generated database types, so the client stays untyped. */
type TelegramClient = SupabaseClient;

function telegramAdmin(client: TelegramClient): TelegramAdmin {
  return {
    async consume(token, telegramId, username) {
      const { data, error } = await client.rpc("findback_telegram_consume", {
        p_token: token,
        p_telegram_id: telegramId,
        p_telegram_username: username,
      });
      return !error && data?.linked === true;
    },
    async setPhone(telegramId, phone) {
      const { data, error } = await client.rpc("findback_telegram_set_phone", {
        p_telegram_id: telegramId,
        p_phone: phone,
      });
      if (!error && data?.ok === true) return "ok";
      if (
        error?.code === "54000" &&
        (error.message === "phone claim account limit" || error.message === "phone claim number limit")
      ) return "limit";
      return "error";
    },
    async unlink(telegramId) {
      const { data, error } = await client.rpc("findback_telegram_unlink_by_telegram", {
        p_telegram_id: telegramId,
      });
      return !error && data?.unlinked === true;
    },
    async linkStatus(telegramId) {
      const { data, error } = await client
        .from("telegram_links")
        .select("phone_verified_at")
        .eq("telegram_id", telegramId)
        .maybeSingle();
      if (error) return null;
      if (!data) return { linked: false, phoneVerified: false };
      return { linked: true, phoneVerified: data.phone_verified_at !== null };
    },
  };
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

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) {
      return Response.json({ error: "webhook not configured" }, { status: 503 });
    }
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    let handled;
    try {
      handled = await handleUpdate(update, telegramAdmin(client));
    } catch {
      // A transient RPC failure must be retried by Telegram, not acknowledged.
      return Response.json({ error: "webhook failed" }, { status: 500 });
    }
    if (!handled) return Response.json({ ok: true });

    const body: Record<string, unknown> = { chat_id: handled.chatId, text: handled.reply.text };
    const markup = replyMarkup(handled.reply.keyboard);
    if (markup) body.reply_markup = markup;
    // A committed single-use token cannot safely be retried after a send failure.
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Do not log URLs or Telegram payloads, which may contain secrets or phones.
    }
    return Response.json({ ok: true });
  },
};
