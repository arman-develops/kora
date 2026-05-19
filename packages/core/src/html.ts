/**
 * @kora/core — parser/html.ts
 *
 * Parses an HTML string and extracts all kora-* marked content blocks.
 *
 * Responsibilities:
 *   1. Find all kora-archetype containers in the document
 *   2. For each container, extract scoped kora-field elements
 *   3. Apply element-specific attribute extraction rules
 *   4. Collect kora-item / kora-turn children into typed scopes
 *   5. Promote nested kora-archetype blocks to nestedBlocks
 *   6. Record all diagnostics without throwing
 *
 * This module produces RawBlock intermediates only.
 * It does not produce KOra output payloads — that is the builder's job.
 */

import * as cheerio from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import type {Archetype, 
    Confidence, 
    SpecialElement,
    Diagnostic,
    DiagnosticCode,
    ExtractionResult,
    RawBlock,
    RawField,
    RawItem,
    RawTurn
} from "@kora/types"

import {
  isArchetype,
  isConfidence,
  isSpecialElement,
} from "@kora/types";

const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const AUTO_STRIP_SELECTORS = [
  "nav",
  "footer",
  "header:not([kora-archetype] header)",
] as const;

//helpers

function isSnakeCase(value: string): boolean {
    return SNAKE_CASE_RE.test(value)
}

function makeDiagnostic(
    severity: "error" | "warning",
    code: DiagnosticCode,
    message: string,
    context?: string
): Diagnostic {
    return {
        severity,
        code,
        message,
        ...(context !== undefined ? {context} : {})
    }
}

function elementKind(tag: string): SpecialElement | "other" {
  const lower = tag.toLowerCase();
  return isSpecialElement(lower) ? lower : "other";
}

/**
 * Extract the meaningful value from an element, applying the spec's
 * element-specific attribute extraction rules.
 *
 * Returns { value, anchorHref? } because <a> needs the href stored
 * separately — the builder writes it as `{fieldName}_url`.
 */
function extractElementValue(
  $el: cheerio.Cheerio<Element>,
  tag: string,
): { value: string; anchorHref?: string } {
  const kind = elementKind(tag);
 
  switch (kind) {
    case "time": {
      // Per spec: datetime attribute is used as the field value.
      // Text content is the human-readable label — not stored separately,
      // agents use the datetime value for any temporal logic.
      const datetime = $el.attr("datetime") ?? "";
      return { value: datetime.trim() };
    }
 
    case "a": {
      // Per spec: href stored as {field}_url, text content is the value.
      const href = $el.attr("href") ?? "";
      const text = $el.text().trim();
      return { value: text, anchorHref: href.trim() };
    }
 
    case "img": {
      // Per spec: src is used as the field value, alt as text.
      // We store src as value — alt is informational, not the primary value.
      const src = $el.attr("src") ?? "";
      return { value: src.trim() };
    }
 
    case "meta": {
      // Per spec: content attribute is used as the field value.
      const content = $el.attr("content") ?? "";
      return { value: content.trim() };
    }
 
    default: {
      return { value: $el.text().trim() };
    }
  }
}

/**
 * Collect direct child elements of a kora-list container as an array.
 * Text nodes and whitespace are ignored per spec.
 */
function extractListValues(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
): string[] {
  const values: string[] = [];
  $el.children().each((_, child) => {
    if (child.type === "tag") {
      values.push($(child).text().trim());
    }
  });
  return values.filter((v) => v.length > 0);
}

// Field Extraction
/**
 * Extracts all kora-field elements from within a container, respecting scope
 * boundaries:
 *   - Stops at nested kora-archetype elements (those become nestedBlocks)
 *   - Stops at kora-item / kora-turn elements (those have their own extractors)
 *   - Respects kora-exclude
 *
 * Returns extracted fields and any diagnostics encountered.
 */
function extractFields(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<Element>,
  archetype: Archetype,
  stopSelectors: string[],
): { fields: RawField[]; diagnostics: Diagnostic[] } {
  const fields: RawField[] = [];
  const diagnostics: Diagnostic[] = [];
  const seenFieldNames = new Set<string>();
 
  // Build the stop selector — we don't descend into these
  const stopSelector = stopSelectors.join(", ");
 
  // Walk all descendants. Cheerio's find() is depth-first.
  // We manually gate descent using the stop selectors.
  const visited = new Set<Element>();
 
  function walk(el: Element): void {
    if (visited.has(el)) return;
    visited.add(el);
 
    const $el = $(el);
 
    // Never descend into excluded elements
    if ($el.attr("kora-exclude") !== undefined) return;
 
    // Stop at boundary elements — they're handled separately
    if (stopSelectors.some((sel) => $el.is(sel))) return;
 
    const fieldName = $el.attr("kora-field");
 
    if (fieldName !== undefined) {
      // Validate snake_case
      if (!isSnakeCase(fieldName)) {
        diagnostics.push(
          makeDiagnostic(
            "warning",
            "FIELD_NOT_SNAKE_CASE",
            `kora-field value "${fieldName}" is not snake_case. Field will still be extracted.`,
            `[kora-field="${fieldName}"]`,
          ),
        );
      }
 
      // Duplicate field check — first occurrence wins per spec
      if (seenFieldNames.has(fieldName)) {
        diagnostics.push(
          makeDiagnostic(
            "warning",
            "DUPLICATE_FIELD",
            `kora-field "${fieldName}" appears more than once in this block. First occurrence used.`,
            `[kora-field="${fieldName}"]`,
          ),
        );
        // Still walk children — there may be nested fields
      } else {
        seenFieldNames.add(fieldName);
 
        const tag = el.type === "tag" ? el.name.toLowerCase() : "div";
        const kind = elementKind(tag);
        const isList = $el.attr("kora-list") !== undefined;
 
        // kora-confidence
        const rawConfidence = $el.attr("kora-confidence");
        let confidence: Confidence | null = null;
        if (rawConfidence !== undefined) {
          if (isConfidence(rawConfidence)) {
            confidence = rawConfidence;
          } else {
            diagnostics.push(
              makeDiagnostic(
                "warning",
                "CONFIDENCE_UNKNOWN_VALUE",
                `kora-confidence value "${rawConfidence}" on field "${fieldName}" is not in the controlled vocabulary (high | medium | low).`,
                `[kora-field="${fieldName}"]`,
              ),
            );
          }
        }
 
        // kora-relation
        const relation = $el.attr("kora-relation") ?? null;
 
        // Extract value
        let value: string | string[];
        let anchorHref: string | undefined;
 
        if (isList) {
          value = extractListValues($, $el);
        } else {
          const extracted = extractElementValue($el, tag);
          value = extracted.value;
          anchorHref = extracted.anchorHref;
        }
 
        const field: RawField = {
          name: fieldName,
          value,
          elementTag: tag,
          elementKind: kind,
          confidence,
          relation,
          isList,
          ...(anchorHref !== undefined ? { anchorHref } : {}),
        };
 
        fields.push(field);
      }
    }
 
    // kora-list without kora-field on the same element
    if (
      $el.attr("kora-list") !== undefined &&
      fieldName === undefined
    ) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "LIST_WITHOUT_FIELD",
          "kora-list is present without kora-field on the same element. Ignored.",
          el.type === "tag" ? `<${el.name}>` : "element",
        ),
      );
    }
 
    // kora-confidence on a non-field element
    if (
      $el.attr("kora-confidence") !== undefined &&
      fieldName === undefined
    ) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "CONFIDENCE_NOT_ON_FIELD",
          "kora-confidence is present on an element without kora-field. Ignored.",
          el.type === "tag" ? `<${el.name}>` : "element",
        ),
      );
    }
 
    // Walk children
    if (el.type === "tag") {
      for (const child of el.children) {
        if (child.type === "tag") {
          walk(child);
        }
      }
    }
  }
 
  // Start walk from direct children of the container.
  // But first, check the container element itself for misplaced kora-confidence
  // and kora-list — the walk only visits children, not the container.
  const containerEl = $container.get(0);
  if (containerEl?.type === "tag") {
    const $containerEl = $($container.get(0)!);
    if (
      $containerEl.attr("kora-confidence") !== undefined &&
      $containerEl.attr("kora-field") === undefined
    ) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "CONFIDENCE_NOT_ON_FIELD",
          `kora-confidence is present on the archetype container element without kora-field. Ignored.`,
          `[kora-archetype]`,
        ),
      );
    }
    if (
      $containerEl.attr("kora-list") !== undefined &&
      $containerEl.attr("kora-field") === undefined
    ) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "LIST_WITHOUT_FIELD",
          "kora-list is present on the archetype container without kora-field. Ignored.",
          `[kora-archetype]`,
        ),
      );
    }
 
    for (const child of containerEl.children) {
      if (child.type === "tag") {
        walk(child);
      }
    }
  }
 
  return { fields, diagnostics };
}

// Relation validation
/**
 * After all fields are extracted, validate that kora-relation targets exist.
 * This is a post-pass because relations can reference fields declared
 * later in the DOM.
 */
function validateRelations(
  fields: RawField[],
  diagnostics: Diagnostic[],
): void {
  const fieldNames = new Set(fields.map((f) => f.name));
  for (const field of fields) {
    if (field.relation !== null && !fieldNames.has(field.relation)) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "RELATION_UNRESOLVED",
          `kora-relation on field "${field.name}" references "${field.relation}" which does not exist in this block.`,
          `[kora-field="${field.name}"]`,
        ),
      );
    }
  }
}

// Scope extractors — items (catalogue) and turns (dialogue)
/**
 * Extract all kora-item elements within a catalogue container.
 * Each item is its own field scope.
 */
function extractItems(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<Element>,
  sourceUrl: string,
): { items: RawItem[]; diagnostics: Diagnostic[] } {
  const items: RawItem[] = [];
  const diagnostics: Diagnostic[] = [];
 
  $container.find("[kora-item]").each((_, el) => {
    // Ensure this kora-item is a direct child of this catalogue — not nested
    // inside another archetype block within the container.
    const $el = $(el);
    const closestArchetype = $el
      .parentsUntil($container)
      .filter("[kora-archetype]");
    if (closestArchetype.length > 0) {
      // This kora-item belongs to a nested archetype, not our container
      return;
    }
 
    const { fields: itemFields, diagnostics: itemDiags } = extractFields(
      $,
      $el,
      "catalogue",
      ["[kora-archetype]", "[kora-item]", "[kora-turn]"],
    );
 
    validateRelations(itemFields, itemDiags);
 
    const nestedBlocks = extractNestedBlocks($, $el, sourceUrl);
 
    items.push({
      fields: itemFields,
      nestedBlocks,
      diagnostics: itemDiags,
    });
  });
 
  return { items, diagnostics };
}

/**
 * Extract all kora-turn elements within a dialogue container.
 */
function extractTurns(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<Element>,
  sourceUrl: string,
): { turns: RawTurn[]; diagnostics: Diagnostic[] } {
  const turns: RawTurn[] = [];
  const diagnostics: Diagnostic[] = [];
 
  $container.find("[kora-turn]").each((_, el) => {
    const $el = $(el);
    const closestArchetype = $el
      .parentsUntil($container)
      .filter("[kora-archetype]");
    if (closestArchetype.length > 0) return;
 
    const { fields: turnFields, diagnostics: turnDiags } = extractFields(
      $,
      $el,
      "dialogue",
      ["[kora-archetype]", "[kora-item]", "[kora-turn]"],
    );
 
    validateRelations(turnFields, turnDiags);
 
    const nestedBlocks = extractNestedBlocks($, $el, sourceUrl);
 
    turns.push({
      fields: turnFields,
      nestedBlocks,
      diagnostics: turnDiags,
    });
  });
 
  return { turns, diagnostics };
}

// Nested block extraction
/**
 * Find and extract all kora-archetype elements that are direct descendants
 * of `$scope` (not further nested inside another archetype within $scope).
 *
 * These become the nestedBlocks of the parent RawBlock.
 */
function extractNestedBlocks(
  $: cheerio.CheerioAPI,
  $scope: cheerio.Cheerio<Element>,
  sourceUrl: string,
): RawBlock[] {
  const blocks: RawBlock[] = [];
 
  $scope.find("[kora-archetype]").each((_, el) => {
    // Only take direct nested archetypes — not those further nested inside
    // another archetype that is itself nested here.
    const $el = $(el);
    const closestAncestorArchetype = $el
      .parentsUntil($scope)
      .filter("[kora-archetype]");
    if (closestAncestorArchetype.length > 0) return;
 
    const block = extractBlock($, $el, sourceUrl);
    if (block !== null) blocks.push(block);
  });
 
  return blocks;
}

// Block extraction — the core unit
/**
 * Extract a single RawBlock from a kora-archetype container element.
 *
 * Returns null only if the archetype value is invalid (hard error) and we
 * cannot proceed. The diagnostic is returned in the block's diagnostics
 * array in all other cases.
 */
function extractBlock(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<Element>,
  sourceUrl: string,
): RawBlock | null {
  const diagnostics: Diagnostic[] = [];
 
  // --- Archetype ---
  const rawArchetype = $container.attr("kora-archetype") ?? "";
 
  if (!isArchetype(rawArchetype)) {
    // Hard error — we cannot process a block with an unknown archetype
    diagnostics.push(
      makeDiagnostic(
        "error",
        "UNKNOWN_ARCHETYPE",
        `kora-archetype value "${rawArchetype}" is not in the controlled vocabulary ` +
          `(narrative | reference | catalogue | dialogue | signal).`,
        `[kora-archetype="${rawArchetype}"]`,
      ),
    );
    // Return a shell block so the CLI can report the error with context
    return {
      archetype: "narrative", // placeholder — block is invalid
      subtype: null,
      inferred: false,
      sourceUrl,
      fields: [],
      items: [],
      turns: [],
      nestedBlocks: [],
      diagnostics,
    };
  }
 
  const archetype: Archetype = rawArchetype;
 
  // --- Subtype ---
  const rawSubtype = $container.attr("kora-subtype") ?? null;
  let subtype: string | null = null;
 
  if (rawSubtype !== null) {
    if (!isSnakeCase(rawSubtype)) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "SUBTYPE_NOT_SNAKE_CASE",
          `kora-subtype value "${rawSubtype}" is not snake_case.`,
          `[kora-subtype="${rawSubtype}"]`,
        ),
      );
    }
    subtype = rawSubtype;
  }
 
  // --- kora-item / kora-turn misuse validation ---
  // Catalogue: kora-turn inside it is an error
  // Dialogue: kora-item inside it is an error
  // Other archetypes: both are errors
  if (archetype !== "catalogue") {
    const itemCount = $container.find("[kora-item]").length;
    if (itemCount > 0) {
      diagnostics.push(
        makeDiagnostic(
          "error",
          "ITEM_OUTSIDE_CATALOGUE",
          `kora-item found inside a "${archetype}" block. kora-item is only valid inside catalogue blocks.`,
        ),
      );
    }
  }
 
  if (archetype !== "dialogue") {
    const turnCount = $container.find("[kora-turn]").length;
    if (turnCount > 0) {
      diagnostics.push(
        makeDiagnostic(
          "error",
          "TURN_OUTSIDE_DIALOGUE",
          `kora-turn found inside a "${archetype}" block. kora-turn is only valid inside dialogue blocks.`,
        ),
      );
    }
  }
 
  // --- Stop selectors for field extraction ---
  // We do not descend into nested archetypes, items, or turns when
  // extracting container-level fields.
  const stopSelectors = ["[kora-archetype]", "[kora-item]", "[kora-turn]"];
 
  // --- Container-level fields ---
  const { fields, diagnostics: fieldDiags } = extractFields(
    $,
    $container,
    archetype,
    stopSelectors,
  );
  diagnostics.push(...fieldDiags);
 
  validateRelations(fields, diagnostics);
 
  // --- Items (catalogue only) ---
  let items: RawItem[] = [];
  if (archetype === "catalogue") {
    const { items: extracted, diagnostics: itemDiags } = extractItems(
      $,
      $container,
      sourceUrl,
    );
    items = extracted;
    diagnostics.push(...itemDiags);
  }
 
  // --- Turns (dialogue only) ---
  let turns: RawTurn[] = [];
  if (archetype === "dialogue") {
    const { turns: extracted, diagnostics: turnDiags } = extractTurns(
      $,
      $container,
      sourceUrl,
    );
    turns = extracted;
    diagnostics.push(...turnDiags);
  }
 
  // --- Nested blocks ---
  // Find kora-archetype elements inside this container that are NOT
  // kora-item or kora-turn scopes — those are already handled above.
  const nestedBlocks = extractNestedBlocks($, $container, sourceUrl);
 
  return {
    archetype,
    subtype,
    inferred: false,
    sourceUrl,
    fields,
    items,
    turns,
    nestedBlocks,
    diagnostics,
  };
}

// Orphan detection — kora-* attributes outside any archetype container
/**
 * Detect kora-field and kora-subtype elements that have no ancestor
 * kora-archetype container. These are warned about at the document level.
 */
function detectOrphans(
  $: cheerio.CheerioAPI,
  diagnostics: Diagnostic[],
): void {
  $("[kora-field]").each((_, el) => {
    const $el = $(el);
    if ($el.closest("[kora-archetype]").length === 0) {
      const fieldName = $el.attr("kora-field") ?? "";
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "FIELD_OUTSIDE_CONTAINER",
          `kora-field "${fieldName}" has no ancestor kora-archetype container. Ignored.`,
          `[kora-field="${fieldName}"]`,
        ),
      );
    }
  });
 
  $("[kora-subtype]").each((_, el) => {
    const $el = $(el);
    // kora-subtype is valid only when on the same element as kora-archetype
    if ($el.attr("kora-archetype") === undefined) {
      const subtype = $el.attr("kora-subtype") ?? "";
      diagnostics.push(
        makeDiagnostic(
          "warning",
          "SUBTYPE_WITHOUT_ARCHETYPE",
          `kora-subtype "${subtype}" is present on an element without kora-archetype. Ignored.`,
          `[kora-subtype="${subtype}"]`,
        ),
      );
    }
  });
}

export interface ParseOptions {
  /** Absolute public URL of the page being parsed. Written to sourceUrl. */
  sourceUrl: string;
}
 
/**
 * Parse an HTML string and extract all kora-* marked content blocks.
 *
 * Uses the Cheerio async API (fromDocument / load from cheerio).
 * Returns a fully populated ExtractionResult — never throws.
 */
export async function parseHtml(
  html: string,
  options: ParseOptions,
): Promise<ParseOutput> {
  const { sourceUrl } = options;
  const documentDiagnostics: Diagnostic[] = [];
 
  const $ = cheerio.load(html);
 
  // Strip auto-excluded elements before any traversal.
  // These are never meaningful content per spec.
  for (const selector of AUTO_STRIP_SELECTORS) {
    $(selector).remove();
  }
 
  // Find all top-level kora-archetype containers.
  // "Top-level" means: no ancestor is also a kora-archetype.
  // Nested ones are handled recursively via extractNestedBlocks.
  const blocks: RawBlock[] = [];
 
  $("[kora-archetype]").each((_, el) => {
    const $el = $(el);
 
    // Skip if this element is inside another kora-archetype container —
    // it will be picked up as a nestedBlock of its parent.
    // Use parents() not closest() — parents() excludes the element itself.
    if ($el.parents("[kora-archetype]").length > 0) return;
 
    const block = extractBlock($, $el, sourceUrl);
    if (block !== null) blocks.push(block);
  });
 
  // Warn about orphaned kora-* attributes
  detectOrphans($, documentDiagnostics);
 
  return {
    result: {
      sourceUrl,
      blocks,
      documentDiagnostics,
    },
    $,
  };
}

/**
 * Output of parseHtml.
 *
 * Returns both the structured extraction result and the live Cheerio instance
 * so downstream pipeline stages (inference, crawler) can operate on the same
 * parsed DOM without re-parsing the HTML string.
 *
 * The CheerioAPI instance reflects the auto-stripped document — nav, footer,
 * and header elements outside kora-archetype containers have already been
 * removed. Inference operates on this cleaned DOM.
 */
export interface ParseOutput {
  result: ExtractionResult;
  $: cheerio.CheerioAPI;
}
