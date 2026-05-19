/**
 * Tests for @kora/core parser/html.ts
 *
 * Test structure mirrors the spec's CLI Warning vs Error Reference table.
 * Every hard error and warning case has at least one test.
 * Positive cases (happy path extraction) are tested for each archetype.
 */

import { describe, it, expect } from "vitest";
import { parseHtml } from "../html.js";
import type { ExtractionResult, RawBlock } from "@kora/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(html: string, sourceUrl = "https://acme.com/page"): Promise<ExtractionResult> {
  return parseHtml(html, { sourceUrl });
}

function firstBlock(result: ExtractionResult): RawBlock {
  const block = result.blocks[0];
  if (!block) throw new Error("No blocks in result");
  return block;
}

function fieldValue(block: RawBlock, name: string): string | string[] | undefined {
  return block.fields.find((f) => f.name === name)?.value;
}

function hasDiagnostic(
  block: RawBlock,
  code: string,
): boolean {
  return block.diagnostics.some((d) => d.code === code);
}

function hasDocDiagnostic(
  result: ExtractionResult,
  code: string,
): boolean {
  return result.documentDiagnostics.some((d) => d.code === code);
}

// ---------------------------------------------------------------------------
// Happy path — narrative
// ---------------------------------------------------------------------------

describe("narrative block — basic extraction", () => {
  it("extracts all core fields", async () => {
    const html = `
      <article kora-archetype="narrative" kora-subtype="blog_post">
        <h1 kora-field="title">The Future of AI Search</h1>
        <span kora-field="author">Jane Doe</span>
        <time kora-field="published_at" datetime="2026-01-15T00:00:00Z">Jan 15, 2026</time>
        <p kora-field="summary">A look at how agents are replacing direct browsing.</p>
        <div kora-field="body">Full article content here...</div>
        <div kora-field="tags" kora-list>
          <span>AI</span>
          <span>Search</span>
          <span>Agents</span>
        </div>
      </article>
    `;

    const result = await parse(html);
    expect(result.blocks).toHaveLength(1);

    const block = firstBlock(result);
    expect(block.archetype).toBe("narrative");
    expect(block.subtype).toBe("blog_post");
    expect(block.inferred).toBe(false);
    expect(fieldValue(block, "title")).toBe("The Future of AI Search");
    expect(fieldValue(block, "author")).toBe("Jane Doe");
    expect(fieldValue(block, "summary")).toBe("A look at how agents are replacing direct browsing.");
    expect(fieldValue(block, "body")).toBe("Full article content here...");
    expect(fieldValue(block, "tags")).toEqual(["AI", "Search", "Agents"]);
  });

  it("extracts datetime attribute from <time> element, not text", async () => {
    const html = `
      <article kora-archetype="narrative">
        <time kora-field="published_at" datetime="2026-01-15T00:00:00Z">Jan 15, 2026</time>
      </article>
    `;
    const result = await parse(html);
    expect(fieldValue(firstBlock(result), "published_at")).toBe("2026-01-15T00:00:00Z");
  });

  it("extracts href from <a> element into anchorHref", async () => {
    const html = `
      <article kora-archetype="narrative">
        <a kora-field="source" href="https://example.com/article">Read more</a>
      </article>
    `;
    const result = await parse(html);
    const block = firstBlock(result);
    const field = block.fields.find((f) => f.name === "source");
    expect(field?.value).toBe("Read more");
    expect(field?.anchorHref).toBe("https://example.com/article");
  });

  it("extracts src from <img> element as value", async () => {
    const html = `
      <article kora-archetype="narrative">
        <img kora-field="hero_image" src="/images/hero.jpg" alt="Hero image" />
      </article>
    `;
    const result = await parse(html);
    expect(fieldValue(firstBlock(result), "hero_image")).toBe("/images/hero.jpg");
  });

  it("extracts content from <meta> element as value", async () => {
    const html = `
      <article kora-archetype="narrative">
        <meta kora-field="og_description" content="A look at AI search trends." />
      </article>
    `;
    const result = await parse(html);
    expect(fieldValue(firstBlock(result), "og_description")).toBe("A look at AI search trends.");
  });

  it("records sourceUrl from options", async () => {
    const html = `<article kora-archetype="narrative"><h1 kora-field="title">T</h1></article>`;
    const result = await parse(html, "https://acme.com/blog/test");
    expect(firstBlock(result).sourceUrl).toBe("https://acme.com/blog/test");
  });

  it("produces no diagnostics for a well-formed block", async () => {
    const html = `
      <article kora-archetype="narrative" kora-subtype="blog_post">
        <h1 kora-field="title">Title</h1>
        <p kora-field="body">Body text.</p>
      </article>
    `;
    const result = await parse(html);
    const block = firstBlock(result);
    const errors = block.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Happy path — catalogue
// ---------------------------------------------------------------------------

describe("catalogue block — items extraction", () => {
  it("extracts catalogue items with scoped fields", async () => {
    const html = `
      <section kora-archetype="catalogue" kora-subtype="product_listing">
        <h1 kora-field="title">Developer Tools</h1>
        <div kora-item>
          <h2 kora-field="name">KOra SDK</h2>
          <p kora-field="description">Agent-optimised content packaging.</p>
          <a kora-field="url" href="/tools/kora">View Tool</a>
        </div>
        <div kora-item>
          <h2 kora-field="name">Another Tool</h2>
          <p kora-field="description">Does something useful.</p>
          <a kora-field="url" href="/tools/other">View Tool</a>
        </div>
      </section>
    `;

    const result = await parse(html);
    const block = firstBlock(result);
    expect(block.archetype).toBe("catalogue");
    expect(block.items).toHaveLength(2);

    // Container-level field
    expect(fieldValue(block, "title")).toBe("Developer Tools");

    // Item-scoped fields — not promoted to container
    expect(block.fields.find((f) => f.name === "name")).toBeUndefined();

    const item0 = block.items[0]!;
    expect(item0.fields.find((f) => f.name === "name")?.value).toBe("KOra SDK");
    expect(item0.fields.find((f) => f.name === "url")?.anchorHref).toBe("/tools/kora");

    const item1 = block.items[1]!;
    expect(item1.fields.find((f) => f.name === "name")?.value).toBe("Another Tool");
  });
});

// ---------------------------------------------------------------------------
// Happy path — dialogue
// ---------------------------------------------------------------------------

describe("dialogue block — turns extraction", () => {
  it("extracts turns with scoped fields in DOM order", async () => {
    const html = `
      <section kora-archetype="dialogue" kora-subtype="support_thread">
        <h1 kora-field="title">How do I handle token limits?</h1>
        <div kora-turn>
          <span kora-field="participant">dev_user</span>
          <span kora-field="role">question</span>
          <p kora-field="body">What happens when a field exceeds max_field_tokens?</p>
          <time kora-field="posted_at" datetime="2026-01-10T09:00:00Z">Jan 10</time>
        </div>
        <div kora-turn>
          <span kora-field="participant">kora_team</span>
          <span kora-field="role">answer</span>
          <p kora-field="body">The field is truncated and flagged.</p>
          <time kora-field="posted_at" datetime="2026-01-10T09:15:00Z">Jan 10</time>
        </div>
      </section>
    `;

    const result = await parse(html);
    const block = firstBlock(result);
    expect(block.archetype).toBe("dialogue");
    expect(block.turns).toHaveLength(2);
    expect(fieldValue(block, "title")).toBe("How do I handle token limits?");

    const turn0 = block.turns[0]!;
    expect(turn0.fields.find((f) => f.name === "participant")?.value).toBe("dev_user");
    expect(turn0.fields.find((f) => f.name === "posted_at")?.value).toBe("2026-01-10T09:00:00Z");

    const turn1 = block.turns[1]!;
    expect(turn1.fields.find((f) => f.name === "participant")?.value).toBe("kora_team");
  });
});

// ---------------------------------------------------------------------------
// Happy path — signal
// ---------------------------------------------------------------------------

describe("signal block — extraction", () => {
  it("extracts signal fields", async () => {
    const html = `
      <div kora-archetype="signal" kora-subtype="stock_price">
        <span kora-field="label">AAPL Stock Price</span>
        <span kora-field="value">214.73</span>
        <span kora-field="unit">USD</span>
        <time kora-field="recorded_at" datetime="2026-01-15T16:00:00Z">Jan 15</time>
        <span kora-field="source">NYSE</span>
        <span kora-field="currency" kora-relation="value">USD</span>
      </div>
    `;

    const result = await parse(html);
    const block = firstBlock(result);
    expect(block.archetype).toBe("signal");
    expect(fieldValue(block, "label")).toBe("AAPL Stock Price");
    expect(fieldValue(block, "recorded_at")).toBe("2026-01-15T16:00:00Z");

    const currencyField = block.fields.find((f) => f.name === "currency");
    expect(currencyField?.relation).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// Nested blocks (Option B)
// ---------------------------------------------------------------------------

describe("nested kora-archetype blocks", () => {
  it("promotes inner kora-archetype to nestedBlocks of the outer block", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Outer article</h1>
        <div kora-archetype="signal" kora-subtype="stock_price">
          <span kora-field="label">AAPL</span>
          <span kora-field="value">214.73</span>
        </div>
      </article>
    `;

    const result = await parse(html);
    // Top-level: only the outer narrative block
    expect(result.blocks).toHaveLength(1);

    const outer = firstBlock(result);
    expect(outer.archetype).toBe("narrative");
    expect(outer.nestedBlocks).toHaveLength(1);

    const inner = outer.nestedBlocks[0]!;
    expect(inner.archetype).toBe("signal");
    expect(fieldValue(inner, "label")).toBe("AAPL");
  });

  it("does not extract inner block's fields into outer block scope", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Outer</h1>
        <div kora-archetype="signal">
          <span kora-field="label">Inner label</span>
        </div>
      </article>
    `;
    const result = await parse(html);
    const outer = firstBlock(result);
    // "label" should not appear in outer block's fields
    expect(outer.fields.find((f) => f.name === "label")).toBeUndefined();
    // It should be in the nested block
    expect(outer.nestedBlocks[0]?.fields.find((f) => f.name === "label")?.value).toBe("Inner label");
  });

  it("handles triple nesting correctly", async () => {
    const html = `
      <div kora-archetype="narrative">
        <div kora-archetype="catalogue">
          <div kora-archetype="signal">
            <span kora-field="label">deep</span>
          </div>
        </div>
      </div>
    `;
    const result = await parse(html);
    expect(result.blocks).toHaveLength(1);
    const level1 = result.blocks[0]!;
    expect(level1.archetype).toBe("narrative");
    expect(level1.nestedBlocks).toHaveLength(1);
    const level2 = level1.nestedBlocks[0]!;
    expect(level2.archetype).toBe("catalogue");
    expect(level2.nestedBlocks).toHaveLength(1);
    const level3 = level2.nestedBlocks[0]!;
    expect(level3.archetype).toBe("signal");
    expect(fieldValue(level3, "label")).toBe("deep");
  });
});

// ---------------------------------------------------------------------------
// kora-exclude
// ---------------------------------------------------------------------------

describe("kora-exclude", () => {
  it("excludes marked element and its descendants from extraction", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Article title</h1>
        <div kora-field="body">Body content.</div>
        <aside kora-exclude>
          <span kora-field="ad_content">Buy now!</span>
        </aside>
      </article>
    `;
    const result = await parse(html);
    const block = firstBlock(result);
    expect(fieldValue(block, "title")).toBe("Article title");
    expect(fieldValue(block, "body")).toBe("Body content.");
    // ad_content is inside kora-exclude — must not appear
    expect(block.fields.find((f) => f.name === "ad_content")).toBeUndefined();
  });

  it("produces no diagnostic for kora-exclude — it is always silently honoured", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Title</h1>
        <div kora-exclude><p kora-field="hidden">hidden</p></div>
      </article>
    `;
    const result = await parse(html);
    const block = firstBlock(result);
    expect(block.diagnostics.every((d) => d.code !== "FIELD_OUTSIDE_CONTAINER")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hard errors
// ---------------------------------------------------------------------------

describe("hard errors", () => {
  it("UNKNOWN_ARCHETYPE — invalid kora-archetype value produces error diagnostic", async () => {
    const html = `<div kora-archetype="bogus"><span kora-field="title">T</span></div>`;
    const result = await parse(html);
    const block = firstBlock(result);
    const err = block.diagnostics.find((d) => d.code === "UNKNOWN_ARCHETYPE");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  it("ITEM_OUTSIDE_CATALOGUE — kora-item inside narrative produces error", async () => {
    const html = `
      <article kora-archetype="narrative">
        <div kora-item><span kora-field="name">Bad item</span></div>
      </article>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "ITEM_OUTSIDE_CATALOGUE")).toBe(true);
    expect(firstBlock(result).diagnostics.find((d) => d.code === "ITEM_OUTSIDE_CATALOGUE")?.severity).toBe("error");
  });

  it("TURN_OUTSIDE_DIALOGUE — kora-turn inside catalogue produces error", async () => {
    const html = `
      <section kora-archetype="catalogue">
        <div kora-turn><span kora-field="participant">user</span></div>
      </section>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "TURN_OUTSIDE_DIALOGUE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

describe("warnings", () => {
  it("FIELD_OUTSIDE_CONTAINER — kora-field with no ancestor archetype", async () => {
    const html = `
      <div>
        <span kora-field="orphan_field">I have no home</span>
      </div>
    `;
    const result = await parse(html);
    expect(result.blocks).toHaveLength(0);
    expect(hasDocDiagnostic(result, "FIELD_OUTSIDE_CONTAINER")).toBe(true);
  });

  it("SUBTYPE_WITHOUT_ARCHETYPE — kora-subtype on element without kora-archetype", async () => {
    const html = `
      <div>
        <span kora-subtype="blog_post">Some text</span>
      </div>
    `;
    const result = await parse(html);
    expect(hasDocDiagnostic(result, "SUBTYPE_WITHOUT_ARCHETYPE")).toBe(true);
  });

  it("SUBTYPE_NOT_SNAKE_CASE — kora-subtype value in wrong format", async () => {
    const html = `<article kora-archetype="narrative" kora-subtype="BlogPost"><h1 kora-field="title">T</h1></article>`;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "SUBTYPE_NOT_SNAKE_CASE")).toBe(true);
  });

  it("FIELD_NOT_SNAKE_CASE — kora-field value in wrong format", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="MyTitle">Title</h1>
      </article>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "FIELD_NOT_SNAKE_CASE")).toBe(true);
    // Field is still extracted despite the warning
    expect(fieldValue(firstBlock(result), "MyTitle")).toBe("Title");
  });

  it("LIST_WITHOUT_FIELD — kora-list without kora-field on same element", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Title</h1>
        <div kora-list><span>tag1</span></div>
      </article>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "LIST_WITHOUT_FIELD")).toBe(true);
  });

  it("CONFIDENCE_NOT_ON_FIELD — kora-confidence on container", async () => {
    const html = `
      <article kora-archetype="narrative" kora-confidence="high">
        <h1 kora-field="title">Title</h1>
      </article>
    `;
    // kora-confidence on the container itself (no kora-field on same element)
    // The parser sees it on a non-field element
    const result = await parse(html);
    // Container doesn't have kora-field, so confidence on it triggers warning
    expect(hasDiagnostic(firstBlock(result), "CONFIDENCE_NOT_ON_FIELD")).toBe(true);
  });

  it("CONFIDENCE_UNKNOWN_VALUE — invalid confidence value on a field", async () => {
    const html = `
      <article kora-archetype="narrative">
        <span kora-field="author" kora-confidence="absolute">Jane</span>
      </article>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "CONFIDENCE_UNKNOWN_VALUE")).toBe(true);
  });

  it("RELATION_UNRESOLVED — kora-relation references non-existent field", async () => {
    const html = `
      <article kora-archetype="narrative">
        <span kora-field="currency" kora-relation="price">USD</span>
      </article>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "RELATION_UNRESOLVED")).toBe(true);
  });

  it("RELATION_RESOLVED — valid kora-relation produces no warning", async () => {
    const html = `
      <div kora-archetype="signal">
        <span kora-field="price">214.73</span>
        <span kora-field="currency" kora-relation="price">USD</span>
      </div>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "RELATION_UNRESOLVED")).toBe(false);
  });

  it("DUPLICATE_FIELD — second occurrence of same field name", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">First title</h1>
        <h2 kora-field="title">Second title</h2>
      </article>
    `;
    const result = await parse(html);
    expect(hasDiagnostic(firstBlock(result), "DUPLICATE_FIELD")).toBe(true);
    // First occurrence wins
    expect(fieldValue(firstBlock(result), "title")).toBe("First title");
  });
});

// ---------------------------------------------------------------------------
// kora-list behaviour
// ---------------------------------------------------------------------------

describe("kora-list", () => {
  it("collects direct child text values as an array", async () => {
    const html = `
      <article kora-archetype="narrative">
        <div kora-field="tags" kora-list>
          <span>AI</span>
          <span>Search</span>
          <span>Agents</span>
        </div>
      </article>
    `;
    const result = await parse(html);
    expect(fieldValue(firstBlock(result), "tags")).toEqual(["AI", "Search", "Agents"]);
  });

  it("marks the field as isList: true", async () => {
    const html = `
      <article kora-archetype="narrative">
        <div kora-field="tags" kora-list><span>AI</span></div>
      </article>
    `;
    const result = await parse(html);
    const field = firstBlock(result).fields.find((f) => f.name === "tags");
    expect(field?.isList).toBe(true);
  });

  it("ignores whitespace text nodes between list children", async () => {
    const html = `
      <article kora-archetype="narrative">
        <div kora-field="tags" kora-list>
          <span>  AI  </span>
          <span>Search</span>
        </div>
      </article>
    `;
    const result = await parse(html);
    expect(fieldValue(firstBlock(result), "tags")).toEqual(["AI", "Search"]);
  });
});

// ---------------------------------------------------------------------------
// Auto-strip behaviour
// ---------------------------------------------------------------------------

describe("auto-strip of nav, footer, header", () => {
  it("strips <nav> elements before processing", async () => {
    const html = `
      <nav><a kora-field="nav_link" href="/home">Home</a></nav>
      <article kora-archetype="narrative">
        <h1 kora-field="title">Article</h1>
      </article>
    `;
    const result = await parse(html);
    // nav_link should not appear anywhere
    const allFields = result.blocks.flatMap((b) => b.fields);
    expect(allFields.find((f) => f.name === "nav_link")).toBeUndefined();
    // But no orphan warning either — it was stripped before detection
    expect(result.documentDiagnostics.find((d) => d.code === "FIELD_OUTSIDE_CONTAINER")).toBeUndefined();
  });

  it("strips <footer> elements", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Title</h1>
      </article>
      <footer><span kora-field="copyright">2026</span></footer>
    `;
    const result = await parse(html);
    const allFields = result.blocks.flatMap((b) => b.fields);
    expect(allFields.find((f) => f.name === "copyright")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple top-level blocks
// ---------------------------------------------------------------------------

describe("multiple top-level blocks", () => {
  it("extracts all independent kora-archetype containers", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Article one</h1>
      </article>
      <article kora-archetype="narrative">
        <h1 kora-field="title">Article two</h1>
      </article>
    `;
    const result = await parse(html);
    expect(result.blocks).toHaveLength(2);
    expect(fieldValue(result.blocks[0]!, "title")).toBe("Article one");
    expect(fieldValue(result.blocks[1]!, "title")).toBe("Article two");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("empty HTML produces no blocks and no diagnostics", async () => {
    const result = await parse("");
    expect(result.blocks).toHaveLength(0);
    expect(result.documentDiagnostics).toHaveLength(0);
  });

  it("kora-archetype container with no kora-field children produces empty fields", async () => {
    const html = `<article kora-archetype="narrative"><p>No fields here.</p></article>`;
    const result = await parse(html);
    expect(firstBlock(result).fields).toHaveLength(0);
  });

  it("kora-confidence on a valid field is stored correctly", async () => {
    const html = `
      <article kora-archetype="narrative">
        <span kora-field="author" kora-confidence="low">Unknown</span>
      </article>
    `;
    const result = await parse(html);
    const field = firstBlock(result).fields.find((f) => f.name === "author");
    expect(field?.confidence).toBe("low");
    expect(hasDiagnostic(firstBlock(result), "CONFIDENCE_UNKNOWN_VALUE")).toBe(false);
  });

  it("sourceUrl is propagated to nested blocks", async () => {
    const html = `
      <article kora-archetype="narrative">
        <div kora-archetype="signal"><span kora-field="label">Price</span></div>
      </article>
    `;
    const result = await parse(html, "https://acme.com/page");
    const nested = firstBlock(result).nestedBlocks[0]!;
    expect(nested.sourceUrl).toBe("https://acme.com/page");
  });
});