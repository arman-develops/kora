# KOra Output Package Format
> Spec version: 1.0 | Status: Canonical | Part of Group A — Specification

---

## Overview

The KOra output package is the versioned, structured bundle produced by `kora build` and pushed to the KOra Repository by `kora publish`. It is the primary artifact that agents consume.

The package is designed around three principles:

1. **Agents should never fetch more than they need.** The summary payload answers most queries. The full payload is fetched only when depth is required.
2. **Every payload is self-describing.** An agent reading any file in the package has everything it needs to understand, trust, and use the content without querying anything else.
3. **`base_url` never appears anywhere in the package.** Only `public_url` is surfaced. This is enforced by the CLI at write time.

---

## Bundle Structure

```
kora-package/
├── manifest.json            # Project identity and package metadata
├── index.json               # Summary payloads for all content blocks
├── full/                    # Full payloads, one file per content block
│   ├── {content_id}.json
│   └── ...
├── live-endpoints.json      # Passthrough declarations for live-tier sources
└── signature.sig            # Publish-time authorship signature
```

---

## File Specifications

### `manifest.json`

The package manifest. Distinct from `kora.manifest.json` in the developer's project — this is the output version, stripped of build-time configuration and redacted of sensitive values.

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
  "signed": true,
  "ttl": 86400
}
```

**Rules:**
- `base_url` is never present. Redacted at write time.
- `dynamic_sources` config (endpoints, auth, env references) is never present. Internal build config only.
- `signed` reflects whether `kora publish` completed the signing step. Always `false` on a local `kora build`.
- `ttl` is in seconds. Derived from the shortest TTL across all content tiers in the package.

---

### `index.json`

Contains summary payloads for every content block in the package. This is the agent's first read — a HEAD-like operation that lets it decide which blocks to fetch in full.

```json
{
  "kora_version": "1.0",
  "package_version": "1.2.0+20260115T143000Z",
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
      "related_content": [
        { "title": "How Agents Query the Web", "url": "https://acme.com/blog/agent-queries" }
      ],
      "meta": {
        "token_count": 42,
        "language": "en",
        "ttl": 86400,
        "extracted_at": "2026-01-15T14:30:00Z"
      },
      "full_available": true
    }
  ]
}
```

**Rules:**
- `body` is never included in summary payloads. Agents that need full content fetch `full/{content_id}.json`.
- `full_available` is always `true` if `output.full` is `true` in the project manifest.
- `related_content` URLs are always `public_url`-based absolute URLs.
- Blocks are ordered by `extracted_at` descending — most recent first.

---

### `full/{content_id}.json`

One file per content block. Contains the complete payload including all fields, full body content, and the complete meta block.

```json
{
  "kora_version": "1.0",
  "package_version": "1.2.0+20260115T143000Z",
  "content_id": "a3f9c2e1",
  "archetype": "narrative",
  "subtype": "blog_post",
  "inferred": false,
  "identity": {
    "publisher": "Acme Corp",
    "public_url": "https://acme.com",
    "signed": true,
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
    "package_version": "1.2.0+20260115T143000Z",
    "ttl": 86400,
    "extracted_at": "2026-01-15T14:30:00Z"
  }
}
```

**Field-level flags:**

| Flag | Type | Meaning |
|------|------|---------|
| `missing_fields` | array of strings | Expected core fields that were absent from the source. Never silently omitted. |
| `truncated_fields` | array of strings | Fields that exceeded `max_field_tokens` and were cut. Agent may request full value via live fallback. |
| `relations` | object | Field relationships declared via `kora-relation`. Key is the dependent field, value is the field it relates to. |
| `implicit_clusters` | array of objects | Content grouped by proximity inference. Present only when the inference pipeline produced clusters. |

**`missing_fields` example:**
```json
"missing_fields": [
  { "field": "author", "missing": true },
  { "field": "published_at", "missing": true }
]
```

**`truncated_fields` example:**
```json
"truncated_fields": [
  { "field": "body", "truncated": true, "token_count": 512, "total_tokens": 2840 }
]
```

---

### `live-endpoints.json`

Declares all `live` tier dynamic sources. Agents query these directly — the data is never snapshotted in the package.

```json
{
  "kora_version": "1.0",
  "endpoints": [
    {
      "field": "stock_price",
      "url": "https://acme.com/api/price",
      "archetype": "signal",
      "subtype": "stock_price",
      "response_format": "kora-signal-1.0",
      "auth_required": false
    }
  ]
}
```

**Rules:**
- `url` is always absolute, always `public_url`-based.
- `auth.env` is never present. Internal build config only.
- `auth_required: true` tells the agent this endpoint requires credentials it must source independently. KOra does not broker agent authentication.
- `response_format` declares the KOra envelope format the endpoint returns. Agents use this to parse the response correctly.

---

### `signature.sig`

Created by `kora publish`. Never present in a local `kora build` output.

Contains a cryptographic signature over the package contents. Format and signing algorithm are defined in the KOra trust model (Layer 2 concern). The presence of this file and `"signed": true` in `manifest.json` together confirm authorship.

---

## Versioning

Package versions follow the format: `MAJOR.MINOR.PATCH+TIMESTAMP`

Example: `1.2.0+20260115T143000Z`

The CLI auto-detects the bump level by diffing the current build against the last published package:

| Change | Bump |
|--------|------|
| Content updated, structure unchanged | PATCH |
| New field added, existing fields intact | MINOR |
| Archetype changed, field removed, structural break | MAJOR |

The timestamp suffix is ISO 8601 compact format. It allows agents to evaluate freshness independently of the semantic version.

---

## Meaningfulness Rules

The CLI enforces these at write time. They are not optional:

| Rule | Enforcement |
|------|------------|
| Navigation, footer, cookie banner, and ad content | Stripped automatically |
| Raw styling and layout information | Stripped automatically |
| `base_url` in any output file | Redacted — hard error if found at write time |
| Fields exceeding `max_field_tokens` | Truncated. Field name added to `truncated_fields`. |
| Empty string fields | Treated as missing. Added to `missing_fields`. Never written as `""` or `null`. |
| Expected fields absent from source | Added to `missing_fields`. Never silently omitted. |
| Extended fields not in archetype core | Written to `fields` normally. No special treatment. |

---

## Token Counting

All `token_count` values in the package are calculated using **tiktoken `cl100k_base`**. This is consistent across all archetypes, all field types, and all output files. Agents can rely on this being the same tokeniser used by most major model providers.

`max_field_tokens` from the project manifest is enforced per field, not per block. A block with three fields each at `512` tokens produces up to `1536` tokens of field content before meta fields are added.

---

## Agent Consumption Pattern

The intended agent consumption pattern for this package:

```
1. Fetch manifest.json
   → Check package_version and ttl
   → Check license.type for usage rights
   → Check signed for trust level

2. Fetch index.json
   → Scan all summary blocks
   → Filter by archetype, subtype, or field values
   → Identify content_ids relevant to the query

3. Fetch full/{content_id}.json for each relevant block
   → Read full fields
   → Check missing_fields and truncated_fields
   → Use relations map to interpret dependent fields

4. If a field is truncated and full value is needed
   → Query live fallback endpoint (see fallback.md)

5. For live-tier data
   → Read live-endpoints.json
   → Query declared endpoints directly
   → Parse response using declared response_format
```

This pattern minimises unnecessary data transfer. An agent answering a simple query may only need steps 1 and 2.

---

*Document version: 1.0 | Owner: KOra specification | Next: fallback.md*