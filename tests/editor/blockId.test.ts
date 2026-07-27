import { describe, expect, it } from "vitest";
import { BlockId } from "@/components/editor/extensions/block-id";

/**
 * Guards the `data-block-id` parse rule.
 *
 * A node's blockId becomes the `blocks.id` PRIMARY KEY (uuid) verbatim via
 * blocksFromDoc(), and every block on a page is written in ONE batched upsert.
 * So a single non-UUID id doesn't just break its own row — it fails the whole
 * batch, and the page stops saving entirely until that block is removed.
 */

type ParseHTML = (el: { getAttribute: (n: string) => string | null }) => string | null;

function parseBlockId(): ParseHTML {
  // Read the rule straight off the extension config rather than mounting an
  // editor, so this stays a fast, DOM-free unit test.
  const groups = (
    BlockId.config.addGlobalAttributes as unknown as () => {
      attributes: { blockId: { parseHTML: ParseHTML } };
    }[]
  ).call(BlockId);
  return groups[0].attributes.blockId.parseHTML;
}

const el = (value: string | null) => ({ getAttribute: () => value });

describe("BlockId data-block-id parsing", () => {
  const parse = parseBlockId();

  it("keeps a well-formed UUID", () => {
    const id = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    expect(parse(el(id))).toBe(id);
  });

  it("keeps an uppercase UUID", () => {
    const id = "3F1A2B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B";
    expect(parse(el(id))).toBe(id);
  });

  it("returns null when the attribute is absent", () => {
    expect(parse(el(null))).toBeNull();
  });

  it.each([
    ["a plain word", "not-a-uuid"],
    ["an empty string", ""],
    ["a numeric id from another editor", "12345"],
    ["a truncated uuid", "3f1a2b4c-5d6e-4f70-8a9b"],
    ["a uuid with extra segment", "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b-extra"],
    ["a uuid with non-hex chars", "zzzzzzzz-5d6e-4f70-8a9b-0c1d2e3f4a5b"],
    ["surrounding whitespace", " 3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b "],
    ["a sql-ish payload", "'); drop table blocks; --"],
  ])("rejects %s so a fresh id is minted instead", (_label, value) => {
    // Rejecting means null -> the appendTransaction plugin assigns a real UUID,
    // rather than the value reaching Postgres and failing the page's upsert.
    expect(parse(el(value))).toBeNull();
  });
});
