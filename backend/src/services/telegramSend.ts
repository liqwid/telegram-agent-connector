import { Api, type TelegramClient } from "telegram";

import type { MessageChatRef } from "@/models/chatSearch";
import { ChatNotFoundError, TelegramRequestError } from "@/models/error";
import type { SentMessage } from "@/models/messageSend";
import { parseChatRef, userDisplayName } from "@/services/telegramSearch";
import { rpcErrorCode } from "@/services/telegramSession";

/**
 * Sending messages as the connected user — the one write path into real
 * conversations. Everything else in this connector reads; this speaks in the
 * user's name, cannot be undone, and is delivered to another human, so the
 * guards live at every layer above (tool descriptions, API summaries) and the
 * result echoes back exactly what Telegram stored.
 *
 * `messages.sendMessage` takes an `InputPeer`, and `InputPeer` covers users,
 * basic groups (`inputPeerChat`) and supergroups/channels (`inputPeerChannel`)
 * alike — there is no separate group method. What limits us is naming the
 * recipient, not writing to it, so a target is resolved three ways: Saved
 * Messages, a public @username, or the numeric chat id this API itself
 * returns (see `resolveDialogTarget` for why that last one costs a lookup).
 *
 * Text is sent verbatim: `parseMode: false` disables gramjs's default markdown
 * parsing, so asterisks and underscores a user dictated survive as characters
 * instead of silently turning into formatting.
 *
 * Mapping helpers are pure and exported for tests.
 */

export type SendTarget =
  | { kind: "self" }
  | { kind: "public"; username: string }
  | { kind: "dialog"; id: string };

/** Aliases for the user's own Saved Messages — a safe drafting target. */
const SELF_ALIASES = ["me", "self", "saved", "saved messages"];

/** How deep into the user's dialog list a numeric id is looked up. */
export const MAX_DIALOG_SCAN = 300;

const CHANNEL_MARKED_ID = /^-100([^0]\d*)$/;
const NUMERIC_ID = /^-?\d+$/;

/**
 * Telegram ids travel in three dialects: bare (`123` — what this API returns),
 * chat-marked (`-123`) and channel-marked (`-100123` — what the Bot API and
 * most exports use). gramjs reads the SIGN to decide the peer type, so a bare
 * channel id handed to it resolves as a *user* id and silently addresses the
 * wrong peer. Hence no raw id ever reaches gramjs: every dialect is normalised
 * to bare digits here and matched against the user's own dialogs, where the
 * peer type comes from the entity instead of from a guess about the sign.
 */
export const bareChatId = (input: string): string => {
  const channelId = input.match(CHANNEL_MARKED_ID)?.[1];
  return channelId ?? input.replace(/^-/, "");
};

/**
 * Resolve what the caller means by `chat`: Saved Messages, a public
 * @username / t.me link (a person or a chat), or a numeric chat id from an
 * earlier search. Invite links are rejected — you cannot write into a chat you
 * have not joined; join it, then address it by id.
 */
export function parseSendTarget(input: string): SendTarget {
  const trimmed = input.trim();
  if (SELF_ALIASES.includes(trimmed.toLowerCase())) {
    return { kind: "self" };
  }
  if (NUMERIC_ID.test(trimmed)) {
    return { kind: "dialog", id: bareChatId(trimmed) };
  }
  const ref = parseChatRef(trimmed);
  if (ref.kind === "invite") {
    throw new ChatNotFoundError(
      "An invite link cannot be messaged — join the chat first, then send to it by id",
    );
  }
  if (ref.username.length === 0) {
    throw new ChatNotFoundError(
      "Provide a @username, a t.me link, a chat id, or 'me' for Saved Messages",
    );
  }
  return { kind: "public", username: ref.username };
}

/** Describe the resolved recipient; null for entities we cannot name. */
export const toSendChatRef = (
  entity: Api.TypeUser | Api.TypeChat,
): MessageChatRef | null => {
  if (entity instanceof Api.User) {
    return {
      id: entity.id.toString(),
      title: userDisplayName(entity) ?? "Private chat",
      username: entity.username ?? null,
    };
  }
  if (entity instanceof Api.Channel) {
    return {
      id: entity.id.toString(),
      title: entity.title,
      username: entity.username ?? null,
    };
  }
  if (entity instanceof Api.Chat) {
    return { id: entity.id.toString(), title: entity.title, username: null };
  }
  return null;
};

/** Echo the delivered message back — proof of what was actually sent. */
export const toSentMessage = (
  message: Api.Message,
  chat: MessageChatRef,
): SentMessage => ({
  chat,
  messageId: message.id,
  sentAt: message.date ? new Date(message.date * 1000) : null,
  text: message.message,
  replyToMsgId:
    message.replyTo instanceof Api.MessageReplyHeader
      ? (message.replyTo.replyToMsgId ?? null)
      : null,
  link: chat.username ? `https://t.me/${chat.username}/${message.id}` : null,
});

/**
 * Telegram's refusals to deliver, in words a user can act on. Groups and
 * channels refuse for reasons a private chat never does — every code below is
 * one the `messages.sendMessage` documentation lists.
 */
export const sendFailureMessage = (code: string): string | null => {
  if (code === "USER_IS_BLOCKED" || code === "YOU_BLOCKED_USER") {
    return "Telegram refused delivery: one of you has blocked the other";
  }
  if (code === "USER_PRIVACY_RESTRICTED") {
    return "This user's privacy settings do not allow messages from you";
  }
  if (code === "PEER_FLOOD") {
    return "Telegram is throttling this account for unsolicited messages — wait before writing to more people";
  }
  if (code === "CHAT_WRITE_FORBIDDEN" || code === "CHAT_SEND_PLAIN_FORBIDDEN") {
    return "This chat does not allow the account to post";
  }
  if (code === "CHAT_ADMIN_REQUIRED") {
    return "Only admins can post in this chat";
  }
  if (code === "USER_BANNED_IN_CHANNEL" || code === "CHAT_RESTRICTED") {
    return "This account is banned or restricted from sending messages in that chat";
  }
  if (code === "CHANNEL_PRIVATE") {
    return "This chat is private and the account is not a member — join it before writing";
  }
  if (code === "CHAT_GUEST_SEND_FORBIDDEN") {
    return "Join the discussion group before commenting in it";
  }
  if (code === "MESSAGE_EMPTY" || code === "MESSAGE_TOO_LONG") {
    return "Telegram rejected the message text as empty or too long";
  }
  return null;
};

/**
 * The slice of a Telegram client this lookup needs. Narrow on purpose: a test
 * can satisfy it with a plain object, so the resolution is exercised for real
 * instead of grepped for.
 */
export type DialogSource = {
  getDialogs: (params: {
    limit: number;
  }) => Promise<{ entity?: Api.TypeUser | Api.TypeChat }[]>;
};

/** The bare id of anything a dialog can point at; null for empty entities. */
const entityBareId = (entity: Api.TypeUser | Api.TypeChat): string | null =>
  entity instanceof Api.User ||
  entity instanceof Api.Channel ||
  entity instanceof Api.Chat
    ? entity.id.toString()
    : null;

/**
 * Find a chat by id among the user's dialogs.
 *
 * A bare id cannot simply be handed to gramjs: for a channel or a user it
 * needs an `access_hash`, and this connector reconnects a fresh client per
 * request from a `StringSession` — which stores only the auth key and the DC,
 * never an entity cache — so nothing is ever warm. Reading the dialog list
 * both supplies the access hashes and settles what type the id is. The cost is
 * one extra round trip, paid only when the caller sends by id.
 *
 * Consequence worth stating: this reaches exactly the chats the user is in,
 * which is the point — private groups included, and nothing they have left.
 */
export const resolveDialogTarget = async (
  client: DialogSource,
  id: string,
): Promise<Api.TypeUser | Api.TypeChat> => {
  const dialogs = await client.getDialogs({ limit: MAX_DIALOG_SCAN });
  const matches = dialogs
    .flatMap((dialog) => (dialog.entity ? [dialog.entity] : []))
    .filter((entity) => entityBareId(entity) === id);
  const [entity] = matches;
  if (!entity) {
    throw new ChatNotFoundError(
      dialogs.length < MAX_DIALOG_SCAN
        ? `No chat with id ${id} among the chats this account is in — check the id, or pass a @username`
        : `No chat with id ${id} in the ${MAX_DIALOG_SCAN} most recent chats — open it in Telegram to bring it up the list, or pass a @username`,
    );
  }
  // Ids are unique per peer type, not across them: a user and a channel may
  // share the digits. Refuse rather than guess which one the caller meant.
  if (matches.length > 1) {
    throw new ChatNotFoundError(
      `Chat id ${id} is ambiguous — it matches ${matches.length} of this account's chats; use a @username instead`,
    );
  }
  return entity;
};

const resolveRecipient = async (
  client: TelegramClient,
  target: SendTarget,
): Promise<{ entity: Api.TypeUser | Api.TypeChat; chat: MessageChatRef }> => {
  const label =
    target.kind === "dialog"
      ? target.id
      : target.kind === "self"
        ? "me"
        : target.username;
  const resolved =
    target.kind === "dialog"
      ? await resolveDialogTarget(client, target.id)
      : await client.getEntity(label).catch(() => null);
  const entity = Array.isArray(resolved) ? null : resolved;
  const chat = entity ? toSendChatRef(entity) : null;
  if (!entity || !chat) {
    throw new ChatNotFoundError(
      `No Telegram user or chat found for "${label}" — check the @username, t.me link or chat id`,
    );
  }
  return { entity, chat };
};

/**
 * Send one text message as the connected user, optionally as a reply to an
 * existing message in the same chat.
 */
export async function sendChatMessage(
  client: TelegramClient,
  input: { chat: string; text: string; replyToMsgId: number | null },
): Promise<SentMessage> {
  const { entity, chat } = await resolveRecipient(
    client,
    parseSendTarget(input.chat),
  );
  try {
    const sent = await client.sendMessage(entity, {
      message: input.text,
      parseMode: false,
      ...(input.replyToMsgId === null ? {} : { replyTo: input.replyToMsgId }),
    });
    return toSentMessage(sent, chat);
  } catch (err) {
    const code = rpcErrorCode(err);
    const message = code === null ? null : sendFailureMessage(code);
    if (message === null) throw err;
    throw new TelegramRequestError(message);
  }
}
