/**
 * @kora/types — archetypes.ts
 *
 * Controlled vocabularies defined by the KOra spec.
 * Every closed set in the spec lives here as a const enum or union.
 * Nothing outside this file should hard-code these string values.
 */

// Archetypes

export const ARCHETYPES = [
    "narrative",
    "reference",
    "catalogue",
    "dialogue",
    "signal"
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export function isArchetype(value: string): value is Archetype {
    return (ARCHETYPES as readonly string[]).includes(value)
}

// Confidence

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
 
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
 
export function isConfidence(value: string): value is Confidence {
  return (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

// Content tiers
 
export const CONTENT_TIERS = ["static", "slow", "fast", "live"] as const;
 
export type ContentTier = (typeof CONTENT_TIERS)[number];

// License types
 
export const LICENSE_TYPES = [
  "public",
  "attribution",
  "no_training",
  "restricted",
] as const;
 
export type LicenseType = (typeof LICENSE_TYPES)[number];

// Element kinds that trigger special attribute extraction rules
 
export const SPECIAL_ELEMENTS = ["time", "a", "img", "meta"] as const;
 
export type SpecialElement = (typeof SPECIAL_ELEMENTS)[number];
 
export function isSpecialElement(tag: string): tag is SpecialElement {
  return (SPECIAL_ELEMENTS as readonly string[]).includes(tag);
}

// Dialogue turn roles — informational per spec, not enforced
 
export const TURN_ROLES = [
  "question",
  "answer",
  "comment",
  "moderator",
] as const;
 
export type TurnRole = (typeof TURN_ROLES)[number];