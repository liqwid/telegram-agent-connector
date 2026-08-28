import { Api } from "telegram";
import { returnBigInt } from "telegram/Helpers.js";
import { describe, expect, it } from "vitest";

import { type ChatSummary, queryListSchema } from "@/models/chatSearch";
import {
  parseChatRef,
  sortChatSummaries,
  toUserSummary,
} from "@/services/telegramSearch";

describe("queryListSchema", () => {
  it("wraps a single query into a list", () => {
    expect(queryListSchema.parse("macbook")).toEqual(["macbook"]);
  });

  it("splits comma-separated variants and trims them", () => {
    expect(queryListSchema.parse("macbook, макбук ,macbook pro")).toEqual([
      "macbook",
      "макбук",
      "macbook pro",
    ]);
  });

  it("accepts repeated query params (arrays) and mixed commas", () => {
    expect(queryListSchema.parse(["macbook", "макбук, ноутбук"])).toEqual([
      "macbook",
      "макбук",
      "ноутбук",
    ]);
  });

  it("caps the number of variants at five", () => {
    expect(queryListSchema.parse("a, b, c, d, e, f, g")).toHaveLength(5);
  });

  it("rejects input that collapses to nothing", () => {
    expect(queryListSchema.safeParse(" , ,").success).toBe(false);
  });
});

describe("parseChatRef", () => {
  it.each([
    ["@tbilisi_barakholka", "tbilisi_barakholka"],
    ["tbilisi_barakholka", "tbilisi_barakholka"],
    ["https://t.me/tbilisi_barakholka", "tbilisi_barakholka"],
    ["http://t.me/@tbilisi_barakholka", "tbilisi_barakholka"],
    ["t.me/tbilisi_barakholka/4242", "tbilisi_barakholka"],
    ["telegram.me/tbilisi_barakholka", "tbilisi_barakholka"],
    ["https://t.me/tbilisi_barakholka?start=x", "tbilisi_barakholka"],
    ["  @tbilisi_barakholka  ", "tbilisi_barakholka"],
  ])("parses %s as the public chat %s", (input, username) => {
    expect(parseChatRef(input)).toEqual({ kind: "public", username });
  });

  it.each([
    ["https://t.me/+AbCdEf-123", "AbCdEf-123"],
    ["t.me/+AbCdEf-123", "AbCdEf-123"],
    ["t.me/joinchat/AbCdEf123", "AbCdEf123"],
    ["https://telegram.me/joinchat/AbCdEf123", "AbCdEf123"],
  ])("parses %s as the invite hash %s", (input, hash) => {
    expect(parseChatRef(input)).toEqual({ kind: "invite", hash });
  });
});

describe("sortChatSummaries", () => {
  const summary = (overrides: Partial<ChatSummary>): ChatSummary => ({
    id: "1",
    title: "chat",
    username: null,
    kind: "group",
    memberCount: null,
    isJoined: false,
    link: null,
    ...overrides,
  });

  it("puts joined chats first, then sorts by member count", () => {
    const sorted = sortChatSummaries([
      summary({ id: "big-public", memberCount: 90_000 }),
      summary({ id: "small-joined", isJoined: true, memberCount: 10 }),
      summary({ id: "unknown-size" }),
      summary({ id: "big-joined", isJoined: true, memberCount: 5_000 }),
    ]);
    expect(sorted.map((chat) => chat.id)).toEqual([
      "big-joined",
      "small-joined",
      "big-public",
      "unknown-size",
    ]);
  });
});

describe("toUserSummary", () => {
  it("describes a private dialog as always reachable", () => {
    const user = new Api.User({
      id: returnBigInt(42),
      firstName: "Сеня",
      username: "senya",
    });
    expect(toUserSummary(user)).toEqual({
      id: "42",
      title: "Сеня",
      username: "senya",
      kind: "private",
      memberCount: null,
      isJoined: true,
      link: "https://t.me/senya",
    });
  });

  it("leaves the link empty for a user without a username", () => {
    const user = new Api.User({ id: returnBigInt(43), firstName: "Сеня" });
    expect(toUserSummary(user)?.link).toBeNull();
  });

  it("returns null for an inaccessible user", () => {
    expect(toUserSummary(new Api.UserEmpty({ id: returnBigInt(44) }))).toBeNull();
  });
});
