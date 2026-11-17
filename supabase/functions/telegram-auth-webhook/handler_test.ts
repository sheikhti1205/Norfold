import { deepStrictEqual as equal, ok } from "node:assert/strict";
import {
  handleUpdate,
  SHARE_CONTACT_LABEL,
  type LinkStatus,
  type SetPhoneResult,
  type TelegramAdmin,
} from "./handler.ts";

const SENDER = 123456789;
const OTHER = 987654321;

interface Calls {
  consume: [string, number, string | null][];
  setPhone: [number, string][];
  unlink: number[];
  linkStatus: number[];
}

function fixture(options: {
  consume?: boolean;
  setPhone?: SetPhoneResult;
  unlink?: boolean;
  linkStatus?: LinkStatus | null;
} = {}) {
  const calls: Calls = { consume: [], setPhone: [], unlink: [], linkStatus: [] };
  const admin: TelegramAdmin = {
    async consume(token, telegramId, username) {
      calls.consume.push([token, telegramId, username]);
      return options.consume ?? true;
    },
    async setPhone(telegramId, phone) {
      calls.setPhone.push([telegramId, phone]);
      return options.setPhone ?? { status: "ok", moved: false, notifyTelegramId: null };
    },
    async unlink(telegramId) {
      calls.unlink.push(telegramId);
      return options.unlink ?? true;
    },
    async linkStatus(telegramId) {
      calls.linkStatus.push(telegramId);
      return "linkStatus" in options
        ? options.linkStatus ?? null
        : { linked: false, phoneVerified: false };
    },
  };
  return { admin, calls };
}

function textUpdate(text: string, sender = SENDER, chatId = sender) {
  return {
    message: {
      from: { id: sender, username: "reader" },
      chat: { id: chatId, type: "private" },
      text,
    },
  };
}

function contactUpdate(userId: number | typeof OTHER | null, phone = "8801812345678") {
  return {
    message: {
      from: { id: SENDER, username: "reader" },
      chat: { id: SENDER, type: "private" },
      contact: { user_id: userId, phone_number: phone },
    },
  };
}

const shareKeyboard = (reply: { keyboard?: string }) => reply.keyboard === "share";

Deno.test("a fresh link asks for the contact with one tap", async () => {
  const { admin, calls } = fixture({ consume: true });
  const handled = await handleUpdate(textUpdate("/start abcdef0123456789"), admin);
  ok(handled);
  equal(calls.consume, [["abcdef0123456789", SENDER, "reader"]]);
  ok(shareKeyboard(handled.reply));
  ok(handled.reply.text.includes("Share my number"));
  equal(SHARE_CONTACT_LABEL, "Share my number");
});

Deno.test("an invalid token does not offer the keyboard", async () => {
  const { admin } = fixture({ consume: false });
  const handled = await handleUpdate(textUpdate("/start deadbeef"), admin);
  ok(handled);
  equal(handled.reply.keyboard, undefined);
  ok(handled.reply.text.includes("invalid or expired"));
});

Deno.test("the user's own contact is saved with a plus prefix and clears the keyboard", async () => {
  const { admin, calls } = fixture({ setPhone: { status: "ok", moved: false, notifyTelegramId: null } });
  const handled = await handleUpdate(contactUpdate(SENDER), admin);
  ok(handled);
  equal(calls.setPhone, [[SENDER, "+8801812345678"]]);
  equal(handled.reply.keyboard, "remove");
  ok(handled.reply.text.includes("verified"));
  equal(handled.notices, undefined);
});

Deno.test("a taken number is not moved on the first share", async () => {
  const { admin, calls } = fixture({ setPhone: { status: "confirm" } });
  const handled = await handleUpdate(contactUpdate(SENDER), admin);
  ok(handled);
  equal(calls.setPhone, [[SENDER, "+8801812345678"]]);
  ok(shareKeyboard(handled.reply));
  ok(handled.reply.text.includes("share it again within 10 minutes"));
  equal(handled.notices, undefined);
});

Deno.test("the confirmed share moves the number and tells the old account", async () => {
  const { admin } = fixture({
    setPhone: { status: "ok", moved: true, notifyTelegramId: OTHER },
  });
  const handled = await handleUpdate(contactUpdate(SENDER), admin);
  ok(handled);
  equal(handled.reply.keyboard, "remove");
  ok(handled.reply.text.includes("moved from the account"));
  equal(handled.notices?.length, 1);
  equal(handled.notices?.[0]?.chatId, OTHER);
  ok(handled.notices?.[0]?.text.includes("+8801812345678"));
});

Deno.test("someone else's contact is rejected and the keyboard stays", async () => {
  const { admin, calls } = fixture();
  const handled = await handleUpdate(contactUpdate(OTHER), admin);
  ok(handled);
  equal(calls.setPhone, []);
  ok(shareKeyboard(handled.reply));
});

Deno.test("a claim limit keeps the keyboard so the reader can retry later", async () => {
  const { admin } = fixture({ setPhone: { status: "limit" } });
  const handled = await handleUpdate(contactUpdate(SENDER), admin);
  ok(handled);
  ok(shareKeyboard(handled.reply));
  ok(handled.reply.text.includes("too many times"));
});

Deno.test("an unlinked reader gets the app instruction, not a keyboard", async () => {
  const { admin } = fixture({ linkStatus: { linked: false, phoneVerified: false } });
  const handled = await handleUpdate(textUpdate("/start"), admin);
  ok(handled);
  equal(handled.reply.keyboard, undefined);
  ok(handled.reply.text.includes("Use the Norfold app"));
});

Deno.test("a linked reader without a number is asked to share it", async () => {
  const { admin } = fixture({ linkStatus: { linked: true, phoneVerified: false } });
  const handled = await handleUpdate(textUpdate("hello"), admin);
  ok(handled);
  ok(shareKeyboard(handled.reply));
  equal(handled.reply.text, "Tap Share my number to verify your number.");
});

Deno.test("a verified reader gets no keyboard", async () => {
  const { admin } = fixture({ linkStatus: { linked: true, phoneVerified: true } });
  const handled = await handleUpdate(textUpdate("/start"), admin);
  ok(handled);
  equal(handled.reply.keyboard, undefined);
  ok(handled.reply.text.includes("verified"));
});

Deno.test("a failed status lookup answers without a keyboard or a claim", async () => {
  const { admin } = fixture({ linkStatus: null });
  const handled = await handleUpdate(textUpdate("hello"), admin);
  ok(handled);
  equal(handled.reply.keyboard, undefined);
  ok(handled.reply.text.includes("Could not check"));
});

Deno.test("unlink clears the keyboard", async () => {
  const { admin, calls } = fixture({ unlink: true });
  const handled = await handleUpdate(textUpdate("/unlink@Norfold_auth_bot"), admin);
  ok(handled);
  equal(calls.unlink, [SENDER]);
  equal(handled.reply.keyboard, "remove");
});

Deno.test("group chats and messages without text or contact are ignored", async () => {
  const { admin } = fixture();
  equal(await handleUpdate({ message: { from: { id: SENDER }, chat: { id: -1, type: "group" }, text: "/start" } }, admin), null);
  equal(await handleUpdate({ message: { from: { id: SENDER }, chat: { id: SENDER, type: "private" }, sticker: {} } }, admin), null);
  equal(await handleUpdate({ edited_message: { text: "/start" } }, admin), null);
});
