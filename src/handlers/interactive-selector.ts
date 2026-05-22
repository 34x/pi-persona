/**
 * Interactive selector logic for `/persona` (no args).
 *
 * Pure-ish functions — no pi types, no side effects.
 * Callbacks handle persistence, temp tracking, UI, etc.
 */

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import type { PersonaManager } from "../persona-manager";
import type { PersonaSource } from "../types";
import type {
  DiscoveredProfileFile,
  DiscoveredPersona,
  DiscoveredProfile,
  ProfileConfig,
} from "../types";

// ---- Duck-typed discovery interface (tests can pass lightweight fakes) ----

export interface DiscoveryOps {
  discoverPersonas(): Promise<DiscoveredPersona[]>;
  discoverProfiles(): Promise<DiscoveredProfile[]>;
  discoverProfileFiles(): Promise<DiscoveredProfileFile[]>;
  resolvePersona(
    value: string,
    homedir: string,
  ): Promise<{
    prompt: string;
    display: string;
    params?: Record<string, unknown>;
  } | null>;
  loadPersonaFile(fullPath: string): Promise<{
    prompt: string;
    frontmatter: Record<string, unknown>;
    params?: Record<string, unknown>;
  } | null>;
  resolveProfilePaths(config: ProfileConfig, baseDir: string): ProfileConfig;
}

// ---- Dependency bag passed from the adapter ----

export interface SelectorDeps {
  manager: PersonaManager;
  discovery: DiscoveryOps;
  io: {
    readFile: (p: string) => Promise<string | null>;
    access: (p: string) => Promise<boolean>;
  };
  homedir: string;
  profilesConfig: Record<string, ProfileConfig>;
  onSetPersona: (
    prompt: string,
    display: string,
    ctx: ExtensionCommandContext,
    source?: PersonaSource,
  ) => Promise<void>;
  onResolveAndTrackContext: (value: string) => Promise<string>;
  onPersist: () => void;
  onUpdateStatusBar: (ctx: ExtensionCommandContext) => void;
  displayPath: (p: string) => string;
  looksLikePath: (s: string) => boolean;
}

// ---- Build selector list ----

export type SelectorItem =
  | { kind: "settings-profile"; profile: DiscoveredProfile }
  | { kind: "profile-file"; pf: DiscoveredProfileFile }
  | { kind: "persona"; persona: DiscoveredPersona };

export interface SelectorList {
  items: SelectorItem[];
  options: string[];
}

export async function buildSelectorList(
  deps: SelectorDeps,
): Promise<SelectorList> {
  const [personas, profiles, profileFiles] = await Promise.all([
    deps.discovery.discoverPersonas(),
    deps.discovery.discoverProfiles(),
    deps.discovery.discoverProfileFiles(),
  ]);

  const items: SelectorItem[] = [];

  for (const p of profiles)
    items.push({ kind: "settings-profile", profile: p });
  for (const pf of profileFiles) items.push({ kind: "profile-file", pf });
  for (const p of personas) items.push({ kind: "persona", persona: p });

  const options: string[] = [];
  for (const item of items) {
    if (item.kind === "settings-profile") {
      const p = item.profile;
      const ctxPreview = formatContextPreview(p.context, deps.looksLikePath);
      if (p.persona) {
        const preview = deps.looksLikePath(p.persona)
          ? deps.displayPath(p.persona)
          : p.persona.slice(0, 20) + (p.persona.length > 20 ? "..." : "");
        options.push(`📦 ${p.name}: ${preview}${ctxPreview}`);
      } else {
        options.push(`📦 ${p.name}${ctxPreview}`);
      }
    } else if (item.kind === "profile-file") {
      const pf = item.pf;
      const ctxPreview = formatContextPreview(
        pf.config.context,
        deps.looksLikePath,
      );
      if (pf.config.persona) {
        const preview = deps.looksLikePath(pf.config.persona)
          ? deps.displayPath(pf.config.persona)
          : pf.config.persona.slice(0, 20) +
            (pf.config.persona.length > 20 ? "..." : "");
        const desc = pf.description ? ` — ${pf.description.slice(0, 30)}` : "";
        options.push(`📋 ${pf.name}${desc}: ${preview}${ctxPreview}`);
      } else {
        const desc = pf.description ? ` — ${pf.description.slice(0, 30)}` : "";
        options.push(`📋 ${pf.name}${desc}${ctxPreview}`);
      }
    } else {
      const p = item.persona;
      const shortDesc =
        p.description && p.description.length > 30
          ? p.description.slice(0, 30) + "…"
          : p.description || "";
      const relPath = deps.displayPath(p.fullPath);
      options.push(
        shortDesc
          ? `${p.name}: ${shortDesc} (${relPath})`
          : `${p.name} (${relPath})`,
      );
    }
  }

  return { items, options };
}

// ---- Helpers ----

/**
 * Format context entries as a compact inline preview.
 * Paths show their basename, inline text is truncated.
 * Capped at ~60 chars total; extra entries become "…".
 */
function formatContextPreview(
  context: string[] | undefined,
  looksLikePath: (s: string) => boolean,
): string {
  if (!context || context.length === 0) return "";

  const maxTotal = 60;
  const parts: string[] = [];
  let total = 0;

  for (const c of context) {
    let preview: string;
    if (looksLikePath(c)) {
      preview = c.split("/").pop() ?? c;
    } else {
      preview = c.slice(0, 15) + (c.length > 15 ? "…" : "");
    }

    if (total + preview.length + (parts.length > 0 ? 2 : 0) > maxTotal) {
      parts.push("…");
      break;
    }
    parts.push(preview);
    total += preview.length;
  }

  return ` [${parts.join(", ")}]`;
}

// ---- Param merging helpers ----

function mergeParams(
  ...sources: (Record<string, unknown> | undefined)[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const src of sources) {
    if (src) Object.assign(merged, src);
  }
  return merged;
}

function applyParams(
  manager: PersonaManager,
  params: Record<string, unknown>,
): void {
  if (Object.keys(params).length > 0) {
    manager.setParams(params);
  }
}

function formatParamNote(params: Record<string, unknown>): string {
  const keys = Object.keys(params);
  if (keys.length === 0) return "";
  return ` (${keys.map((k) => `${k}=${params[k]}`).join(", ")})`;
}

// ---- Handle selection ----

export async function handleSelectorSelection(
  deps: SelectorDeps,
  selected: SelectorItem,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (selected.kind === "settings-profile") {
    const profile = selected.profile;
    // Resolve persona if specified (optional — profile may just add context/params)
    const resolved = profile.persona
      ? await deps.discovery.resolvePersona(profile.persona, deps.homedir)
      : null;

    if (profile.persona && !resolved) {
      ctx.ui.notify(`Failed to load persona from ${profile.persona}`, "error");
    }

    const merged = mergeParams(resolved?.params, profile.params);

    if (resolved) {
      await deps.onSetPersona(resolved.prompt, resolved.display, ctx, {
        type: "profile",
        name: profile.name,
      });
      applyParams(deps.manager, merged);
    } else {
      applyParams(deps.manager, merged);
    }

    if (profile.context.length > 0) {
      const resolvedCtxPaths = await Promise.all(
        profile.context.map((c: string) => deps.onResolveAndTrackContext(c)),
      );
      const { added, duplicates } =
        deps.manager.addContextPaths(resolvedCtxPaths);
      deps.onPersist();
      deps.onUpdateStatusBar(ctx);

      if (resolved) {
        let msg = `Profile "${profile.name}" loaded: persona "${resolved.display}"`;
        if (added > 0) msg += ` + ${added} context`;
        if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
        msg += formatParamNote(merged);
        ctx.ui.notify(msg, "info");
      } else {
        let msg = `Profile "${profile.name}" loaded`;
        if (added > 0) msg += `: ${added} context file(s) added`;
        if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
        msg += formatParamNote(merged);
        ctx.ui.notify(msg, "info");
      }
    } else if (resolved) {
      ctx.ui.notify(
        `Profile "${profile.name}" loaded: persona "${resolved.display}"${formatParamNote(merged)}`,
        "info",
      );
    } else {
      ctx.ui.notify(
        `Profile "${profile.name}" loaded (no persona)${formatParamNote(merged)}`,
        "info",
      );
    }
    return;
  }

  if (selected.kind === "profile-file") {
    const pf = selected.pf;
    const baseDir = pf.fullPath.substring(0, pf.fullPath.lastIndexOf("/"));
    const resolvedConfig = deps.discovery.resolveProfilePaths(
      pf.config,
      baseDir,
    );

    // Resolve persona if specified (optional — profile may just add context/params)
    const resolved = resolvedConfig.persona
      ? await deps.discovery.resolvePersona(
          resolvedConfig.persona,
          deps.homedir,
        )
      : null;

    if (resolvedConfig.persona && !resolved) {
      ctx.ui.notify(
        `Failed to load persona from ${resolvedConfig.persona}`,
        "error",
      );
    }

    const merged = mergeParams(resolved?.params, resolvedConfig.params);

    if (resolved) {
      await deps.onSetPersona(resolved.prompt, resolved.display, ctx, {
        type: "profile-file",
        name: pf.name,
      });
      applyParams(deps.manager, merged);
    } else {
      applyParams(deps.manager, merged);
    }

    const contextEntries = resolvedConfig.context ?? [];
    if (contextEntries.length > 0) {
      const resolvedCtxPaths = await Promise.all(
        contextEntries.map((c: string) => deps.onResolveAndTrackContext(c)),
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
        ctx.ui.notify(msg, "info");
      } else {
        let msg = `Profile "${pf.name}" loaded`;
        if (added > 0) msg += `: ${added} context file(s) added`;
        if (duplicates.length > 0) msg += `\nSkipped: ${duplicates.join(", ")}`;
        msg += formatParamNote(merged);
        ctx.ui.notify(msg, "info");
      }
    } else if (resolved) {
      ctx.ui.notify(
        `Profile "${pf.name}" loaded: persona "${resolved.display}"${formatParamNote(merged)}`,
        "info",
      );
    } else {
      ctx.ui.notify(
        `Profile "${pf.name}" loaded (no persona)${formatParamNote(merged)}`,
        "info",
      );
    }
    return;
  }

  // persona selected
  {
    const persona = selected.persona;
    const loaded = await deps.discovery.loadPersonaFile(persona.fullPath);
    if (!loaded) {
      ctx.ui.notify(`Failed to load persona from ${persona.fullPath}`, "error");
      return;
    }

    await deps.onSetPersona(loaded.prompt, persona.name, ctx, {
      type: "persona-file",
      name: persona.name,
    });
    applyParams(deps.manager, loaded.params ?? {});

    const contextList = loaded.frontmatter.context as string[] | undefined;
    if (contextList && contextList.length > 0) {
      const resolvedCtxPaths = await Promise.all(
        contextList.map((c: string) => deps.onResolveAndTrackContext(c)),
      );
      const { added: ctxAdded } =
        deps.manager.addContextPaths(resolvedCtxPaths);
      deps.onPersist();
      deps.onUpdateStatusBar(ctx);
      if (ctxAdded > 0) {
        ctx.ui.notify(
          `Added ${ctxAdded} context file(s) from persona frontmatter`,
          "info",
        );
      }
    }

    ctx.ui.notify(`Persona set: "${persona.name}"`, "info");
  }
}

// ---- Fallback: inline text when no items found ----

export function formatInlineTextPrompt(text: string): string {
  return text.slice(0, 30) + (text.length > 30 ? "..." : "");
}
