/**
 * PersonaManager — state machine for persona + context.
 *
 * Owns all mutable state that was previously trapped in the factory closure
 * and module-level variables. Fully testable with no pi dependency.
 */

import type {
  ContextFilesData,
  PersonaStateData,
  PersonaState,
  PersonaSource,
  SessionEntry,
} from "./types";
import { CTX_ENTRY_TYPE, PERSONA_ENTRY_TYPE } from "./types";
import { displayPath } from "./utils";

export class PersonaManager {
  private persona: string | null = null;
  private personaDisplay: string | null = null;
  private fallback = false;
  private source: PersonaSource = null;
  private contextPaths: string[] = [];
  private params: Record<string, unknown> = {};

  // ========================================================================
  // Queries
  // ========================================================================

  getPersona(): string | null {
    return this.persona;
  }

  getPersonaDisplay(): string | null {
    return this.personaDisplay;
  }

  isFallback(): boolean {
    return this.fallback;
  }

  getContextPaths(): string[] {
    return [...this.contextPaths];
  }

  getParams(): Record<string, unknown> {
    return { ...this.params };
  }

  getState(): PersonaState {
    return {
      persona: this.persona,
      personaDisplay: this.personaDisplay,
      fallback: this.fallback,
      source: this.source,
      contextPaths: [...this.contextPaths],
      params: { ...this.params },
    };
  }

  // ========================================================================
  // Mutations
  // ========================================================================

  /**
   * Set the active persona.
   * The persona is always prepended to the base system prompt,
   * preserving pi's auto-loaded context files.
   */
  setPersona(
    prompt: string,
    displayName: string,
    source: PersonaSource = null,
    params?: Record<string, unknown>,
  ): void {
    this.persona = prompt;
    this.personaDisplay = displayName;
    this.source = source;
    this.fallback = true;
    if (params) {
      this.params = { ...params };
    }
  }

  /**
   * Set inference params directly (e.g. from /persona:params command).
   */
  setParams(params: Record<string, unknown>): void {
    this.params = { ...params };
  }

  /**
   * Clear inference params.
   */
  clearParams(): void {
    this.params = {};
  }

  /**
   * Clear the active persona.
   */
  clearPersona(): void {
    this.persona = null;
    this.personaDisplay = null;
    this.source = null;
    this.fallback = false;
    this.params = {};
  }

  /**
   * Add context file paths. Returns the number added and any duplicates.
   */
  addContextPaths(paths: string[]): { added: number; duplicates: string[] } {
    let added = 0;
    const duplicates: string[] = [];

    for (const p of paths) {
      if (!this.contextPaths.includes(p)) {
        this.contextPaths.push(p);
        added++;
      } else {
        duplicates.push(p);
      }
    }

    return { added, duplicates };
  }

  /**
   * Remove context file paths by resolved path.
   * Returns removed paths and paths that were not found.
   */
  removeContextPaths(resolvedPaths: string[]): {
    removed: string[];
    notFound: string[];
  } {
    const removed: string[] = [];
    const notFound: string[] = [];

    for (const rp of resolvedPaths) {
      const index = this.contextPaths.indexOf(rp);
      if (index !== -1) {
        this.contextPaths.splice(index, 1);
        removed.push(rp);
      } else {
        notFound.push(rp);
      }
    }

    return { removed, notFound };
  }

  /**
   * Clear all context paths.
   */
  clearContext(): void {
    this.contextPaths = [];
  }

  // ========================================================================
  // Prompt building
  // ========================================================================

  /**
   * Rebuild the system prompt by surgically replacing only the persona,
   * guidelines, and pi documentation sections — keeping tools, context
   * files, skills, and metadata intact.
   *
   * Strips from the start through the pi docs section, then rebuilds:
   *   [persona] \n\n [tools section] \n\n [everything after pi docs]
   *
   * `readFile` is injected so tests can provide fakes.
   * `homedir` is injected for display-path formatting in headings.
   */
  async buildSystemPrompt(
    basePrompt: string,
    readFile: (path: string) => Promise<string | null>,
    homedir: string,
  ): Promise<string> {
    // Build context string
    const contextParts: string[] = [];

    const contextString = await this.buildContextString(readFile, homedir);
    if (contextString) contextParts.push(contextString);

    const allContext = contextParts.join("\n");

    if (!this.persona) {
      return allContext ? basePrompt + allContext : basePrompt;
    }

    // Parse the base prompt section by section
    const rebuilt = this.replacePersonaInPrompt(basePrompt, this.persona);

    return allContext ? rebuilt + allContext : rebuilt;
  }

  /**
   * Strip the persona line, guidelines, and pi documentation from the base
   * prompt, keeping tools + "In addition to the tools" + everything after
   * pi docs (context files, skills, date, cwd, append section).
   * Then prepend the user's persona.
   *
   * Sections by structure (see system-prompt.ts in pi-mono):
   *   1. Persona         ← strip, replace with user persona
   *   2. Tools           ← keep (Available tools: ...)
   *   3. Custom tools    ← keep (In addition to the tools above...)
   *   4. Guidelines      ← strip
   *   5. Pi docs         ← strip (Pi documentation ... - Always read ...)
   *   6. Append section  ← keep (from APPEND_SYSTEM.md)
   *   7. Context files   ← keep (# Project Context ...)
   *   8. Skills          ← keep
   *   9. Date & CWD      ← keep
   */
  private replacePersonaInPrompt(basePrompt: string, persona: string): string {
    const lines = basePrompt.split("\n");
    const kept: string[] = [];
    let mode: "skip" | "keep-tools" | "skip-pi-docs" | "keep-tail" = "skip";

    for (const line of lines) {
      // Detect section transitions by known markers
      if (line.startsWith("Available tools:")) {
        mode = "keep-tools";
        kept.push(line);
        continue;
      }

      if (line.startsWith("Guidelines:")) {
        mode = "skip";
        continue;
      }

      if (line.startsWith("Pi documentation")) {
        mode = "skip-pi-docs";
        continue;
      }

      // Skip pi docs bullet points; transition to tail on next non-empty content
      if (mode === "skip-pi-docs") {
        if (line.startsWith("- ")) {
          continue; // still a pi docs bullet
        }
        if (line === "") {
          continue; // empty line separator between sections
        }
        // Non-empty, non-bullet — this is the start of the tail
        mode = "keep-tail";
        kept.push(line);
        continue;
      }

      // General skip (persona, guidelines) - transition to tail on known markers
      if (mode === "skip") {
        if (
          line.startsWith("# ") ||
          line.startsWith("Current date:") ||
          line.startsWith("Current working directory:") ||
          line.startsWith("<available_skills>") ||
          line.startsWith("The following skills")
        ) {
          mode = "keep-tail";
          kept.push(line);
          continue;
        }
        continue; // still skipping
      }

      if (mode === "keep-tools" || mode === "keep-tail") {
        kept.push(line);
      }
    }

    return persona + "\n\n" + kept.join("\n");
  }

  /**
   * Build the context string from all registered context paths.
   * Reads each file via the injected `readFile`.
   * Uses displayPath for headings (not raw absolute paths).
   */
  private async buildContextString(
    readFile: (path: string) => Promise<string | null>,
    homedir: string,
  ): Promise<string> {
    if (this.contextPaths.length === 0) return "";

    let out = "\n# Project Context\n\n";
    out += "Project-specific instructions and guidelines:\n\n";
    const failures: string[] = [];

    for (const filePath of this.contextPaths) {
      const content = await readFile(filePath);
      if (content !== null) {
        const heading = displayPath(filePath, homedir);
        out += `## ${heading}\n\n${content}\n\n`;
      } else {
        failures.push(filePath);
        const heading = displayPath(filePath, homedir);
        out += `## ${heading}\n\n*(file not found or unreadable)*\n\n`;
      }
    }

    if (failures.length > 0) {
      out += `> ⚠ Could not read: ${failures.map((f) => displayPath(f, homedir)).join(", ")}\n`;
    }

    return out;
  }

  // ========================================================================
  // Session persistence / restore
  // ========================================================================

  /**
   * Get the serializable context state for session persistence.
   */
  getContextState(): ContextFilesData {
    return { paths: [...this.contextPaths] };
  }

  /**
   * Get the serializable persona state for session persistence.
   */
  getPersonaState(): PersonaStateData {
    return {
      prompt: this.persona,
      display: this.personaDisplay,
      fallback: this.fallback,
      source: this.source,
      params: { ...this.params },
    };
  }

  /**
   * Restore state from session entries (e.g. on session_start).
   * Restores both context file paths and persona state.
   */
  restoreFromEntries(entries: SessionEntry[]): void {
    this.contextPaths = [];

    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === CTX_ENTRY_TYPE) {
        const data = entry.data as ContextFilesData | undefined;
        if (data?.paths) {
          this.contextPaths = data.paths;
        }
      }
      // Also restore persona state (fixes bug: persona lost on /reload)
      if (entry.type === "custom" && entry.customType === PERSONA_ENTRY_TYPE) {
        const data = entry.data as PersonaStateData | undefined;
        if (data) {
          this.persona = data.prompt;
          this.personaDisplay = data.display;
          // Always use fallback=true when a persona is restored, regardless
          // of what was persisted (old sessions may have fallback=false)
          this.fallback = data.prompt !== null;
          this.source = data.source ?? null;
          this.params = data.params ? { ...this.params, ...data.params } : {};
        }
      }
    }
  }
}
