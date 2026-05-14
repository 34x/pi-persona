/**
 * Arg-based persona loading — handles direct `/persona <value>` commands.
 *
 * Pure-ish functions — no pi types, no side effects (callbacks for persistence, UI, etc.)
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { FileIO } from "../io";
import type { PersonaManager } from "../persona-manager";
import type { PersonaDiscovery } from "../persona-discovery";
import type { PersonaSource, ProfileConfig } from "../types";

// ---- Dependency bag ----

export interface ArgHandlerDeps {
  manager: PersonaManager;
  discovery: PersonaDiscovery;
  io: FileIO;
  homedir: string;
  tmpDir: string;
  profilesConfig: Record<string, ProfileConfig>;
  onSetPersona: (
    prompt: string,
    display: string,
    ctx: ExtensionContext,
    source?: PersonaSource,
  ) => Promise<void>;
  onResolveAndTrackContext: (value: string) => Promise<string>;
  onPersist: () => void;
  onUpdateStatusBar: (ctx: ExtensionContext) => void;
  onNotify: (msg: string, kind: "info" | "warning" | "error") => void;
  onInput: (
    title: string,
    initial: string,
  ) => Promise<string | null | undefined>;
  displayPath: (p: string) => string;
  expandPath: (p: string) => string;
  looksLikePath: (s: string) => boolean;
}

// ---- Param merging helper ----

function mergeParams(
  ...sources: (Record<string, unknown> | undefined)[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const src of sources) {
    if (src) Object.assign(merged, src);
  }
  return merged;
}

function formatParamNote(params: Record<string, unknown>): string {
  const keys = Object.keys(params);
  if (keys.length === 0) return "";
  return ` (${keys.map((k) => `${k}=${params[k]}`).join(", ")})`;
}

// ---- Settings profile ----

export async function loadSettingsProfile(
  deps: ArgHandlerDeps,
  name: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  const profile = deps.profilesConfig[name];
  if (!profile) return false;

  // Resolve persona if specified (optional — profile may just add context/params)
  const resolved = profile.persona
    ? await deps.discovery.resolvePersona(profile.persona, deps.homedir)
    : null;

  if (profile.persona && !resolved) {
    deps.onNotify(`Failed to load persona: ${profile.persona}`, "error");
  }

  // Merge params regardless of persona
  const merged = mergeParams(resolved?.params, profile.params);

  // Set persona if resolved successfully
  if (resolved) {
    await deps.onSetPersona(resolved.prompt, resolved.display, ctx, {
      type: "profile",
      name,
    });
    if (Object.keys(merged).length > 0) {
      deps.manager.setParams(merged);
    }
  } else if (Object.keys(merged).length > 0) {
    deps.manager.setParams(merged);
  }

  // Load context regardless of persona
  const contextEntries = profile.context ?? [];
  if (contextEntries.length > 0) {
    const resolvedCtxPaths = await Promise.all(
      contextEntries.map((c) => deps.onResolveAndTrackContext(c)),
    );
    const { added, duplicates } =
      deps.manager.addContextPaths(resolvedCtxPaths);
    deps.onPersist();
    deps.onUpdateStatusBar(ctx);

    if (resolved) {
      let msg = `Profile "${name}" loaded: persona "${resolved.display}"`;
      if (added > 0) msg += ` + ${added} context`;
      if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
      msg += formatParamNote(merged);
      deps.onNotify(msg, "info");
    } else {
      let msg = `Profile "${name}" loaded`;
      if (added > 0) msg += `: ${added} context file(s) added`;
      if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
      msg += formatParamNote(merged);
      deps.onNotify(msg, "info");
    }
  } else if (resolved) {
    deps.onNotify(
      `Profile "${name}" loaded: persona "${resolved.display}"${formatParamNote(merged)}`,
      "info",
    );
  } else {
    deps.onNotify(
      `Profile "${name}" loaded (no persona)${formatParamNote(merged)}`,
      "info",
    );
  }

  return true; // handled
}

// ---- Profile file ----

export async function loadProfileFileByName(
  deps: ArgHandlerDeps,
  name: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  const files = await deps.discovery.discoverProfileFiles();
  const pf = files.find(
    (f) => f.name === name || f.name === name.replace(/\.(yml|yaml)$/, ""),
  );
  if (!pf) return false; // not handled

  const baseDir = pf.fullPath.substring(0, pf.fullPath.lastIndexOf("/"));
  const resolvedConfig = deps.discovery.resolveProfilePaths(pf.config, baseDir);

  // Resolve persona if specified (optional — profile may just add context/params)
  const resolved = resolvedConfig.persona
    ? await deps.discovery.resolvePersona(resolvedConfig.persona, deps.homedir)
    : null;

  if (resolvedConfig.persona && !resolved) {
    deps.onNotify(`Failed to load persona from ${resolvedConfig.persona}`, "error");
  }

  // Merge params regardless of persona
  const merged = mergeParams(resolved?.params, resolvedConfig.params);

  // Set persona if resolved successfully
  if (resolved) {
    await deps.onSetPersona(resolved.prompt, resolved.display, ctx, {
      type: "profile-file",
      name: pf.name,
    });
    if (Object.keys(merged).length > 0) {
      deps.manager.setParams(merged);
    }
  } else if (Object.keys(merged).length > 0) {
    deps.manager.setParams(merged);
  }

  // Load context regardless of persona
  const contextEntries = resolvedConfig.context ?? [];
  if (contextEntries.length > 0) {
    const resolvedCtxPaths = await Promise.all(
      contextEntries.map((c) => deps.onResolveAndTrackContext(c)),
    );
    const { added, duplicates } =
      deps.manager.addContextPaths(resolvedCtxPaths);
    deps.onPersist();
    deps.onUpdateStatusBar(ctx);

    if (resolved) {
      let msg = `Profile "${pf.name}" loaded: persona "${resolved.display}"`;
      if (added > 0) msg += ` + ${added} context`;
      if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
      msg += formatParamNote(merged);
      deps.onNotify(msg, "info");
    } else {
      let msg = `Profile "${pf.name}" loaded`;
      if (added > 0) msg += `: ${added} context file(s) added`;
      if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
      msg += formatParamNote(merged);
      deps.onNotify(msg, "info");
    }
  } else if (resolved) {
    deps.onNotify(
      `Profile "${pf.name}" loaded: persona "${resolved.display}"${formatParamNote(merged)}`,
      "info",
    );
  } else {
    deps.onNotify(
      `Profile "${pf.name}" loaded (no persona)${formatParamNote(merged)}`,
      "info",
    );
  }

  return true; // handled
}

// ---- File path (handles .yml/.yaml profile bundles and .md persona files) ----

export async function loadByFilePath(
  deps: ArgHandlerDeps,
  trimmed: string,
  ctx: ExtensionContext,
): Promise<"handled" | "not-a-path"> {
  if (!deps.looksLikePath(trimmed)) return "not-a-path";

  const expanded = deps.expandPath(trimmed);
  const exists = await deps.io.access(expanded);
  if (!exists) {
    deps.onNotify(`File not found: ${expanded}`, "error");
    return "handled";
  }

  // .yml/.yaml files are profile bundles
  if (expanded.endsWith(".yml") || expanded.endsWith(".yaml")) {
    return await loadYamlProfile(deps, expanded, ctx);
  }

  // .md/.txt files — persona files
  return await loadPersonaFile(deps, expanded, ctx);
}

async function loadYamlProfile(
  deps: ArgHandlerDeps,
  fullPath: string,
  ctx: ExtensionContext,
): Promise<"handled"> {
  const content = await deps.io.readFile(fullPath);
  if (!content) {
    deps.onNotify(`Failed to read profile: ${fullPath}`, "error");
    return "handled";
  }

  try {
    const { parse } = await import("yaml");
    const parsed = parse(content) as Record<string, unknown>;
    const persona = typeof parsed.persona === "string" ? parsed.persona : "";
    const context = Array.isArray(parsed.context)
      ? parsed.context.filter(
          (c: unknown): c is string => typeof c === "string",
        )
      : [];
    const params =
      parsed.params &&
      typeof parsed.params === "object" &&
      !Array.isArray(parsed.params)
        ? (parsed.params as Record<string, unknown>)
        : undefined;

    const profileName =
      typeof parsed.name === "string"
        ? parsed.name
        : fullPath
            .substring(fullPath.lastIndexOf("/") + 1)
            .replace(/\.[^.]+$/, "");

    if (!persona) {
      // No persona specified — profile may just add context/params
      if (params && Object.keys(params).length > 0) {
        deps.manager.setParams(params);
      }
      if (context.length > 0) {
        const resolvedCtxPaths = await Promise.all(
          context.map((c) => deps.onResolveAndTrackContext(c)),
        );
        const { added, duplicates } =
          deps.manager.addContextPaths(resolvedCtxPaths);
        deps.onPersist();
        deps.onUpdateStatusBar(ctx);

        let msg = `Profile "${profileName}" loaded`;
        if (added > 0) msg += `: ${added} context file(s) added`;
        if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
        msg += formatParamNote((params ?? {}) as Record<string, unknown>);
        deps.onNotify(msg, "info");
      } else {
        deps.onNotify(
          `Profile "${profileName}" loaded (no persona)`,
          "info",
        );
      }
    } else {
      // Persona specified — resolve and load it
      const baseDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      const resolvedConfig = deps.discovery.resolveProfilePaths(
        { persona, context, params },
        baseDir,
      );
      const resolved = await deps.discovery.resolvePersona(
        resolvedConfig.persona!,
        deps.homedir,
      );
      if (!resolved) {
        deps.onNotify(
          `Failed to load persona from profile: ${resolvedConfig.persona!}`,
          "error",
        );
      }

      const merged = mergeParams(resolved?.params, resolvedConfig.params);

      // Set persona if resolved successfully
      if (resolved) {
        await deps.onSetPersona(resolved.prompt, resolved.display, ctx, {
          type: "profile-file",
          name: profileName,
        });
        if (Object.keys(merged).length > 0) {
          deps.manager.setParams(merged);
        }
      } else if (Object.keys(merged).length > 0) {
        deps.manager.setParams(merged);
      }

      // Load context regardless of persona
      const contextEntries = resolvedConfig.context ?? [];
      if (contextEntries.length > 0) {
        const resolvedCtxPaths = await Promise.all(
          contextEntries.map((c) => deps.onResolveAndTrackContext(c)),
        );
        const { added, duplicates } =
          deps.manager.addContextPaths(resolvedCtxPaths);
        deps.onPersist();
        deps.onUpdateStatusBar(ctx);

        if (resolved) {
          let msg = `Profile "${profileName}" loaded: persona "${resolved.display}"`;
          if (added > 0) msg += ` + ${added} context`;
          if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
          msg += formatParamNote(merged);
          deps.onNotify(msg, "info");
        } else {
          let msg = `Profile "${profileName}" loaded`;
          if (added > 0) msg += `: ${added} context file(s) added`;
          if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
          msg += formatParamNote(merged);
          deps.onNotify(msg, "info");
        }
      } else if (resolved) {
        deps.onNotify(
          `Profile "${profileName}" loaded: persona "${resolved.display}"${formatParamNote(merged)}`,
          "info",
        );
      } else {
        deps.onNotify(
          `Profile "${profileName}" loaded (no persona)${formatParamNote(merged)}`,
          "info",
        );
      }
    }
  } catch {
    deps.onNotify(`Failed to parse profile: ${fullPath}`, "error");
  }

  return "handled";
}

async function loadPersonaFile(
  deps: ArgHandlerDeps,
  fullPath: string,
  ctx: ExtensionContext,
): Promise<"handled"> {
  const loaded = await deps.discovery.loadPersonaFile(fullPath);
  if (!loaded) {
    deps.onNotify(`Failed to load persona from ${fullPath}`, "error");
    return "handled";
  }

  const displayName =
    (loaded.frontmatter.name as string | undefined) ??
    fullPath.substring(fullPath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

  await deps.onSetPersona(loaded.prompt, displayName, ctx, {
    type: "persona-file",
    name: displayName,
  });
  if (loaded.params && Object.keys(loaded.params).length > 0) {
    deps.manager.setParams(loaded.params);
  }

  const contextList = loaded.frontmatter.context as string[] | undefined;
  if (contextList && contextList.length > 0) {
    const resolvedCtxPaths = await Promise.all(
      contextList.map((c) => deps.onResolveAndTrackContext(c)),
    );
    const { added: ctxAdded } = deps.manager.addContextPaths(resolvedCtxPaths);
    deps.onPersist();
    deps.onUpdateStatusBar(ctx);
    if (ctxAdded > 0) {
      deps.onNotify(
        `Added ${ctxAdded} context file(s) from persona frontmatter`,
        "info",
      );
    }
  }

  deps.onNotify(`Persona loaded from: ${fullPath}`, "info");

  return "handled";
}

// ---- Inline text ----

export async function loadInlineText(
  deps: ArgHandlerDeps,
  text: string,
  ctx: ExtensionContext,
): Promise<void> {
  const displayName = text.slice(0, 30) + (text.length > 30 ? "..." : "");
  await deps.onSetPersona(text, displayName, ctx, { type: "inline" });
  const actualDisplay = deps.manager.getPersonaDisplay() ?? displayName;
  deps.onNotify(`Persona set: "${actualDisplay}"`, "info");
}

// ---- persona:create helpers ----

export interface CreatePersonaFileOptions {
  expandedPath: string;
  targetDir: string;
  personaName: string;
}

export function parseCreateArgs(
  deps: ArgHandlerDeps,
  args: string,
): CreatePersonaFileOptions | null {
  const parts = args.trim().split(/\s+/);

  if (
    parts.length >= 1 &&
    (parts[0].startsWith("/") ||
      parts[0].startsWith(".") ||
      parts[0].startsWith("~"))
  ) {
    const expanded = deps.expandPath(parts[0]);
    const targetDir = expanded.substring(0, expanded.lastIndexOf("/"));
    const personaName = expanded
      .substring(expanded.lastIndexOf("/") + 1)
      .replace(/\.[^.]+$/, "");
    return { expandedPath: expanded, targetDir, personaName };
  }

  return null; // interactive path selection
}

export function formatCreateDefaultContent(personaName: string): string {
  return `---\nname: ${personaName}\ndescription: A custom persona\n---\n\nYou are ${personaName}.\n\n[Describe the persona's characteristics, expertise, and behavior here]\n`;
}

export function formatCreateDirMessage(personaPath: string): string {
  return `Created persona: ${personaPath}`;
}

export function formatCreateError(error: unknown): string {
  return `Failed to create persona: ${error}`;
}

export function formatCreateNeedDir(targetDir: string): string {
  return `Failed to create directory: ${targetDir}`;
}

// ---- persona:clear helpers ----

export function formatClearNoPersona(): string {
  return "No persona set (using default)";
}

export function formatClearDone(): string {
  return "Persona cleared (using default)";
}