/**
 * Pure utility functions for pi-persona.
 *
 * No ExtensionAPI, no module-level state, no side effects.
 * `homedir` is injected where needed so tests don't depend on `os.homedir()`.
 */

import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { PersonaFrontmatter } from "./types";

// ============================================================================
// Param utilities
// ============================================================================

/**
 * Normalise a param key: `temp` → `temperature`.
 * Otherwise return the key as-is.
 */
export function normalizeParamKey(key: string): string {
  if (key === "temp") return "temperature";
  return key;
}

/**
 * Coerce a raw string value to the most appropriate JS type.
 * - numeric strings → number
 * - "true"/"false" → boolean
 * - everything else → string
 */
export function coerceParamValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== "") return num;
  return trimmed;
}

/**
 * Parse a `/persona:params` command argument string.
 *
 * Accepts: `temperature=0.7 top_p=0.9 clear`
 * Returns the parsed params map, or `null` when the user requested a clear.
 */
export function parseParamArgs(args: string): Record<string, unknown> | null {
  const trimmed = args.trim();
  if (trimmed === "clear") return null;
  if (!trimmed) return {};

  const params: Record<string, unknown> = {};
  // Match `key=value` tokens; split on whitespace followed by a new key.
  const tokens = trimmed.split(/\s+(?=[a-zA-Z_][a-zA-Z0-9_-]*=)/);

  for (const token of tokens) {
    const eqIdx = token.indexOf("=");
    if (eqIdx === -1) {
      // Boolean flag (e.g. `foo` as shorthand for `foo=true`)
      params[normalizeParamKey(token)] = true;
      continue;
    }
    const key = normalizeParamKey(token.slice(0, eqIdx));
    let rawValue = token.slice(eqIdx + 1);
    // Strip surrounding quotes
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.slice(1, -1);
    }
    params[key] = coerceParamValue(rawValue);
  }

  return params;
}

/**
 * Format params as a short status string (e.g. "t:0.7 p:0.9").
 * Returns `null` when there are no params.
 */
export function formatParamStatus(
  params: Record<string, unknown>,
): string | null {
  const keys = Object.keys(params);
  if (keys.length === 0) return null;
  const short: Record<string, string> = {
    temperature: "t",
    top_p: "p",
    top_k: "k",
    max_tokens: "m",
    min_p: "mp",
    seed: "s",
  };
  const parts: string[] = [];
  for (const k of keys) {
    const label = short[k] ?? k;
    const v = params[k];
    const display =
      typeof v === "number"
        ? Number.isInteger(v)
          ? String(v)
          : v.toFixed(2)
        : String(v);
    parts.push(`${label}:${display}`);
  }
  return parts.join(" ");
}

// ============================================================================
// Path utilities
// ============================================================================

/**
 * Expand `~` in a path to the given home directory.
 */
export function expandPath(p: string, homedir: string): string {
  if (p.startsWith("~/")) {
    return path.join(homedir, p.slice(2));
  }
  return p;
}

/**
 * Resolve a file path: expand `~`, then make absolute.
 */
export function resolveFilePath(filePath: string, homedir: string): string {
  let resolvedPath = filePath;
  if (resolvedPath.startsWith("~")) {
    resolvedPath = homedir + resolvedPath.slice(1);
  }
  return path.resolve(resolvedPath);
}

/**
 * Display a file path, replacing the home directory prefix with `~`.
 */
export function displayPath(filePath: string, homedir: string): string {
  if (filePath.startsWith(homedir)) {
    return "~" + filePath.slice(homedir.length);
  }
  return filePath;
}

// ============================================================================
// Path heuristic
// ============================================================================

/**
 * Heuristic: does a string look like a file path vs free-form text?
 *
 * Matches strings that start with path indicators (`/`, `./`, `../`, `~`)
 * or end with known file extensions.
 */
export function looksLikePath(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  return (
    s.startsWith("/") ||
    s.startsWith("./") ||
    s.startsWith("../") ||
    s.startsWith("~") ||
    /\.(md|txt|json|yaml|yml|toml|rst|adoc|org)$/i.test(s)
  );
}

// ============================================================================
// Frontmatter parsing
// ============================================================================

/**
 * Parse YAML frontmatter from a persona file using proper YAML parsing.
 *
 * Extracts `name`, `description`, `context`, and `params` fields.
 * Falls back to the first body line for description.
 */
export function parseFrontmatter(content: string): {
  frontmatter: PersonaFrontmatter;
  body: string;
} {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content.trim() };
  }

  const body = fmMatch[2].trim();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = parseYaml(fmMatch[1]) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const frontmatter: PersonaFrontmatter = {};
  if (typeof parsed.name === "string") {
    frontmatter.name = parsed.name;
  }
  if (typeof parsed.description === "string") {
    frontmatter.description = parsed.description;
  }
  if (
    Array.isArray(parsed.context) &&
    parsed.context.every((c: unknown): c is string => typeof c === "string")
  ) {
    frontmatter.context = parsed.context;
  }
  // Treat an explicit empty mapping value `context:` as [] for convenience
  if (parsed.context === null) {
    frontmatter.context = [];
  }
  if (
    parsed.params &&
    typeof parsed.params === "object" &&
    !Array.isArray(parsed.params)
  ) {
    frontmatter.params = parsed.params as Record<string, unknown>;
  }

  // Preserve unknown keys for forward compatibility
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in frontmatter)) {
      (frontmatter as Record<string, unknown>)[key] = value;
    }
  }

  // Fallback: use first body line for description if missing
  if (!frontmatter.description && body) {
    const firstLine = body.split("\n").find((l) => l.trim().length > 0);
    if (firstLine) {
      frontmatter.description = firstLine.trim().slice(0, 50);
    }
  }

  return { frontmatter, body };
}
