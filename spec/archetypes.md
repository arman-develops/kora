# KOra Archetype Schemas
> Spec version: 1.0 | Status: Canonical | Part of Group A — Specification

---

## Overview

KOra uses five **Content Archetypes** — the fundamental shapes that human knowledge takes regardless of domain. Every content block declares exactly one archetype. The archetype tells agents how to read and process the content. It never describes the domain or topic.

Archetypes live exclusively at the **content block level** — declared via `kora-archetype` attributes in HTML or as props on framework wrapper components. A manifest-level archetype does not exist.

Each archetype defines:
- **Core fields** — KOra-controlled. Same name and type across every implementation. Agents rely on these.
- **Extended fields** — Common extensions that make sense for this archetype. Developer-declared. Never used for structural decisions by KOra.
- **Meta block** — CLI-generated fields present in every content block regardless of archetype.

### Field Status Levels

| Status | Meaning | CLI Behaviour | Agent Expectation |
|--------|---------|---------------|-------------------|
| `required` | Must be present and non-empty | Hard error if missing | Always present |
| `expected` | Should be present | Warning if missing. Output flags `"missing": true` | Present in well-formed content. May be absent. |
| `optional` | May or may not be present | Silent if absent | Never assume presence |

### Shared Meta Block

Every content block carries this meta block regardless of archetype. All fields are CLI-generated — never declared by the developer.

```json
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
```

| Field | Type | Description |
|-------|------|-------------|
| `content_id` | string | Stable unique identifier. Hash of `source_url` + `archetype`. Consistent across builds for the same content. |
| `archetype` | string | One of the five archetypes. CLI-validated. |
| `subtype` | string \| null | Developer-declared domain context. Optional. Informational only. snake_case enforced. |
| `inferred` | boolean | `true` if archetype was inferred by the CLI inference pipeline. `false` if developer-declared. |
| `confidence` | string | `high` — developer-marked. `medium` — inferred with strong signals. `low` — inferred with weak signals. |
| `language` | string | BCP 47 language tag. Inherited from manifest. Per-block override is defined but post-MVP. |
| `source_url` | string | Public URL this block was extracted from. Always `public_url`-based. `base_url` never appears here. |
| `token_count` | integer | Total tokens in the full payload. Counted using tiktoken `cl100k_base`. |
| `kora_version` | string | Spec version from the manifest. |
| `package_version` | string | semver-timestamp of the package this block belongs to. |
| `ttl` | integer | Seconds. How long agents should trust this payload before re-fetching. |
| `extracted_at` | string | ISO 8601 timestamp of CLI extraction time. |

---

## Archetype 1 — Narrative

### Description
Content with a beginning, argument, and conclusion. The defining characteristic is that the content has intentional **flow** — it is meant to be read sequentially.

### Covers
News articles, blog posts, essays, whitepapers, research papers, opinion pieces, case studies, announcements.

### Core Fields

| Field | Status | Type | Description |
|-------|--------|------|-------------|
| `title` | required | string | The primary heading of the content. |
| `body` | required | string | The full narrative content. Subject to `max_field_tokens`. |
| `author` | expected | string | Name of the author or authors. |
| `published_at` | expected | string | ISO 8601 publication date. |
| `summary` | expected | string | A short summary or abstract. Developer-declared or CLI-inferred from the opening paragraph. |
| `updated_at` | optional | string | ISO 8601 date of last meaningful edit. |
| `tags` | optional | array of strings | Developer-declared topic tags. |
| `reading_time` | optional | integer | Estimated reading time in minutes. CLI-calculated from token count if not declared. |

### Extended Fields
These are not defined by KOra but are common extensions developers declare via `kora-field`. Agents should handle them gracefully if present.

| Field | Type | Example subtypes |
|-------|------|-----------------|
| `series` | string | Multi-part blog posts, research series |
| `part` | integer | Position within a series |
| `category` | string | Editorial category |
| `citations` | array of strings | Academic papers, whitepapers |
| `co_authors` | array of strings | Research papers, collaborative pieces |

### Structure Field
The CLI extracts the heading hierarchy (`h1 > h2 > h3`) as a `structure` array. This gives agents a navigable outline without reading the full body.

```json
"structure": ["Introduction", "The Problem With Scraping", "What KOra Changes", "Conclusion"]
```

### Example Output (Summary Payload)
```json
{
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
    { "title": "How Agents Query the Web", "url": "/blog/agent-queries" }
  ],
  "meta": { "...": "see meta block above" }
}
```

---

## Archetype 2 — Reference

### Description
Structured facts intended to be **looked up**, not read sequentially. The defining characteristic is that any section is independently meaningful — an agent can jump directly to the relevant part without reading the whole.

### Covers
API documentation, technical specifications, FAQs, legal texts, academic reference material, glossaries, changelogs.

### Core Fields

| Field | Status | Type | Description |
|-------|--------|------|-------------|
| `title` | required | string | The name of this reference document or section. |
| `body` | required | string | The reference content. Subject to `max_field_tokens`. |
| `version` | expected | string | Version of the thing being documented. Not the KOra package version. |
| `last_updated` | expected | string | ISO 8601 date of last update. |
| `summary` | expected | string | One or two sentences describing what this reference covers. |
| `section` | optional | string | The section or chapter this block belongs to within a larger reference. |
| `tags` | optional | array of strings | Topic or category tags. |

### Extended Fields

| Field | Type | Example subtypes |
|-------|------|-----------------|
| `parameters` | array of objects | API docs |
| `returns` | string | API docs |
| `examples` | array of strings | Code examples in specs |
| `deprecated` | boolean | API docs, changelogs |
| `since` | string | Version when this was introduced |
| `jurisdiction` | string | Legal texts |

### Structure Field
For reference content, the `structure` field maps section hierarchy. This is especially valuable — agents can locate the relevant section without fetching the full body.

```json
"structure": ["Authentication", "Endpoints", "Rate Limits", "Error Codes"]
```

### Example Output (Summary Payload)
```json
{
  "fields": {
    "title": "Rate Limits",
    "version": "2.1",
    "last_updated": "2026-01-10T00:00:00Z",
    "summary": "Describes request limits per API tier and how to handle 429 responses.",
    "section": "Endpoints"
  },
  "structure": ["Overview", "Limits by Tier", "Handling 429", "Retry Strategy"],
  "meta": { "...": "see meta block above" }
}
```

---

## Archetype 3 — Catalogue

### Description
A collection of **repeating items** that share a consistent attribute structure. The defining characteristic is uniformity — every item in a catalogue has the same shape.

### Covers
Product listings, portfolios, job boards, directories, event listings, recipe collections, app stores.

### Core Fields

These fields describe the **catalogue container** — the collection itself.

| Field | Status | Type | Description |
|-------|--------|------|-------------|
| `title` | required | string | Name of the catalogue or collection. |
| `items` | required | array of objects | The catalogue items. Each item is a consistent object. See item schema below. |
| `total_count` | expected | integer | Total number of items. May differ from items in payload if truncated. |
| `summary` | optional | string | Description of what this catalogue contains. |
| `filters` | optional | array of strings | Available filter dimensions (e.g. `["category", "price_range", "location"]`). Informational for agents. |

### Item Schema
Each object in `items` should have consistent fields. KOra defines the minimum expected item fields:

| Field | Status | Type | Description |
|-------|--------|------|-------------|
| `item_id` | expected | string | Stable identifier for this item. |
| `name` | required | string | The item's name or title. |
| `description` | expected | string | Short description. Subject to `max_field_tokens`. |
| `url` | expected | string | Canonical URL for this item. |
| `image_url` | optional | string | Primary image URL. |
| `attributes` | optional | object | Domain-specific key-value pairs. Free-form. Agents treat this as informational. |

### Extended Fields (container level)

| Field | Type | Example subtypes |
|-------|------|-----------------|
| `category` | string | Product catalogues, directories |
| `currency` | string | E-commerce (ISO 4217 code) |
| `location` | string | Local business directories, event listings |

### Example Output (Summary Payload)
```json
{
  "fields": {
    "title": "Developer Tools",
    "total_count": 48,
    "summary": "A curated directory of tools for AI application developers.",
    "filters": ["category", "pricing", "language"],
    "items": [
      {
        "item_id": "tool_001",
        "name": "KOra SDK",
        "description": "Agent-optimised content packaging for any web project.",
        "url": "https://acme.com/tools/kora",
        "attributes": {
          "pricing": "open_source",
          "language": "TypeScript"
        }
      }
    ]
  },
  "meta": { "...": "see meta block above" }
}
```

---

## Archetype 4 — Dialogue

### Description
An **exchange between two or more participants**. The defining characteristic is turn-taking — the content only makes sense as a sequence of attributed contributions.

### Covers
Forum threads, Q&A pages, interviews, support transcripts, comment sections, chat logs.

### Core Fields

| Field | Status | Type | Description |
|-------|--------|------|-------------|
| `title` | required | string | The question, thread title, or interview subject. |
| `turns` | required | array of objects | The ordered sequence of contributions. See turn schema below. |
| `participant_count` | expected | integer | Number of distinct participants. |
| `summary` | expected | string | What this dialogue is about and what was resolved or concluded. |
| `opened_at` | expected | string | ISO 8601 timestamp of the first contribution. |
| `closed_at` | optional | string | ISO 8601 timestamp of the last contribution or when the thread was closed. |
| `tags` | optional | array of strings | Topic tags. |
| `resolved` | optional | boolean | Whether the dialogue reached a resolution. Useful for support threads, Q&A. |

### Turn Schema
Each object in `turns`:

| Field | Status | Type | Description |
|-------|--------|------|-------------|
| `turn_id` | required | string | Stable identifier for this turn. |
| `participant` | expected | string | Name or identifier of the contributor. |
| `role` | optional | string | `question`, `answer`, `comment`, `moderator`. Informational. |
| `body` | required | string | The content of this contribution. Subject to `max_field_tokens`. |
| `posted_at` | expected | string | ISO 8601 timestamp. |
| `upvotes` | optional | integer | Community signal. Useful for Q&A and forums. |

### Example Output (Summary Payload)
```json
{
  "fields": {
    "title": "How do I handle token limits in KOra output fields?",
    "participant_count": 3,
    "summary": "Developer asks about token truncation. Resolved with an explanation of the truncated flag and the full field request pattern.",
    "opened_at": "2026-01-10T09:00:00Z",
    "resolved": true,
    "tags": ["kora", "tokens", "output"],
    "turns": [
      {
        "turn_id": "t_001",
        "participant": "dev_user",
        "role": "question",
        "body": "What happens when a field exceeds max_field_tokens?",
        "posted_at": "2026-01-10T09:00:00Z",
        "upvotes": 12
      },
      {
        "turn_id": "t_002",
        "participant": "kora_team",
        "role": "answer",
        "body": "The field is truncated and flagged with truncated: true. You can request the full field separately.",
        "posted_at": "2026-01-10T09:15:00Z",
        "upvotes": 34
      }
    ]
  },
  "meta": { "...": "see meta block above" }
}
```

---

## Archetype 5 — Signal

### Description
**Time-stamped data points** intended to represent current state. The defining characteristic is recency — the value of a signal degrades as time passes. Signals are almost always `live` or `fast` tier content.

### Covers
Prices, scores, metrics, alerts, inventory levels, weather readings, exchange rates, sensor data, status pages.

### Core Fields

| Field | Status | Type | Description |
|-------|--------|------|-------------|
| `label` | required | string | What this signal measures. Human-readable. |
| `value` | required | string \| number \| boolean | The current value. String to accommodate formatted values like `"$142.50"`. |
| `unit` | expected | string | Unit of measurement. e.g. `USD`, `km/h`, `°C`, `%`. |
| `recorded_at` | required | string | ISO 8601 timestamp of when this value was recorded. Not when it was extracted. |
| `source` | expected | string | Where this signal originates. e.g. `"NYSE"`, `"OpenWeatherMap"`. |
| `status` | optional | string | Operational context. e.g. `"normal"`, `"warning"`, `"critical"`. Useful for status pages and alerts. |
| `previous_value` | optional | string \| number | The prior reading. Allows agents to detect direction of change. |
| `change` | optional | number | Delta between `previous_value` and `value`. |
| `change_percent` | optional | number | Percentage change. |

### Important Notes on Signal

- Signal content is **never cached in the output package** when declared as `live` tier. The manifest declares a passthrough endpoint. Agents query it directly.
- When declared as `fast` tier, the package snapshot carries a short TTL. Agents must check `extracted_at` and `ttl` before trusting the value.
- `recorded_at` is distinct from `extracted_at` in the meta block. A price recorded at market close and extracted an hour later has different values for each.

### Example Output (Summary Payload)
```json
{
  "fields": {
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
    "content_id": "b7d2a1f4",
    "archetype": "signal",
    "subtype": "stock_price",
    "inferred": false,
    "confidence": "high",
    "ttl": 60,
    "extracted_at": "2026-01-15T16:05:00Z"
  }
}
```

---

## Cross-Archetype Rules

These rules apply to all five archetypes without exception.

1. **One archetype per content block.** A block cannot declare two archetypes. If content genuinely spans two shapes, split it into two blocks.
2. **Expected fields absent from output carry `"missing": true`.** Never omit them silently. The agent must know whether a field was absent from the source or failed to extract.
3. **Empty strings are treated as missing.** A field with `""` is the same as a field that was not found.
4. **Fields exceeding `max_field_tokens` are truncated** and carry `"truncated": true`. The agent may request the full field via the live fallback endpoint.
5. **Extended fields never override core fields.** If a developer declares a custom field with the same name as a core field, the core field definition wins.
6. **`subtype` is informational only.** No archetype behaviour changes based on `subtype`. It is purely context for the agent.

---

*Document version: 1.0 | Owner: KOra specification | Next: attributes.md*