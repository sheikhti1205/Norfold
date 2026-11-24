import { getSupabase } from "./supabaseClient";
import { ApiError } from "./session";

/**
 * The account's contact rules.
 *
 * Closed sets, stored on the account rather than on the device, because "who
 * may start a conversation with me" is a fact messaging admission has to read:
 *
 *   message_from  who may start a conversation
 *   connect_from  who may send a connection request
 *   show_contact  who may see the contact details on the profile
 *
 * `message_from` and `connect_from` gate the same event (a first message is the
 * connection request in this schema) and the panel writes both from one answer.
 * `show_contact` has no reader yet: no client path exposes email or phone, so it
 * is stored and round-tripped but nothing offers it as a control.
 *
 * The server owns the vocabulary. This module never invents a fourth value; it
 * narrows whatever comes back and falls back to the permissive default the
 * database itself uses when an account has never set a rule.
 */
export const CONTACT_RULE_VALUES = ["ANYONE", "CONNECTED", "NOBODY"] as const;
export type ContactRule = (typeof CONTACT_RULE_VALUES)[number];

export interface AccountContactRules {
  messageFrom: ContactRule;
  connectFrom: ContactRule;
  showContact: ContactRule;
}

export const DEFAULT_CONTACT_RULES: AccountContactRules = {
  messageFrom: "ANYONE",
  connectFrom: "ANYONE",
  showContact: "CONNECTED",
};

export const CONTACT_RULE_LABELS: Record<ContactRule, string> = {
  ANYONE: "Anyone",
  CONNECTED: "People I'm connected to",
  NOBODY: "Nobody",
};

function narrow(value: unknown, fallback: ContactRule): ContactRule {
  return typeof value === "string" && (CONTACT_RULE_VALUES as readonly string[]).includes(value)
    ? (value as ContactRule)
    : fallback;
}

function readRow(row: Record<string, unknown> | undefined): AccountContactRules {
  return {
    messageFrom: narrow(row?.message_from, DEFAULT_CONTACT_RULES.messageFrom),
    connectFrom: narrow(row?.connect_from, DEFAULT_CONTACT_RULES.connectFrom),
    showContact: narrow(row?.show_contact, DEFAULT_CONTACT_RULES.showContact),
  };
}

export async function fetchContactRules(): Promise<AccountContactRules> {
  const { data, error } = await getSupabase().rpc("findback_get_contact_rules", {});
  if (error) throw new ApiError(error.message, 400, error.code);
  return readRow(((data ?? []) as Record<string, unknown>[])[0]);
}

export async function saveContactRules(next: AccountContactRules): Promise<AccountContactRules> {
  const { data, error } = await getSupabase().rpc("findback_set_contact_rules", {
    p_message_from: next.messageFrom,
    p_connect_from: next.connectFrom,
    p_show_contact: next.showContact,
  });
  if (error) throw new ApiError(error.message, 400, error.code);
  return readRow(((data ?? []) as Record<string, unknown>[])[0]);
}
