/**
 * @kora/core — parser/inference.ts
 *
 * The structural inference pipeline. Runs after parseHtml on the same
 * Cheerio instance — no re-parsing.
 *
 * Three jobs defined by spec §5.3:
 *
 *   1. Heading hierarchy     → blockStructure (per-block StructureNode[])
 *   2. Proximity clustering  → implicitClusters (unmarked content groups)
 *   3. Link graph extraction → relatedContent (internal page links)
 *
 * Plus the archetype inference fallback:
 *   4. Structural signals    → inferredBlocks (candidate blocks, always
 *                              marked inferred: true, never auto-promoted)
 *
 * Rules that govern everything here:
 *   - Explicitly marked content always takes priority. Inference never
 *     overrides developer declarations.
 *   - Inference is best-effort. Confidence scores tell agents how much
 *     to trust each result.
 *   - This module never mutates RawBlocks. It produces supplementary
 *     InferenceResult data the builder merges into output payloads.
 *   - Never throws. Silent failures produce empty results, not errors.
 */

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type {
  Archetype,
  Confidence,
  ClusterMember,
  ExtractionResult,
  ImplicitCluster,
  InferenceResult,
  InferredBlockCandidate,
  RelatedContentLink,
  StructureNode,
} from "@kora/types";

// Constants

/** Heading levels the spec mentions for structure extraction */
const HEADING_SELECTORS = ["h1", "h2", "h3"] as const;
type HeadingTag = (typeof HEADING_SELECTORS)[number];
const HEADING_LEVEL: Record<HeadingTag, 1 | 2 | 3> = {
  h1: 1,
  h2: 2,
  h3: 3,
};

/**
 * Semantic HTML5 container elements. Used to identify meaningful layout
 * regions for proximity clustering and archetype inference.
 */
const SEMANTIC_CONTAINERS = new Set([
  "article",
  "section",
  "aside",
  "main",
  "div",
]);

/**
 * Structural signals used by the archetype inference fallback.
 * Maps signal element/attribute to the archetype it suggests.
 */
const ARCHETYPE_SIGNALS: Array<{
  selector: string;
  archetype: Archetype;
  signal: string;
}> = [
  // Narrative signals
  { selector: "article", archetype: "narrative", signal: "<article>" },
  { selector: "time[datetime]", archetype: "narrative", signal: "<time datetime>" },
  // Reference signals
  { selector: "table", archetype: "reference", signal: "<table>" },
  { selector: "dl", archetype: "reference", signal: "<dl>" },
  { selector: "code, pre", archetype: "reference", signal: "<code>/<pre>" },
  // Catalogue signals
  { selector: "ul > li > a, ol > li > a", archetype: "catalogue", signal: "list of links" },
  { selector: "figure", archetype: "catalogue", signal: "<figure>" },
  // Dialogue signals
  { selector: "blockquote", archetype: "dialogue", signal: "<blockquote>" },
  // Signal signals
  { selector: "[data-value], [data-metric]", archetype: "signal", signal: "data-value/data-metric" },
];

/**
 * Elements whose text content is meaningful for clustering.
 * Excludes pure structural/presentational tags.
 */
const CONTENT_BEARING_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "dt", "dd", "blockquote", "figcaption",
  "td", "th", "caption", "span", "a",
]);

/** Minimum text length for a cluster member to be considered meaningful */
const MIN_CLUSTER_TEXT_LENGTH = 20;

/** Minimum number of members for a cluster to be worth reporting */
const MIN_CLUSTER_SIZE = 2;

// Helpers

/**
 * Build a human-readable context string for an element.
 * Used in containerContext fields for debugging.
 * Format: tagName[.class][#id]
 */
function elementContext(el: Element): string {
  const tag = el.name ?? "unknown";
  const id = el.attribs["id"] ? `#${el.attribs["id"]}` : "";
  const cls = el.attribs["class"]
    ? `.${el.attribs["class"].trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${tag}${id}${cls}`;
}

/**
 * Extract the origin (scheme + host) from a URL string.
 * Returns null if the URL is unparseable.
 */
function extractOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve a potentially relative href against a base URL.
 * Returns null if resolution fails or the result is not HTTP/HTTPS.
 */
function resolveHref(href: string, base: string): string | null {
  try {
    const resolved = new URL(href, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * True if el or any of its ancestors has a kora-archetype attribute.
 * Used to exclude already-claimed content from inference.
 */
function isInsideKoraBlock(
  $: cheerio.CheerioAPI,
  el: Element,
): boolean {
  return $(el).closest("[kora-archetype]").length > 0;
}

/**
 * True if el is a kora-archetype container itself.
 */
function isKoraContainer(el: Element): boolean {
  return el.attribs["kora-archetype"] !== undefined;
}

// Job 1 — Heading hierarchy

/**
 * Extract the heading hierarchy from within a kora-archetype container.
 *
 * Reads h1, h2, h3 elements in DOM order. Stops at nested kora-archetype
 * boundaries — inner blocks have their own structure.
 *
 * Returns an ordered array of StructureNode, one per heading found.
 */
function extractBlockStructure(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<Element>,
): StructureNode[] {
  const nodes: StructureNode[] = [];
  const selector = HEADING_SELECTORS.join(", ");

  $container.find(selector).each((_, el) => {
    // Don't cross into nested kora-archetype boundaries
    const $el = $(el);
    if (
      $el.parents("[kora-archetype]").not($container).length > 0
    ) {
      return;
    }

    const tag = el.name.toLowerCase() as HeadingTag;
    const level = HEADING_LEVEL[tag];
    if (level === undefined) return;

    const text = $el.text().trim();
    if (text.length > 0) {
      nodes.push({ level, text });
    }
  });

  return nodes;
}

/**
 * Run heading hierarchy extraction across all top-level blocks.
 * Returns a Map from block index → StructureNode[].
 */
function inferBlockStructure(
  $: cheerio.CheerioAPI,
  result: ExtractionResult,
): Map<number, StructureNode[]> {
  const blockStructure = new Map<number, StructureNode[]>();

  result.blocks.forEach((block, index) => {
    // Re-select the container element by archetype + sourceUrl context.
    // We match by position: the nth top-level kora-archetype in the doc.
    const containers = $("[kora-archetype]").filter((_, el) => {
      return $(el).parents("[kora-archetype]").length === 0;
    });

    const containerEl = containers.get(index);
    if (!containerEl) return;

    const structure = extractBlockStructure($, $(containerEl as Element));
    if (structure.length > 0) {
      blockStructure.set(index, structure);
    }
  });

  return blockStructure;
}

// ---------------------------------------------------------------------------
// Job 2 — Proximity clustering
// ---------------------------------------------------------------------------

/**
 * Determine the confidence level for an implicit cluster based on
 * the container element and its children.
 *
 * high   — semantic HTML5 container with heading + body-like children
 * medium — generic div with multiple meaningful text-bearing children
 * low    — weak signals
 */
function clusterConfidence(
  containerTag: string,
  members: ClusterMember[],
): Confidence {
  const isSemanticContainer = ["article", "section", "aside", "main"].includes(
    containerTag,
  );
  const hasHeading = members.some((m) =>
    ["h1", "h2", "h3", "h4", "h5", "h6"].includes(m.tag),
  );
  const hasBody = members.some((m) => ["p", "blockquote", "figcaption"].includes(m.tag));
  const hasEnoughMembers = members.length >= 3;

  if (isSemanticContainer && hasHeading && hasBody) return "high";
  if ((isSemanticContainer || hasEnoughMembers) && (hasHeading || hasBody)) return "medium";
  return "low";
}

/**
 * Extract proximity clusters from the document.
 *
 * A cluster is a meaningful layout container whose direct children
 * bear text content but carry no kora-* marks. We operate at the
 * container level — not the whole document — to avoid producing
 * one enormous useless cluster.
 *
 * Excludes:
 *   - Any container inside a kora-archetype block (already claimed)
 *   - Any container that is itself a kora-archetype block
 *   - Containers whose children are all too short to be meaningful
 *   - Clusters with fewer than MIN_CLUSTER_SIZE members
 */
function inferProximityClusters(
  $: cheerio.CheerioAPI,
): ImplicitCluster[] {
  const clusters: ImplicitCluster[] = [];

  // Walk all semantic container elements in the document
  $(Array.from(SEMANTIC_CONTAINERS).join(", ")).each((_, el) => {
    if (el.type !== "tag") return;

    // Skip anything inside or equal to a kora-archetype container
    if (isInsideKoraBlock($, el) || isKoraContainer(el)) return;

    const members: ClusterMember[] = [];

    // Examine direct children only — we don't recurse here.
    // Recursion would happen naturally as we visit child containers
    // in subsequent iterations of the outer each().
    for (const child of el.children) {
      if (child.type !== "tag") continue;

      const tag = child.name.toLowerCase();

      // Skip child containers — they're their own cluster candidates
      if (SEMANTIC_CONTAINERS.has(tag)) continue;

      // Skip kora-marked content
      if (
        child.attribs["kora-field"] !== undefined ||
        child.attribs["kora-archetype"] !== undefined ||
        child.attribs["kora-exclude"] !== undefined
      ) continue;

      // Only collect content-bearing tags
      if (!CONTENT_BEARING_TAGS.has(tag)) continue;

      const text = $(child).text().trim();
      if (text.length === 0) continue;

      // Headings are structurally meaningful regardless of length.
      // Apply the minimum text length only to body-like elements.
      const isHeading = ["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag);
      if (!isHeading && text.length < MIN_CLUSTER_TEXT_LENGTH) continue;

      members.push({ tag, text });
    }

    if (members.length < MIN_CLUSTER_SIZE) return;

    const containerTag = el.name.toLowerCase();
    const confidence = clusterConfidence(containerTag, members);
    const containerContext = elementContext(el);

    clusters.push({ containerContext, members, confidence });
  });

  return clusters;
}

// Job 3 — Link graph

/**
 * Extract internal links from the document as a related content map.
 *
 * "Internal" means: same origin as sourceUrl.
 * Excludes:
 *   - External links (different origin)
 *   - Anchor-only links (#fragment)
 *   - Links with no meaningful text
 *   - Duplicate URLs (first occurrence wins)
 *
 * Link text is used as the title. We do not attempt to resolve page
 * titles — that would require additional HTTP requests.
 */
function inferLinkGraph(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): RelatedContentLink[] {
  const sourceOrigin = extractOrigin(sourceUrl);
  if (sourceOrigin === null) return [];

  const seen = new Set<string>();
  const links: RelatedContentLink[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";

    // Skip fragment-only links
    if (href.startsWith("#")) return;

    const resolved = resolveHref(href, sourceUrl);
    if (resolved === null) return;

    // Internal only
    const origin = extractOrigin(resolved);
    if (origin !== sourceOrigin) return;

    // Skip the page linking to itself
    if (resolved === sourceUrl) return;

    // Deduplicate by URL
    if (seen.has(resolved)) return;
    seen.add(resolved);

    const title = $(el).text().trim();
    if (title.length === 0) return;

    links.push({ title, url: resolved });
  });

  return links;
}

// ---------------------------------------------------------------------------
// Job 4 — Archetype inference fallback
// ---------------------------------------------------------------------------

/**
 * Infer archetype candidates for unmarked regions of the document.
 *
 * Only runs on containers that:
 *   - Are not inside a kora-archetype block
 *   - Are not themselves kora-archetype containers
 *   - Contain enough text to be meaningful
 *
 * Confidence scoring:
 *   high   — multiple strong signals pointing to the same archetype
 *   medium — one strong signal
 *   low    — weak or ambiguous signals
 *
 * These candidates are never auto-promoted to RawBlocks. The builder
 * decides whether to include them. Always marked inferred: true.
 */
function inferArchetypeCandidates(
  $: cheerio.CheerioAPI,
): InferredBlockCandidate[] {
  const candidates: InferredBlockCandidate[] = [];

  // Look at semantic containers only — same logic as clustering
  $(["article", "section", "main"].join(", ")).each((_, el) => {
    if (el.type !== "tag") return;
    if (isInsideKoraBlock($, el) || isKoraContainer(el)) return;

    const $el = $(el);
    const text = $el.text().trim();

    // Skip trivially short containers
    if (text.length < 100) return;

    // Collect signals within this container
    const signalCounts = new Map<Archetype, string[]>();

    for (const { selector, archetype, signal } of ARCHETYPE_SIGNALS) {
      // Check the container element itself — $el.find() is descendants-only.
      // An <article> container is its own "article" signal.
      let count = $el.is(selector) ? 1 : 0;

      // Then count matching descendants, excluding those inside kora blocks
      $el.find(selector).each((_, signalEl) => {
        if (!isInsideKoraBlock($, signalEl as Element)) count++;
      });

      if (count > 0) {
        const existing = signalCounts.get(archetype) ?? [];
        existing.push(signal);
        signalCounts.set(archetype, existing);
      }
    }

    if (signalCounts.size === 0) return;

    // Pick the archetype with the most signals
    let bestArchetype: Archetype = "narrative";
    let bestSignals: string[] = [];
    for (const [archetype, signals] of signalCounts) {
      if (signals.length > bestSignals.length) {
        bestArchetype = archetype;
        bestSignals = signals;
      }
    }

    // Score confidence
    let confidence: Confidence;
    if (bestSignals.length >= 3) {
      confidence = "high";
    } else if (bestSignals.length >= 1 && signalCounts.size === 1) {
      // Single archetype pointed to by at least one signal
      confidence = "medium";
    } else {
      confidence = "low";
    }

    candidates.push({
      archetype: bestArchetype,
      confidence,
      signals: bestSignals,
      text: text.slice(0, 500), // cap for storage
      containerContext: elementContext(el),
    });
  });

  return candidates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InferenceOptions {
  sourceUrl: string;
}

/**
 * Run the full structural inference pipeline over a parsed document.
 *
 * Takes the Cheerio instance and ExtractionResult produced by parseHtml —
 * no re-parsing. Returns InferenceResult with all four inference outputs.
 *
 * Call order in the build pipeline:
 *   const { result, $ } = await parseHtml(html, { sourceUrl });
 *   const inference = runInference($, result, { sourceUrl });
 */
export function runInference(
  $: cheerio.CheerioAPI,
  result: ExtractionResult,
  options: InferenceOptions,
): InferenceResult {
  const { sourceUrl } = options;

  const blockStructure = inferBlockStructure($, result);
  const implicitClusters = inferProximityClusters($);
  const relatedContent = inferLinkGraph($, sourceUrl);
  const inferredBlocks = inferArchetypeCandidates($);

  return {
    blockStructure,
    implicitClusters,
    relatedContent,
    inferredBlocks,
  };
}