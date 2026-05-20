/**
 * KoraBlock
 *
 * Renders a DOM container element with kora-archetype (and optionally
 * kora-subtype) injected as HTML attributes. The CLI reads these attributes
 * from the SSR output via parseHtml — this component is purely an attribute
 * injector and is fully transparent to the human UI.
 *
 * The `as` prop controls which element is rendered. Defaults to "div".
 * Use the semantically correct element for your content:
 *   as="article"  for narrative content
 *   as="section"  for reference or catalogue blocks
 *   as="aside"    for supplementary signal blocks
 *
 * All non-KOra props are forwarded to the rendered element via ...rest,
 * so className, id, style, aria-*, data-*, and event handlers all work.
 *
 * The `dynamic` prop declares a build-time dynamic source for this block.
 * It has no effect at runtime — it is serialised as data-kora-dynamic so
 * the CLI can extract it from the rendered HTML without running JavaScript.
 */

import React from "react";
import type {Archetype} from "@kora/types"

// Dynamic source declaration
// Mirrors the per-block dynamic config in KoraBlock framework components.
// The `live` tier intentionally omits `refresh` — enforced by the CLI.
 
export interface KoraBlockDynamic {
  source: string;
  tier: "slow" | "fast" | "live";
  refresh?: string;
}

// Polymorphic `as` prop helpers
 
type AsProp<E extends React.ElementType> = {
  as?: E;
};
 
type PropsWithAs<E extends React.ElementType, P> = P &
  AsProp<E> &
  Omit<React.ComponentPropsWithoutRef<E>, keyof P | "as">;
 
// KoraBlock own props
 
export interface KoraBlockOwnProps {
  /** Required. One of the five KOra archetypes. */
  archetype: Archetype;
  /**
   * Developer-declared domain label. Optional. Informational for agents.
   * snake_case is enforced by the CLI validator at build time, not here.
   */
  subtype?: string;
  /**
   * Dynamic source declaration. Has no runtime effect.
   * Serialised to data-kora-dynamic for CLI extraction.
   */
  dynamic?: KoraBlockDynamic;
  children?: React.ReactNode;
}
 
export type KoraBlockProps<E extends React.ElementType = "div"> = PropsWithAs<
  E,
  KoraBlockOwnProps
>;
 
// Component
 
/**
 * KoraBlock renders a content block container with kora-* attributes.
 *
 * @example
 * <KoraBlock as="article" archetype="narrative" subtype="blog_post">
 *   <KoraField field="title"><h1>{post.title}</h1></KoraField>
 *   <KoraField field="body"><div>{post.content}</div></KoraField>
 * </KoraBlock>
 *
 * Renders as:
 * <article kora-archetype="narrative" kora-subtype="blog_post">
 *   <h1 kora-field="title">...</h1>
 *   <div kora-field="body">...</div>
 * </article>
 */
export function KoraBlock<E extends React.ElementType = "div">({
  as,
  archetype,
  subtype,
  dynamic: dynamicSource,
  children,
  ...rest
}: KoraBlockProps<E>): React.ReactElement {
  const Tag = (as ?? "div") as React.ElementType;
 
  // Build kora-* attributes separately so they are clearly visible
  // and always override any conflicting values in ...rest.
  const koraAttrs: Record<string, string> = {
    "kora-archetype": archetype,
  };
 
  if (subtype !== undefined) {
    koraAttrs["kora-subtype"] = subtype;
  }
 
  if (dynamicSource !== undefined) {
    koraAttrs["data-kora-dynamic"] = JSON.stringify(dynamicSource);
  }
 
  if (process.env["NODE_ENV"] !== "production") {
    if (subtype !== undefined && !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(subtype)) {
      console.warn(
        `[KOra] KoraBlock subtype "${subtype}" is not snake_case. ` +
          `The CLI will emit a warning when it processes this output.`,
      );
    }
  }
 
  // kora attributes go last — they must not be overridable by rest props.
  return React.createElement(Tag, { ...rest, ...koraAttrs }, children);
}