import { describe, expect, it } from "vitest";
import type { Block, Json } from "@/lib/db/types";
import { asNode, byPosition, childNodes, collectText } from "@/lib/export/pmWalk";
import { serializeBlocksToMarkdown } from "@/lib/export/serialize";

/**
 * Covers lib/export/pmWalk.ts — the walker primitives that used to be
 * copy-pasted into the Markdown/HTML/docx serializers — plus a round-trip
 * through the Markdown serializer to prove the extraction preserved behaviour.
 */

function block(partial: Partial<Block> & { position: string; content: Json }): Block {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    page_id: "11111111-1111-4111-8111-111111111111",
    parent_block_id: null,
    type: "paragraph",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  } as Block;
}

const para = (text: string): Json =>
  ({ type: "paragraph", content: [{ type: "text", text }] }) as unknown as Json;

describe("byPosition", () => {
  it("orders by the fractional-index key as a STRING, not numerically", () => {
    // The keys are COLLATE "C" fractional-index strings (lib/positions.ts).
    // "a10" must sort before "a2" — numeric comparison would get this wrong.
    const blocks = [
      block({ position: "a2", content: para("second") }),
      block({ position: "a10", content: para("first") }),
    ];
    const sorted = blocks.slice().sort(byPosition);
    expect(sorted.map((b) => b.position)).toEqual(["a10", "a2"]);
  });

  it("returns 0 for equal positions", () => {
    const a = block({ position: "a0", content: para("x") });
    expect(byPosition(a, a)).toBe(0);
  });
});

describe("asNode", () => {
  it("narrows a well-formed node object", () => {
    expect(asNode(para("hi"))?.type).toBe("paragraph");
  });

  it("rejects values that are not PM nodes", () => {
    // A block row's `content` column is untrusted JSON — these must not throw.
    expect(asNode(null)).toBeNull();
    expect(asNode("a string" as unknown as Json)).toBeNull();
    expect(asNode(42 as unknown as Json)).toBeNull();
    expect(asNode([] as unknown as Json)).toBeNull();
    expect(asNode({} as unknown as Json)).toBeNull();
    expect(asNode({ notType: true } as unknown as Json)).toBeNull();
  });
});

describe("childNodes", () => {
  it("returns children when present", () => {
    const node = asNode(para("hello"))!;
    expect(childNodes(node)).toHaveLength(1);
  });

  it("returns [] for a leaf with no content array", () => {
    expect(childNodes({ type: "text", text: "x" })).toEqual([]);
  });

  it("filters out null/undefined entries rather than propagating them", () => {
    const node = { type: "paragraph", content: [null, { type: "text", text: "a" }] };
    expect(childNodes(node as never)).toHaveLength(1);
  });
});

describe("collectText", () => {
  it("flattens a nested subtree to plain text", () => {
    const node = {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "bold", content: [{ type: "text", text: "brave " }] },
        { type: "text", text: "world" },
      ],
    };
    expect(collectText(node as never)).toBe("Hello brave world");
  });

  it("returns an empty string for a text node with no text", () => {
    expect(collectText({ type: "text" })).toBe("");
  });
});

describe("serializeBlocksToMarkdown (post-extraction behaviour)", () => {
  const ctx = { resolveWikilink: () => null };

  it("emits blocks in fractional-index order, not array order", () => {
    const md = serializeBlocksToMarkdown(
      [
        block({ position: "a2", content: para("second") }),
        block({ position: "a1", content: para("first") }),
      ],
      ctx
    );
    expect(md.indexOf("first")).toBeLessThan(md.indexOf("second"));
  });

  it("skips rows whose content is not a valid PM node instead of throwing", () => {
    const md = serializeBlocksToMarkdown(
      [
        block({ position: "a1", content: para("kept") }),
        block({ position: "a2", content: null as unknown as Json }),
      ],
      ctx
    );
    expect(md).toContain("kept");
  });

  it("escapes Markdown-significant characters in text", () => {
    const md = serializeBlocksToMarkdown(
      [block({ position: "a1", content: para("a * b _ c [d]") })],
      ctx
    );
    expect(md).toContain("\\*");
    expect(md).toContain("\\_");
  });
});
