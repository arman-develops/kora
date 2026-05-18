# KOra Live Fallback Endpoint Contract
> Spec version: 1.0 | Status: Canonical | Part of Group A — Specification

---

## Overview

The live fallback ensures that installing the KOra SDK alone provides value to agents — even before a developer runs `kora publish`.

When an agent queries the KOra Repository and either:
- The site has no published package, or
- The published package has exceeded its declared TTL,

the agent falls back to querying the live site directly via the `/.kora/` endpoints exposed by the SDK middleware.

The agent experience is identical to consuming a repository package. Only latency differs.

---

## Endpoints

All endpoints are served from the root of the site's `public_url`.

```
GET /.kora/manifest
GET /.kora/index
GET /.kora/full/{content_id}
GET /.kora/field/{content_id}/{field_name}
GET /.kora/live/{field}
```

---

### `GET /.kora/manifest`

Returns the site's package manifest. Identical in structure to `manifest.json` in the repository package.

**Response:** `application/json`

```json
{
  "kora_version": "1.0",
  "package_version": "1.2.0+20260115T143000Z",
  "published_at": "2026-01-15T14:30:00Z",
  "identity": {
    "name": "Acme Corp Blog",
    "description": "Technology news and analysis focused on AI infrastructure and developer tooling.",
    "public_url": "https://acme.com",
    "author": {
      "name": "Acme Corp",
      "contact": "dev@acme.com"
    },
    "language": "en",
    "license": {
      "type": "public",
      "url": "https://acme.com/license"
    }
  },
  "content_summary": {
    "total_blocks": 42,
    "archetypes": {
      "narrative": 38,
      "reference": 4
    },
    "dynamic_sources": 1,
    "live_sources": 1
  },
  "signed": false,
  "ttl": 300,
  "source": "live"
}
```

**Differences from repository package manifest:**
- `signed` is always `false`. The live fallback is not cryptographically signed.
- `ttl` reflects the live site's current cache TTL, not the published package TTL.
- `source: "live"` is always present. Agents use this to distinguish live fallback responses from repository package responses.

---

### `GET /.kora/index`

Returns summary payloads for all content blocks currently extractable from the live site. Identical in structure to `index.json` in the repository package.

**Response:** `application/json`

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `archetype` | string | Filter blocks by archetype. e.g. `?archetype=narrative` |
| `subtype` | string | Filter blocks by subtype. e.g. `?subtype=blog_post` |
| `limit` | integer | Maximum number of blocks to return. Default: `50`. Maximum: `200`. |
| `offset` | integer | Pagination offset. Default: `0`. |

**Response:**
```json
{
  "kora_version": "1.0",
  "source": "live",
  "total": 42,
  "limit": 50,
  "offset": 0,
  "blocks": [
    {
      "content_id": "a3f9c2e1",
      "archetype": "narrative",
      "subtype": "blog_post",
      "inferred": false,
      "confidence": "high",
      "source_url": "https://acme.com/blog/future-of-ai-search",
      "fields": {
        "title": "The Future of AI Search",
        "author": "Jane Doe",
        "published_at": "2026-01-15T00:00:00Z",
        "summary": "A look at how agents are replacing direct browsing.",
        "tags": ["AI", "Search", "Agents"],
        "reading_time": 4
      },
      "structure": ["Introduction", "The Problem", "What Changes", "Conclusion"],
      "meta": {
        "token_count": 42,
        "language": "en",
        "ttl": 300,
        "extracted_at": "2026-01-15T14:30:00Z"
      },
      "full_available": true
    }
  ]
}
```

---

### `GET /.kora/full/{content_id}`

Returns the full payload for a single content block. Identical in structure to `full/{content_id}.json` in the repository package.

**Path parameter:** `content_id` — the stable content identifier from the index.

**Response:** `application/json`

```json
{
  "kora_version": "1.0",
  "source": "live",
  "content_id": "a3f9c2e1",
  "archetype": "narrative",
  "subtype": "blog_post",
  "inferred": false,
  "identity": {
    "publisher": "Acme Corp",
    "public_url": "https://acme.com",
    "signed": false,
    "source_url": "https://acme.com/blog/future-of-ai-search"
  },
  "fields": {
    "title": "The Future of AI Search",
    "author": "Jane Doe",
    "published_at": "2026-01-15T00:00:00Z",
    "summary": "A look at how agents are replacing direct browsing.",
    "body": "Full article content here...",
    "tags": ["AI", "Search", "Agents"],
    "reading_time": 4
  },
  "missing_fields": [],
  "truncated_fields": [],
  "relations": {},
  "structure": ["Introduction", "The Problem", "What Changes", "Conclusion"],
  "implicit_clusters": [],
  "related_content": [
    { "title": "How Agents Query the Web", "url": "https://acme.com/blog/agent-queries" }
  ],
  "meta": {
    "content_id": "a3f9c2e1",
    "archetype": "narrative",
    "subtype": "blog_post",
    "inferred": false,
    "confidence": "high",
    "language": "en",
    "source_url": "https://acme.com/blog/future-of-ai-search",
    "token_count": 380,
    "kora_version": "1.0",
    "ttl": 300,
    "extracted_at": "2026-01-15T14:30:00Z"
  }
}
```

**Error — content_id not found:**
```json
{
  "error": "not_found",
  "message": "No content block with id 'a3f9c2e1' found on this site.",
  "source": "live"
}
```

---

### `GET /.kora/field/{content_id}/{field_name}`

Returns the full value of a single field from a content block. Used when a field was truncated in the package or live index response and the agent needs the complete value.

**Path parameters:**
- `content_id` — the stable content identifier
- `field_name` — the field to retrieve. snake_case.

**Response:** `application/json`

```json
{
  "kora_version": "1.0",
  "source": "live",
  "content_id": "a3f9c2e1",
  "field": "body",
  "value": "Full untruncated article content here...",
  "truncated": false,
  "token_count": 2840,
  "extracted_at": "2026-01-15T14:30:00Z"
}
```

**Error — field not found:**
```json
{
  "error": "not_found",
  "message": "Field 'body' not found in content block 'a3f9c2e1'.",
  "source": "live"
}
```

**Note:** This endpoint always returns the full field value regardless of `max_field_tokens`. It is the only endpoint that does. The `truncated` flag in the response confirms whether the value was truncated in the package — `false` here means the agent is receiving the complete value.

---

### `GET /.kora/live/{field}`

Returns the current value of a declared `live` tier dynamic source. This endpoint is the passthrough for real-time data.

**Path parameter:** `field` — the `field` name declared in `dynamic_sources` in the project manifest.

**Response:** `application/json`

```json
{
  "kora_version": "1.0",
  "source": "live",
  "field": "stock_price",
  "archetype": "signal",
  "subtype": "stock_price",
  "value": {
    "label": "AAPL Stock Price",
    "value": 214.73,
    "unit": "USD",
    "recorded_at": "2026-01-15T16:00:00Z",
    "source": "NYSE",
    "status": "normal",
    "previous_value": 211.20,
    "change": 3.53,
    "change_percent": 1.67
  },
  "meta": {
    "ttl": 60,
    "extracted_at": "2026-01-15T16:05:00Z"
  }
}
```

**Error — field not declared as live:**
```json
{
  "error": "not_live",
  "message": "Field 'stock_price' is not declared as a live-tier source.",
  "source": "live"
}
```

---

## Response Headers

All `/.kora/` endpoints return these headers:

| Header | Value | Description |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Always JSON. |
| `X-KOra-Version` | `1.0` | Spec version of this response. |
| `X-KOra-Source` | `live` | Confirms this is a live fallback response, not a repository package. |
| `X-KOra-Package-Version` | `1.2.0+20260115T143000Z` | Current package version on this site. |
| `Cache-Control` | `max-age={ttl}` | TTL in seconds. Derived from content tier. |

---

## Caching Behaviour

The SDK middleware applies caching at the endpoint level. Responses are not re-extracted on every request.

| Endpoint | Cache TTL source |
|----------|-----------------|
| `/.kora/manifest` | `ttl` from the project manifest output config |
| `/.kora/index` | Shortest TTL across all static content blocks |
| `/.kora/full/{content_id}` | TTL of the specific content block |
| `/.kora/field/{content_id}/{field_name}` | TTL of the specific content block |
| `/.kora/live/{field}` | `refresh` value declared for the source in the manifest |

`/.kora/live/{field}` responses are never cached beyond their declared refresh interval. The SDK middleware re-fetches from the declared endpoint on each request when the TTL has expired.

---

## Trust and Signing

Live fallback responses are **never cryptographically signed**. `signed` is always `false` in live fallback responses.

Agents must treat live fallback responses with lower trust than repository package responses:

| Source | Signed | Trust level |
|--------|--------|-------------|
| Repository package | Yes (when `kora publish` was run) | High — authorship verified |
| Live fallback | Never | Medium — site identity via HTTPS only |

Agents that require signed content must use the repository package. The live fallback is a best-effort fallback, not a trust-equivalent alternative.

---

## Error Responses

All errors follow a consistent structure:

```json
{
  "error": "{error_code}",
  "message": "{human_readable_description}",
  "source": "live"
}
```

| Error code | HTTP status | Meaning |
|------------|-------------|---------|
| `not_found` | 404 | The requested content_id or field does not exist |
| `not_live` | 404 | The requested field is not a live-tier source |
| `unavailable` | 503 | The SDK middleware is installed but the site is temporarily unable to serve KOra responses |
| `not_installed` | — | Not an SDK error — the site does not have KOra installed. The `/.kora/` path will return a 404 from the site's own router. |

---

## SDK Middleware Installation

The `/.kora/` routes are automatically registered by the SDK middleware. Developers do not configure them manually.

**Next.js:**
```js
// next.config.js — no configuration needed
// The @kora/react package registers /.kora/ routes automatically
// via a Next.js API route added at install time
```

**Express / Node.js:**
```js
import { koraMiddleware } from '@kora/core'

app.use(koraMiddleware())
// Registers all /.kora/ routes automatically
// Must be called before other route definitions
```

**Plain HTML (static sites):**
Static sites cannot serve dynamic `/.kora/` endpoints without a runtime. For static sites, `kora publish` to the repository is the primary distribution method. The live fallback is not available for purely static deployments without a hosting layer that supports serverless functions.

---

## Discovery

Agents discover whether a site supports KOra by:

1. Attempting `GET /.kora/manifest`
2. If response is `200` with `X-KOra-Version` header — KOra is installed and the fallback is available
3. If response is `404` — KOra is not installed. No fallback available.

No prior knowledge of a site's KOra support is required. Discovery is a single lightweight request.

---

*Document version: 1.0 | Owner: KOra specification | Group A — Specification complete*