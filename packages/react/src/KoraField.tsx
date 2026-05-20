/**
 * KoraField
 *
 * Injects kora-field (and optionally kora-list, kora-confidence,
 * kora-relation, kora-exclude) onto the single child element by cloning it
 * with React.cloneElement.
 *
 * The child MUST be a single React element whose underlying DOM node can
 * accept arbitrary HTML attributes — i.e. a native DOM element (<h1>, <p>,
 * <div>, <time>, <a>, <img>, etc.) or a component that spreads ...props
 * onto its root DOM element.
 *
 * If the child is a custom component that does not forward props, the
 * kora-* attributes will be silently dropped from the SSR output and the
 * CLI parser will not find them. In development mode, a warning is emitted
 * when the child appears to be a non-DOM component, to help developers
 * catch this early.
 *
 * KoraField renders no element of its own — it is purely a prop injector.
 */

import React from "react";
import type { Confidence } from "@kora/types";
import { isConfidence } from "@kora/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KoraFieldProps {
  /**
   * The field name. Maps to kora-field on the child element.
   * snake_case enforced by the CLI validator at build time.
   */
  field: string;
  /**
   * Marks this field as a list. Maps to kora-list on the child element.
   * The CLI collects direct children of the element as an array.
   */
  list?: boolean;
  /**
   * Excludes this field from extraction. Maps to kora-exclude.
   * When true, the child element and all its descendants are ignored
   * by the CLI parser.
   */
  exclude?: boolean;
  /**
   * Developer-declared confidence in this field's content.
   * Maps to kora-confidence. Overrides CLI-calculated confidence
   * for this specific field only.
   */
  confidence?: Confidence;
  /**
   * Links this field to another by name. Maps to kora-relation.
   * Expresses that this field modifies or contextualises another field
   * (e.g. "currency" relates to "price").
   */
  relation?: string;
  /**
   * The single child element to inject attributes onto.
   * Must be a React element — not a string, number, or fragment.
   */
  children: React.ReactElement;
}

// ---------------------------------------------------------------------------
// Dev-mode child validation
// ---------------------------------------------------------------------------

/**
 * In development, warn when the child looks like a custom component
 * rather than a native DOM element. Custom components that do not spread
 * ...props will silently drop kora-* attributes in SSR output.
 *
 * We identify DOM elements by their `type` being a lowercase string.
 * Custom components have a function or class as `type`.
 */
function warnIfCustomComponent(
  child: React.ReactElement,
  field: string,
): void {
  if (process.env["NODE_ENV"] === "production") return;
  if (typeof child.type !== "string") {
    console.warn(
      `[KOra] KoraField field="${field}": child is a custom component ` +
        `(${String(child.type)}). kora-* attributes will only appear in SSR ` +
        `output if this component spreads ...props onto its root DOM element. ` +
        `Wrap in a native DOM element if unsure: ` +
        `<KoraField field="${field}"><div><YourComponent /></div></KoraField>`,
    );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * KoraField injects kora-* attributes onto its single child element.
 *
 * @example
 * // Renders: <h1 kora-field="title">The Future of AI Search</h1>
 * <KoraField field="title">
 *   <h1>{post.title}</h1>
 * </KoraField>
 *
 * @example
 * // Renders: <div kora-field="tags" kora-list>
 * <KoraField field="tags" list>
 *   <div>{tags.map(t => <span key={t}>{t}</span>)}</div>
 * </KoraField>
 *
 * @example
 * // Relates currency to price:
 * // <span kora-field="currency" kora-relation="price">USD</span>
 * <KoraField field="currency" relation="price">
 *   <span>{currency}</span>
 * </KoraField>
 */
export function KoraField({
  field,
  list,
  exclude,
  confidence,
  relation,
  children,
}: KoraFieldProps): React.ReactElement {
  if (process.env["NODE_ENV"] !== "production") {
    warnIfCustomComponent(children, field);

    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(field)) {
      console.warn(
        `[KOra] KoraField field="${field}" is not snake_case. ` +
          `The CLI will emit a warning when it processes this output.`,
      );
    }

    if (confidence !== undefined && !isConfidence(confidence)) {
      console.warn(
        `[KOra] KoraField field="${field}": confidence="${String(confidence)}" ` +
          `is not in the controlled vocabulary (high | medium | low).`,
      );
    }
  }

  // Build the injected props. Only include attributes the developer declared.
  const injected: Record<string, string | true> = {
    "kora-field": field,
  };

  if (list === true) {
    // Boolean HTML attributes: presence = true. React renders kora-list=""
    // for truthy string values and omits for false/undefined.
    // Use empty string so the attribute appears in SSR output.
    injected["kora-list"] = "";
  }

  if (exclude === true) {
    injected["kora-exclude"] = "";
  }

  if (confidence !== undefined) {
    injected["kora-confidence"] = confidence;
  }

  if (relation !== undefined) {
    injected["kora-relation"] = relation;
  }

  // cloneElement merges injected props with the child's existing props.
  // kora-* attributes go second so they override any conflicting props
  // already on the child (defensive — developers shouldn't set these manually).
  return React.cloneElement(children, injected);
}