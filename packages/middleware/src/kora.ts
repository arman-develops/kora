/**
 * @kora/core — middleware/kora.ts
 *
 * SDK live fallback middleware. Exposes the /.kora/ endpoints that let
 * agents query a live site directly when no published package exists or
 * the TTL has expired.
 *
 * Design constraints:
 *   - Never throws. All errors are JSON responses.
 *   - In-memory TTL cache — no external dependencies.
 *   - content_id is deterministic: sha256(sourceUrl + archetype)[0..7]
 *   - body is excluded from summary/index payloads.
 *   - /.kora/field ignores max_field_tokens — always returns the full value.
 *
 * Supports two integration styles:
 *   - koraMiddleware()  — raw node:http IncomingMessage / ServerResponse
 *   - koraExpressMiddleware() — Express-compatible req/res/next
 */

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { parseHtml, runInference } from "@kora/core";

import type {
  KoraMiddlewareOptions,
  KoraCacheEntry,
  KoraManifestResponse,
  KoraIndexResponse,
  KoraIndexBlock,
  KoraFullResponse,
  KoraFieldResponse,
  KoraLiveFieldResponse,
  KoraErrorResponse,
  KoraManifest,
} from "@kora/types";

import type { RawBlock, RawField } from "@kora/types";
import type { Archetype, Confidence } from "@kora/types";
import { isArchetype } from "@kora/types";

// Constants─

const KORA_VERSION = "1.0" as const;
const KORA_PACKAGE_VERSION = "1.0.0+live";

/** Default TTL in seconds when no tier-specific value is available */
const DEFAULT_TTL = 300;

/** Index/manifest cache key */
const CACHE_KEY_MANIFEST = "__manifest__";
const CACHE_KEY_INDEX = "__index__";

// content_id
/**
 * Deterministic content identifier.
 * sha256(sourceUrl + archetype), first 8 hex characters.
 * Consistent across requests for the same content per spec.
 */
export function makeContentId(sourceUrl: string, archetype: Archetype): string {
  return createHash("sha256")
    .update(sourceUrl + archetype)
    .digest("hex")
    .slice(0, 8);
}

// TTL helpers
/**
 * Parse a manifest refresh string ("30m", "6h", "1d") to seconds.
 * Returns DEFAULT_TTL if the value is missing or malformed.
 */
function parseRefreshToSeconds(refresh: string | undefined): number {
  if (!refresh) return DEFAULT_TTL;
  const match = /^(\d+)(m|h|d)$/.exec(refresh);
  if (!match) return DEFAULT_TTL;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "m": return n * 60;
    case "h": return n * 3600;
    case "d": return n * 86400;
    default:  return DEFAULT_TTL;
  }
}

/**
 * Derive cache TTL for a content block based on its tier.
 * Static content uses DEFAULT_TTL; live is never cached (returns 0).
 */
function blockTtl(manifest: KoraManifest): number {
  // For static content there is no per-block tier in RawBlock.
  // The spec says index TTL = shortest TTL across all static blocks.
  // We approximate: use the lowest refresh across slow/fast dynamic sources,
  // falling back to DEFAULT_TTL for purely static content.
  if (!manifest.dynamic_sources?.length) return DEFAULT_TTL;

  const staticMin = manifest.dynamic_sources
    .filter((s) => s.tier !== "live")
    .map((s) => parseRefreshToSeconds(s.refresh))
    .reduce((a, b) => Math.min(a, b), DEFAULT_TTL);

  return staticMin;
}

// In-memory cache─

class KoraCache {
  private readonly store = new Map<string, KoraCacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    // Never cache entries with TTL ≤ 0 (live tier)
    if (ttlSeconds <= 0) return;
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  clear(): void {
    this.store.clear();
  }
}

// Field helpers

/**
 * Convert RawField[] to a plain Record, applying the spec's extraction rules:
 *   <a> → value is text content, {field}_url is the href
 * Skips empty string values (treated as missing per spec).
 */
function fieldsToRecord(fields: RawField[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const f of fields) {
    const v = f.value;
    const isEmpty = Array.isArray(v) ? v.length === 0 : v === "";
    if (isEmpty) continue;
    record[f.name] = v;
    if (f.anchorHref !== undefined && f.anchorHref !== "") {
      record[`${f.name}_url`] = f.anchorHref;
    }
  }
  return record;
}

/**
 * Build the relations map from a fields array.
 * Key = dependent field, value = the field it relates to.
 */
function buildRelations(fields: RawField[]): Record<string, string> {
  const relations: Record<string, string> = {};
  for (const f of fields) {
    if (f.relation !== null) {
      relations[f.name] = f.relation;
    }
  }
  return relations;
}

/**
 * Summarise fields for index payloads: omit `body`.
 * All other fields are included.
 */
function summaryFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === "body") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Infer block confidence from diagnostics and inferred flag.
 * Developer-marked blocks are always "high". Inferred blocks
 * may be "medium" or "low" depending on diagnostic severity.
 */
function inferConfidence(block: RawBlock): Confidence {
  if (!block.inferred) return "high";
  const hasErrors = block.diagnostics.some((d) => d.severity === "error");
  return hasErrors ? "low" : "medium";
}

// Page extraction─

/**
 * Fetch and parse one page, returning all top-level RawBlocks together
 * with inference results for structure extraction.
 */
async function extractPage(
  path: string,
  options: KoraMiddlewareOptions,
): Promise<Array<{ block: RawBlock; structure: string[]; relatedContent: Array<{ title: string; url: string }> }>> {
  const pageUrl = options.sourceUrl.replace(/\/$/, "") + path;

  let html: string;
  try {
    html = await options.fetchPage(path);
  } catch {
    // fetchPage failed — return empty, never throw
    return [];
  }

  const { result, $ } = await parseHtml(html, { sourceUrl: pageUrl });
  const inference = runInference($, result, { sourceUrl: pageUrl });

  return result.blocks
    .filter((block) => !block.diagnostics.some((d) => d.severity === "error"))
    .map((block, i) => ({
      block,
      structure: (inference.blockStructure.get(i) ?? []).map((n) => n.text),
      relatedContent: inference.relatedContent,
    }));
}

/**
 * Extract all blocks from all static_roots in the manifest.
 * Returns a flat list ordered by extraction time (most recent first is
 * approximated here as manifest order since we can't know actual timestamps).
 */
async function extractAllBlocks(
  options: KoraMiddlewareOptions,
): Promise<Array<{ block: RawBlock; structure: string[]; relatedContent: Array<{ title: string; url: string }> }>> {
  const results: Array<{ block: RawBlock; structure: string[]; relatedContent: Array<{ title: string; url: string }> }> = [];

  for (const root of options.manifest.static_roots) {
    const pagePath = root.endsWith("/**") ? root.slice(0, -3) : root;
    const extracted = await extractPage(pagePath, options);
    results.push(...extracted);
  }

  return results;
}

// Response helpers

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "X-KOra-Version": KORA_VERSION,
  "X-KOra-Source": "live",
  "X-KOra-Package-Version": KORA_PACKAGE_VERSION,
};

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  ttl: number = DEFAULT_TTL,
): void {
  const headers: Record<string, string> = {
    ...COMMON_HEADERS,
    "Cache-Control": `max-age=${ttl}`,
  };

  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }

  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  error: KoraErrorResponse["error"],
  message: string,
): void {
  const body: KoraErrorResponse = {
    kora_version: KORA_VERSION,
    source: "live",
    error,
    message,
  };
  sendJson(res, status, body, 0);
}

function parseUrl(req: IncomingMessage): { pathname: string; query: URLSearchParams } {
  const raw = req.url ?? "/";
  // Use a dummy base so URL can parse relative paths
  const parsed = new URL(raw, "http://localhost");
  return { pathname: parsed.pathname, query: parsed.searchParams };
}

// Route handlers──

async function handleManifest(
  res: ServerResponse,
  options: KoraMiddlewareOptions,
  cache: KoraCache,
): Promise<void> {
  const cached = cache.get<KoraManifestResponse>(CACHE_KEY_MANIFEST);
  if (cached) {
    sendJson(res, 200, cached, DEFAULT_TTL);
    return;
  }

  const ttl = DEFAULT_TTL;
  const allBlocks = await extractAllBlocks(options);
  const archetypeCounts: Partial<Record<Archetype, number>> = {};

  for (const { block } of allBlocks) {
    archetypeCounts[block.archetype] = (archetypeCounts[block.archetype] ?? 0) + 1;
  }

  const liveSources = (options.manifest.dynamic_sources ?? []).filter(
    (s) => s.tier === "live",
  ).length;
  const dynamicSources = (options.manifest.dynamic_sources ?? []).filter(
    (s) => s.tier !== "live",
  ).length;

  const body: KoraManifestResponse = {
    kora_version: KORA_VERSION,
    source: "live",
    package_version: KORA_PACKAGE_VERSION,
    published_at: new Date().toISOString(),
    identity: {
      name: options.manifest.identity.name,
      description: options.manifest.identity.description,
      public_url: options.manifest.identity.public_url,
      author: options.manifest.identity.author,
      language: options.manifest.identity.language,
      license: options.manifest.identity.license,
    },
    content_summary: {
      total_blocks: allBlocks.length,
      archetypes: archetypeCounts,
      dynamic_sources: dynamicSources,
      live_sources: liveSources,
    },
    signed: false,
    ttl,
  };

  cache.set(CACHE_KEY_MANIFEST, body, ttl);
  sendJson(res, 200, body, ttl);
}

async function handleIndex(
  res: ServerResponse,
  query: URLSearchParams,
  options: KoraMiddlewareOptions,
  cache: KoraCache,
): Promise<void> {
  // Parse query params
  const rawArchetype = query.get("archetype") ?? undefined;
  const subtype = query.get("subtype") ?? undefined;
  const limit = Math.min(parseInt(query.get("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(query.get("offset") ?? "0", 10) || 0;

  // Validate archetype filter if provided
  if (rawArchetype !== undefined && !isArchetype(rawArchetype)) {
    sendError(res, 400, "not_found", `Unknown archetype "${rawArchetype}".`);
    return;
  }
  const archetypeFilter = rawArchetype as Archetype | undefined;

  const cacheKey = `${CACHE_KEY_INDEX}:${archetypeFilter ?? ""}:${subtype ?? ""}`;
  const ttl = blockTtl(options.manifest);

  const allBlocks = await extractAllBlocks(options);
  const now = new Date().toISOString();

  // Build full index (before pagination) — filtered
  let filtered = allBlocks;
  if (archetypeFilter !== undefined) {
    filtered = filtered.filter(({ block }) => block.archetype === archetypeFilter);
  }
  if (subtype !== undefined) {
    filtered = filtered.filter(({ block }) => block.subtype === subtype);
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  const blocks: KoraIndexBlock[] = page.map(({ block, structure }) => {
    const contentId = makeContentId(block.sourceUrl, block.archetype);
    const allFields = fieldsToRecord(block.fields);
    return {
      content_id: contentId,
      archetype: block.archetype,
      subtype: block.subtype,
      inferred: block.inferred,
      confidence: inferConfidence(block),
      source_url: block.sourceUrl,
      fields: summaryFields(allFields),
      structure,
      meta: {
        token_count: 0, // token counting requires tiktoken — not wired here
        language: options.manifest.identity.language,
        ttl,
        extracted_at: now,
      },
      full_available: true,
    };
  });

  const body: KoraIndexResponse = {
    kora_version: KORA_VERSION,
    source: "live",
    total,
    limit,
    offset,
    blocks,
  };

  cache.set(cacheKey, body, ttl);
  sendJson(res, 200, body, ttl);
}

async function handleFull(
  res: ServerResponse,
  contentId: string,
  options: KoraMiddlewareOptions,
  cache: KoraCache,
): Promise<void> {
  const cacheKey = `full:${contentId}`;
  const cached = cache.get<KoraFullResponse>(cacheKey);
  if (cached) {
    sendJson(res, 200, cached, DEFAULT_TTL);
    return;
  }

  const allBlocks = await extractAllBlocks(options);
  const now = new Date().toISOString();
  const ttl = blockTtl(options.manifest);

  const found = allBlocks.find(
    ({ block }) => makeContentId(block.sourceUrl, block.archetype) === contentId,
  );

  if (!found) {
    sendError(
      res,
      404,
      "not_found",
      `No content block with id '${contentId}' found on this site.`,
    );
    return;
  }

  const { block, structure, relatedContent } = found;
  const allFields = fieldsToRecord(block.fields);
  const relations = buildRelations(block.fields);

  const body: KoraFullResponse = {
    kora_version: KORA_VERSION,
    source: "live",
    content_id: contentId,
    archetype: block.archetype,
    subtype: block.subtype,
    inferred: block.inferred,
    identity: {
      publisher: options.manifest.identity.author.name,
      public_url: options.manifest.identity.public_url,
      signed: false,
      source_url: block.sourceUrl,
    },
    fields: allFields,
    missing_fields: [],
    truncated_fields: [],
    relations,
    structure,
    implicit_clusters: [],
    related_content: relatedContent,
    meta: {
      content_id: contentId,
      archetype: block.archetype,
      subtype: block.subtype,
      inferred: block.inferred,
      confidence: inferConfidence(block),
      language: options.manifest.identity.language,
      source_url: block.sourceUrl,
      token_count: 0,
      kora_version: KORA_VERSION,
      ttl,
      extracted_at: now,
    },
  };

  cache.set(cacheKey, body, ttl);
  sendJson(res, 200, body, ttl);
}

async function handleField(
  res: ServerResponse,
  contentId: string,
  fieldName: string,
  options: KoraMiddlewareOptions,
  cache: KoraCache,
): Promise<void> {
  // /.kora/field always bypasses cache — it must return the full value
  const allBlocks = await extractAllBlocks(options);
  const now = new Date().toISOString();
  const ttl = blockTtl(options.manifest);

  const found = allBlocks.find(
    ({ block }) => makeContentId(block.sourceUrl, block.archetype) === contentId,
  );

  if (!found) {
    sendError(
      res,
      404,
      "not_found",
      `No content block with id '${contentId}' found on this site.`,
    );
    return;
  }

  const { block } = found;
  const rawField = block.fields.find((f) => f.name === fieldName);

  if (!rawField) {
    sendError(
      res,
      404,
      "not_found",
      `Field '${fieldName}' not found in content block '${contentId}'.`,
    );
    return;
  }

  // Return the full value — this endpoint ignores max_field_tokens per spec.
  const body: KoraFieldResponse = {
    kora_version: KORA_VERSION,
    source: "live",
    content_id: contentId,
    field: fieldName,
    value: rawField.value,
    truncated: false,
    token_count: 0,
    extracted_at: now,
  };

  sendJson(res, 200, body, ttl);
}

async function handleLive(
  res: ServerResponse,
  fieldName: string,
  options: KoraMiddlewareOptions,
  cache: KoraCache,
): Promise<void> {
  const dynamicSources = options.manifest.dynamic_sources ?? [];
  const source = dynamicSources.find(
    (s) => s.field === fieldName && s.tier === "live",
  );

  if (!source) {
    sendError(
      res,
      404,
      "not_live",
      `Field '${fieldName}' is not declared as a live-tier source.`,
    );
    return;
  }

  if (!options.fetchDynamic) {
    sendError(
      res,
      503,
      "unavailable",
      `Live source '${fieldName}' is declared but fetchDynamic is not configured.`,
    );
    return;
  }

  // Live sources use refresh interval as TTL — but we never cache beyond it.
  // For live tier, refresh is explicitly forbidden by the schema, so TTL = 0
  // means always re-fetch.
  const cacheKey = `live:${fieldName}`;
  const cached = cache.get<KoraLiveFieldResponse>(cacheKey);
  if (cached) {
    sendJson(res, 200, cached, 0);
    return;
  }

  let value: unknown;
  try {
    value = await options.fetchDynamic(fieldName);
  } catch {
    sendError(
      res,
      503,
      "unavailable",
      `Failed to fetch live source '${fieldName}'.`,
    );
    return;
  }

  const now = new Date().toISOString();
  const body: KoraLiveFieldResponse = {
    kora_version: KORA_VERSION,
    source: "live",
    field: fieldName,
    archetype: "signal",
    subtype: fieldName,
    value,
    meta: {
      ttl: 0,
      extracted_at: now,
    },
  };

  // Never cache live responses beyond their TTL (0 for live tier)
  sendJson(res, 200, body, 0);
}

// Route table
// Matches /.kora/manifest
const ROUTE_MANIFEST = /^\/\.kora\/manifest\/?$/;
// Matches /.kora/index
const ROUTE_INDEX = /^\/\.kora\/index\/?$/;
// Matches /.kora/full/{content_id}
const ROUTE_FULL = /^\/\.kora\/full\/([a-f0-9]{8})\/?$/;
// Matches /.kora/field/{content_id}/{field_name}
const ROUTE_FIELD = /^\/\.kora\/field\/([a-f0-9]{8})\/([a-z][a-z0-9_]*)\/?$/;
// Matches /.kora/live/{field}
const ROUTE_LIVE = /^\/\.kora\/live\/([a-z][a-z0-9_]*)\/?$/;

// Public API

/**
 * Create the KOra live fallback middleware for raw Node.js http servers.
 *
 * Returns a handler function. Call `next()` for requests that don't match
 * any /.kora/ route.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http"
 * import { koraMiddleware } from "@kora/core"
 *
 * const kora = koraMiddleware({ manifest, sourceUrl, fetchPage })
 * createServer((req, res) => kora(req, res, () => {
 *   res.statusCode = 404
 *   res.end("Not found")
 * }))
 * ```
 */
export function koraMiddleware(
  options: KoraMiddlewareOptions,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void> {
  const cache = new KoraCache();

  return async (req, res, next) => {
    const { pathname, query } = parseUrl(req);

    // Only handle GET requests on /.kora/ paths
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    if (ROUTE_MANIFEST.test(pathname)) {
      await handleManifest(res, options, cache);
      return;
    }

    if (ROUTE_INDEX.test(pathname)) {
      await handleIndex(res, query, options, cache);
      return;
    }

    const fullMatch = ROUTE_FULL.exec(pathname);
    if (fullMatch) {
      await handleFull(res, fullMatch[1], options, cache);
      return;
    }

    const fieldMatch = ROUTE_FIELD.exec(pathname);
    if (fieldMatch) {
      await handleField(res, fieldMatch[1], fieldMatch[2], options, cache);
      return;
    }

    const liveMatch = ROUTE_LIVE.exec(pathname);
    if (liveMatch) {
      await handleLive(res, liveMatch[1], options, cache);
      return;
    }

    // Not a /.kora/ route — pass through
    next();
  };
}

/**
 * Express-compatible variant. Wraps koraMiddleware so the handler signature
 * matches Express's `(req, res, next)` contract.
 *
 * Accepts `express.Request` / `express.Response` because Express extends
 * IncomingMessage / ServerResponse — no express import needed here.
 *
 * @example
 * ```ts
 * import express from "express"
 * import { koraExpressMiddleware } from "@kora/core"
 *
 * const app = express()
 * app.use(koraExpressMiddleware({ manifest, sourceUrl, fetchPage }))
 * ```
 */
export function koraExpressMiddleware(
  options: KoraMiddlewareOptions,
): (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => Promise<void> {
  const handler = koraMiddleware(options);
  return async (req, res, next) => {
    await handler(req, res, () => next());
  };
}