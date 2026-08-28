import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  connectorGuidance,
  toolResult,
  UNTRUSTED_PREFIX,
  untrustedData,
} from "@/mcp/content";

/**
 * What is under test is a SHAPE: other people's content and our own
 * instructions must never share a content block, because a model has no way
 * to tell them apart inside one string. The first three tests exercise the
 * functions; the last two read source text — a weak form of check
 * (`.claude/rules/verification.md` §3 ranks it last), used deliberately
 * because the property is "no call site re-mixes them", which no unit test on
 * a helper can see.
 */

describe("untrustedData", () => {
  it("puts the provenance warning before anything Telegram wrote", () => {
    const block = untrustedData({ text: "hello" });
    expect(block.type).toBe("text");
    const text = block.type === "text" ? block.text : "";
    expect(text.indexOf(UNTRUSTED_PREFIX)).toBe(0);
    expect(text.indexOf('"hello"')).toBeGreaterThan(UNTRUSTED_PREFIX.length);
  });

  it("carries the payload verbatim — a warning that mangles data is useless", () => {
    const payload = { messages: [{ text: "приве*т [x](tg://user?id=7)" }] };
    const block = untrustedData(payload);
    const text = block.type === "text" ? block.text : "";
    expect(JSON.parse(text.slice(UNTRUSTED_PREFIX.length))).toEqual(payload);
  });
});

describe("toolResult", () => {
  it("keeps fetched content and connector guidance in SEPARATE blocks", () => {
    const result = toolResult(
      untrustedData({ chats: [] }),
      connectorGuidance("Retry with different variants."),
    );
    expect(result.content).toHaveLength(2);
    const [data, guidance] = result.content;
    const dataText = data?.type === "text" ? data.text : "";
    const guidanceText = guidance?.type === "text" ? guidance.text : "";
    // The point of the split: our instruction must not be inside the block
    // that also carries other people's text, and vice versa.
    expect(dataText).not.toContain("Retry with different variants.");
    expect(guidanceText).not.toContain("chats");
    expect(guidanceText).toContain("not from Telegram");
  });
});

/** Repo-root-relative, so the check reaches the sibling workspace too. */
const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);

describe("the call sites (source-text check, see the note above)", () => {
  const sources = ["backend/src/mcp/server.ts", "mcp-server/src/index.ts"];

  it.each(sources)(
    "%s never concatenates a JSON payload with trailing prose",
    (path) => {
      const source = readFileSync(repoFile(path), "utf8");
      // The banned shape is exactly what this change removed:
      //   `${JSON.stringify(x, null, 2)}\n\n` + "…advice to the model…"
      expect(source).not.toMatch(/JSON\.stringify\([^)]*\)\}\\n\\n`\s*\+/);
    },
  );

  it("the stdio bridge warns in the same words as the hosted server", () => {
    const bridge = readFileSync(repoFile("mcp-server/src/index.ts"), "utf8");
    // Two workspaces cannot share an import, so drift is the real risk: a
    // softened warning on one surface and not the other is invisible at runtime.
    // The bridge holds the same text as a concatenation of source literals,
    // so joints between them (`" + "`) are removed before comparing.
    const normalise = (text: string) =>
      text
        .replace(/"\s*\+\s*"/g, "")
        .replace(/\s+/g, " ")
        .trim();
    expect(normalise(bridge)).toContain(normalise(UNTRUSTED_PREFIX));
  });
});
