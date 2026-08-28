import { logger } from "common/logging";

import type { AccountWithTokenHash } from "@/models/account";
import { InvalidRequestError } from "@/models/error";
import { MAX_SEND_TEXT_LENGTH, type SentMessage } from "@/models/messageSend";
import { sendChatMessage } from "@/services/telegramSend";
import { withSessionClient } from "@/services/telegramSession";

/**
 * Send a message as the user, to a person or a chat. Irreversible and
 * attributed to the user personally — callers are expected to have shown the
 * exact recipient and text to the user and got an explicit go-ahead.
 *
 * Deliberately never logs the message text: this is private correspondence,
 * and the connector's logs are not the place for it.
 */
export async function sendMessage(
  account: AccountWithTokenHash,
  input: { chat: string; text: string; replyToMsgId: number | null },
): Promise<SentMessage> {
  logger.info("sendMessage", {
    accountId: account.id,
    chat: input.chat,
    textLength: input.text.length,
    isReply: input.replyToMsgId !== null,
  });
  const text = input.text.trim();
  if (text.length === 0) {
    throw new InvalidRequestError("Message text cannot be empty");
  }
  if (text.length > MAX_SEND_TEXT_LENGTH) {
    throw new InvalidRequestError(
      `Message text exceeds Telegram's ${MAX_SEND_TEXT_LENGTH}-character limit`,
    );
  }
  const sent = await withSessionClient(account, (client) =>
    sendChatMessage(client, { ...input, text }),
  );
  logger.info("sendMessage: sent", {
    accountId: account.id,
    chatId: sent.chat.id,
    messageId: sent.messageId,
  });
  return sent;
}
