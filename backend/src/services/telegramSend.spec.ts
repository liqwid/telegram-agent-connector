import { Api } from "telegram";
import { returnBigInt } from "telegram/Helpers.js";
import { describe, expect, it } from "vitest";

import type { MessageChatRef } from "@/models/chatSearch";
import { ChatNotFoundError } from "@/models/error";
import {
  bareChatId,
  MAX_DIALOG_SCAN,
  parseSendTarget,
  resolveDialogTarget,
  sendFailureMessage,
  toSendChatRef,
  toSentMessage,
} from "@/services/telegramSend";

describe("parseSendTarget", () => {
  it.each(["me", "ME", " self ", "saved", "Saved Messages"])(
    "treats %s as the user's own Saved Messages",
    (input) => {
      expect(parseSendTarget(input)).toEqual({ kind: "self" });
    },
  );

  it.each([
    ["@senya", "senya"],
    ["senya", "senya"],
    ["https://t.me/senya", "senya"],
    ["t.me/senya/4242", "senya"],
  ])("resolves %s to the public target %s", (input, username) => {
    expect(parseSendTarget(input)).toEqual({ kind: "public", username });
  });

  it.each([
    ["1234567", "1234567"],
    ["-1234567", "1234567"],
    ["-1001234567", "1234567"],
  ])(
    "accepts the chat id %s and normalises it to the bare id %s",
    (input, id) => {
      expect(parseSendTarget(input)).toEqual({ kind: "dialog", id });
    },
  );

  it("refuses invite links — you cannot write into a chat you have not joined", () => {
    expect(() => parseSendTarget("https://t.me/+AbCdEf-123")).toThrow(
      ChatNotFoundError,
    );
  });

  it("refuses a reference that collapses to an empty username", () => {
    expect(() => parseSendTarget("t.me/")).toThrow(ChatNotFoundError);
  });
});

describe("bareChatId", () => {
  it("keeps a marked chat id apart from a channel id with the same digits", () => {
    // -100 is a channel marker only when what follows does not start with a
    // zero — gramjs resolves it the same way, and disagreeing here would
    // address a different peer than the caller named.
    expect(bareChatId("-1000123")).toBe("1000123");
    expect(bareChatId("-1001234")).toBe("1234");
  });
});

describe("resolveDialogTarget", () => {
  const group = new Api.Chat({
    id: returnBigInt(4242),
    title: "Кухня",
    photo: new Api.ChatPhotoEmpty(),
    participantsCount: 3,
    date: 1_756_000_000,
    version: 1,
  });

  const source = (entities: (Api.TypeUser | Api.TypeChat)[]) => ({
    getDialogs: (params: { limit: number }) => {
      expect(params.limit).toBe(MAX_DIALOG_SCAN);
      return Promise.resolve(entities.map((entity) => ({ entity })));
    },
  });

  it("finds a private basic group by id — no username exists to name it by", async () => {
    await expect(resolveDialogTarget(source([group]), "4242")).resolves.toBe(
      group,
    );
  });

  it("reports a miss as a miss, naming the id", async () => {
    await expect(resolveDialogTarget(source([group]), "7")).rejects.toThrow(
      ChatNotFoundError,
    );
  });

  it("refuses to guess when a user and a channel share the digits", async () => {
    const user = new Api.User({ id: returnBigInt(4242), firstName: "Сеня" });
    const channel = new Api.Channel({
      id: returnBigInt(4242),
      title: "Кухня",
      photo: new Api.ChatPhotoEmpty(),
      date: 1_756_000_000,
    });
    await expect(
      resolveDialogTarget(source([user, channel]), "4242"),
    ).rejects.toThrow(/ambiguous/);
  });

  it("says the scan hit its cap instead of claiming the chat does not exist", async () => {
    const many = Array.from({ length: MAX_DIALOG_SCAN }, (_ignored, index) => {
      return new Api.User({ id: returnBigInt(index + 1), firstName: "X" });
    });
    await expect(resolveDialogTarget(source(many), "999999")).rejects.toThrow(
      new RegExp(`${MAX_DIALOG_SCAN} most recent chats`),
    );
  });
});

describe("toSendChatRef", () => {
  it("names a user by full name", () => {
    const user = new Api.User({
      id: returnBigInt(7),
      firstName: "Сеня",
      lastName: "Петров",
      username: "senya",
    });
    expect(toSendChatRef(user)).toEqual({
      id: "7",
      title: "Сеня Петров",
      username: "senya",
    });
  });

  it("falls back to the username when a user has no name", () => {
    const user = new Api.User({
      id: returnBigInt(8),
      username: "senya",
    });
    expect(toSendChatRef(user)?.title).toBe("senya");
  });

  it("names a channel by title", () => {
    const channel = new Api.Channel({
      id: returnBigInt(9),
      title: "Кальянная барахолка",
      username: "hookahsale",
      photo: new Api.ChatPhotoEmpty(),
      participantsCount: 10,
      date: 0,
    });
    expect(toSendChatRef(channel)).toEqual({
      id: "9",
      title: "Кальянная барахолка",
      username: "hookahsale",
    });
  });
});

describe("toSentMessage", () => {
  const chat: MessageChatRef = {
    id: "7",
    title: "Сеня",
    username: "senya",
  };

  const message = (overrides: Partial<Api.Message>): Api.Message =>
    Object.assign(
      new Api.Message({
        id: 512,
        peerId: new Api.PeerUser({ userId: returnBigInt(7) }),
        message: "привет",
        date: 1_756_000_000,
      }),
      overrides,
    );

  it("echoes the delivered text, timestamp and deep link", () => {
    expect(toSentMessage(message({}), chat)).toEqual({
      chat,
      messageId: 512,
      sentAt: new Date(1_756_000_000 * 1000),
      text: "привет",
      replyToMsgId: null,
      link: "https://t.me/senya/512",
    });
  });

  it("omits the link for a chat without a username", () => {
    const sent = toSentMessage(message({}), { ...chat, username: null });
    expect(sent.link).toBeNull();
  });

  it("reports the message it replied to", () => {
    const sent = toSentMessage(
      message({
        replyTo: new Api.MessageReplyHeader({ replyToMsgId: 480 }),
      }),
      chat,
    );
    expect(sent.replyToMsgId).toBe(480);
  });
});

describe("sendFailureMessage", () => {
  it.each([
    "USER_IS_BLOCKED",
    "YOU_BLOCKED_USER",
    "USER_PRIVACY_RESTRICTED",
    "PEER_FLOOD",
    "CHAT_WRITE_FORBIDDEN",
    "CHAT_SEND_PLAIN_FORBIDDEN",
    "CHAT_ADMIN_REQUIRED",
    "USER_BANNED_IN_CHANNEL",
    "CHAT_RESTRICTED",
    "CHANNEL_PRIVATE",
    "CHAT_GUEST_SEND_FORBIDDEN",
    "MESSAGE_TOO_LONG",
  ])("explains %s in words a user can act on", (code) => {
    expect(sendFailureMessage(code)).toEqual(expect.any(String));
  });

  it("leaves unknown codes to the generic session mapping", () => {
    expect(sendFailureMessage("SOMETHING_ELSE")).toBeNull();
  });
});
