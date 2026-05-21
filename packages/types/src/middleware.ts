/**
 * @kora/types — middleware.ts
 *
 * Types for the KOra SDK live fallback middleware.
 * These are the request/response shapes for the /.kora/ endpoints,
 * plus the KoraManifest type derived from manifest.schema.json.
 *
 * These types are intentionally separate from the parser intermediates
 * in parser.ts — they represent the public API surface agents consume,
 * not the internal extraction layer.
 */

import type { Archetype, Confidence } from "./archetypes.js";

// Project manifest ─

/**
 * Shape of a parsed kora.manifest.json file.
 * Derived from the JSON Schema at packages/schema/manifest.schema.json.
 *
 * `base_url` is present here because the middleware receives the parsed
 * manifest at runtime. It is never written to any /.kora/ response.
 */
export interface KoraManifest {
  kora: string;
  identity: {
    name: string;
    description: string;
    base_url: string;
    public_url: string;
    author: {
      name: string;
      contact: string;
    };
    language: string;
    license: {
      type: string;
      url?: string;
    };
  };
  static_roots: string[];
  exclude?: string[];
  dynamic_sources?: Array<{
    field: string;
    endpoint: string;
    auth: {
      type: "public" | "api_key" | "bearer";
      env?: string;
    };
    tier: "slow" | "fast" | "live";
    refresh?: string;
  }>;
  output: {
    summary: boolean;
    full: boolean;
    max_field_tokens: number;
  };
  versioning: {
    strategy: "semver-timestamp";
  };
}

// Shared response envelope 

/** Present on every successful /.kora/ response body. */
export interface KoraLiveBase {
  kora_version: "1.0";
  source: "live";
}

// Error response ─

export type KoraErrorCode = "not_found" | "not_live" | "unavailable";

export interface KoraErrorResponse extends KoraLiveBase {
  error: KoraErrorCode;
  message: string;
}

// GET /.kora/manifest 
export interface KoraManifestResponse extends KoraLiveBase {
  package_version: string;
  published_at: string;
  identity: {
    name: string;
    description: string;
    public_url: string;
    author: {
      name: string;
      contact: string;
    };
    language: string;
    license: {
      type: string;
      url?: string;
    };
  };
  content_summary: {
    total_blocks: number;
    archetypes: Partial<Record<Archetype, number>>;
    dynamic_sources: number;
    live_sources: number;
  };
  signed: false;
  ttl: number;
}

// GET /.kora/index 
/** One block entry in the index response — summary level only, never body. */
export interface KoraIndexBlock {
  content_id: string;
  archetype: Archetype;
  subtype: string | null;
  inferred: boolean;
  confidence: Confidence;
  source_url: string;
  /** All fields except body. */
  fields: Record<string, unknown>;
  structure: string[];
  meta: {
    token_count: number;
    language: string;
    ttl: number;
    extracted_at: string;
  };
  full_available: true;
}

export interface KoraIndexResponse extends KoraLiveBase {
  total: number;
  limit: number;
  offset: number;
  blocks: KoraIndexBlock[];
}

/** Query parameters accepted by GET /.kora/index */
export interface KoraIndexQuery {
  archetype?: Archetype;
  subtype?: string;
  limit?: number;
  offset?: number;
}

// GET /.kora/full/{content_id} ─

export interface KoraFullResponse extends KoraLiveBase {
  content_id: string;
  archetype: Archetype;
  subtype: string | null;
  inferred: boolean;
  identity: {
    publisher: string;
    public_url: string;
    signed: false;
    source_url: string;
  };
  fields: Record<string, unknown>;
  missing_fields: Array<{ field: string; missing: true }>;
  truncated_fields: Array<{
    field: string;
    truncated: true;
    token_count: number;
    total_tokens: number;
  }>;
  relations: Record<string, string>;
  structure: string[];
  implicit_clusters: unknown[];
  related_content: Array<{ title: string; url: string }>;
  meta: {
    content_id: string;
    archetype: Archetype;
    subtype: string | null;
    inferred: boolean;
    confidence: Confidence;
    language: string;
    source_url: string;
    token_count: number;
    kora_version: "1.0";
    ttl: number;
    extracted_at: string;
  };
}

// GET /.kora/field/{content_id}/{field_name} 

export interface KoraFieldResponse extends KoraLiveBase {
  content_id: string;
  field: string;
  value: unknown;
  truncated: false;
  token_count: number;
  extracted_at: string;
}

// GET /.kora/live/{field} ─

export interface KoraLiveFieldResponse extends KoraLiveBase {
  field: string;
  archetype: Archetype;
  subtype: string | null;
  value: unknown;
  meta: {
    ttl: number;
    extracted_at: string;
  };
}

// Middleware options 

export interface KoraMiddlewareOptions {
  /** The project's parsed kora.manifest.json */
  manifest: KoraManifest;
  /** The site's public_url — used for absolute URL construction */
  sourceUrl: string;
  /** Fetch the HTML of a path on this site. Path starts with /. */
  fetchPage: (path: string) => Promise<string>;
  /** For /.kora/live/{field} — returns the live value for a declared live-tier source */
  fetchDynamic?: (field: string) => Promise<unknown>;
}

// Internal cache entry
/** Used by the in-memory TTL cache inside the middleware. Not exported publicly. */
export interface KoraCacheEntry<T> {
  data: T;
  expiresAt: number;
}