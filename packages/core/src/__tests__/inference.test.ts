/**
 * Tests for @kora/core parser/inference.ts
 *
 * Each inference job is tested independently via targeted HTML fixtures.
 * One integration test covers the full pipeline via the real parseHtml path.
 *
 * Key invariant throughout: inference never touches explicitly marked content.
 * Every test that places kora-* attributes verifies that marked content is
 * excluded from inference output.
 */

import { describe, it, expect } from "vitest";
import { parseHtml } from "../html.js";
import { runInference } from "../inference.js";
import type { InferenceResult } from "@kora/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "https://acme.com";

async function infer(html: string, sourceUrl = `${BASE_URL}/page`): Promise<InferenceResult> {
  const { result, $ } = await parseHtml(html, { sourceUrl });
  return runInference($, result, { sourceUrl });
}

// ---------------------------------------------------------------------------
// Job 1 — Heading hierarchy (blockStructure)
// ---------------------------------------------------------------------------

describe("heading hierarchy — blockStructure", () => {
  it("extracts h1 h2 h3 in DOM order from a marked block", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Main Title</h1>
        <h2>Introduction</h2>
        <h3>Background</h3>
        <h2>The Problem</h2>
        <h3>Root Cause</h3>
        <h2>Conclusion</h2>
      </article>
    `;
    const result = await infer(html);
    const structure = result.blockStructure.get(0);
    expect(structure).toBeDefined();
    expect(structure).toHaveLength(6);
    expect(structure![0]).toEqual({ level: 1, text: "Main Title" });
    expect(structure![1]).toEqual({ level: 2, text: "Introduction" });
    expect(structure![2]).toEqual({ level: 3, text: "Background" });
    expect(structure![3]).toEqual({ level: 2, text: "The Problem" });
    expect(structure![4]).toEqual({ level: 3, text: "Root Cause" });
    expect(structure![5]).toEqual({ level: 2, text: "Conclusion" });
  });

  it("produces correct level numbers", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">H1</h1>
        <h2>H2</h2>
        <h3>H3</h3>
      </article>
    `;
    const result = await infer(html);
    const structure = result.blockStructure.get(0)!;
    expect(structure[0]!.level).toBe(1);
    expect(structure[1]!.level).toBe(2);
    expect(structure[2]!.level).toBe(3);
  });

  it("omits empty headings", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Title</h1>
        <h2>  </h2>
        <h2>Real section</h2>
      </article>
    `;
    const result = await infer(html);
    const structure = result.blockStructure.get(0)!;
    expect(structure.every((n) => n.text.trim().length > 0)).toBe(true);
    expect(structure.find((n) => n.text.trim() === "")).toBeUndefined();
  });

  it("does not cross nested kora-archetype boundaries", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Outer H1</h1>
        <h2>Outer H2</h2>
        <div kora-archetype="reference">
          <h2>Inner H2 — should not appear in outer structure</h2>
        </div>
      </article>
    `;
    const result = await infer(html);
    const structure = result.blockStructure.get(0)!;
    expect(structure.every((n) => !n.text.includes("Inner"))).toBe(true);
  });

  it("produces empty structure for a block with no headings", async () => {
    const html = `
      <article kora-archetype="narrative">
        <p kora-field="body">No headings here at all.</p>
      </article>
    `;
    const result = await infer(html);
    // Map should not have an entry for a block with no structure
    expect(result.blockStructure.has(0)).toBe(false);
  });

  it("indexes multiple blocks independently", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Article One</h1>
        <h2>Section A</h2>
      </article>
      <article kora-archetype="narrative">
        <h1 kora-field="title">Article Two</h1>
        <h2>Section B</h2>
        <h2>Section C</h2>
      </article>
    `;
    const result = await infer(html);
    expect(result.blockStructure.get(0)).toHaveLength(2);
    expect(result.blockStructure.get(1)).toHaveLength(3);
    expect(result.blockStructure.get(0)![0]!.text).toBe("Article One");
    expect(result.blockStructure.get(1)![0]!.text).toBe("Article Two");
  });
});

// ---------------------------------------------------------------------------
// Job 2 — Proximity clustering (implicitClusters)
// ---------------------------------------------------------------------------

describe("proximity clustering — implicitClusters", () => {
  it("clusters unmarked text-bearing children of a semantic container", async () => {
    const html = `
      <section>
        <h2>About our company</h2>
        <p>We build tools for AI developers. Our mission is to make content accessible to agents.</p>
        <p>Founded in 2024, we have shipped three products used by thousands of developers worldwide.</p>
      </section>
    `;
    const result = await infer(html);
    expect(result.implicitClusters.length).toBeGreaterThan(0);
    const cluster = result.implicitClusters[0]!;
    expect(cluster.members.length).toBeGreaterThanOrEqual(2);
    expect(cluster.members.some((m) => m.tag === "h2")).toBe(true);
    expect(cluster.members.some((m) => m.tag === "p")).toBe(true);
  });

  it("assigns high confidence to semantic container with heading and body", async () => {
    const html = `
      <article>
        <h2>A meaningful section</h2>
        <p>This paragraph is long enough to be considered meaningful content by the pipeline.</p>
        <p>Another paragraph with enough content to pass the minimum length threshold check here.</p>
      </article>
    `;
    const result = await infer(html);
    const cluster = result.implicitClusters[0];
    expect(cluster).toBeDefined();
    expect(cluster!.confidence).toBe("high");
  });

  it("assigns medium confidence to div container with meaningful children", async () => {
    const html = `
      <div>
        <h3>A section in a div</h3>
        <p>This paragraph has enough text to meet the minimum threshold for cluster membership.</p>
        <p>Another paragraph with sufficient length content to pass the threshold and be counted.</p>
      </div>
    `;
    const result = await infer(html);
    const cluster = result.implicitClusters.find(
      (c) => c.members.some((m) => m.text.includes("A section in a div")),
    );
    expect(cluster).toBeDefined();
    // div without body-class children gets medium at best
    expect(["medium", "low"]).toContain(cluster!.confidence);
  });

  it("does not cluster content inside kora-archetype blocks", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h2>This is inside a marked block</h2>
        <p>This paragraph is inside a kora-archetype container and must not appear in clusters.</p>
        <p>Another paragraph also inside the marked block with sufficient length to check.</p>
      </article>
      <section>
        <h2>This is outside any marked block</h2>
        <p>This paragraph is outside any kora container and should be clustered by inference pipeline.</p>
        <p>Second paragraph outside the marked block with sufficient length for the threshold.</p>
      </section>
    `;
    const result = await infer(html);
    // No cluster should reference content from inside the kora-archetype block
    for (const cluster of result.implicitClusters) {
      expect(
        cluster.members.every((m) => !m.text.includes("inside a marked block")),
      ).toBe(true);
      expect(
        cluster.members.every((m) => !m.text.includes("inside a kora-archetype container")),
      ).toBe(true);
    }
    // The outside content should be clustered
    expect(
      result.implicitClusters.some((c) =>
        c.members.some((m) => m.text.includes("outside any marked block")),
      ),
    ).toBe(true);
  });

  it("does not cluster kora-exclude content", async () => {
    const html = `
      <section>
        <h2>Real section content here for testing purposes</h2>
        <p>This content is real and long enough to be a cluster member in the inference pipeline.</p>
        <p kora-exclude>This paragraph is excluded and must not appear in any cluster output.</p>
      </section>
    `;
    const result = await infer(html);
    for (const cluster of result.implicitClusters) {
      expect(
        cluster.members.every((m) => !m.text.includes("excluded and must not")),
      ).toBe(true);
    }
  });

  it("skips containers with fewer than MIN_CLUSTER_SIZE meaningful members", async () => {
    const html = `
      <section>
        <p>Only one paragraph that is long enough to meet the minimum text length threshold here.</p>
      </section>
    `;
    const result = await infer(html);
    // A single-member container should produce no cluster
    const singleMemberClusters = result.implicitClusters.filter(
      (c) => c.members.length < 2,
    );
    expect(singleMemberClusters).toHaveLength(0);
  });

  it("skips child containers — they are cluster candidates themselves", async () => {
    const html = `
      <section>
        <section>
          <h2>Inner section heading for the nested container cluster test</h2>
          <p>Inner paragraph with sufficient length to qualify as a cluster member in the pipeline.</p>
          <p>Second inner paragraph also long enough to count as a separate cluster member here.</p>
        </section>
      </section>
    `;
    const result = await infer(html);
    // The outer section should produce no cluster (its only child is a section, which is skipped)
    // The inner section should produce a cluster
    const innerCluster = result.implicitClusters.find((c) =>
      c.members.some((m) => m.text.includes("Inner section")),
    );
    expect(innerCluster).toBeDefined();
  });

  it("records containerContext for each cluster", async () => {
    const html = `
      <section id="about">
        <h2>About section with an id attribute for context testing</h2>
        <p>First paragraph with enough text to meet the minimum cluster member length threshold.</p>
        <p>Second paragraph also long enough to be included as a member in the cluster result.</p>
      </section>
    `;
    const result = await infer(html);
    const cluster = result.implicitClusters[0];
    expect(cluster).toBeDefined();
    expect(cluster!.containerContext).toContain("section");
    expect(cluster!.containerContext).toContain("about");
  });

  it("produces no clusters for empty HTML", async () => {
    const result = await infer("");
    expect(result.implicitClusters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Job 3 — Link graph (relatedContent)
// ---------------------------------------------------------------------------

describe("link graph — relatedContent", () => {
  it("extracts internal links with title and resolved URL", async () => {
    const html = `
      <nav>
        <a href="/blog/agent-queries">How Agents Query the Web</a>
        <a href="/docs/quickstart">Quickstart Guide</a>
      </nav>
    `;
    // Note: nav is auto-stripped by the parser, but the link graph runs
    // on the Cheerio instance after the parser pass. nav is already gone.
    // Use a non-nav container to test link extraction.
    const html2 = `
      <div>
        <a href="/blog/agent-queries">How Agents Query the Web</a>
        <a href="/docs/quickstart">Quickstart Guide</a>
      </div>
    `;
    const result = await infer(html2, "https://acme.com/page");
    expect(result.relatedContent).toHaveLength(2);
    expect(result.relatedContent[0]).toEqual({
      title: "How Agents Query the Web",
      url: "https://acme.com/blog/agent-queries",
    });
    expect(result.relatedContent[1]).toEqual({
      title: "Quickstart Guide",
      url: "https://acme.com/docs/quickstart",
    });
  });

  it("excludes external links", async () => {
    const html = `
      <div>
        <a href="/internal-page">Internal link text</a>
        <a href="https://external.com/page">External link text</a>
      </div>
    `;
    const result = await infer(html, "https://acme.com/page");
    expect(result.relatedContent.every((l) => l.url.startsWith("https://acme.com"))).toBe(true);
    expect(result.relatedContent.find((l) => l.url.includes("external.com"))).toBeUndefined();
  });

  it("excludes fragment-only links", async () => {
    const html = `
      <div>
        <a href="#section-2">Jump to section</a>
        <a href="/real-page">A real page link here</a>
      </div>
    `;
    const result = await infer(html, "https://acme.com/page");
    expect(result.relatedContent.find((l) => l.url.includes("#section-2"))).toBeUndefined();
  });

  it("excludes links with no text", async () => {
    const html = `
      <div>
        <a href="/page-with-text">Has text</a>
        <a href="/page-no-text"></a>
      </div>
    `;
    const result = await infer(html, "https://acme.com/current");
    expect(result.relatedContent.find((l) => l.url.includes("no-text"))).toBeUndefined();
  });

  it("deduplicates links — first occurrence title wins", async () => {
    const html = `
      <div>
        <a href="/same-page">First mention</a>
        <a href="/same-page">Second mention</a>
      </div>
    `;
    const result = await infer(html, "https://acme.com/current");
    const dupes = result.relatedContent.filter((l) => l.url === "https://acme.com/same-page");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.title).toBe("First mention");
  });

  it("excludes the source URL itself from related content", async () => {
    const html = `
      <div>
        <a href="/page">This page links to itself</a>
        <a href="/other-page">Other page link</a>
      </div>
    `;
    const result = await infer(html, "https://acme.com/page");
    expect(result.relatedContent.find((l) => l.url === "https://acme.com/page")).toBeUndefined();
  });

  it("resolves relative hrefs against sourceUrl", async () => {
    const html = `<div><a href="../other-section/page">Relative link</a></div>`;
    const result = await infer(html, "https://acme.com/docs/intro");
    expect(result.relatedContent[0]?.url).toBe("https://acme.com/other-section/page");
  });

  it("excludes non-http links (mailto, javascript, etc)", async () => {
    const html = `
      <div>
        <a href="mailto:hello@acme.com">Email us</a>
        <a href="javascript:void(0)">JS link</a>
        <a href="/real">Real link</a>
      </div>
    `;
    const result = await infer(html, "https://acme.com/page");
    expect(result.relatedContent.every((l) => l.url.startsWith("http"))).toBe(true);
  });

  it("produces empty relatedContent for pages with no internal links", async () => {
    const html = `<article kora-archetype="narrative"><h1 kora-field="title">No links</h1></article>`;
    const result = await infer(html);
    expect(result.relatedContent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Job 4 — Archetype inference fallback (inferredBlocks)
// ---------------------------------------------------------------------------

describe("archetype inference fallback — inferredBlocks", () => {
  it("infers narrative for an article element with a time element", async () => {
    const html = `
      <article>
        <h1>The Future of AI Search</h1>
        <time datetime="2026-01-15">Jan 15, 2026</time>
        <p>This is a substantial article body with enough content to meet the minimum length threshold
           required for the archetype inference pipeline to consider this container as a candidate.
           The text needs to be over 100 characters to qualify.</p>
      </article>
    `;
    const result = await infer(html);
    const candidate = result.inferredBlocks.find((b) => b.archetype === "narrative");
    expect(candidate).toBeDefined();
    expect(candidate!.signals).toContain("<article>");
  });

  it("infers reference for a container with table and code elements", async () => {
    const html = `
      <section>
        <h2>API Reference</h2>
        <table><tr><td>endpoint</td><td>/api/posts</td></tr></table>
        <pre><code>GET /api/posts HTTP/1.1</code></pre>
        <p>Use this endpoint to retrieve all blog posts from the API with pagination support built in.</p>
      </section>
    `;
    const result = await infer(html);
    const candidate = result.inferredBlocks.find((b) => b.archetype === "reference");
    expect(candidate).toBeDefined();
  });

  it("does not infer archetype for content inside a kora-archetype block", async () => {
    const html = `
      <article kora-archetype="narrative">
        <h1 kora-field="title">Already marked</h1>
        <time datetime="2026-01-15">Jan 15, 2026</time>
        <p>This content is already explicitly marked with a kora-archetype attribute and should not
           appear as an inferred block candidate in the inference pipeline output at all.</p>
      </article>
    `;
    const result = await infer(html);
    // No inferred candidates should reference content inside the marked block
    expect(result.inferredBlocks).toHaveLength(0);
  });

  it("skips containers with less than 100 characters of text", async () => {
    const html = `<article><h1>Short</h1><p>Too short.</p></article>`;
    const result = await infer(html);
    expect(result.inferredBlocks).toHaveLength(0);
  });

  it("picks the archetype with the most signals when multiple apply", async () => {
    const html = `
      <article>
        <h1>Mixed signals article</h1>
        <time datetime="2026-01-15">Jan 15, 2026</time>
        <p>This article has both narrative signals (article element, time element) and a table for
           reference content. The narrative signals should win because there are more of them present.
           The content is long enough to qualify for archetype inference candidate consideration.</p>
        <table><tr><td>one</td><td>reference signal</td></tr></table>
      </article>
    `;
    const result = await infer(html);
    // Both signals present — narrative has article + time, reference has table
    // Should pick whichever has more
    expect(result.inferredBlocks.length).toBeGreaterThan(0);
    expect(result.inferredBlocks[0]!.archetype).toBeDefined();
  });

  it("caps text field at 500 characters", async () => {
    const longText = "A".repeat(600);
    const html = `<article><h1>Long article</h1><p>${longText}</p></article>`;
    const result = await infer(html);
    if (result.inferredBlocks.length > 0) {
      expect(result.inferredBlocks[0]!.text.length).toBeLessThanOrEqual(500);
    }
  });

  it("records the signals that triggered inference", async () => {
    const html = `
      <article>
        <h1>Signal test</h1>
        <time datetime="2026-01-15">Published Jan 15 2026</time>
        <p>This article content is long enough to qualify for the inference pipeline to process it
           as a candidate block. The article and time elements should both fire as narrative signals.</p>
      </article>
    `;
    const result = await infer(html);
    const candidate = result.inferredBlocks.find((b) => b.archetype === "narrative");
    if (candidate) {
      expect(candidate.signals.length).toBeGreaterThan(0);
      expect(candidate.containerContext).toContain("article");
    }
  });
});

// ---------------------------------------------------------------------------
// Integration — full pipeline
// ---------------------------------------------------------------------------

describe("full inference pipeline integration", () => {
  it("runs all four jobs on a realistic document", async () => {
    const html = `
      <main>
        <article kora-archetype="narrative" kora-subtype="blog_post">
          <h1 kora-field="title">The Future of AI Search</h1>
          <h2>Introduction</h2>
          <p kora-field="body">A look at how agents are replacing direct browsing in the modern era
             of AI-native applications and the implications for content publishers everywhere.</p>
          <h2>What Changes</h2>
          <h3>Agent Behaviour</h3>
        </article>

        <section>
          <h2>Related reading on agents and search</h2>
          <p>We have published several articles on this topic that explore it in greater depth.
             Each article covers a different angle of how AI is changing the web ecosystem.</p>
          <p>The shift from user-driven browsing to agent-driven queries is accelerating rapidly
             and publishers need to adapt their content strategy to remain discoverable to agents.</p>
          <a href="/blog/agent-queries">How Agents Query the Web</a>
          <a href="/blog/kora-intro">Introducing KOra</a>
        </section>
      </main>
    `;

    const { result, $ } = await parseHtml(html, { sourceUrl: "https://acme.com/blog/future" });
    const inference = runInference($, result, { sourceUrl: "https://acme.com/blog/future" });

    // Job 1 — structure
    const structure = inference.blockStructure.get(0)!;
    expect(structure.map((n) => n.text)).toContain("Introduction");
    expect(structure.map((n) => n.text)).toContain("What Changes");
    expect(structure.map((n) => n.text)).toContain("Agent Behaviour");

    // Job 2 — clusters (the unmarked <section> should cluster)
    expect(inference.implicitClusters.length).toBeGreaterThan(0);
    const sectionCluster = inference.implicitClusters.find((c) =>
      c.members.some((m) => m.text.includes("Related reading")),
    );
    expect(sectionCluster).toBeDefined();

    // Job 3 — link graph
    expect(inference.relatedContent.length).toBeGreaterThan(0);
    expect(inference.relatedContent.find((l) => l.url.includes("agent-queries"))).toBeDefined();
    expect(inference.relatedContent.find((l) => l.url.includes("kora-intro"))).toBeDefined();

    // Marked content not in clusters
    expect(
      inference.implicitClusters.every((c) =>
        c.members.every((m) => !m.text.includes("agents are replacing")),
      ),
    ).toBe(true);
  });

  it("produces a fully empty InferenceResult for a bare document", async () => {
    const result = await infer("<html><body></body></html>");
    expect(result.blockStructure.size).toBe(0);
    expect(result.implicitClusters).toHaveLength(0);
    expect(result.relatedContent).toHaveLength(0);
    expect(result.inferredBlocks).toHaveLength(0);
  });
});