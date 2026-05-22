/**
 * PersonaDiscovery — find, load, and resolve personas + profiles.
 *
 * All I/O goes through the injected FileIO interface.
 * All paths must be pre-expanded (no os.homedir() dependency).
 * Fully testable with InMemoryFileIO.
 */

import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  FileIO,
  ProfileConfig,
  PersonaFrontmatter,
  DiscoveredPersona,
  DiscoveredProfile,
  DiscoveredProfileFile,
} from "./types";
import { parseFrontmatter, looksLikePath, expandPath } from "./utils";

export class PersonaDiscovery {
  constructor(
    private io: FileIO,
    private personaDirs: string[],
    private profilesConfig: Record<string, ProfileConfig>,
  ) {}

  /**
   * Scan persona directories for .md/.txt files and parse their frontmatter.
   */
  async discoverPersonas(): Promise<DiscoveredPersona[]> {
    const personas: DiscoveredPersona[] = [];
    const seen = new Set<string>();

    for (const dir of this.personaDirs) {
      const entries = await this.io.readdir(dir);

      for (const entryName of entries) {
        // Skip hidden files
        if (entryName.startsWith(".")) continue;
        if (!entryName.endsWith(".md") && !entryName.endsWith(".txt")) continue;

        const fullPath = path.join(dir, entryName);
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);

        const content = await this.io.readFile(fullPath);
        if (content !== null) {
          const { frontmatter } = parseFrontmatter(content);
          personas.push({
            name: frontmatter.name || entryName.replace(/\.(md|txt)$/, ""),
            description: frontmatter.description,
            fullPath,
          });
        }
      }
    }

    personas.sort((a, b) => a.name.localeCompare(b.name));
    return personas;
  }

  /**
   * Return the configured profiles as DiscoveredProfile objects.
   */
  async discoverProfiles(): Promise<DiscoveredProfile[]> {
    return Object.entries(this.profilesConfig).map(([name, config]) => ({
      name,
      persona: config.persona,
      context: config.context ?? [],
      params: config.params,
    }));
  }

  /**
   * Scan persona directories for .yml/.yaml profile files.
   *
   * Each file is parsed as a ProfileConfig with optional `name` and
   * `description` fields. Paths are resolved via resolveProfilePaths.
   * See that method for the path resolution convention.
   */
  async discoverProfileFiles(): Promise<DiscoveredProfileFile[]> {
    const profiles: DiscoveredProfileFile[] = [];
    const seen = new Set<string>();

    for (const dir of this.personaDirs) {
      const entries = await this.io.readdir(dir);

      for (const entryName of entries) {
        if (entryName.startsWith(".")) continue;
        if (!entryName.endsWith(".yml") && !entryName.endsWith(".yaml"))
          continue;

        const fullPath = path.join(dir, entryName);
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);

        const content = await this.io.readFile(fullPath);
        if (content === null) continue;

        try {
          const parsed = parseYaml(content) as Record<string, unknown>;
          if (!parsed || typeof parsed !== "object") continue;

          const name =
            typeof parsed.name === "string"
              ? parsed.name
              : entryName.replace(/\.(yml|yaml)$/, "");
          const description =
            typeof parsed.description === "string"
              ? parsed.description
              : undefined;

          const persona =
            typeof parsed.persona === "string" ? parsed.persona : "";
          const context = Array.isArray(parsed.context)
            ? parsed.context.filter((c): c is string => typeof c === "string")
            : [];

          const params =
            parsed.params &&
            typeof parsed.params === "object" &&
            !Array.isArray(parsed.params)
              ? (parsed.params as Record<string, unknown>)
              : undefined;

          if (!persona) continue; // persona is required

          profiles.push({
            name,
            description,
            fullPath,
            config: { persona, context, params },
          });
        } catch {
          // Invalid YAML — skip
        }
      }
    }

    profiles.sort((a, b) => a.name.localeCompare(b.name));
    return profiles;
  }

  /**
   * Resolve a persona value: if it's a file path, load it; if it's inline
   * text, use directly.
   */
  async resolvePersona(
    value: string,
    homedir: string,
  ): Promise<{
    prompt: string;
    display: string;
    params?: Record<string, unknown>;
  } | null> {
    if (!value || typeof value !== "string") return null;
    if (looksLikePath(value)) {
      const loaded = await this.loadPersonaFile(expandPath(value, homedir));
      if (!loaded) return null;
      return {
        prompt: loaded.prompt,
        display:
          loaded.frontmatter.name || path.basename(value, path.extname(value)),
        params: loaded.frontmatter.params,
      };
    }
    // Inline text — use as-is
    return {
      prompt: value,
      display: value.slice(0, 30) + (value.length > 30 ? "..." : ""),
    };
  }

  /**
   * Load and parse a persona file at the given path.
   */
  async loadPersonaFile(fullPath: string): Promise<{
    prompt: string;
    frontmatter: PersonaFrontmatter;
    params?: Record<string, unknown>;
  } | null> {
    const content = await this.io.readFile(fullPath);
    if (content === null) return null;

    const { frontmatter, body } = parseFrontmatter(content);
    return { prompt: body, frontmatter, params: frontmatter.params };
  }

  /**
   * Resolve a context entry: if it's a file path, expand it; if it's inline
   * text, write to a temp file for consistent handling.
   *
   * Note: temp files are written via the injected FileIO. In production
   * this goes to os.tmpdir(); tests can track writes via InMemoryFileIO.
   */
  async resolveContextEntry(
    value: string,
    homedir: string,
    tmpDir: string,
  ): Promise<string> {
    if (!value || typeof value !== "string") return value ?? "";
    if (looksLikePath(value)) {
      return expandPath(value, homedir);
    }
    // Inline text — write to temp file for consistent handling
    const textHash =
      value.length > 40
        ? value.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_")
        : value.replace(/[^a-zA-Z0-9]/g, "_");
    const tmpPath = path.join(tmpDir, `pi-context-${textHash}.txt`);
    await this.io.writeFile(tmpPath, value);
    return tmpPath;
  }

  /**
   * Resolve relative paths in a profile config using the profile file's directory.
   *
   * Convention:
   * - `./foo.md`  or `../foo.md` → resolved relative to the profile file's directory
   * - `foo.md`    (bare name)    → passed through unchanged (resolved against CWD later)
   * - `/abs/path`                → passed through (absolute)
   * - `~/path`                   → passed through (expanded by adapter later)
   * - Inline text (non-path)     → passed through unchanged
   */
  resolveProfilePaths(config: ProfileConfig, baseDir: string): ProfileConfig {
    const persona = config.persona
      ? looksLikePath(config.persona)
        ? this.resolveRelativePath(config.persona, baseDir)
        : config.persona
      : undefined;

    const context =
      config.context?.map((c) =>
        looksLikePath(c) ? this.resolveRelativePath(c, baseDir) : c,
      ) ?? [];

    return { persona, context, params: config.params };
  }

  /**
   * Resolve a path from a profile file.
   *
   * Convention for .yml/.yaml profile files:
   * - `./foo.md` or `../foo.md` → resolved relative to the profile file's directory
   * - `foo.md` (bare name)     → passed through unchanged (resolved against CWD by io.readFile)
   * - `/abs/path`              → passed through (absolute)
   * - `~/path`                 → passed through (expanded by adapter later)
   */
  private resolveRelativePath(filePath: string, baseDir: string): string {
    if (filePath.startsWith("/")) return filePath;
    if (filePath.startsWith("~")) return filePath; // expanded by adapter later
    // Only ./ and ../ are resolved relative to the profile file's directory
    if (filePath.startsWith("./")) return path.resolve(baseDir, filePath);
    if (filePath.startsWith("../")) return path.resolve(baseDir, filePath);
    // Bare path (no ./ prefix) → CWD-relative, passed through unchanged
    return filePath;
  }
}
