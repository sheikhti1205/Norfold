import { ApiError } from "../services/session";
import { interactionRefusalCopy, isStandingRefusal } from "./interactionRefusal";

/**
 * Central error taxonomy: raw failures become one clear human message plus a
 * stable code. Backend/Supabase jargon never reaches normal UI.
 */
export type ErrorCode =
  | "OFFLINE"
  | "TIMEOUT"
  | "VALIDATION"
  | "AUTH"
  | "PERMISSION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "SERVER"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface FriendlyError {
  code: ErrorCode;
  message: string;
}

const DOMAIN_MESSAGES: Record<string, FriendlyError> = {
  "Invalid category": { code: "VALIDATION", message: "Invalid category" },
  "Title is required": { code: "VALIDATION", message: "Title is required" },
  "This post violates our guidelines": { code: "VALIDATION", message: "This post violates our guidelines" },
  "You have already rated this recovery": { code: "CONFLICT", message: "You have already rated this recovery" },
  "you have reached today's limit of 5": { code: "RATE_LIMIT", message: "you have reached today's limit of 5" },
  "Devices could not load. Try again.": { code: "SERVER", message: "Devices could not load. Try again." },
  "That device could not be renamed. Try again.": { code: "SERVER", message: "That device could not be renamed. Try again." },
  "Reaction could not be saved": { code: "UNKNOWN", message: "Reaction could not be saved" },
  "You cannot block yourself": { code: "VALIDATION", message: "You cannot block yourself." },
  "You cannot unblock yourself": { code: "VALIDATION", message: "You cannot unblock yourself." },
};

export function friendlyError(err: unknown): FriendlyError {
  // A confirmed write stays confirmed even if connectivity drops before
  // read-back. Never echo an arbitrary message just because it has this code.
  if (err instanceof ApiError && err.code === "READ_BACK_FAILED") {
    return { code: "SERVER", message: "Your report was saved, but the app could not read it back. Refresh to see it." };
  }
  // Narrow domain discriminators: never echo arbitrary server messages.
  if (err instanceof ApiError && err.status === 409 && err.code === "LAST_ADMIN_DELETION_BLOCKED") {
    return { code: "CONFLICT", message: "This is the only admin account. Promote another admin before deleting this one." };
  }
  if (err instanceof ApiError && err.status === 502 && err.code === "ACCOUNT_DELETION_PENDING") {
    return { code: "SERVER", message: "Your account deletion is pending. Account privileges and uploads remain disabled. Try deleting your account again to finish." };
  }
  // A contract this build points at may not exist yet on the project it
  // points at (a migration that has not been applied). The surface is ABSENT,
  // not broken, and "not available in this build" is a different fact from
  // "the server is having trouble".
  if (err instanceof ApiError && err.code === "RPC_UNAVAILABLE") {
    return { code: "UNAVAILABLE", message: "This feature is not available in this build." };
  }
  // The interaction-limit guard's refusals go through the shared vocabulary
  // rather than through "keep the server's words": the `P0001` message carries a
  // protocol token ("POST_NOT_AVAILABLE: your account cannot post or comment
  // right now"), and the three words mean three different things. The standing
  // case is a fact and not a wait, so it answers PERMISSION; none of the three
  // invites a retry that cannot succeed. This is checked before the status
  // branches because the same refusal arrives as 400 (a table write) or 403 (the
  // guard's word re-thrown by a service), and a generic "no permission to do
  // that" would lose the fact the server volunteered.
  const refusalCopy = interactionRefusalCopy(err);
  if (refusalCopy) {
    return {
      code: isStandingRefusal(err) ? "PERMISSION" : "RATE_LIMIT",
      message: refusalCopy,
    };
  }
  // The feedback ceiling has the same shape as a guard refusal — a token in front
  // of a sentence — and reached the form verbatim through the P0001 echo below
  // (delta review R-6). It is a real quota, so it is a wait with a real end.
  if (err instanceof ApiError && err.message.includes("FEEDBACK_LIMIT_REACHED")) {
    return {
      code: "RATE_LIMIT",
      message: "You've reached today's feedback limit. Come back tomorrow.",
    };
  }
  if (err instanceof Error && Object.hasOwn(DOMAIN_MESSAGES, err.message)) {
    return DOMAIN_MESSAGES[err.message]!;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { code: "OFFLINE", message: "You are offline. Check your connection and try again." };
  }
  const status = err instanceof ApiError ? err.status : null;
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();

  if (status === 401) return { code: "AUTH", message: "Your session expired. Please sign in again." };
  if (status === 403)
    return { code: "PERMISSION", message: "You do not have permission to do that." };
  if (status === 404) return { code: "NOT_FOUND", message: "That item could not be found." };
  if (status === 409)
    return { code: "CONFLICT", message: "That conflicts with something already saved. Refresh and try again." };
  if (status === 429)
    return { code: "RATE_LIMIT", message: "Too many attempts. Wait a moment and try again." };
  if (status != null && status >= 500)
    return { code: "SERVER", message: "The server is having trouble. Try again in a bit." };
  if (status === 400) return { code: "VALIDATION", message: "Check the highlighted fields and try again." };
  if (/timeout|timed out|abort/i.test(lower))
    return { code: "TIMEOUT", message: "The request timed out. Try again." };
  if (/network|fetch|failed to fetch|load failed/i.test(lower))
    return { code: "OFFLINE", message: "Network problem. Check your connection and try again." };
  return { code: "UNKNOWN", message: "Something went wrong. Try again." };
}
