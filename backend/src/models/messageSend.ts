import type { MessageChatRef } from "@/models/chatSearch";

/**
 * Outbound message shapes. Sending is the connector's only write into a
 * user's conversations: it is irreversible, attributed to the user
 * personally, and visible to whoever receives it — so every caller (tool
 * description, GPT instructions, API summary) is expected to confirm the
 * exact recipient and text with the user before invoking it.
 */

/** Telegram's own cap on a single text message. */
export const MAX_SEND_TEXT_LENGTH = 4096;

/** A message the user's account just sent, echoed back for confirmation. */
export type SentMessage = {
  chat: MessageChatRef;
  messageId: number;
  sentAt: Date | null;
  /** The text as Telegram stored it — verbatim, never parsed as markup. */
  text: string;
  replyToMsgId: number | null;
  /** Public t.me deep link to the sent message, when the chat has one. */
  link: string | null;
};
