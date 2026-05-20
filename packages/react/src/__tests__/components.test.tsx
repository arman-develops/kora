/**
 * Tests for @kora/react components.
 *
 * Primary assertion surface: SSR HTML output via renderToStaticMarkup.
 * This is the contract that matters — the CLI parses SSR output, not the
 * React component tree. If the attribute doesn't appear in rendered HTML,
 * the CLI won't find it.
 *
 * Secondary surface: DOM attribute presence via @testing-library/react,
 * for cases where we want to query the live DOM rather than parse HTML.
 *
 * Test structure:
 *   KoraBlock  — element rendering, kora-* attributes, prop forwarding
 *   KoraField  — attribute injection via cloneElement, all attributes
 *   KoraItem   — kora-item injection, scope isolation
 *   KoraTurn   — kora-turn injection, scope isolation
 *   Integration — full realistic component trees rendered to HTML,
 *                 fed to parseHtml to verify the round-trip
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KoraBlock, KoraField, KoraItem, KoraTurn } from "../index.js";
import { parseHtml } from "@kora/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ssr(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ---------------------------------------------------------------------------
// KoraBlock
// ---------------------------------------------------------------------------

describe("KoraBlock", () => {
  describe("element rendering", () => {
    it("renders a div by default", () => {
      const html = ssr(
        <KoraBlock archetype="narrative">
          <p>content</p>
        </KoraBlock>,
      );
      expect(html).toMatch(/^<div /);
    });

    it("renders the element specified by `as`", () => {
      const html = ssr(
        <KoraBlock as="article" archetype="narrative">
          <p>content</p>
        </KoraBlock>,
      );
      expect(html).toMatch(/^<article /);
    });

    it("renders children inside the container element", () => {
      const html = ssr(
        <KoraBlock as="section" archetype="reference">
          <h1>Title</h1>
          <p>Body</p>
        </KoraBlock>,
      );
      expect(html).toContain("<h1>Title</h1>");
      expect(html).toContain("<p>Body</p>");
    });
  });

  describe("kora-archetype attribute", () => {
    it("writes kora-archetype on the rendered element", () => {
      const html = ssr(
        <KoraBlock archetype="narrative"><p>x</p></KoraBlock>,
      );
      expect(html).toContain('kora-archetype="narrative"');
    });

    it("writes the correct archetype for each value", () => {
      const archetypes = [
        "narrative",
        "reference",
        "catalogue",
        "dialogue",
        "signal",
      ] as const;
      for (const archetype of archetypes) {
        const html = ssr(<KoraBlock archetype={archetype}><p>x</p></KoraBlock>);
        expect(html).toContain(`kora-archetype="${archetype}"`);
      }
    });
  });

  describe("kora-subtype attribute", () => {
    it("writes kora-subtype when provided", () => {
      const html = ssr(
        <KoraBlock archetype="narrative" subtype="blog_post">
          <p>x</p>
        </KoraBlock>,
      );
      expect(html).toContain('kora-subtype="blog_post"');
    });

    it("omits kora-subtype when not provided", () => {
      const html = ssr(
        <KoraBlock archetype="narrative"><p>x</p></KoraBlock>,
      );
      expect(html).not.toContain("kora-subtype");
    });
  });

  describe("dynamic prop serialisation", () => {
    it("writes data-kora-dynamic as JSON when provided", () => {
      const dynamic = { source: "/api/products", tier: "slow" as const, refresh: "6h" };
      const html = ssr(
        <KoraBlock archetype="catalogue" dynamic={dynamic}>
          <p>x</p>
        </KoraBlock>,
      );
      expect(html).toContain("data-kora-dynamic");
      // renderToStaticMarkup HTML-encodes attribute values — verify key presence
      expect(html).toContain("source");
      expect(html).toContain("/api/products");
    });

    it("omits data-kora-dynamic when not provided", () => {
      const html = ssr(
        <KoraBlock archetype="narrative"><p>x</p></KoraBlock>,
      );
      expect(html).not.toContain("data-kora-dynamic");
    });

    it("serialises live tier dynamic source without refresh", () => {
      const dynamic = { source: "/api/price", tier: "live" as const };
      const html = ssr(
        <KoraBlock archetype="signal" dynamic={dynamic}><p>x</p></KoraBlock>,
      );
      // renderToStaticMarkup HTML-encodes attribute values — verify key presence
      expect(html).toContain("/api/price");
      expect(html).toContain("live");
    });
  });

  describe("prop forwarding", () => {
    it("forwards className to the rendered element", () => {
      const html = ssr(
        <KoraBlock archetype="narrative" className="prose max-w-2xl">
          <p>x</p>
        </KoraBlock>,
      );
      expect(html).toContain('class="prose max-w-2xl"');
    });

    it("forwards id to the rendered element", () => {
      const html = ssr(
        <KoraBlock archetype="narrative" id="intro">
          <p>x</p>
        </KoraBlock>,
      );
      expect(html).toContain('id="intro"');
    });

    it("forwards data-* attributes to the rendered element", () => {
      const html = ssr(
        <KoraBlock archetype="narrative" data-testid="block">
          <p>x</p>
        </KoraBlock>,
      );
      expect(html).toContain('data-testid="block"');
    });

    it("kora-archetype cannot be overridden by rest props", () => {
      // Pass a conflicting kora-archetype via rest — the prop should
      // win because koraAttrs are spread last in the implementation.
      const html = ssr(
        <KoraBlock archetype="narrative" kora-archetype="hacked">
          <p>x</p>
        </KoraBlock>,
      );
      // The correct archetype declared via the prop should win
      expect(html).toContain('kora-archetype="narrative"');
      expect(html).not.toContain('kora-archetype="hacked"');
    });
  });

  describe("dev-mode warnings", () => {
    it("warns in development when subtype is not snake_case", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";
      ssr(<KoraBlock archetype="narrative" subtype="BlogPost"><p>x</p></KoraBlock>);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("BlogPost"));
      process.env["NODE_ENV"] = originalEnv;
      spy.mockRestore();
    });

    it("does not warn in production for invalid subtype", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";
      ssr(<KoraBlock archetype="narrative" subtype="BlogPost"><p>x</p></KoraBlock>);
      expect(spy).not.toHaveBeenCalled();
      process.env["NODE_ENV"] = originalEnv;
      spy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// KoraField
// ---------------------------------------------------------------------------

describe("KoraField", () => {
  describe("kora-field attribute", () => {
    it("injects kora-field onto the child element", () => {
      const html = ssr(
        <KoraField field="title">
          <h1>The Future of AI Search</h1>
        </KoraField>,
      );
      expect(html).toBe('<h1 kora-field="title">The Future of AI Search</h1>');
    });

    it("preserves the child element type", () => {
      const html = ssr(<KoraField field="body"><div>content</div></KoraField>);
      expect(html).toMatch(/^<div/);
    });

    it("preserves existing props on the child element", () => {
      const html = ssr(
        <KoraField field="author">
          <span className="text-sm italic">Jane Doe</span>
        </KoraField>,
      );
      expect(html).toContain('class="text-sm italic"');
      expect(html).toContain('kora-field="author"');
    });

    it("handles <time> element correctly — datetime attribute is preserved", () => {
      const html = ssr(
        <KoraField field="published_at">
          <time dateTime="2026-01-15T00:00:00Z">Jan 15, 2026</time>
        </KoraField>,
      );
      expect(html).toContain('kora-field="published_at"');
      expect(html).toContain('dateTime="2026-01-15T00:00:00Z"');
      expect(html).toContain("Jan 15, 2026");
    });

    it("handles <a> element correctly — href is preserved", () => {
      const html = ssr(
        <KoraField field="source">
          <a href="https://example.com/article">Read more</a>
        </KoraField>,
      );
      expect(html).toContain('kora-field="source"');
      expect(html).toContain('href="https://example.com/article"');
    });

    it("handles <img> element correctly — src and alt preserved", () => {
      const html = ssr(
        <KoraField field="hero_image">
          <img src="/images/hero.jpg" alt="Hero" />
        </KoraField>,
      );
      expect(html).toContain('kora-field="hero_image"');
      expect(html).toContain('src="/images/hero.jpg"');
    });
  });

  describe("kora-list attribute", () => {
    it("injects kora-list when list=true", () => {
      const html = ssr(
        <KoraField field="tags" list>
          <div>
            <span>AI</span>
            <span>Search</span>
          </div>
        </KoraField>,
      );
      expect(html).toContain("kora-list");
      expect(html).toContain('kora-field="tags"');
    });

    it("does not inject kora-list when list is not set", () => {
      const html = ssr(
        <KoraField field="title"><h1>Title</h1></KoraField>,
      );
      expect(html).not.toContain("kora-list");
    });
  });

  describe("kora-exclude attribute", () => {
    it("injects kora-exclude when exclude=true", () => {
      const html = ssr(
        <KoraField field="ad_content" exclude>
          <div>Buy now</div>
        </KoraField>,
      );
      expect(html).toContain("kora-exclude");
    });

    it("does not inject kora-exclude when not set", () => {
      const html = ssr(
        <KoraField field="title"><h1>Title</h1></KoraField>,
      );
      expect(html).not.toContain("kora-exclude");
    });
  });

  describe("kora-confidence attribute", () => {
    it("injects kora-confidence when provided", () => {
      const html = ssr(
        <KoraField field="author" confidence="low">
          <span>Unknown</span>
        </KoraField>,
      );
      expect(html).toContain('kora-confidence="low"');
    });

    it("accepts all three confidence values", () => {
      for (const confidence of ["high", "medium", "low"] as const) {
        const html = ssr(
          <KoraField field="f" confidence={confidence}><span>x</span></KoraField>,
        );
        expect(html).toContain(`kora-confidence="${confidence}"`);
      }
    });

    it("omits kora-confidence when not provided", () => {
      const html = ssr(
        <KoraField field="title"><h1>Title</h1></KoraField>,
      );
      expect(html).not.toContain("kora-confidence");
    });
  });

  describe("kora-relation attribute", () => {
    it("injects kora-relation when provided", () => {
      const html = ssr(
        <KoraField field="currency" relation="price">
          <span>USD</span>
        </KoraField>,
      );
      expect(html).toContain('kora-relation="price"');
      expect(html).toContain('kora-field="currency"');
    });

    it("omits kora-relation when not provided", () => {
      const html = ssr(
        <KoraField field="price"><span>214.73</span></KoraField>,
      );
      expect(html).not.toContain("kora-relation");
    });
  });

  describe("dev-mode warnings", () => {
    it("warns when child is a custom component", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";

      function MyComponent({ children }: { children?: React.ReactNode }) {
        return <div>{children}</div>;
      }

      ssr(
        <KoraField field="title">
          <MyComponent>Title</MyComponent>
        </KoraField>,
      );
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("custom component"));
      process.env["NODE_ENV"] = originalEnv;
      spy.mockRestore();
    });

    it("warns when field name is not snake_case", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";
      ssr(<KoraField field="MyField"><span>x</span></KoraField>);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("MyField"));
      process.env["NODE_ENV"] = originalEnv;
      spy.mockRestore();
    });

    it("does not warn for valid snake_case field names", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";
      ssr(<KoraField field="published_at"><span>x</span></KoraField>);
      expect(spy).not.toHaveBeenCalled();
      process.env["NODE_ENV"] = originalEnv;
      spy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// KoraItem
// ---------------------------------------------------------------------------

describe("KoraItem", () => {
  it("injects kora-item onto the child element", () => {
    const html = ssr(
      <KoraItem>
        <div>item content</div>
      </KoraItem>,
    );
    expect(html).toContain("kora-item");
    expect(html).toContain("item content");
  });

  it("preserves the child element type", () => {
    const html = ssr(<KoraItem><article>item</article></KoraItem>);
    expect(html).toMatch(/^<article/);
  });

  it("preserves existing props on the child", () => {
    const html = ssr(
      <KoraItem>
        <div className="product-card" id="p1">item</div>
      </KoraItem>,
    );
    expect(html).toContain('class="product-card"');
    expect(html).toContain('id="p1"');
    expect(html).toContain("kora-item");
  });

  it("renders nested KoraField children correctly", () => {
    const html = ssr(
      <KoraItem>
        <div>
          <KoraField field="name"><h2>KOra SDK</h2></KoraField>
          <KoraField field="description"><p>Agent-optimised content packaging.</p></KoraField>
        </div>
      </KoraItem>,
    );
    expect(html).toContain("kora-item");
    expect(html).toContain('kora-field="name"');
    expect(html).toContain('kora-field="description"');
  });
});

// ---------------------------------------------------------------------------
// KoraTurn
// ---------------------------------------------------------------------------

describe("KoraTurn", () => {
  it("injects kora-turn onto the child element", () => {
    const html = ssr(
      <KoraTurn>
        <div>turn content</div>
      </KoraTurn>,
    );
    expect(html).toContain("kora-turn");
  });

  it("preserves the child element type", () => {
    const html = ssr(<KoraTurn><article>turn</article></KoraTurn>);
    expect(html).toMatch(/^<article/);
  });

  it("renders nested KoraField children correctly", () => {
    const html = ssr(
      <KoraTurn>
        <div>
          <KoraField field="participant"><span>dev_user</span></KoraField>
          <KoraField field="body"><p>What happens when a field exceeds max_field_tokens?</p></KoraField>
          <KoraField field="posted_at">
            <time dateTime="2026-01-10T09:00:00Z">Jan 10</time>
          </KoraField>
        </div>
      </KoraTurn>,
    );
    expect(html).toContain("kora-turn");
    expect(html).toContain('kora-field="participant"');
    expect(html).toContain('kora-field="body"');
    expect(html).toContain('kora-field="posted_at"');
    expect(html).toContain('dateTime="2026-01-10T09:00:00Z"');
  });
});

// ---------------------------------------------------------------------------
// Integration — SSR → parseHtml round-trip
//
// These tests render component trees to HTML via renderToStaticMarkup,
// then feed the HTML string to parseHtml. This validates the complete
// hybrid contract: components produce attributes → parser reads them.
// ---------------------------------------------------------------------------

describe("SSR → parseHtml round-trip", () => {
  it("narrative blog post — all core fields extracted", async () => {
    const html = ssr(
      <KoraBlock as="article" archetype="narrative" subtype="blog_post">
        <KoraField field="title"><h1>The Future of AI Search</h1></KoraField>
        <KoraField field="author"><span>Jane Doe</span></KoraField>
        <KoraField field="published_at">
          <time dateTime="2026-01-15T00:00:00Z">Jan 15, 2026</time>
        </KoraField>
        <KoraField field="summary">
          <p>A look at how agents are replacing direct browsing.</p>
        </KoraField>
        <KoraField field="body">
          <div>Full article content here.</div>
        </KoraField>
        <KoraField field="tags" list>
          <div><span>AI</span><span>Search</span><span>Agents</span></div>
        </KoraField>
      </KoraBlock>,
    );

    const { result } = await parseHtml(html, { sourceUrl: "https://acme.com/blog/test" });
    expect(result.blocks).toHaveLength(1);

    const block = result.blocks[0]!;
    expect(block.archetype).toBe("narrative");
    expect(block.subtype).toBe("blog_post");

    const field = (name: string) => block.fields.find((f) => f.name === name);

    expect(field("title")?.value).toBe("The Future of AI Search");
    expect(field("author")?.value).toBe("Jane Doe");
    // KoraBlock datetime is extracted from the datetime attribute by the parser
    expect(field("published_at")?.value).toBe("2026-01-15T00:00:00Z");
    expect(field("summary")?.value).toBe("A look at how agents are replacing direct browsing.");
    expect(field("body")?.value).toBe("Full article content here.");
    expect(field("tags")?.value).toEqual(["AI", "Search", "Agents"]);
    expect(block.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("catalogue with items — item fields scoped correctly", async () => {
    const tools = [
      { id: "1", name: "KOra SDK", description: "Agent-optimised content packaging.", url: "/tools/kora" },
      { id: "2", name: "Another Tool", description: "Does something useful.", url: "/tools/other" },
    ];

    const html = ssr(
      <KoraBlock as="section" archetype="catalogue" subtype="tool_directory">
        <KoraField field="title"><h1>Developer Tools</h1></KoraField>
        {tools.map((tool) => (
          <KoraItem key={tool.id}>
            <div>
              <KoraField field="name"><h2>{tool.name}</h2></KoraField>
              <KoraField field="description"><p>{tool.description}</p></KoraField>
              <KoraField field="url"><a href={tool.url}>View Tool</a></KoraField>
            </div>
          </KoraItem>
        ))}
      </KoraBlock>,
    );

    const { result } = await parseHtml(html, { sourceUrl: "https://acme.com/tools" });
    const block = result.blocks[0]!;
    expect(block.archetype).toBe("catalogue");
    expect(block.items).toHaveLength(2);

    // Container-level field
    expect(block.fields.find((f) => f.name === "title")?.value).toBe("Developer Tools");

    // Item fields not promoted to container
    expect(block.fields.find((f) => f.name === "name")).toBeUndefined();

    // Item fields correctly scoped
    expect(block.items[0]!.fields.find((f) => f.name === "name")?.value).toBe("KOra SDK");
    expect(block.items[0]!.fields.find((f) => f.name === "url")?.anchorHref).toBe("/tools/kora");
    expect(block.items[1]!.fields.find((f) => f.name === "name")?.value).toBe("Another Tool");
  });

  it("dialogue with turns — turn fields scoped correctly", async () => {
    const turns = [
      { id: "t1", participant: "dev_user", role: "question", body: "What happens when a field exceeds max_field_tokens?", iso: "2026-01-10T09:00:00Z" },
      { id: "t2", participant: "kora_team", role: "answer", body: "The field is truncated and flagged.", iso: "2026-01-10T09:15:00Z" },
    ];

    const html = ssr(
      <KoraBlock as="section" archetype="dialogue" subtype="support_thread">
        <KoraField field="title"><h1>How do I handle token limits?</h1></KoraField>
        {turns.map((turn) => (
          <KoraTurn key={turn.id}>
            <div>
              <KoraField field="participant"><span>{turn.participant}</span></KoraField>
              <KoraField field="role"><span>{turn.role}</span></KoraField>
              <KoraField field="body"><p>{turn.body}</p></KoraField>
              <KoraField field="posted_at">
                <time dateTime={turn.iso}>date</time>
              </KoraField>
            </div>
          </KoraTurn>
        ))}
      </KoraBlock>,
    );

    const { result } = await parseHtml(html, { sourceUrl: "https://acme.com/support/thread" });
    const block = result.blocks[0]!;
    expect(block.archetype).toBe("dialogue");
    expect(block.turns).toHaveLength(2);

    const turn0 = block.turns[0]!;
    expect(turn0.fields.find((f) => f.name === "participant")?.value).toBe("dev_user");
    expect(turn0.fields.find((f) => f.name === "role")?.value).toBe("question");
    expect(turn0.fields.find((f) => f.name === "posted_at")?.value).toBe("2026-01-10T09:00:00Z");

    const turn1 = block.turns[1]!;
    expect(turn1.fields.find((f) => f.name === "participant")?.value).toBe("kora_team");
  });

  it("signal block — core signal fields extracted", async () => {
    const html = ssr(
      <KoraBlock as="div" archetype="signal" subtype="stock_price">
        <KoraField field="label"><span>AAPL Stock Price</span></KoraField>
        <KoraField field="value"><span>214.73</span></KoraField>
        <KoraField field="unit"><span>USD</span></KoraField>
        <KoraField field="recorded_at">
          <time dateTime="2026-01-15T16:00:00Z">Jan 15</time>
        </KoraField>
        <KoraField field="currency" relation="value">
          <span>USD</span>
        </KoraField>
      </KoraBlock>,
    );

    const { result } = await parseHtml(html, { sourceUrl: "https://acme.com/prices" });
    const block = result.blocks[0]!;
    expect(block.archetype).toBe("signal");
    expect(block.fields.find((f) => f.name === "label")?.value).toBe("AAPL Stock Price");
    expect(block.fields.find((f) => f.name === "recorded_at")?.value).toBe("2026-01-15T16:00:00Z");
    expect(block.fields.find((f) => f.name === "currency")?.relation).toBe("value");
  });

  it("nested blocks — inner kora-archetype becomes nestedBlock of outer", async () => {
    const html = ssr(
      <KoraBlock as="article" archetype="narrative">
        <KoraField field="title"><h1>Article with embedded price</h1></KoraField>
        <KoraBlock as="div" archetype="signal" subtype="stock_price">
          <KoraField field="label"><span>AAPL</span></KoraField>
          <KoraField field="value"><span>214.73</span></KoraField>
        </KoraBlock>
      </KoraBlock>,
    );

    const { result } = await parseHtml(html, { sourceUrl: "https://acme.com/article" });
    expect(result.blocks).toHaveLength(1);
    const outer = result.blocks[0]!;
    expect(outer.archetype).toBe("narrative");
    expect(outer.nestedBlocks).toHaveLength(1);
    expect(outer.nestedBlocks[0]!.archetype).toBe("signal");
    expect(outer.nestedBlocks[0]!.fields.find((f) => f.name === "label")?.value).toBe("AAPL");
  });

  it("produces no parse errors for a well-formed component tree", async () => {
    const html = ssr(
      <KoraBlock as="article" archetype="narrative" subtype="blog_post">
        <KoraField field="title"><h1>Title</h1></KoraField>
        <KoraField field="body"><p>Body text with enough content.</p></KoraField>
      </KoraBlock>,
    );

    const { result } = await parseHtml(html, { sourceUrl: "https://acme.com/page" });
    const errors = result.blocks.flatMap((b) =>
      b.diagnostics.filter((d) => d.severity === "error"),
    );
    expect(errors).toHaveLength(0);
  });
});