/**
 * @kora/types — parser.ts
 *
 * Intermediate types produced by the HTML parser.
 * These are NOT output payloads — they are the raw extraction layer
 * that the builder in @kora/core consumes and shapes into KOra packages.
 *
 * The parser never throws on recoverable problems. All issues are
 * collected as Diagnostics on the containing block.
 */

import { Archetype, Confidence, SpecialElement } from "./archetypes";

// diagnostics

/**
 * Every validation problem the parser encounters — warnings and hard errors
 * alike — is recorded as a Diagnostic. The CLI decides what to surface.
 *
 * Hard errors mean the block is excluded from output.
 * Warnings mean the block proceeds with degraded data.
 */

export type DiagnosticSeverity = "error" | "warning";

export const DIAGNOSTIC_CODES = [
  // Hard errors
  "UNKNOWN_ARCHETYPE",         // kora-archetype value not in controlled vocab
  "ITEM_OUTSIDE_CATALOGUE",    // kora-item used outside a catalogue block
  "TURN_OUTSIDE_DIALOGUE",     // kora-turn used outside a dialogue block
 
  // Warnings
  "FIELD_OUTSIDE_CONTAINER",   // kora-field with no ancestor kora-archetype
  "SUBTYPE_WITHOUT_ARCHETYPE", // kora-subtype on element with no kora-archetype
  "SUBTYPE_NOT_SNAKE_CASE",    // kora-subtype value fails snake_case check
  "FIELD_NOT_SNAKE_CASE",      // kora-field value fails snake_case check
  "LIST_WITHOUT_FIELD",        // kora-list without kora-field on same element
  "CONFIDENCE_NOT_ON_FIELD",   // kora-confidence on a container, not a field
  "CONFIDENCE_UNKNOWN_VALUE",  // kora-confidence value not in controlled vocab
  "RELATION_UNRESOLVED",       // kora-relation references a field not in block
  "DUPLICATE_FIELD",           // same kora-field name appears twice in a block
  "EXPECTED_FIELD_MISSING",    // an expected core field is absent
  "EXTENDED_FIELD",            // field name not in archetype core (informational)
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number]

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  /** CSS selector or attribute context — helps CLI point at the right element */
  context?: string;
}

// Raw field

/**
 * A single extracted field from a kora-field element.
 *
 * `value` is always a resolved string or string array (for kora-list fields).
 * The parser applies element-specific extraction rules here:
 *   <time>    → datetime attribute value
 *   <a>       → href stored separately as `{name}_url`, text as value
 *   <img>     → src as value, alt as text
 *   <meta>    → content attribute as value
 */

export interface RawField {
    name: string
    value: string | string[]
    elementTag: string
    elementKind: SpecialElement | "other"

    anchorHref?: string
    confidence: Confidence | null
    relation: string | null
    isList: boolean
}

// Raw item (catalogue) and raw turn (dialogue)
 
/**
 * One item within a catalogue block.
 * Fields are scoped to this item — not promoted to the container.
 *
 * An item can itself contain nested kora-archetype blocks
 * (e.g. a product card that embeds a signal for live price).
 */
export interface RawItem {
  fields: RawField[];
  nestedBlocks: RawBlock[];
  diagnostics: Diagnostic[];
}
 
/**
 * One turn within a dialogue block.
 * Fields are scoped to this turn.
 */
export interface RawTurn {
  fields: RawField[];
  nestedBlocks: RawBlock[];
  diagnostics: Diagnostic[];
}

// Raw block - the core extraction unit

/**
 * Everything the parser extracted from one kora-archetype container.
 *
 * This type is recursive: nestedBlocks contains fully extracted RawBlocks
 * for any kora-archetype found inside this block that is not a kora-item
 * or kora-turn. Those are promoted to items/turns instead.
 *
 * Parsing rules:
 * - Fields are container-scoped. They exclude descendants of nested
 *   kora-archetype elements (those become nestedBlocks).
 * - items is only populated when archetype === 'catalogue'
 * - turns is only populated when archetype === 'dialogue'
 * - A block with severity: 'error' diagnostics is excluded from output
 *   by the CLI. The parser still produces it so errors can be reported.
 */

export interface RawBlock {
    archetype: Archetype
    subtype: string | null
    inferred: boolean
    sourceUrl: string
    fields: RawField[]
    items: RawItem[]
    turns: RawTurn
    nestedBlocks: RawBlock[]
    diagnostics: Diagnostic[]
}

// Extraction result
/**
 * The complete output of parsing one HTML document.
 *
 * `blocks` is a flat list of top-level RawBlocks found in the document.
 * Nested blocks are accessible via block.nestedBlocks recursively.
 *
 * `documentDiagnostics` carries issues that aren't attributable to a
 * specific block — e.g. a kora-field with no ancestor archetype container.
 */
export interface ExtractionResult {
  sourceUrl: string;
  blocks: RawBlock[];
  documentDiagnostics: Diagnostic[];
}