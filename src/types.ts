/**
 * Shared type definitions for pi-persona.
 *
 * No logic, no node builtins, no ExtensionAPI dependency.
 */

// ============================================================================
// Configuration types (from settings.json)
// ============================================================================

export interface ProfileConfig {
  /** Optional — omit to use default personality without changing it */
  persona?: string;
  context?: string[];
  /** Optional inference parameters (temperature, top_p, top_k, max_tokens, etc.) */
  params?: Record<string, unknown>;
}

export interface PiPersonaSettings {
  personaPaths?: string[];
  /**
   * Context files to always load on startup (unconditional, like AGENTS.md).
   * Each entry is a file path or inline text, resolved relative to the project root.
   */
  context?: string[];
  profiles?: Record<string, ProfileConfig>;
  /**
   * Default persona/profile to load on startup when no persona is active.
   *
   * String form: profile name, persona name, or file path (same resolution as `/persona`).
   * Object form: explicitly specify which type of default to load.
   *
   * Examples:
   *   "strict-dev"           → profile or persona named "strict-dev"
   *   { "profile": "fe" }    → profile named "fe"
   *   { "persona": "tdd" }   → persona named "tdd"
   *   { "path": "./my-p.yml" } → file path
   */
  default?: string | { profile?: string; persona?: string; path?: string };
}

export interface SettingsFile {
  "pi-persona"?: PiPersonaSettings;
}

// ============================================================================
// Persona discovery types
// ============================================================================

export interface PersonaFrontmatter {
  name?: string;
  description?: string;
  /** Optional context entries: file paths or inline text (like profile context) */
  context?: string[];
  /** Optional inference parameters (temperature, top_p, top_k, max_tokens, etc.) */
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DiscoveredPersona {
  name: string;
  description?: string;
  fullPath: string;
}

export interface DiscoveredProfile {
  name: string;
  persona?: string;
  context: string[];
  params?: Record<string, unknown>;
}

/** A profile file (.yml/.yaml) discovered in a persona directory */
export interface DiscoveredProfileFile {
  name: string;
  /** Display description for the selector */
  description?: string;
  fullPath: string;
  /** The parsed profile config from the file */
  config: ProfileConfig;
}

// ============================================================================
// Session persistence types
// ============================================================================

export const CTX_ENTRY_TYPE = "context-files";
export const PERSONA_ENTRY_TYPE = "persona-state";

export interface ContextFilesData {
  paths: string[];
}

export interface PersonaStateData {
  prompt: string | null;
  display: string | null;
  fallback: boolean;
  source: PersonaSource;
  params?: Record<string, unknown>;
}

// ============================================================================
// File I/O abstraction
// ============================================================================

export interface FileIO {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  access(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
}

// ============================================================================
// PersonaManager public state (read-only view)
// ============================================================================

export type PersonaSource =
  | { type: "profile"; name: string } // settings profile (e.g. "tdd-project")
  | { type: "profile-file"; name: string } // .yml/.yaml profile bundle file
  | { type: "persona-file"; name: string } // .md/.txt persona file
  | { type: "inline" } // inline text
  | { type: "flag" } // --persona CLI flag
  | { type: "default" } // default from settings
  | null; // no persona active

export interface PersonaState {
  persona: string | null;
  personaDisplay: string | null;
  fallback: boolean;
  source: PersonaSource;
  contextPaths: string[];
  params: Record<string, unknown>;
}

// ============================================================================
// Session entry shape (what restoreFromEntries expects)
// ============================================================================

export interface SessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
}
