/**
 * Telegram webhook decisions, separated from HTTP, Supabase and the Bot API so
 * they can be exercised without a network. `index.ts` supplies the effects.
 *
 * Phone proof needs an explicit contact share: Telegram never includes a phone
 * number in `/start` or an ordinary message. The bot therefore answers a fresh
 * link with a `request_contact` keyboard button, and repeats it for any linked
 * account whose number is still missing.
 */

export const SHARE_CONTACT_LABEL = "Share my number";

export type Keyboard = "share" | "remove";

export interface TelegramReply {
  text: string;
  keyboard?: Keyboard;
}

export interface LinkStatus {
  linked: boolean;
  phoneVerified: boolean;
}

/** Effects the webhook needs. Failures are reported as values, not thrown. */
export interface TelegramAdmin {
  consume(token: string, telegramId: number, username: string | null): Promise<boolean>;
  setPhone(telegramId: number, phone: string): Promise<"ok" | "limit" | "error">;
  unlink(telegramId: number): Promise<boolean>;
  linkStatus(telegramId: number): Promise<LinkStatus | null>;
}

export interface HandledUpdate {
  chatId: number;
  reply: TelegramReply;
}

interface PrivateMessage {
  chatId: number;
  sender: number;
  username: string | null;
  text: string | null;
  contact: { userId: number | null; phoneNumber: string | null } | null;
}

interface UpdateShape {
  message?: {
    from?: { id?: unknown; username?: unknown };
    chat?: { id?: unknown; type?: unknown };
    text?: unknown;
    contact?: { user_id?: unknown; phone_number?: unknown };
  };
}

const START = /^\/start(?:@Norfold_auth_bot)?(?:\s+(.+))?$/i;
const UNLINK = /^\/unlink(?:@Norfold_auth_bot)?$/i;

function readPrivateMessage(update: unknown): PrivateMessage | null {
  const message = (update as UpdateShape | null)?.message;
  const sender = message?.from?.id;
  const chat = message?.chat;
  if (typeof sender !== "number" || !Number.isSafeInteger(sender)) return null;
  if (chat?.type !== "private" || chat?.id !== sender) return null;
  const contact = message?.contact;
  return {
    chatId: sender,
    sender,
    username: typeof message?.from?.username === "string" ? message.from.username : null,
    text: typeof message?.text === "string" ? message.text.trim() : null,
    contact: contact
      ? {
        userId: typeof contact.user_id === "number" ? contact.user_id : null,
        phoneNumber: typeof contact.phone_number === "string" ? contact.phone_number : null,
      }
      : null,
  };
}

async function contactReply(
  message: PrivateMessage,
  admin: TelegramAdmin,
): Promise<TelegramReply> {
  const contact = message.contact;
  if (!contact || contact.userId !== message.sender || contact.phoneNumber === null) {
    return { text: "Please share your own number, not someone else's.", keyboard: "share" };
  }
  const phone = contact.phoneNumber.startsWith("+")
    ? contact.phoneNumber
    : `+${contact.phoneNumber}`;
  const result = await admin.setPhone(message.sender, phone);
  if (result === "ok") {
    return {
      text: "Your number is verified. Your Norfold profile now shows it as verified.",
      keyboard: "remove",
    };
  }
  if (result === "limit") {
    return {
      text: "This number has been verified too many times recently. Please try again later.",
      keyboard: "share",
    };
  }
  return {
    text: "Could not save your number. Connect Norfold in the app first, then try again.",
    keyboard: "share",
  };
}

async function statusReply(admin: TelegramAdmin, sender: number): Promise<TelegramReply> {
  const status = await admin.linkStatus(sender);
  if (!status) {
    return { text: "Could not check your connection right now. Try again." };
  }
  if (!status.linked) {
    return { text: "Use the Norfold app to connect Telegram to your account." };
  }
  if (!status.phoneVerified) {
    return { text: "Tap Share my number to verify your number.", keyboard: "share" };
  }
  return {
    text: "Telegram is connected and your number is verified. Use /unlink to disconnect.",
  };
}

async function textReply(
  message: PrivateMessage,
  admin: TelegramAdmin,
): Promise<TelegramReply> {
  const text = message.text ?? "";
  const start = START.exec(text);
  if (start) {
    const token = start[1];
    if (!token) return await statusReply(admin, message.sender);
    const linked = await admin.consume(token, message.sender, message.username);
    return linked
      ? {
        text: "Telegram is connected to Norfold. Tap Share my number to add and verify your number.",
        keyboard: "share",
      }
      : { text: "That code is invalid or expired." };
  }
  if (UNLINK.test(text)) {
    const unlinked = await admin.unlink(message.sender);
    return unlinked
      ? {
        text: "Telegram is unlinked from Norfold. This does not sign you out of the app.",
        keyboard: "remove",
      }
      : { text: "Could not unlink right now. Please try again.", keyboard: "remove" };
  }
  return await statusReply(admin, message.sender);
}

export async function handleUpdate(
  update: unknown,
  admin: TelegramAdmin,
): Promise<HandledUpdate | null> {
  const message = readPrivateMessage(update);
  if (!message) return null;
  if (!message.contact && message.text === null) return null;
  const reply = message.contact
    ? await contactReply(message, admin)
    : await textReply(message, admin);
  return { chatId: message.chatId, reply };
}
