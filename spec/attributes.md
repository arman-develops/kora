# KOra Attribute API
> Spec version: 1.0 | Status: Canonical | Part of Group A — Specification

---

## Overview

The `kora-*` attribute system is how developers mark meaningful content in HTML. Attributes are added directly to HTML elements and read by the KOra CLI during `kora build`.

For component-based sites (React, Vue, Svelte), the same concepts are expressed as props on the `KoraBlock` and `KoraField` wrapper components. The attribute names and behaviours are identical — only the syntax differs.

### Three Rules That Govern Everything

1. **Attributes are additive.** They never change how the page renders. A `kora-field` attribute on a `<div>` does not affect its layout, styling, or behaviour in the browser.
2. **Explicit always wins over inferred.** If a developer marks a field, the CLI uses that. The inference pipeline only runs on unmarked content.
3. **The container defines context. The field defines meaning.** `kora-archetype` on a container tells the CLI what shape this content is. `kora-field` on a child element tells the CLI what that element means within that shape.

---

## Attribute Reference

### `kora-archetype`

**Placed on:** Container elements — the outermost element that wraps a complete content block.

**Value:** One of the five controlled archetype values.

| Value | Archetype |
|-------|-----------|
| `narrative` | Narrative |
| `reference` | Reference |
| `catalogue` | Catalogue |
| `dialogue` | Dialogue |
| `signal` | Signal |

**Behaviour:**
- Declares the archetype for all `kora-field` elements within this container.
- Required for the CLI to process a content block with `confidence: high`. Without it, the inference pipeline attempts to detect the archetype and marks the block `inferred: true`.
- One `kora-archetype` per content block. Nested `kora-archetype` declarations are treated as separate content blocks, each processed independently.

**Example:**
```html
<article kora-archetype="narrative">
  <!-- all kora-field elements here belong to this narrative block -->
</article>
```

**Validation:** CLI hard errors if value is not one of the five controlled values.

---

### `kora-subtype`

**Placed on:** The same element as `kora-archetype`.

**Value:** Developer-declared string. snake_case enforced.

**Behaviour:**
- Provides domain context for agents. Purely informational — never used for structural decisions.
- Optional. No CLI warning if absent.
- Must be on the same element as `kora-archetype`. A `kora-subtype` without a `kora-archetype` on the same element is ignored with a CLI warning.

**Example:**
```html
<article kora-archetype="narrative" kora-subtype="case_study">
```

**Validation:** CLI warns if `kora-subtype` is present without `kora-archetype` on the same element. CLI warns if value is not snake_case.

---

### `kora-field`

**Placed on:** Any element within a `kora-archetype` container.

**Value:** The field name this element represents. Must match a core field name for the declared archetype, or be a developer-declared extended field name. snake_case enforced.

**Behaviour:**
- The text content of the element is extracted as the field value.
- For elements with meaningful attributes (e.g. `<time datetime="...">`, `<a href="...">`), the CLI extracts both the text content and the relevant attribute. See attribute extraction rules below.
- A `kora-field` outside a `kora-archetype` container is ignored with a CLI warning.
- Duplicate `kora-field` values within the same container: CLI warns and uses the first occurrence.

**Attribute extraction rules by element:**

| Element | Text content extracted | Attribute also extracted |
|---------|----------------------|-------------------------|
| `<time>` | Human-readable label | `datetime` value — used as the field value |
| `<a>` | Link text | `href` — stored as `{field}_url` |
| `<img>` | `alt` text | `src` — used as the field value |
| `<meta>` | — | `content` attribute — used as the field value |

**Example:**
```html
<article kora-archetype="narrative" kora-subtype="blog_post">
  <h1 kora-field="title">The Future of AI Search</h1>
  <span kora-field="author">Jane Doe</span>
  <time kora-field="published_at" datetime="2026-01-15T00:00:00Z">Jan 15, 2026</time>
  <p kora-field="summary">A look at how agents are replacing direct browsing.</p>
  <div kora-field="body">Full article content here...</div>
</article>
```

**Validation:** CLI warns if value is not snake_case. CLI warns if field name is not a recognised core field for the declared archetype and marks it as an extended field in the output.

---

### `kora-list`

**Placed on:** A container element whose direct children each represent one value in a list field.

**Value:** None. Presence is the signal.

**Behaviour:**
- Must be used alongside `kora-field` on the same element.
- The CLI collects the text content of each direct child element as an array value.
- Non-element children (text nodes, whitespace) are ignored.
- Used for fields like `tags`, `co_authors`, `citations` where the value is an array of strings.

**Example:**
```html
<div kora-field="tags" kora-list>
  <span>AI</span>
  <span>Search</span>
  <span>Agents</span>
</div>
```

Produces: `"tags": ["AI", "Search", "Agents"]`

**Validation:** CLI warns if `kora-list` is present without `kora-field` on the same element.

---

### `kora-item`

**Placed on:** Repeating child elements within a `catalogue` archetype container.

**Value:** None. Presence is the signal.

**Behaviour:**
- Used exclusively within `kora-archetype="catalogue"` containers.
- Each element marked `kora-item` is treated as one catalogue item object.
- `kora-field` elements nested inside a `kora-item` element are scoped to that item — they are not extracted as container-level fields.
- Items are collected into the `items` array in the order they appear in the DOM.

**Example:**
```html
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
```

**Validation:** CLI hard errors if `kora-item` is used outside a `kora-archetype="catalogue"` container.

---

### `kora-turn`

**Placed on:** Repeating child elements within a `dialogue` archetype container.

**Value:** None. Presence is the signal.

**Behaviour:**
- Used exclusively within `kora-archetype="dialogue"` containers.
- Each element marked `kora-turn` is treated as one turn object.
- `kora-field` elements nested inside a `kora-turn` element are scoped to that turn.
- Turns are collected into the `turns` array in DOM order. DOM order is assumed to be chronological. If it is not, the developer should use `kora-field="posted_at"` on each turn so the CLI can sort correctly.
- The CLI assigns a stable `turn_id` to each turn based on its position and `posted_at` value.

**Example:**
```html
<section kora-archetype="dialogue" kora-subtype="support_thread">
  <h1 kora-field="title">How do I handle token limits?</h1>

  <div kora-turn>
    <span kora-field="participant">dev_user</span>
    <span kora-field="role">question</span>
    <p kora-field="body">What happens when a field exceeds max_field_tokens?</p>
    <time kora-field="posted_at" datetime="2026-01-10T09:00:00Z">Jan 10, 2026</time>
  </div>

  <div kora-turn>
    <span kora-field="participant">kora_team</span>
    <span kora-field="role">answer</span>
    <p kora-field="body">The field is truncated and flagged with truncated: true.</p>
    <time kora-field="posted_at" datetime="2026-01-10T09:15:00Z">Jan 10, 2026</time>
  </div>
</section>
```

**Validation:** CLI hard errors if `kora-turn` is used outside a `kora-archetype="dialogue"` container.

---

### `kora-exclude`

**Placed on:** Any element.

**Value:** None. Presence is the signal.

**Behaviour:**
- Explicitly excludes this element and all its descendants from extraction.
- Takes precedence over any `kora-field` or `kora-archetype` on the same element or within it.
- Used to suppress navigation, sidebars, cookie banners, ads, or any content within a marked container that should not be packaged.
- The CLI also strips the following automatically without requiring `kora-exclude`: `<nav>`, `<footer>`, `<header>` elements not inside a `kora-archetype` container, elements with common ad/cookie class patterns.

**Example:**
```html
<article kora-archetype="narrative">
  <h1 kora-field="title">The Future of AI Search</h1>
  <div kora-field="body">Article content here...</div>

  <aside kora-exclude>
    <!-- related articles widget, newsletter signup, ads -->
    <!-- none of this will be extracted -->
  </aside>
</article>
```

**Validation:** None. `kora-exclude` is always silently honoured.

---

### `kora-confidence`

**Placed on:** Any `kora-field` element.

**Value:** `high` | `medium` | `low`

**Behaviour:**
- Optional. Allows the developer to signal their own confidence in the reliability or accuracy of a field's content.
- When present, this value overrides the CLI's calculated confidence for that specific field only. The block-level confidence is unaffected.
- Use case: a developer marking a field that is auto-populated from an unreliable source, or a field where content quality varies.

**Example:**
```html
<span kora-field="author" kora-confidence="low">Unknown</span>
```

**Validation:** CLI warns if value is not one of the three controlled values.

---

### `kora-relation`

**Placed on:** Any `kora-field` element.

**Value:** The `kora-field` name of the field this element is related to.

**Behaviour:**
- Declares a semantic relationship between two fields within the same content block.
- Used when a field provides context for, or modifies, another field. For example, a `price` field and a `currency` field are related — the currency modifies how the price is interpreted.
- The CLI records this as a `relations` map in the output payload. Agents use it to understand which fields belong together.
- Does not affect extraction. Both fields are extracted independently. `kora-relation` only affects how they are represented in the output.

**Example:**
```html
<span kora-field="price">214.73</span>
<span kora-field="currency" kora-relation="price">USD</span>
```

Produces in output:
```json
"relations": {
  "currency": "price"
}
```

**Validation:** CLI warns if the referenced field name does not exist in the same content block.

---

## Framework Component API

For React, Vue, and Svelte, the same attribute system is expressed as component props. Behaviour is identical to the HTML attribute system.

### `KoraBlock`
Maps to a `kora-archetype` container.

| Prop | Type | Maps to |
|------|------|---------|
| `archetype` | string | `kora-archetype` |
| `subtype` | string | `kora-subtype` |
| `dynamic` | object | Dynamic source declaration for this block |

### `KoraField`
Maps to a `kora-field` element.

| Prop | Type | Maps to |
|------|------|---------|
| `field` | string | `kora-field` |
| `list` | boolean | `kora-list` |
| `exclude` | boolean | `kora-exclude` |
| `confidence` | string | `kora-confidence` |
| `relation` | string | `kora-relation` |

### `KoraItem`
Maps to `kora-item`. Used inside a `KoraBlock` with `archetype="catalogue"`.

### `KoraTurn`
Maps to `kora-turn`. Used inside a `KoraBlock` with `archetype="dialogue"`.

**React example — full catalogue block:**
```jsx
import { KoraBlock, KoraField, KoraItem } from '@kora/react'

export function ToolDirectory({ tools }) {
  return (
    <KoraBlock archetype="catalogue" subtype="tool_directory">
      <KoraField field="title"><h1>Developer Tools</h1></KoraField>

      {tools.map(tool => (
        <KoraItem key={tool.id}>
          <KoraField field="name"><h2>{tool.name}</h2></KoraField>
          <KoraField field="description"><p>{tool.description}</p></KoraField>
          <KoraField field="url"><a href={tool.url}>View Tool</a></KoraField>
        </KoraItem>
      ))}
    </KoraBlock>
  )
}
```

---

## Interaction Rules

These rules govern how attributes interact when combined.

| Situation | Behaviour |
|-----------|-----------|
| `kora-archetype` nested inside another `kora-archetype` | Treated as a separate content block. Inner block is extracted independently. |
| `kora-field` outside any `kora-archetype` container | Ignored. CLI emits warning. |
| `kora-subtype` without `kora-archetype` on same element | Ignored. CLI emits warning. |
| `kora-item` outside `catalogue` archetype | CLI hard error. |
| `kora-turn` outside `dialogue` archetype | CLI hard error. |
| `kora-list` without `kora-field` on same element | Ignored. CLI emits warning. |
| `kora-exclude` inside a `kora-field` element | The excluded element's content is omitted. The field is still extracted from remaining content. |
| `kora-confidence` on a container, not a field | Ignored. CLI emits warning. |
| `kora-relation` referencing a non-existent field | Recorded but flagged `unresolved: true` in output. CLI emits warning. |
| Duplicate `kora-field` name within same container | First occurrence used. CLI emits warning. |

---

## CLI Warning vs Error Reference

| Situation | Severity |
|-----------|----------|
| `kora-archetype` value not in controlled vocabulary | Hard error |
| `kora-item` outside `catalogue` container | Hard error |
| `kora-turn` outside `dialogue` container | Hard error |
| `kora-field` value not snake_case | Warning |
| `kora-field` outside archetype container | Warning |
| `kora-subtype` without `kora-archetype` on same element | Warning |
| `kora-subtype` value not snake_case | Warning |
| `kora-list` without `kora-field` on same element | Warning |
| `kora-confidence` not on a field element | Warning |
| `kora-confidence` value not in controlled vocabulary | Warning |
| `kora-relation` referencing non-existent field | Warning |
| Duplicate `kora-field` name in same container | Warning |
| Expected core field absent from marked block | Warning |

---

*Document version: 1.0 | Owner: KOra specification | Next: output.md*