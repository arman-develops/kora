/**
 * @kora/core — middleware/kora.test.ts
 *
 * Tests for the KOra live fallback middleware.
 *
 * Strategy:
 *   - All tests use mock IncomingMessage / ServerResponse objects.
 *     No supertest, no real HTTP server.
 *   - fetchPage returns controlled HTML fixtures.
 *   - Tests are grouped by endpoint, with 404/error cases inline.
 *   - Header assertions on every endpoint test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { koraMiddleware, makeContentId } from "../kora.js";
import type { KoraMiddlewareOptions, KoraManifest } from "@kora/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A minimal valid manifest for testing.
 */
const TEST_MANIFEST: KoraManifest = {
  kora: "1.0",
  identity: {
    name: "Test Site",
    description: "A test site for KOra middleware tests.",
    base_url: "http://localhost:3000",
    public_url: "https://test.example.com",
    author: { name: "Test Author", contact: "test@example.com" },
    language: "en",
    license: { type: "public" },
  },
  static_roots: ["/blog"],
  output: { summary: true, full: true, max_field_tokens: 512 },
  versioning: { strategy: "semver-timestamp" },
};

const NARRATIVE_HTML = `
<html><body>
  <article kora-archetype="narrative" kora-subtype="blog_post">
    <h1 kora-field="title">The Future of AI Search</h1>
    <span kora-field="author">Jane Doe</span>
    <time kora-field="published_at" datetime="2026-01-15T00:00:00Z">Jan 15, 2026</time>
    <p kora-field="summary">A look at how agents are replacing direct browsing.</p>
    <div kora-field="body">Full article content here. This is the body.</div>
    <div kora-field="tags" kora-list>
      <span>AI</span><span>Search</span><span>Agents</span>
    </div>
  </article>
</body></html>
`;

const REFERENCE_HTML = `
<html><body>
  <section kora-archetype="reference" kora-subtype="api_docs">
    <h1 kora-field="title">Rate Limits</h1>
    <p kora-field="summary">Describes request limits per tier.</p>
    <div kora-field="body">Full reference content. Extensive documentation.</div>
    <span kora-field="version">2.1</span>
  </section>
</body></html>
`;

const SIGNAL_FIELD = "stock_price";
const MANIFEST_WITH_LIVE: KoraManifest = {
  ...TEST_MANIFEST,
  dynamic_sources: [
    {
      field: SIGNAL_FIELD,
      endpoint: "/api/price",
      auth: { type: "public" },
      tier: "live",
    },
  ],
};

// ─── Mock HTTP helpers ────────────────────────────────────────────────────────

interface MockResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

/**
 * Build a minimal mock IncomingMessage.
 */
function mockReq(url: string, method = "GET"): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.url = url;
  emitter.method = method;
  return emitter;
}

/**
 * Build a mock ServerResponse that captures status, headers, and body.
 * Returns both the mock and a promise that resolves when `end()` is called.
 */
function mockRes(): { res: ServerResponse; result: Promise<MockResponse> } {
  let resolve!: (r: MockResponse) => void;

  const promise = new Promise<MockResponse>((r) => {
    resolve = r;
  });

  const headers: Record<string, string | string[]> = {};

  let currentStatusCode = 200;
  let body = "";

  const res = {
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
    },

    end(data?: string) {
      body = data ?? "";

      resolve({
        statusCode: currentStatusCode,
        headers,
        body,
      });
    },

    get statusCode() {
      return currentStatusCode;
    },

    set statusCode(v: number) {
      currentStatusCode = v;
    },
  } as unknown as ServerResponse;

  return {
    res,
    result: promise,
  };
}

/**
 * Run the middleware against a mock request and return the captured response.
 */
async function runMiddleware(
  url: string,
  options: KoraMiddlewareOptions,
  method = "GET",
): Promise<MockResponse & { json: unknown }> {
  const req = mockReq(url, method);
  const { res, result } = mockRes();
  const nextCalled = { value: false };

  const handler = koraMiddleware(options);
  await handler(req, res, () => { nextCalled.value = true; });

  if (nextCalled.value) {
    // next() was called — simulate 404 from the outer server
    return { statusCode: 404, headers: {}, body: "", json: null };
  }

  const response = await result;
  let json: unknown = null;
  try { json = JSON.parse(response.body); } catch { /* not JSON */ }

  return { ...response, json };
}

// ─── Options factory ──────────────────────────────────────────────────────────

function makeOptions(
  overrides: Partial<KoraMiddlewareOptions> & {
    htmlMap?: Record<string, string>;
  } = {},
): KoraMiddlewareOptions {
  const { htmlMap = { "/blog": NARRATIVE_HTML }, ...rest } = overrides;

  return {
    manifest: TEST_MANIFEST,
    sourceUrl: "https://test.example.com",
    fetchPage: async (path: string) => {
      const html = htmlMap[path];
      if (!html) throw new Error(`No fixture for path: ${path}`);
      return html;
    },
    ...rest,
  };
}

// ─── content_id helper ────────────────────────────────────────────────────────

describe("makeContentId", () => {
  it("returns exactly 8 hex characters", () => {
    const id = makeContentId("https://test.example.com/blog", "narrative");
    expect(id).toMatch(/^[a-f0-9]{8}$/);
  });

  it("is deterministic — same inputs always produce same id", () => {
    const a = makeContentId("https://test.example.com/blog", "narrative");
    const b = makeContentId("https://test.example.com/blog", "narrative");
    expect(a).toBe(b);
  });

  it("differs for different archetypes on the same URL", () => {
    const a = makeContentId("https://test.example.com/blog", "narrative");
    const b = makeContentId("https://test.example.com/blog", "reference");
    expect(a).not.toBe(b);
  });

  it("differs for different URLs with the same archetype", () => {
    const a = makeContentId("https://test.example.com/blog", "narrative");
    const b = makeContentId("https://test.example.com/about", "narrative");
    expect(a).not.toBe(b);
  });
});

// ─── Non-.kora routes ─────────────────────────────────────────────────────────

describe("non-.kora routes", () => {
  it("calls next() for unrelated paths", async () => {
    const req = mockReq("/some/other/path");
    const { res } = mockRes();
    let nextCalled = false;

    const handler = koraMiddleware(makeOptions());
    await handler(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("calls next() for non-GET methods on .kora routes", async () => {
    const result = await runMiddleware("/.kora/manifest", makeOptions(), "POST");
    expect(result.statusCode).toBe(404); // next() called → our test harness returns 404
  });
});

// ─── Response headers ─────────────────────────────────────────────────────────

describe("response headers", () => {
  it("sets all required headers on /.kora/manifest", async () => {
    const result = await runMiddleware("/.kora/manifest", makeOptions());
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.headers["x-kora-version"]).toBe("1.0");
    expect(result.headers["x-kora-source"]).toBe("live");
    expect(result.headers["x-kora-package-version"]).toBeDefined();
    expect(result.headers["cache-control"]).toMatch(/^max-age=\d+$/);
  });

  it("sets all required headers on /.kora/index", async () => {
    const result = await runMiddleware("/.kora/index", makeOptions());
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.headers["x-kora-version"]).toBe("1.0");
    expect(result.headers["x-kora-source"]).toBe("live");
    expect(result.headers["cache-control"]).toMatch(/^max-age=\d+$/);
  });
});

// ─── GET /.kora/manifest ──────────────────────────────────────────────────────

describe("GET /.kora/manifest", () => {
  it("returns 200 with correct envelope fields", async () => {
    const result = await runMiddleware("/.kora/manifest", makeOptions());
    expect(result.statusCode).toBe(200);

    const body = result.json as Record<string, unknown>;
    expect(body.kora_version).toBe("1.0");
    expect(body.source).toBe("live");
    expect(body.signed).toBe(false);
    expect(body.ttl).toBeTypeOf("number");
  });

  it("includes correct identity (no base_url)", async () => {
    const result = await runMiddleware("/.kora/manifest", makeOptions());
    const body = result.json as Record<string, unknown>;
    const identity = body.identity as Record<string, unknown>;

    expect(identity.name).toBe("Test Site");
    expect(identity.public_url).toBe("https://test.example.com");
    expect(identity.base_url).toBeUndefined();
  });

  it("includes content_summary with correct block count", async () => {
    const result = await runMiddleware("/.kora/manifest", makeOptions());
    const body = result.json as Record<string, unknown>;
    const summary = body.content_summary as Record<string, unknown>;

    expect(summary.total_blocks).toBe(1);
    expect((summary.archetypes as Record<string, number>).narrative).toBe(1);
  });

  it("reports live_sources count from manifest", async () => {
    const result = await runMiddleware(
      "/.kora/manifest",
      makeOptions({ manifest: MANIFEST_WITH_LIVE }),
    );
    const body = result.json as Record<string, unknown>;
    const summary = body.content_summary as Record<string, unknown>;
    expect(summary.live_sources).toBe(1);
  });

  it("handles fetchPage failure gracefully — returns 0 blocks", async () => {
    const opts = makeOptions({ fetchPage: async () => { throw new Error("network error"); } });
    const result = await runMiddleware("/.kora/manifest", opts);
    expect(result.statusCode).toBe(200);
    const body = result.json as Record<string, unknown>;
    const summary = body.content_summary as Record<string, unknown>;
    expect(summary.total_blocks).toBe(0);
  });
});

// ─── GET /.kora/index ─────────────────────────────────────────────────────────

describe("GET /.kora/index", () => {
  it("returns 200 with blocks array", async () => {
    const result = await runMiddleware("/.kora/index", makeOptions());
    expect(result.statusCode).toBe(200);

    const body = result.json as Record<string, unknown>;
    expect(body.kora_version).toBe("1.0");
    expect(body.source).toBe("live");
    expect(Array.isArray(body.blocks)).toBe(true);
  });

  it("block in index has expected fields", async () => {
    const result = await runMiddleware("/.kora/index", makeOptions());
    const body = result.json as Record<string, unknown>;
    const blocks = body.blocks as Array<Record<string, unknown>>;
    const block = blocks[0];

    expect(block.content_id).toMatch(/^[a-f0-9]{8}$/);
    expect(block.archetype).toBe("narrative");
    expect(block.subtype).toBe("blog_post");
    expect(block.full_available).toBe(true);
    expect(block.source_url).toContain("test.example.com");
  });

  it("body field is excluded from index blocks", async () => {
    const result = await runMiddleware("/.kora/index", makeOptions());
    const body = result.json as Record<string, unknown>;
    const blocks = body.blocks as Array<Record<string, unknown>>;
    const fields = blocks[0].fields as Record<string, unknown>;

    expect(fields.body).toBeUndefined();
    expect(fields.title).toBeDefined();
  });

  it("filters by archetype", async () => {
    const htmlMap = { "/blog": NARRATIVE_HTML };
    const result = await runMiddleware(
      "/.kora/index?archetype=reference",
      makeOptions({ htmlMap }),
    );
    const body = result.json as Record<string, unknown>;
    const blocks = body.blocks as unknown[];
    expect(blocks.length).toBe(0);
    expect(body.total).toBe(0);
  });

  it("filters by subtype", async () => {
    const htmlMap = { "/blog": NARRATIVE_HTML };
    const result = await runMiddleware(
      "/.kora/index?subtype=blog_post",
      makeOptions({ htmlMap }),
    );
    const body = result.json as Record<string, unknown>;
    const blocks = body.blocks as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(1);
    expect(blocks[0].subtype).toBe("blog_post");
  });

  it("respects limit and offset", async () => {
    // Two pages with one block each
    const htmlMap = {
      "/blog": NARRATIVE_HTML,
      "/docs": REFERENCE_HTML,
    };
    const manifest: KoraManifest = {
      ...TEST_MANIFEST,
      static_roots: ["/blog", "/docs"],
    };

    const resultPage1 = await runMiddleware(
      "/.kora/index?limit=1&offset=0",
      makeOptions({ manifest, htmlMap }),
    );
    const body1 = resultPage1.json as Record<string, unknown>;
    expect((body1.blocks as unknown[]).length).toBe(1);
    expect(body1.total).toBe(2);
    expect(body1.limit).toBe(1);
    expect(body1.offset).toBe(0);

    const resultPage2 = await runMiddleware(
      "/.kora/index?limit=1&offset=1",
      makeOptions({ manifest, htmlMap }),
    );
    const body2 = resultPage2.json as Record<string, unknown>;
    expect((body2.blocks as unknown[]).length).toBe(1);
    expect(body2.offset).toBe(1);
  });

  it("caps limit at 200", async () => {
    const result = await runMiddleware(
      "/.kora/index?limit=9999",
      makeOptions(),
    );
    const body = result.json as Record<string, unknown>;
    expect(body.limit).toBe(200);
  });

  it("returns 400 for invalid archetype filter", async () => {
    const result = await runMiddleware(
      "/.kora/index?archetype=nonsense",
      makeOptions(),
    );
    expect(result.statusCode).toBe(400);
    const body = result.json as Record<string, unknown>;
    expect(body.error).toBe("not_found");
    expect(body.source).toBe("live");
  });
});

// ─── GET /.kora/full/{content_id} ────────────────────────────────────────────

describe("GET /.kora/full/{content_id}", () => {
  it("returns 200 with full payload for a known content_id", async () => {
    const opts = makeOptions();
    // First get the content_id from the index
    const indexResult = await runMiddleware("/.kora/index", opts);
    const indexBody = indexResult.json as Record<string, unknown>;
    const blocks = indexBody.blocks as Array<Record<string, unknown>>;
    const contentId = blocks[0].content_id as string;

    const result = await runMiddleware(`/.kora/full/${contentId}`, opts);
    expect(result.statusCode).toBe(200);

    const body = result.json as Record<string, unknown>;
    expect(body.kora_version).toBe("1.0");
    expect(body.source).toBe("live");
    expect(body.content_id).toBe(contentId);
    expect(body.archetype).toBe("narrative");
  });

  it("includes body field in full payload", async () => {
    const opts = makeOptions();
    const indexResult = await runMiddleware("/.kora/index", opts);
    const indexBody = indexResult.json as Record<string, unknown>;
    const blocks = indexBody.blocks as Array<Record<string, unknown>>;
    const contentId = blocks[0].content_id as string;

    const result = await runMiddleware(`/.kora/full/${contentId}`, opts);
    const body = result.json as Record<string, unknown>;
    const fields = body.fields as Record<string, unknown>;

    expect(fields.body).toBeDefined();
    expect(typeof fields.body).toBe("string");
  });

  it("includes identity block with correct fields", async () => {
    const opts = makeOptions();
    const indexResult = await runMiddleware("/.kora/index", opts);
    const indexBody = indexResult.json as Record<string, unknown>;
    const blocks = indexBody.blocks as Array<Record<string, unknown>>;
    const contentId = blocks[0].content_id as string;

    const result = await runMiddleware(`/.kora/full/${contentId}`, opts);
    const body = result.json as Record<string, unknown>;
    const identity = body.identity as Record<string, unknown>;

    expect(identity.publisher).toBe("Test Author");
    expect(identity.public_url).toBe("https://test.example.com");
    expect(identity.signed).toBe(false);
  });

  it("returns 404 for unknown content_id", async () => {
    const result = await runMiddleware("/.kora/full/00000000", makeOptions());
    expect(result.statusCode).toBe(404);
    const body = result.json as Record<string, unknown>;
    expect(body.error).toBe("not_found");
    expect(body.source).toBe("live");
    expect(body.message).toContain("00000000");
  });

  it("error response has correct shape", async () => {
    const result = await runMiddleware("/.kora/full/deadbeef", makeOptions());
    const body = result.json as Record<string, unknown>;
    expect(body.kora_version).toBe("1.0");
    expect(body.source).toBe("live");
    expect(typeof body.error).toBe("string");
    expect(typeof body.message).toBe("string");
  });
});

// ─── GET /.kora/field/{content_id}/{field_name} ───────────────────────────────

describe("GET /.kora/field/{content_id}/{field_name}", () => {
  async function getContentId(opts: KoraMiddlewareOptions): Promise<string> {
    const indexResult = await runMiddleware("/.kora/index", opts);
    const indexBody = indexResult.json as Record<string, unknown>;
    const blocks = indexBody.blocks as Array<Record<string, unknown>>;
    return blocks[0].content_id as string;
  }

  it("returns the full field value", async () => {
    const opts = makeOptions();
    const contentId = await getContentId(opts);

    const result = await runMiddleware(
      `/.kora/field/${contentId}/title`,
      opts,
    );
    expect(result.statusCode).toBe(200);
    const body = result.json as Record<string, unknown>;
    expect(body.value).toBe("The Future of AI Search");
    expect(body.field).toBe("title");
    expect(body.content_id).toBe(contentId);
  });

  it("returns body field in full — does not truncate", async () => {
    const opts = makeOptions();
    const contentId = await getContentId(opts);

    const result = await runMiddleware(
      `/.kora/field/${contentId}/body`,
      opts,
    );
    expect(result.statusCode).toBe(200);
    const body = result.json as Record<string, unknown>;
    expect(body.truncated).toBe(false);
    expect(typeof body.value).toBe("string");
    expect((body.value as string).length).toBeGreaterThan(0);
  });

  it("returns list field as array", async () => {
    const opts = makeOptions();
    const contentId = await getContentId(opts);

    const result = await runMiddleware(
      `/.kora/field/${contentId}/tags`,
      opts,
    );
    expect(result.statusCode).toBe(200);
    const body = result.json as Record<string, unknown>;
    expect(Array.isArray(body.value)).toBe(true);
    expect(body.value).toEqual(["AI", "Search", "Agents"]);
  });

  it("returns 404 for unknown content_id", async () => {
    const result = await runMiddleware(
      "/.kora/field/00000000/title",
      makeOptions(),
    );
    expect(result.statusCode).toBe(404);
    const body = result.json as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });

  it("returns 404 for unknown field_name on a valid block", async () => {
    const opts = makeOptions();
    const contentId = await getContentId(opts);

    const result = await runMiddleware(
      `/.kora/field/${contentId}/nonexistent_field`,
      opts,
    );
    expect(result.statusCode).toBe(404);
    const body = result.json as Record<string, unknown>;
    expect(body.error).toBe("not_found");
    expect((body.message as string)).toContain("nonexistent_field");
  });

  it("response has correct envelope fields", async () => {
    const opts = makeOptions();
    const contentId = await getContentId(opts);

    const result = await runMiddleware(
      `/.kora/field/${contentId}/title`,
      opts,
    );
    const body = result.json as Record<string, unknown>;
    expect(body.kora_version).toBe("1.0");
    expect(body.source).toBe("live");
    expect(body.extracted_at).toBeDefined();
  });
});

// ─── GET /.kora/live/{field} ──────────────────────────────────────────────────

describe("GET /.kora/live/{field}", () => {
  it("returns 404 when field is not a live-tier source", async () => {
    const result = await runMiddleware("/.kora/live/stock_price", makeOptions());
    expect(result.statusCode).toBe(404);
    const body = result.json as Record<string, unknown>;
    expect(body.error).toBe("not_live");
    expect(body.source).toBe("live");
  });

  it("returns 503 when fetchDynamic is not provided but field is live", async () => {
    const opts = makeOptions({
      manifest: MANIFEST_WITH_LIVE,
      // fetchDynamic intentionally omitted
    });
    const result = await runMiddleware(`/.kora/live/${SIGNAL_FIELD}`, opts);
    expect(result.statusCode).toBe(503);
    const body = result.json as Record<string, unknown>;
    expect(body.error).toBe("unavailable");
  });

  it("returns 200 with signal envelope when fetchDynamic succeeds", async () => {
    const liveValue = {
      label: "AAPL Stock Price",
      value: 214.73,
      unit: "USD",
      recorded_at: "2026-01-15T16:00:00Z",
    };

    const opts = makeOptions({
      manifest: MANIFEST_WITH_LIVE,
      fetchDynamic: async () => liveValue,
    });

    const result = await runMiddleware(`/.kora/live/${SIGNAL_FIELD}`, opts);
    expect(result.statusCode).toBe(200);

    const body = result.json as Record<string, unknown>;
    expect(body.kora_version).toBe("1.0");
    expect(body.source).toBe("live");
    expect(body.field).toBe(SIGNAL_FIELD);
    expect(body.archetype).toBe("signal");
    expect(body.value).toEqual(liveValue);
  });

  it("returns 503 when fetchDynamic throws", async () => {
    const opts = makeOptions({
      manifest: MANIFEST_WITH_LIVE,
      fetchDynamic: async () => { throw new Error("upstream failure"); },
    });

    const result = await runMiddleware(`/.kora/live/${SIGNAL_FIELD}`, opts);
    expect(result.statusCode).toBe(503);
    const body = result.json as Record<string, unknown>;
    expect(body.error).toBe("unavailable");
  });

  it("not_live error message mentions the field name", async () => {
    const result = await runMiddleware("/.kora/live/nonexistent_field", makeOptions());
    const body = result.json as Record<string, unknown>;
    expect((body.message as string)).toContain("nonexistent_field");
  });

  it("live response sets Cache-Control: max-age=0", async () => {
    const opts = makeOptions({
      manifest: MANIFEST_WITH_LIVE,
      fetchDynamic: async () => ({ value: 42 }),
    });
    const result = await runMiddleware(`/.kora/live/${SIGNAL_FIELD}`, opts);
    expect(result.headers["cache-control"]).toBe("max-age=0");
  });
});

// ─── Error responses ──────────────────────────────────────────────────────────

describe("error response shape", () => {
  it("all error responses have kora_version, source, error, message", async () => {
    const errorUrls = [
      "/.kora/full/00000000",
      "/.kora/field/00000000/title",
      "/.kora/live/not_a_live_field",
    ];
    const opts = makeOptions();

    for (const url of errorUrls) {
      const result = await runMiddleware(url, opts);
      const body = result.json as Record<string, unknown>;
      expect(body.kora_version, `kora_version missing on ${url}`).toBe("1.0");
      expect(body.source, `source missing on ${url}`).toBe("live");
      expect(body.error, `error missing on ${url}`).toBeDefined();
      expect(body.message, `message missing on ${url}`).toBeDefined();
    }
  });
});