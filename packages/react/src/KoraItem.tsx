/**
 * KoraItem and KoraTurn
 *
 * Scope markers for catalogue and dialogue blocks respectively.
 * Both inject a boolean HTML attribute onto the single child element
 * by cloning it with React.cloneElement — the same pattern as KoraField.
 *
 * KoraItem  → injects kora-item  onto child (catalogue scope)
 * KoraTurn  → injects kora-turn  onto child (dialogue scope)
 *
 * The CLI uses these attributes to group field extraction into per-item
 * or per-turn scopes. Fields nested inside a KoraItem/KoraTurn are not
 * promoted to the container block — they belong to the item/turn only.
 *
 * Constraints enforced by the CLI at build time (not at runtime here):
 *   - KoraItem must be inside a KoraBlock with archetype="catalogue"
 *   - KoraTurn must be inside a KoraBlock with archetype="dialogue"
 *
 * The child must be a single React element whose root is a native DOM
 * element, or a component that spreads ...props onto its root DOM node.
 */

import React from "react";

// ---------------------------------------------------------------------------
// Shared dev warning — same failure mode as KoraField
// ---------------------------------------------------------------------------

function warnIfCustomComponent(
  child: React.ReactElement,
  componentName: "KoraItem" | "KoraTurn",
  attribute: string,
): void {
  if (process.env["NODE_ENV"] === "production") return;
  if (typeof child.type !== "string") {
    console.warn(
      `[KOra] ${componentName}: child is a custom component ` +
        `(${String(child.type)}). The ${attribute} attribute will only appear ` +
        `in SSR output if this component spreads ...props onto its root DOM ` +
        `element. Wrap in a native element if unsure: ` +
        `<${componentName}><div><YourComponent /></div></${componentName}>`,
    );
  }
}

// ---------------------------------------------------------------------------
// KoraItem
// ---------------------------------------------------------------------------

export interface KoraItemProps {
  /**
   * Single React element child. Must have a DOM element at its root
   * (or a component that forwards props) so that kora-item reaches the DOM.
   */
  children: React.ReactElement;
}

/**
 * KoraItem marks a repeating item within a catalogue block.
 * Injects kora-item onto its child element.
 *
 * @example
 * <KoraBlock as="section" archetype="catalogue" subtype="product_listing">
 *   <KoraField field="title"><h1>Developer Tools</h1></KoraField>
 *   {tools.map(tool => (
 *     <KoraItem key={tool.id}>
 *       <div>
 *         <KoraField field="name"><h2>{tool.name}</h2></KoraField>
 *         <KoraField field="description"><p>{tool.desc}</p></KoraField>
 *         <KoraField field="url"><a href={tool.url}>View</a></KoraField>
 *       </div>
 *     </KoraItem>
 *   ))}
 * </KoraBlock>
 */
export function KoraItem({ children }: KoraItemProps): React.ReactElement {
  if (process.env["NODE_ENV"] !== "production") {
    warnIfCustomComponent(children, "KoraItem", "kora-item");
  }
  return React.cloneElement(children, { "kora-item": "" } as Record<string, string>);
}

// ---------------------------------------------------------------------------
// KoraTurn
// ---------------------------------------------------------------------------

export interface KoraTurnProps {
  /**
   * Single React element child. Must have a DOM element at its root
   * (or a component that forwards props) so that kora-turn reaches the DOM.
   */
  children: React.ReactElement;
}

/**
 * KoraTurn marks one turn within a dialogue block.
 * Injects kora-turn onto its child element.
 *
 * @example
 * <KoraBlock as="section" archetype="dialogue" subtype="support_thread">
 *   <KoraField field="title"><h1>{thread.title}</h1></KoraField>
 *   {thread.turns.map(turn => (
 *     <KoraTurn key={turn.id}>
 *       <div>
 *         <KoraField field="participant"><span>{turn.author}</span></KoraField>
 *         <KoraField field="role"><span>{turn.role}</span></KoraField>
 *         <KoraField field="body"><p>{turn.text}</p></KoraField>
 *         <KoraField field="posted_at">
 *           <time dateTime={turn.iso}>{turn.display}</time>
 *         </KoraField>
 *       </div>
 *     </KoraTurn>
 *   ))}
 * </KoraBlock>
 */
export function KoraTurn({ children }: KoraTurnProps): React.ReactElement {
  if (process.env["NODE_ENV"] !== "production") {
    warnIfCustomComponent(children, "KoraTurn", "kora-turn");
  }
  return React.cloneElement(children, { "kora-turn": "" } as Record<string, string>);
}