import { describe, it, expect, beforeEach } from "vitest";
import { PersonaDiscovery } from "./persona-discovery";
import type { FileIO } from "./types";

/**
 * In-memory FileIO implementation for testing.
 */
class InMemoryFileIO implements FileIO {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  addFile(filePath: string, content: string): void {
    this.files.set(filePath, content);
    // Auto-register parent directory
    const dir = filePath.split("/").slice(0, -1).join("/");
    if (dir) this.dirs.add(dir);
  }

  async readFile(filePath: string): Promise<string | null> {
    return this.files.get(filePath) ?? null;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async readdir(dir: string): Promise<string[]> {
    const entries: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(dir + "/")) {
        const name = filePath.slice(dir.length + 1).split("/")[0];
        if (name && !entries.includes(name)) {
          entries.push(name);
        }
      }
    }
    return entries;
  }

  async mkdir(_filePath: string): Promise<void> {
    // no-op for in-memory
  }

  async access(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }
}

const HOMEDIR = "/home/testuser";
const PERSONA_DIR = `${HOMEDIR}/.pi/agent/personas`;

describe("PersonaDiscovery", () => {
  let io: InMemoryFileIO;
  let discovery: PersonaDiscovery;

  beforeEach(() => {
    io = new InMemoryFileIO();
    discovery = new PersonaDiscovery(io, [PERSONA_DIR], {});
  });

  // ---- discoverPersonas ----

  describe("discoverPersonas", () => {
    it("should discover .md persona files", async () => {
      io.addFile(
        `${PERSONA_DIR}/pirate.md`,
        `---\nname: Pirate\ndescription: Ahoy!\n---\nYou are a pirate.`,
      );
      io.addFile(
        `${PERSONA_DIR}/robot.md`,
        `---\nname: Robot\ndescription: Beep boop\n---\nYou are a robot.`,
      );

      const personas = await discovery.discoverPersonas();
      expect(personas).toHaveLength(2);
      expect(personas.map((p) => p.name).sort()).toEqual(["Pirate", "Robot"]);
    });

    it("should discover .txt persona files", async () => {
      io.addFile(`${PERSONA_DIR}/helper.txt`, "You are a helper.");

      const personas = await discovery.discoverPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0].name).toBe("helper");
    });

    it("should use frontmatter name over filename", async () => {
      io.addFile(
        `${PERSONA_DIR}/tdd-expert.md`,
        `---\nname: TDD Expert\ndescription: Test-first\n---\nYou love tests.`,
      );

      const personas = await discovery.discoverPersonas();
      expect(personas[0].name).toBe("TDD Expert");
    });

    it("should use filename (without extension) when no frontmatter name", async () => {
      io.addFile(`${PERSONA_DIR}/simple.md`, "Just a simple persona.");

      const personas = await discovery.discoverPersonas();
      expect(personas[0].name).toBe("simple");
    });

    it("should skip hidden files", async () => {
      io.addFile(`${PERSONA_DIR}/.hidden.md`, "---\nname: Hidden\n---\n...");
      io.addFile(`${PERSONA_DIR}/visible.md`, "---\nname: Visible\n---\n...");

      const personas = await discovery.discoverPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0].name).toBe("Visible");
    });

    it("should return empty array for non-existent directory", async () => {
      // Don't add any files → directory doesn't exist in InMemoryFileIO
      const personas = await discovery.discoverPersonas();
      expect(personas).toEqual([]);
    });

    it("should sort personas by name", async () => {
      io.addFile(`${PERSONA_DIR}/zebra.md`, "---\nname: Zebra\n---\n...");
      io.addFile(`${PERSONA_DIR}/alpha.md`, "---\nname: Alpha\n---\n...");
      io.addFile(`${PERSONA_DIR}/middle.md`, "---\nname: Middle\n---\n...");

      const personas = await discovery.discoverPersonas();
      expect(personas.map((p) => p.name)).toEqual(["Alpha", "Middle", "Zebra"]);
    });

    it("should deduplicate files across multiple directories", async () => {
      const dir2 = "/other/dir";
      io.addFile(`${PERSONA_DIR}/shared.md`, "---\nname: Shared\n---\n...");
      // Same file appears in both dirs — InMemoryFileIO treats them as separate
      // but the same fullPath will be deduplicated
      const discovery2 = new PersonaDiscovery(io, [PERSONA_DIR, dir2], {});
      // No file in dir2, so same result
      const personas = await discovery2.discoverPersonas();
      expect(personas).toHaveLength(1);
    });
  });

  // ---- discoverProfiles ----

  describe("discoverProfiles", () => {
    it("should return configured profiles", async () => {
      const disc = new PersonaDiscovery(io, [PERSONA_DIR], {
        "tdd-project": {
          persona: "tdd.md",
          context: ["./test-guidelines.md"],
        },
      });

      const profiles = await disc.discoverProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("tdd-project");
      expect(profiles[0].persona).toBe("tdd.md");
      expect(profiles[0].context).toEqual(["./test-guidelines.md"]);
    });

    it("should return empty array when no profiles configured", async () => {
      const profiles = await discovery.discoverProfiles();
      expect(profiles).toEqual([]);
    });

    it("should return persona paths as-is (adapter pre-expands)", async () => {
      const disc = new PersonaDiscovery(io, [PERSONA_DIR], {
        dev: {
          persona: "~/personas/dev.md",
          context: ["./conventions.md", "Always use strict mode"],
        },
      });

      const profiles = await disc.discoverProfiles();
      expect(profiles[0].name).toBe("dev");
      expect(profiles[0].persona).toBe("~/personas/dev.md");
      expect(profiles[0].context).toEqual([
        "./conventions.md",
        "Always use strict mode",
      ]);
    });
  });

  // ---- resolvePersona ----

  describe("resolvePersona", () => {
    it("should resolve a file path to a loaded persona", async () => {
      io.addFile(
        `${PERSONA_DIR}/pirate.md`,
        "---\nname: Pirate\n---\nYou are a pirate.",
      );
      const result = await discovery.resolvePersona(
        `${PERSONA_DIR}/pirate.md`,
        HOMEDIR,
      );
      expect(result).not.toBeNull();
      expect(result!.prompt).toBe("You are a pirate.");
      expect(result!.display).toBe("Pirate");
    });

    it("should use filename as display name when no frontmatter name", async () => {
      io.addFile(`${PERSONA_DIR}/nameless.md`, "Just text, no frontmatter.");
      const result = await discovery.resolvePersona(
        `${PERSONA_DIR}/nameless.md`,
        HOMEDIR,
      );
      expect(result).not.toBeNull();
      expect(result!.display).toBe("nameless");
    });

    it("should return null for non-existent file", async () => {
      const result = await discovery.resolvePersona("/nonexistent.md", HOMEDIR);
      expect(result).toBeNull();
    });

    it("should treat inline text as a persona", async () => {
      const result = await discovery.resolvePersona(
        "You are a pirate!",
        HOMEDIR,
      );
      expect(result).not.toBeNull();
      expect(result!.prompt).toBe("You are a pirate!");
      expect(result!.display).toBe("You are a pirate!");
    });

    it("should truncate long inline text for display name", async () => {
      const longText = "A".repeat(50);
      const result = await discovery.resolvePersona(longText, HOMEDIR);
      expect(result!.display).toBe("A".repeat(30) + "...");
    });

    it("should resolve ~ paths in persona file paths", async () => {
      io.addFile(
        `${HOMEDIR}/personas/dev.md`,
        "---\nname: Dev\n---\nYou are a dev.",
      );
      const result = await discovery.resolvePersona(
        "~/personas/dev.md",
        HOMEDIR,
      );
      expect(result).not.toBeNull();
      expect(result!.display).toBe("Dev");
    });
  });

  // ---- loadPersonaFile ----

  describe("loadPersonaFile", () => {
    it("should load and parse a persona file", async () => {
      io.addFile("/test/persona.md", "---\nname: Test\n---\nYou are a test.");
      const result = await discovery.loadPersonaFile("/test/persona.md");
      expect(result).not.toBeNull();
      expect(result!.prompt).toBe("You are a test.");
      expect(result!.frontmatter.name).toBe("Test");
    });

    it("should return null for non-existent file", async () => {
      const result = await discovery.loadPersonaFile("/nonexistent.md");
      expect(result).toBeNull();
    });

    it("should handle file without frontmatter", async () => {
      io.addFile("/test/raw.txt", "Just raw content.");
      const result = await discovery.loadPersonaFile("/test/raw.txt");
      expect(result).not.toBeNull();
      expect(result!.prompt).toBe("Just raw content.");
      expect(result!.frontmatter).toEqual({});
    });

    it("should load persona file with context frontmatter", async () => {
      io.addFile(
        "/test/with-context.md",
        "---\nname: Project\ncontext:\n  - ./guidelines.md\n  - ./conventions.md\n---\nYou are a project expert.",
      );
      const result = await discovery.loadPersonaFile("/test/with-context.md");
      expect(result).not.toBeNull();
      expect(result!.prompt).toBe("You are a project expert.");
      expect(result!.frontmatter.name).toBe("Project");
      expect(result!.frontmatter.context).toEqual([
        "./guidelines.md",
        "./conventions.md",
      ]);
    });
  });

  // ---- resolveContextEntry ----

  describe("resolveContextEntry", () => {
    it("should expand ~ paths for file context", async () => {
      const result = await discovery.resolveContextEntry(
        "~/docs/guide.md",
        HOMEDIR,
        "/tmp",
      );
      expect(result).toBe(`${HOMEDIR}/docs/guide.md`);
    });

    it("should pass through absolute paths", async () => {
      const result = await discovery.resolveContextEntry(
        "/absolute/path.md",
        HOMEDIR,
        "/tmp",
      );
      expect(result).toBe("/absolute/path.md");
    });

    it("should write inline text to temp file and return its path", async () => {
      const result = await discovery.resolveContextEntry(
        "Some inline context text",
        HOMEDIR,
        "/tmp",
      );
      expect(result).toContain("/tmp/pi-context-");
      expect(result.endsWith(".txt")).toBe(true);

      // Verify the content was written
      const content = await io.readFile(result);
      expect(content).toBe("Some inline context text");
    });

    it("should hash long inline text for filename", async () => {
      const longText = "A".repeat(50);
      const result = await discovery.resolveContextEntry(
        longText,
        HOMEDIR,
        "/tmp",
      );
      expect(result).toContain("/tmp/pi-context-");
    });
  });

  // ---- FileIO unlink ----

  describe("FileIO unlink", () => {
    it("should remove a file via unlink", async () => {
      io.addFile("/test/file.md", "content");
      expect(await io.access("/test/file.md")).toBe(true);
      await io.unlink("/test/file.md");
      expect(await io.access("/test/file.md")).toBe(false);
    });

    it("should silently ignore unlink of non-existent file", async () => {
      // Should not throw
      await io.unlink("/nonexistent/file.md");
    });
  });

  // ---- discoverProfileFiles ----

  describe("discoverProfileFiles", () => {
    it("should discover .yml profile files", async () => {
      io.addFile(
        `${PERSONA_DIR}/tdd-be.yml`,
        "persona: tdd.md\ncontext:\n  - ./be/AGENTS.md",
      );
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("tdd-be");
      expect(profiles[0].config.persona).toBe("tdd.md");
      expect(profiles[0].config.context).toEqual(["./be/AGENTS.md"]);
    });

    it("should discover .yaml profile files", async () => {
      io.addFile(
        `${PERSONA_DIR}/full-stack.yaml`,
        'persona: "You are a full-stack developer"\ncontext:\n  - ./guide.md',
      );
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("full-stack");
      expect(profiles[0].config.persona).toBe("You are a full-stack developer");
    });

    it("should use name field from YAML if present", async () => {
      io.addFile(
        `${PERSONA_DIR}/custom.yml`,
        "name: My Custom Profile\npersona: dev.md\ncontext: []",
      );
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles[0].name).toBe("My Custom Profile");
    });

    it("should include description if present", async () => {
      io.addFile(
        `${PERSONA_DIR}/dev.yml`,
        "name: Dev\ndescription: Development profile\npersona: dev.md",
      );
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles[0].description).toBe("Development profile");
    });

    it("should skip files without persona field", async () => {
      io.addFile(
        `${PERSONA_DIR}/broken.yml`,
        "name: Broken\ncontext:\n  - ./a.md",
      );
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles).toHaveLength(0);
    });

    it("should handle YAML multiline context", async () => {
      io.addFile(
        `${PERSONA_DIR}/multi.yml`,
        "persona: tdd.md\ncontext:\n  - ./be/AGENTS.md\n  - |\n    Always use TypeScript strict mode.\n    Follow the backend patterns.",
      );
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].config.context!.length).toBe(2);
      expect(profiles[0].config.context![0]).toBe("./be/AGENTS.md");
      expect(profiles[0].config.context![1]).toContain("TypeScript strict");
    });

    it("should sort profiles by name", async () => {
      io.addFile(`${PERSONA_DIR}/zeta.yml`, "persona: a.md");
      io.addFile(`${PERSONA_DIR}/alpha.yml`, "persona: b.md");
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles[0].name).toBe("alpha");
      expect(profiles[1].name).toBe("zeta");
    });

    it("should skip hidden .yml files", async () => {
      io.addFile(`${PERSONA_DIR}/.hidden.yml`, "persona: hidden.md");
      io.addFile(`${PERSONA_DIR}/visible.yml`, "persona: visible.md");
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("visible");
    });

    it("should skip invalid YAML files", async () => {
      io.addFile(`${PERSONA_DIR}/bad.yml`, ": invalid: yaml: [[[{");
      const profiles = await discovery.discoverProfileFiles();
      expect(profiles).toHaveLength(0);
    });
  });

  // ---- resolveProfilePaths ----

  describe("resolveProfilePaths", () => {
    it("should resolve relative paths relative to baseDir", () => {
      const result = discovery.resolveProfilePaths(
        { persona: "./personas/dev.md", context: ["./guide.md"] },
        "/project/.pi/personas",
      );
      expect(result.persona).toBe("/project/.pi/personas/personas/dev.md");
      expect(result.context).toEqual(["/project/.pi/personas/guide.md"]);
    });

    it("should leave absolute paths unchanged", () => {
      const result = discovery.resolveProfilePaths(
        { persona: "/absolute/dev.md", context: ["/absolute/guide.md"] },
        "/project",
      );
      expect(result.persona).toBe("/absolute/dev.md");
      expect(result.context).toEqual(["/absolute/guide.md"]);
    });

    it("should leave inline text unchanged", () => {
      const result = discovery.resolveProfilePaths(
        { persona: "You are a helper", context: ["Always use strict mode"] },
        "/project",
      );
      expect(result.persona).toBe("You are a helper");
      expect(result.context).toEqual(["Always use strict mode"]);
    });

    it("should leave ~ paths unchanged (expanded by adapter later)", () => {
      const result = discovery.resolveProfilePaths(
        { persona: "~/dev.md", context: ["~/guide.md"] },
        "/project",
      );
      expect(result.persona).toBe("~/dev.md");
      expect(result.context).toEqual(["~/guide.md"]);
    });
  });
});
