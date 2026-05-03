import { describe, it, expect, beforeEach } from "vitest";
import { PersonaManager } from "./persona-manager";
import type { SessionEntry } from "./types";
import { CTX_ENTRY_TYPE, PERSONA_ENTRY_TYPE } from "./types";

const HOMEDIR = "/home/testuser";

/** Build a realistic pi-style base prompt */
function makePiPrompt(body: string = "Base prompt"): string {
  return [
    "You are an expert coding assistant operating inside pi.",
    "",
    "Available tools:",
    "- read: Read file contents",
    "- bash: Execute bash commands",
    "",
    "In addition to the tools above, you may have access to other custom tools depending on the project.",
    "",
    "Guidelines:",
    "- Prefer grep/find/ls tools over bash for file exploration",
    "- Be concise in your responses",
    "",
    "Pi documentation (read only when the user asks about pi itself):",
    "- Main documentation: /path/to/docs",
    "- Always read pi .md files completely",
    "",
    "# Project Context",
    "",
    "Project-specific instructions and guidelines:",
    "",
    "## Some context",
    "",
    body,
    "",
    "Current date: 2026-04-25",
    "Current working directory: /home/testuser",
  ].join("\n");
}

describe("PersonaManager", () => {
  let manager: PersonaManager;

  beforeEach(() => {
    manager = new PersonaManager();
  });

  // ---- Queries ----

  describe("initial state", () => {
    it("should have null persona", () => {
      expect(manager.getPersona()).toBeNull();
    });

    it("should have null persona display", () => {
      expect(manager.getPersonaDisplay()).toBeNull();
    });

    it("should not be in fallback mode when no persona", () => {
      expect(manager.isFallback()).toBe(false);
    });

    it("should have empty context paths", () => {
      expect(manager.getContextPaths()).toEqual([]);
    });

    it("should return full state snapshot", () => {
      const state = manager.getState();
      expect(state).toEqual({
        persona: null,
        personaDisplay: null,
        fallback: false,
        source: null,
        contextPaths: [],
        params: {},
      });
    });
  });

  describe("setParams / getParams / clearParams", () => {
    it("should set and get params", () => {
      manager.setParams({ temperature: 0.7, top_p: 0.9 });
      expect(manager.getParams()).toEqual({ temperature: 0.7, top_p: 0.9 });
    });

    it("should clear params", () => {
      manager.setParams({ temperature: 0.7 });
      manager.clearParams();
      expect(manager.getParams()).toEqual({});
    });

    it("should include params in state", () => {
      manager.setParams({ max_tokens: 1024 });
      const state = manager.getState();
      expect(state.params).toEqual({ max_tokens: 1024 });
    });

    it("should pass params through setPersona", () => {
      manager.setPersona("Prompt", "Name", null, { temperature: 0.5 });
      expect(manager.getParams()).toEqual({ temperature: 0.5 });
    });
  });

  // ---- setPersona ----

  describe("setPersona", () => {
    it("should set persona with prompt and display name (always fallback)", () => {
      manager.setPersona("You are a pirate.", "Pirate");
      expect(manager.getPersona()).toBe("You are a pirate.");
      expect(manager.getPersonaDisplay()).toBe("Pirate");
      // Always uses fallback (prepends to base prompt, preserves context)
      expect(manager.isFallback()).toBe(true);
    });

    it("should replace existing persona", () => {
      manager.setPersona("Old prompt", "Old");
      manager.setPersona("New prompt", "New");
      expect(manager.getPersona()).toBe("New prompt");
      expect(manager.getPersonaDisplay()).toBe("New");
    });
  });

  // ---- clearPersona ----

  describe("clearPersona", () => {
    it("should clear an active persona", () => {
      manager.setPersona("You are a pirate.", "Pirate");
      manager.clearPersona();
      expect(manager.getPersona()).toBeNull();
      expect(manager.getPersonaDisplay()).toBeNull();
      expect(manager.isFallback()).toBe(false);
    });

    it("should be safe to call when no persona is set", () => {
      manager.clearPersona();
      expect(manager.getPersona()).toBeNull();
    });
  });

  // ---- addContextPaths ----

  describe("addContextPaths", () => {
    it("should add paths and return count", () => {
      const result = manager.addContextPaths(["/a.md", "/b.md"]);
      expect(result.added).toBe(2);
      expect(result.duplicates).toEqual([]);
      expect(manager.getContextPaths()).toEqual(["/a.md", "/b.md"]);
    });

    it("should detect duplicate paths", () => {
      manager.addContextPaths(["/a.md"]);
      const result = manager.addContextPaths(["/a.md", "/b.md"]);
      expect(result.added).toBe(1);
      expect(result.duplicates).toEqual(["/a.md"]);
      expect(manager.getContextPaths()).toEqual(["/a.md", "/b.md"]);
    });

    it("should handle all duplicates", () => {
      manager.addContextPaths(["/a.md"]);
      const result = manager.addContextPaths(["/a.md"]);
      expect(result.added).toBe(0);
      expect(result.duplicates).toEqual(["/a.md"]);
    });

    it("should add to existing context without replacing", () => {
      manager.addContextPaths(["/a.md"]);
      manager.addContextPaths(["/b.md"]);
      expect(manager.getContextPaths()).toEqual(["/a.md", "/b.md"]);
    });
  });

  // ---- removeContextPaths ----

  describe("removeContextPaths", () => {
    it("should remove paths and return removed list", () => {
      manager.addContextPaths(["/a.md", "/b.md", "/c.md"]);
      const result = manager.removeContextPaths(["/b.md"]);
      expect(result.removed).toEqual(["/b.md"]);
      expect(result.notFound).toEqual([]);
      expect(manager.getContextPaths()).toEqual(["/a.md", "/c.md"]);
    });

    it("should report not found paths", () => {
      manager.addContextPaths(["/a.md"]);
      const result = manager.removeContextPaths(["/a.md", "/z.md"]);
      expect(result.removed).toEqual(["/a.md"]);
      expect(result.notFound).toEqual(["/z.md"]);
    });

    it("should handle removing all context paths", () => {
      manager.addContextPaths(["/a.md", "/b.md"]);
      manager.removeContextPaths(["/a.md", "/b.md"]);
      expect(manager.getContextPaths()).toEqual([]);
    });

    it("should handle removing from empty context", () => {
      const result = manager.removeContextPaths(["/a.md"]);
      expect(result.removed).toEqual([]);
      expect(result.notFound).toEqual(["/a.md"]);
    });
  });

  // ---- clearContext ----

  describe("clearContext", () => {
    it("should remove all context paths", () => {
      manager.addContextPaths(["/a.md", "/b.md"]);
      manager.clearContext();
      expect(manager.getContextPaths()).toEqual([]);
    });

    it("should be safe on empty context", () => {
      manager.clearContext();
      expect(manager.getContextPaths()).toEqual([]);
    });
  });

  // ---- buildSystemPrompt ----

  describe("buildSystemPrompt", () => {
    const fakeReadFile = async (p: string): Promise<string | null> => {
      const files: Record<string, string> = {
        "/a.md": "Content A",
        "/b.md": "Content B",
      };
      return files[p] ?? null;
    };

    it("should return base prompt unchanged when no persona and no context", async () => {
      const result = await manager.buildSystemPrompt(
        "Base prompt",
        fakeReadFile,
        HOMEDIR,
      );
      expect(result).toBe("Base prompt");
    });

    it("should append context files to base prompt", async () => {
      manager.addContextPaths(["/a.md"]);
      const result = await manager.buildSystemPrompt(
        "Base prompt",
        fakeReadFile,
        HOMEDIR,
      );
      expect(result).toContain("Base prompt");
      expect(result).toContain("Content A");
      expect(result).toContain("# Project Context");
    });

    it("should append multiple context files", async () => {
      manager.addContextPaths(["/a.md", "/b.md"]);
      const result = await manager.buildSystemPrompt(
        "Base",
        fakeReadFile,
        HOMEDIR,
      );
      expect(result).toContain("Content A");
      expect(result).toContain("Content B");
    });

    it("should handle unreadable files gracefully", async () => {
      manager.addContextPaths(["/missing.md"]);
      const result = await manager.buildSystemPrompt(
        "Base",
        fakeReadFile,
        HOMEDIR,
      );
      expect(result).toContain("file not found or unreadable");
    });

    it("should prepend persona to base prompt", async () => {
      manager.setPersona("Persona prompt", "Pirate");
      const result = await manager.buildSystemPrompt(
        makePiPrompt(),
        fakeReadFile,
        HOMEDIR,
      );
      expect(result).toContain("Base prompt");
      expect(result).toContain("Persona prompt");
      // Persona should come before base prompt
      expect(result.indexOf("Persona prompt")).toBeLessThan(
        result.indexOf("Base prompt"),
      );
    });

    it("should append context even when persona is set", async () => {
      manager.setPersona("Persona prompt", "Pirate");
      manager.addContextPaths(["/a.md"]);
      const result = await manager.buildSystemPrompt(
        makePiPrompt(),
        fakeReadFile,
        HOMEDIR,
      );
      expect(result).toContain("Persona prompt");
      expect(result).toContain("Base prompt");
      expect(result).toContain("Content A");
      // Should still have tools section
      expect(result).toContain("Available tools:");
      expect(result).toContain("In addition to the tools above");
      // Should NOT have guidelines or pi docs
      expect(result).not.toContain("Guidelines:");
      expect(result).not.toContain("Pi documentation");
      // Should have date and cwd
      expect(result).toContain("Current date:");
      expect(result).toContain("Current working directory:");
    });

    it("should use displayPath for headings (not raw absolute paths)", async () => {
      const pathUnderHome = HOMEDIR + "/docs/guide.md";
      const readFileWithPath = async (p: string): Promise<string | null> => {
        if (p === pathUnderHome) return "Guide content";
        return null;
      };
      manager.addContextPaths([pathUnderHome]);
      const result = await manager.buildSystemPrompt(
        "Base",
        readFileWithPath,
        HOMEDIR,
      );
      expect(result).toContain("~/docs/guide.md");
      expect(result).not.toContain(HOMEDIR + "/docs/guide.md");
    });
  });

  // ---- Session persistence / restore ----

  describe("getContextState", () => {
    it("should return context paths", () => {
      manager.addContextPaths(["/a.md", "/b.md"]);
      expect(manager.getContextState()).toEqual({
        paths: ["/a.md", "/b.md"],
      });
    });
  });

  describe("getPersonaState", () => {
    it("should return persona state", () => {
      manager.setPersona("Prompt", "Display");
      expect(manager.getPersonaState()).toEqual({
        prompt: "Prompt",
        display: "Display",
        fallback: true,
        source: null,
        params: {},
      });
    });

    it("should return null state when no persona", () => {
      expect(manager.getPersonaState()).toEqual({
        prompt: null,
        display: null,
        fallback: false,
        source: null,
        params: {},
      });
    });
  });

  describe("restoreFromEntries", () => {
    it("should restore context paths from session entries", () => {
      const entries: SessionEntry[] = [
        {
          type: "custom",
          customType: CTX_ENTRY_TYPE,
          data: { paths: ["/a.md", "/b.md"] },
        },
      ];
      manager.restoreFromEntries(entries);
      expect(manager.getContextPaths()).toEqual(["/a.md", "/b.md"]);
    });

    it("should restore persona state from session entries (fixes bug #10)", () => {
      const entries: SessionEntry[] = [
        {
          type: "custom",
          customType: PERSONA_ENTRY_TYPE,
          data: {
            prompt: "You are a pirate.",
            display: "Pirate",
            fallback: false,
          },
        },
      ];
      manager.restoreFromEntries(entries);
      expect(manager.getPersona()).toBe("You are a pirate.");
      expect(manager.getPersonaDisplay()).toBe("Pirate");
      // Backward compat: old entries may have fallback=false, but always treated as fallback
      expect(manager.isFallback()).toBe(true);
    });

    it("should restore both context and persona from entries", () => {
      const entries: SessionEntry[] = [
        {
          type: "custom",
          customType: CTX_ENTRY_TYPE,
          data: { paths: ["/x.md"] },
        },
        {
          type: "custom",
          customType: PERSONA_ENTRY_TYPE,
          data: { prompt: "Persona prompt", display: "TDD", fallback: true },
        },
      ];
      manager.restoreFromEntries(entries);
      expect(manager.getContextPaths()).toEqual(["/x.md"]);
      expect(manager.getPersonaDisplay()).toBe("TDD");
      expect(manager.isFallback()).toBe(true);
    });

    it("should restore params from session entries", () => {
      const entries: SessionEntry[] = [
        {
          type: "custom",
          customType: PERSONA_ENTRY_TYPE,
          data: {
            prompt: "Persona prompt",
            display: "TDD",
            fallback: true,
            params: { temperature: 0.7, top_p: 0.9 },
          },
        },
      ];
      manager.restoreFromEntries(entries);
      expect(manager.getParams()).toEqual({ temperature: 0.7, top_p: 0.9 });
    });

    it("should fallback params to empty object when missing in old entries", () => {
      const entries: SessionEntry[] = [
        {
          type: "custom",
          customType: PERSONA_ENTRY_TYPE,
          data: { prompt: "Persona prompt", display: "TDD", fallback: true },
        },
      ];
      manager.restoreFromEntries(entries);
      expect(manager.getParams()).toEqual({});
    });

    it("should reset context when restoring (no stale state)", () => {
      manager.addContextPaths(["/old.md"]);
      const entries: SessionEntry[] = [
        {
          type: "custom",
          customType: CTX_ENTRY_TYPE,
          data: { paths: ["/new.md"] },
        },
      ];
      manager.restoreFromEntries(entries);
      expect(manager.getContextPaths()).toEqual(["/new.md"]);
    });

    it("should ignore entries with wrong type", () => {
      const entries: SessionEntry[] = [
        { type: "message" },
        { type: "custom", customType: "other-type", data: {} },
      ];
      manager.restoreFromEntries(entries);
      expect(manager.getContextPaths()).toEqual([]);
      expect(manager.getPersona()).toBeNull();
    });

    it("should handle empty entries list", () => {
      manager.addContextPaths(["/a.md"]);
      manager.restoreFromEntries([]);
      expect(manager.getContextPaths()).toEqual([]);
    });
  });
});
