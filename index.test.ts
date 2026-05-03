/**
 * Unit tests for pi-persona extension
 * Tests pure utility functions imported from src/utils
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import os from "node:os";

// Import from the source modules (no more copy-pasting)
import {
  parseFrontmatter,
  looksLikePath,
  expandPath,
  resolveFilePath,
  displayPath,
  parseParamArgs,
} from "./src/utils";

// ============================================================================
// Tests: parseFrontmatter
// ============================================================================

describe("parseFrontmatter", () => {
  it("should parse valid frontmatter with name and description", () => {
    const content = `---
name: Test Persona
description: A test persona
---
You are a test persona.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Test Persona");
    expect(result.frontmatter.description).toBe("A test persona");
    expect(result.body).toBe("You are a test persona.");
  });

  it("should parse frontmatter with YAML multiline description (>-, stripped)", () => {
    const content = `---
name: Test
description: >-
  Multi-line
  description
---
Body content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Test");
    expect(result.frontmatter.description).toBe("Multi-line description");
  });

  it("should handle YAML multiline >- without space (edge case)", () => {
    const content = `---
name: Edge
description: >-
---
Actual description from body.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Edge");
    // Should fall back to body since >- is empty
    expect(result.frontmatter.description).toBe(
      "Actual description from body.",
    );
  });

  it("should parse frontmatter with YAML multiline description (> with space)", () => {
    const content = `---
name: Test
description: >
  Folded line
  another line
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Test");
    expect(result.frontmatter.description).toContain("Folded");
  });

  it("should fall back to body first line when description is missing", () => {
    const content = `---
name: Test
---
This is the persona description.
More content follows.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Test");
    expect(result.frontmatter.description).toBe(
      "This is the persona description.",
    );
  });

  it("should fall back to body first line when description is empty YAML multiline", () => {
    const content = `---
name: Test
description: >-
---
Persona description from body.
More content.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Test");
    expect(result.frontmatter.description).toBe(
      "Persona description from body.",
    );
  });

  it("should return empty frontmatter for content without frontmatter", () => {
    const content = `Just some plain content without frontmatter.`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Just some plain content without frontmatter.");
  });

  it("should handle frontmatter with only name", () => {
    const content = `---
name: Only Name
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Only Name");
    expect(result.frontmatter.description).toBe("Body"); // Falls back to body
  });

  it("should preserve unknown frontmatter keys", () => {
    const content = `---
name: Test
unknown: value
version: 1.0
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Test");
    expect(result.frontmatter.description).toBe("Body"); // Falls back to body
    expect((result.frontmatter as any).unknown).toBe("value");
    expect((result.frontmatter as any).version).toBe(1.0);
  });

  it("should handle frontmatter without trailing newline", () => {
    const content = `---
name: No Newline
---
Body`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("No Newline");
  });

  it("should handle pipe multiline (|)", () => {
    const content = `---
name: Test
description: |
  Line one
  Line two
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Test");
    expect(result.frontmatter.description).toContain("Line one");
  });

  // ---- context field parsing ----

  it("should parse context list with file paths", () => {
    const content = `---
name: Project
context:
  - ./guidelines.md
  - ./conventions.md
---
You are a project expert.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Project");
    expect(result.frontmatter.context).toEqual([
      "./guidelines.md",
      "./conventions.md",
    ]);
    expect(result.body).toBe("You are a project expert.");
  });

  it("should parse context list with inline text entries", () => {
    const content = `---
name: TDD
description: TDD expert
context:
  - ./test-guidelines.md
  - Always use TypeScript strict mode
---
You are a TDD expert.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.context).toEqual([
      "./test-guidelines.md",
      "Always use TypeScript strict mode",
    ]);
  });

  it("should parse context list with absolute paths", () => {
    const content = `---
name: Dev
context:
  - /home/user/project/.cursor/rules
  - ~/docs/api.md
---
You are a dev.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.context).toEqual([
      "/home/user/project/.cursor/rules",
      "~/docs/api.md",
    ]);
  });

  it("should handle persona without context field (backwards compatible)", () => {
    const content = `---
name: Simple
description: No context
---
Just a simple persona.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Simple");
    expect(result.frontmatter.context).toBeUndefined();
  });

  it("should handle empty context list", () => {
    const content = `---
name: Empty
context:
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Empty");
    expect(result.frontmatter.context).toEqual([]);
  });

  it("should parse context mixed with other frontmatter keys", () => {
    const content = `---
name: Mixed
context:
  - ./a.md
  - Always be strict
description: Mixed keys
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Mixed");
    expect(result.frontmatter.description).toBe("Mixed keys");
    expect(result.frontmatter.context).toEqual(["./a.md", "Always be strict"]);
  });

  it("should handle YAML comment inside list", () => {
    const content = `---
name: Comment
context:
  - ./real.md
  # this is a comment
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Comment");
    // YAML comments as list items with # are skipped
    expect(result.frontmatter.context).toEqual(["./real.md"]);
  });

  it("should handle context after multiline description", () => {
    const content = `---
name: Complex
description: >
  Multi
  line
  description
context:
  - ./guide.md
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Complex");
    expect(result.frontmatter.description).toContain("Multi");
    expect(result.frontmatter.description).toContain("line");
    expect(result.frontmatter.context).toEqual(["./guide.md"]);
  });
});

// ============================================================================
// Tests: looksLikePath
// ============================================================================

describe("looksLikePath", () => {
  it("should return true for absolute paths", () => {
    expect(looksLikePath("/home/user/persona.md")).toBe(true);
    expect(looksLikePath("/absolute/path.txt")).toBe(true);
  });

  it("should return true for relative paths", () => {
    expect(looksLikePath("./persona.md")).toBe(true);
    expect(looksLikePath("../persona.txt")).toBe(true);
  });

  it("should return true for home directory paths", () => {
    expect(looksLikePath("~/persona.md")).toBe(true);
  });

  it("should return true for paths with common extensions", () => {
    expect(looksLikePath("persona.md")).toBe(true);
    expect(looksLikePath("persona.txt")).toBe(true);
    expect(looksLikePath("persona.json")).toBe(true);
    expect(looksLikePath("persona.yaml")).toBe(true);
    expect(looksLikePath("persona.yml")).toBe(true);
    expect(looksLikePath("persona.toml")).toBe(true);
    expect(looksLikePath("persona.rst")).toBe(true);
    expect(looksLikePath("persona.adoc")).toBe(true);
    expect(looksLikePath("persona.org")).toBe(true);
  });

  it("should return false for inline text (plain description)", () => {
    expect(looksLikePath("You are a helpful assistant")).toBe(false);
    expect(looksLikePath("A simple persona description")).toBe(false);
  });

  it("should return false for profile names", () => {
    expect(looksLikePath("pirate")).toBe(false);
    expect(looksLikePath("tdd-expert")).toBe(false);
  });
});

// ============================================================================
// Tests: expandPath
// ============================================================================

describe("expandPath", () => {
  it("should expand home directory paths", () => {
    const home = os.homedir();
    expect(expandPath("~/persona.md", home)).toBe(
      path.join(home, "persona.md"),
    );
  });

  it("should not modify absolute paths", () => {
    const absPath = "/home/user/persona.md";
    expect(expandPath(absPath, "/home/other")).toBe(absPath);
  });

  it("should not modify relative paths", () => {
    expect(expandPath("./persona.md", "/home/user")).toBe("./persona.md");
    expect(expandPath("../persona.md", "/home/user")).toBe("../persona.md");
  });
});

// ============================================================================
// Tests: index calculation in interactive selector (pure logic)
// ============================================================================

describe("Interactive selector index calculation", () => {
  interface DiscoveredPersona {
    name: string;
    description?: string;
    fullPath: string;
  }

  interface DiscoveredProfile {
    name: string;
    persona: string;
    context: string[];
  }

  function buildOptions(
    profiles: DiscoveredProfile[],
    personas: DiscoveredPersona[],
  ): string[] {
    const options: string[] = [];

    // Profiles first
    if (profiles.length > 0) {
      for (const p of profiles) {
        options.push("📦 " + p.name);
      }
    }

    // Then personas
    for (const p of personas) {
      options.push(p.description ? p.name + " — " + p.description : p.name);
    }

    return options;
  }

  function resolveSelection(
    idx: number,
    profiles: DiscoveredProfile[],
    personas: DiscoveredPersona[],
    options: string[],
  ): { type: "profile" | "persona"; item: any } | null {
    const personaStartIdx = profiles.length;

    if (idx < 0 || idx >= options.length) return null;

    if (idx < personaStartIdx) {
      return { type: "profile", item: profiles[idx] };
    } else {
      return { type: "persona", item: personas[idx - personaStartIdx] };
    }
  }

  it("should correctly identify profile selection (no personas)", () => {
    const profiles = [{ name: "profile1", persona: "text1", context: [] }];
    const personas: DiscoveredPersona[] = [];
    const options = buildOptions(profiles, personas);

    expect(options).toEqual(["📦 profile1"]);

    const result = resolveSelection(0, profiles, personas, options);
    expect(result?.type).toBe("profile");
    expect(result?.item.name).toBe("profile1");
  });

  it("should correctly identify persona selection (no profiles)", () => {
    const profiles: DiscoveredProfile[] = [];
    const personas = [
      { name: "persona1", fullPath: "/path1", description: "desc1" },
    ];
    const options = buildOptions(profiles, personas);

    expect(options).toEqual(["persona1 — desc1"]);

    const result = resolveSelection(0, profiles, personas, options);
    expect(result?.type).toBe("persona");
    expect(result?.item.name).toBe("persona1");
  });

  it("should correctly identify profile when both exist", () => {
    const profiles = [
      { name: "profile1", persona: "text1", context: [] },
      { name: "profile2", persona: "text2", context: [] },
    ];
    const personas = [
      { name: "persona1", fullPath: "/path1", description: "desc1" },
      { name: "persona2", fullPath: "/path2" },
    ];
    const options = buildOptions(profiles, personas);

    expect(options).toEqual([
      "📦 profile1",
      "📦 profile2",
      "persona1 — desc1",
      "persona2",
    ]);

    // Profile selections
    expect(resolveSelection(0, profiles, personas, options)?.type).toBe(
      "profile",
    );
    expect(resolveSelection(1, profiles, personas, options)?.type).toBe(
      "profile",
    );
    expect(resolveSelection(1, profiles, personas, options)?.item.name).toBe(
      "profile2",
    );

    // Persona selections
    expect(resolveSelection(2, profiles, personas, options)?.type).toBe(
      "persona",
    );
    expect(resolveSelection(2, profiles, personas, options)?.item.name).toBe(
      "persona1",
    );
    expect(resolveSelection(3, profiles, personas, options)?.type).toBe(
      "persona",
    );
    expect(resolveSelection(3, profiles, personas, options)?.item.name).toBe(
      "persona2",
    );
  });

  it("should return null for invalid index", () => {
    const profiles = [{ name: "p1", persona: "t1", context: [] }];
    const personas: DiscoveredPersona[] = [];
    const options = buildOptions(profiles, personas);

    expect(resolveSelection(-1, profiles, personas, options)).toBeNull();
    expect(resolveSelection(10, profiles, personas, options)).toBeNull();
  });
});

// ============================================================================
// Tests: resolveFilePath
// ============================================================================

describe("resolveFilePath", () => {
  it("should resolve ~ paths to absolute paths", () => {
    const result = resolveFilePath("~/docs/guide.md", "/home/user");
    expect(result).toBe("/home/user/docs/guide.md");
  });

  it("should resolve relative paths from cwd", () => {
    // path.resolve with relative path depends on cwd
    const result = resolveFilePath("./guide.md", "/home/user");
    expect(result.endsWith("guide.md")).toBe(true);
  });

  it("should pass through absolute paths", () => {
    const result = resolveFilePath("/absolute/path/guide.md", "/home/user");
    expect(result).toBe("/absolute/path/guide.md");
  });
});

// ============================================================================
// Tests: displayPath
// ============================================================================

describe("displayPath", () => {
  it("should replace home directory with ~", () => {
    expect(displayPath("/home/user/docs/guide.md", "/home/user")).toBe(
      "~/docs/guide.md",
    );
  });

  it("should leave non-home paths unchanged", () => {
    expect(displayPath("/tmp/pi-context-abc.txt", "/home/user")).toBe(
      "/tmp/pi-context-abc.txt",
    );
  });

  it("should handle paths that are exactly the home dir", () => {
    expect(displayPath("/home/user", "/home/user")).toBe("~");
  });
});

// ============================================================================
// Tests: parseParamArgs
// ============================================================================

describe("parseParamArgs", () => {
  it("should return empty object for empty string", () => {
    expect(parseParamArgs("")).toEqual({});
  });

  it("should return null for 'clear'", () => {
    expect(parseParamArgs("clear")).toBeNull();
  });

  it("should parse numeric values", () => {
    expect(parseParamArgs("temperature=0.7")).toEqual({ temperature: 0.7 });
    expect(parseParamArgs("top_p=0.95")).toEqual({ top_p: 0.95 });
    expect(parseParamArgs("max_tokens=2048")).toEqual({ max_tokens: 2048 });
  });

  it("should parse boolean values", () => {
    expect(parseParamArgs("some_flag=true")).toEqual({ some_flag: true });
    expect(parseParamArgs("other=false")).toEqual({ other: false });
  });

  it("should parse string values", () => {
    expect(parseParamArgs("seed=abc123")).toEqual({ seed: "abc123" });
  });

  it("should normalize temp to temperature", () => {
    expect(parseParamArgs("temp=0.7")).toEqual({ temperature: 0.7 });
  });

  it("should parse multiple params", () => {
    expect(parseParamArgs("temperature=0.7 top_p=0.9 max_tokens=1024")).toEqual(
      {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1024,
      },
    );
  });

  it("should strip surrounding quotes", () => {
    expect(parseParamArgs('seed="abc"')).toEqual({ seed: "abc" });
    expect(parseParamArgs("seed='abc'")).toEqual({ seed: "abc" });
  });
});

// ============================================================================
// Tests: frontmatter params parsing
// ============================================================================

describe("parseFrontmatter params", () => {
  it("should extract params block from frontmatter", () => {
    const content = `---
name: Creative
params:
  temperature: 0.9
  top_p: 0.95
---
Be creative!`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("Creative");
    expect(result.frontmatter.params).toEqual({
      temperature: 0.9,
      top_p: 0.95,
    });
  });

  it("should handle personas without params", () => {
    const content = `---
name: Simple
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.params).toBeUndefined();
  });
});
