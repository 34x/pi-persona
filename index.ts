/**
 * Pi Persona Extension - Thin Adapter
 *
 * ONLY module importing from `@mariozechner/pi-coding-agent`.
 * Wires pi events and commands to handler functions.
 * All business logic lives in src/handlers/ and src/.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import os from "node:os";

import { PersonaManager } from "./src/persona-manager";
import { PersonaDiscovery } from "./src/persona-discovery";
import { NodeFileIO } from "./src/io";
import type {
  FileIO,
  PiPersonaSettings,
  SettingsFile,
  PersonaSource,
} from "./src/types";
import { CTX_ENTRY_TYPE, PERSONA_ENTRY_TYPE } from "./src/types";
import type { ContextFilesData, PersonaStateData } from "./src/types";
import {
  looksLikePath,
  expandPath,
  displayPath as utilDisplayPath,
  resolveFilePath,
  parseParamArgs,
  formatParamStatus,
} from "./src/utils";
import {
  buildSelectorList,
  handleSelectorSelection,
  type SelectorItem,
} from "./src/handlers/interactive-selector";
import {
  type ArgHandlerDeps,
  loadSettingsProfile,
  loadProfileFileByName,
  loadByFilePath,
  loadInlineText,
  parseCreateArgs,
  formatCreateDefaultContent,
} from "./src/handlers/arg-handler";
import {
  handleContextAdd,
  formatAddSuccess,
  formatAddUsageError,
  handleContextRemove,
  formatRemoveMessage,
  formatRemoveUsageError,
  handleContextClean,
  formatCleanMessage,
  handleContextList,
  formatListEmpty,
  type ContextDeps,
} from "./src/handlers/context-handler";
import { createBeforeProviderRequestHandler } from "./src/params-injection";

// ============================================================================
// Settings loading (adapter-level — reads from disk at init)
// ============================================================================

async function loadSettings(
  io: FileIO,
  homedir: string,
): Promise<PiPersonaSettings> {
  for (const configPath of [
    path.join(".pi", "settings.json"),
    path.join(".pi", "pi-persona.json"),
    path.join(homedir, ".pi", "agent", "settings.json"),
  ]) {
    const content = await io.readFile(configPath);
    if (content !== null) {
      try {
        const settings = JSON.parse(content) as SettingsFile;
        if (settings["pi-persona"]) return settings["pi-persona"];
      } catch {
        // invalid JSON — skip
      }
    }
  }
  return {};
}

// ============================================================================
// Scope options for persona:create
// ============================================================================

const SCOPE_OPTIONS = [
  "Local (.pi/extensions/pi-persona/personas/)",
  "Global (~/.pi/agent/personas/)",
  "Custom folder...",
];

// ============================================================================
// Extension entry point
// ============================================================================

export default async function (pi: ExtensionAPI) {
  const io = new NodeFileIO();
  const homedir = os.homedir();
  const tmpDir = os.tmpdir();
  const manager = new PersonaManager();

  // Load settings and build discovery once at init
  // ==========================================================================
  // CLI Flags
  // ==========================================================================

  pi.registerFlag("persona", {
    description: "Load a persona by name, path, or inline text at startup",
    type: "string",
  });

  pi.registerFlag("persona-params", {
    description:
      "Set inference params as comma-separated key=value pairs (e.g., --persona-params temperature=0.7,top_p=0.9)",
    type: "string",
  });
  const settings = await loadSettings(io, homedir);
  const personaDirs =
    settings.personaPaths && Array.isArray(settings.personaPaths)
      ? settings.personaPaths.map((p: string) => expandPath(p, homedir))
      : [path.join(homedir, ".pi", "agent", "personas")];
  const profilesConfig = settings.profiles ?? {};
  const discovery = new PersonaDiscovery(io, personaDirs, profilesConfig);

  const tempFilePaths = new Set<string>();

  // ---- Adapter-level operations ----

  function persistContextState(): void {
    try {
      pi.appendEntry<ContextFilesData>(
        CTX_ENTRY_TYPE,
        manager.getContextState(),
      );
    } catch {
      /* session may not be active */
    }
  }

  function persistPersonaState(): void {
    try {
      pi.appendEntry<PersonaStateData>(
        PERSONA_ENTRY_TYPE,
        manager.getPersonaState(),
      );
    } catch {
      /* session may not be active */
    }
  }

  /** Short label for status bar: profile→"via profile:X", profile-file→"via .yml", persona-file→nothing */
  function sourceToLabel(source: PersonaSource | null): string {
    if (!source) return "";
    switch (source.type) {
      case "profile":
        return `via profile:${source.name}`;
      case "profile-file":
        return `via ${source.name}.yml`;
      case "persona-file":
      case "inline":
      default:
        return "";
    }
  }

  function updateStatusBar(ctx: ExtensionContext): void {
    const state = manager.getState();
    const paramStr = formatParamStatus(state.params);
    const parts: string[] = [];

    if (state.personaDisplay) {
      const sourceLabel = sourceToLabel(state.source);
      const viaTag = sourceLabel ? ` ${sourceLabel}` : "";
      parts.push(
        ctx.ui.theme.fg("dim", `[persona: ${state.personaDisplay}${viaTag}]`),
      );
    }
    if (state.contextPaths.length > 0)
      parts.push(ctx.ui.theme.fg("dim", `ctx: ${state.contextPaths.length}`));
    if (paramStr) parts.push(ctx.ui.theme.fg("dim", paramStr));

    if (parts.length > 0) {
      ctx.ui.setStatus("pi-persona", parts.join(" "));
    } else {
      ctx.ui.setStatus("pi-persona", undefined);
    }
  }

  async function resolveAndTrackContext(value: string): Promise<string> {
    const resolved = await discovery.resolveContextEntry(
      value,
      homedir,
      tmpDir,
    );
    if (resolved.startsWith(tmpDir)) tempFilePaths.add(resolved);
    return resolved;
  }

  function cleanupTempFiles(): void {
    for (const tmpPath of tempFilePaths) {
      io.unlink(tmpPath).catch(() => {
        /* ignore */
      });
    }
    tempFilePaths.clear();
  }

  async function setPersona(
    prompt: string,
    displayName: string,
    ctx: ExtensionContext,
    source?: PersonaSource,
  ): Promise<void> {
    manager.setPersona(prompt, displayName, source);
    persistPersonaState();
    persistContextState();
    updateStatusBar(ctx);
  }

  /**
   * Build the shared ArgHandlerDeps object.
   * Reused by resolveAndLoadPersona, loadDefaultPersona, and the /persona command.
   */
  function buildDeps(ctx: ExtensionContext): ArgHandlerDeps {
    return {
      manager,
      discovery,
      io,
      homedir,
      tmpDir,
      profilesConfig,
      onSetPersona: setPersona,
      onResolveAndTrackContext: resolveAndTrackContext,
      onPersist: () => {
        persistContextState();
      },
      onUpdateStatusBar: updateStatusBar,
      onNotify: (msg, kind) => ctx.ui.notify(msg, kind),
      onInput: (title, initial) => ctx.ui.input(title, initial),
      displayPath,
      expandPath: expandPathFn,
      looksLikePath,
    };
  }

  /**
   * Resolve and load a persona using the same resolution chain as /persona <value>.
   *
   * Resolution order:
   *   1. Settings profile name (profilesConfig)
   *   2. Profile file name (.yml/.yaml in persona dirs)
   *   3. File path (.yml/.yaml/.md)
   *   4. Inline text (fallback)
   */
  async function resolveAndLoadPersona(
    value: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    const deps = buildDeps(ctx);

    // 1. Try as a settings profile name
    if (profilesConfig[value]) {
      await loadSettingsProfile(deps, value, ctx);
      return;
    }

    // 2. Try as a profile file name (.yml/.yaml)
    const profileFileHandled = await loadProfileFileByName(deps, value, ctx);
    if (profileFileHandled) return;

    // 3. Try as a file path
    const pathResult = await loadByFilePath(deps, value, ctx);
    if (pathResult === "handled") return;

    // 4. Fallback: inline text
    await loadInlineText(deps, value, ctx);
  }

  /**
   * Load the default persona/profile from settings when no persona is active.
   * Called on session_start after session restore and CLI flags.
   *
   * Resolution order (same as /persona command):
   *   1. Settings profile name (profilesConfig)
   *   2. Profile file name (.yml/.yaml in persona dirs)
   *   3. File path (.yml/.yaml/.md)
   *   4. Inline text (fallback)
   */
  async function loadDefaultPersona(ctx: ExtensionContext): Promise<void> {
    const defaultSetting = settings.default;
    if (!defaultSetting) return;

    // Don't override an already-active persona
    if (manager.getPersona()) return;

    // Resolve the default value to a string
    let value: string | null = null;
    if (typeof defaultSetting === "string") {
      value = defaultSetting;
    } else if (typeof defaultSetting === "object" && defaultSetting !== null) {
      value =
        defaultSetting.profile ??
        defaultSetting.persona ??
        defaultSetting.path ??
        null;
    }

    if (!value) return;

    // Delegate to the shared resolution chain
    await resolveAndLoadPersona(value, ctx);
  }

  // ---- Shared adapter helpers passed to handlers ----

  const displayPath = (p: string) => utilDisplayPath(p, homedir);
  const expandPathFn = (p: string) => expandPath(p, homedir);

  // ==========================================================================
  // Event hooks
  // ==========================================================================

  // @ts-expect-error - "before_provider_request" is a valid event but the peer-dep type
  // definitions may not include it in their overload signatures (runtime works correctly).
  pi.on("before_provider_request", createBeforeProviderRequestHandler(manager));

  pi.on("before_agent_start", async (event) => {
    const prompt = await manager.buildSystemPrompt(
      event.systemPrompt,
      io.readFile.bind(io),
      homedir,
    );
    return prompt !== event.systemPrompt ? { systemPrompt: prompt } : {};
  });

  pi.on("session_start", async (_event, ctx) => {
    // 1. Restore session state first (so CLI flags can override it)
    manager.restoreFromEntries(ctx.sessionManager.getBranch());

    // 2. Handle CLI flags (override restored state)
    const personaFlag = pi.getFlag("persona");
    if (typeof personaFlag === "string" && personaFlag.trim()) {
      // Use the same resolution chain as /persona <value> and loadDefaultPersona:
      // settings profile → profile file → file path → inline text
      await resolveAndLoadPersona(personaFlag.trim(), ctx);
    }

    const paramsFlag = pi.getFlag("persona-params");
    if (typeof paramsFlag === "string" && paramsFlag.trim()) {
      const trimmed = paramsFlag.trim();
      // Validate: must contain at least one "key=value" pair
      if (!/\w+=\S/.test(trimmed)) {
        ctx.ui.notify(
          "--persona-params requires key=value pairs (e.g., temperature=0.7,top_p=0.9)",
          "error",
        );
      } else {
        try {
          // comma-separated format: temperature=0.7,top_p=0.9
          const spaceSep = trimmed.replace(/,/g, " ");
          const params = parseParamArgs(spaceSep);
          if (params === null) {
            ctx.ui.notify(
              "Use /persona:params clear instead of --persona-params clear",
              "warning",
            );
          } else {
            manager.setParams(params);
            persistPersonaState();
            updateStatusBar(ctx);
          }
        } catch (error) {
          ctx.ui.notify(
            `Invalid params format: ${error}. Use --persona-params temperature=0.7,top_p=0.9`,
            "error",
          );
        }
      }
    }

    // 3. Load default persona from settings if no persona is active
    await loadDefaultPersona(ctx);

    // 4. Load top-level context files from settings (unconditional, like AGENTS.md)
    const settingsCtx = settings.context ?? [];
    if (settingsCtx.length > 0) {
      const resolvedCtxPaths = await Promise.all(
        settingsCtx.map((c) => resolveAndTrackContext(c)),
      );
      const { added } = manager.addContextPaths(resolvedCtxPaths);
      if (added > 0) {
        persistContextState();
      }
    }

    updateStatusBar(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    updateStatusBar(ctx);
  });

  // ==========================================================================
  // /persona command
  // ==========================================================================

  pi.registerCommand("persona", {
    description: "Set persona (name, path, profile, or inline text)",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      // ---- No args: interactive selector ----
      if (!trimmed) {
        const { items, options } = await buildSelectorList({
          manager,
          discovery,
          io,
          homedir,
          profilesConfig,
          onSetPersona: setPersona,
          onResolveAndTrackContext: resolveAndTrackContext,
          onPersist: () => {
            persistContextState();
          },
          onUpdateStatusBar: updateStatusBar,
          displayPath,
          looksLikePath,
        });

        if (options.length === 0) {
          const answer = await ctx.ui.input(
            "No personas or profiles found. Enter persona text or file path:",
            "",
          );
          if (!answer) {
            ctx.ui.notify("Cancelled", "info");
            return;
          }
          const apiOk = await setPersona(
            answer,
            answer.slice(0, 30) + (answer.length > 30 ? "..." : ""),
            ctx,
            { type: "inline" },
          );
          const display = manager.getPersonaDisplay() ?? "";
          ctx.ui.notify(`Persona set: "${display}"`, "info");
          return;
        }

        const selected = await ctx.ui.select(
          "Select a persona or profile:",
          options,
        );
        if (!selected) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const idx = options.indexOf(selected);
        if (idx === -1 || idx >= items.length) {
          ctx.ui.notify("Invalid selection", "error");
          return;
        }

        await handleSelectorSelection(
          {
            manager,
            discovery,
            io,
            homedir,
            profilesConfig,
            onSetPersona: setPersona,
            onResolveAndTrackContext: resolveAndTrackContext,
            onPersist: () => {
              persistContextState();
            },
            onUpdateStatusBar: updateStatusBar,
            displayPath,
            looksLikePath,
          },
          items[idx] as SelectorItem,
          ctx,
        );
        return;
      }

      // ---- Resolve value using same chain as --persona flag and /persona command ----
      await resolveAndLoadPersona(trimmed, ctx);
    },
  });

  pi.registerCommand("persona:params", {
    description:
      "Set/clear inference params: temp=0.7 top_p=0.9 freq_penalty=0,presence_penalty=0 (use 'clear' to reset)",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        const current = manager.getParams();
        const keys = Object.keys(current);
        if (keys.length === 0) {
          ctx.ui.notify(
            "No active params. Usage: /persona:params temperature=0.7 top_p=0.9",
            "info",
          );
        } else {
          const entries = keys.map((k) => `${k}=${current[k]}`).join(", ");
          ctx.ui.notify(`Active params: ${entries}`, "info");
        }
        return;
      }

      const parsed = parseParamArgs(trimmed);
      if (parsed === null) {
        manager.clearParams();
        persistPersonaState();
        updateStatusBar(ctx);
        ctx.ui.notify("Params cleared", "info");
        return;
      }

      if (Object.keys(parsed).length === 0) {
        ctx.ui.notify(
          "No params provided. Usage: /persona:params temperature=0.7 top_p=0.9",
          "info",
        );
        return;
      }

      manager.setParams(parsed);
      persistPersonaState();
      updateStatusBar(ctx);
      const entries = Object.entries(parsed)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      ctx.ui.notify(`Params set: ${entries}`, "info");
    },
  });

  // ==========================================================================
  // /persona:clear
  // ==========================================================================

  pi.registerCommand("persona:clear", {
    description: "Clear persona (restore default)",
    handler: async (_args, ctx) => {
      if (!manager.getPersona()) {
        ctx.ui.notify("No persona set (using default)", "info");
        return;
      }
      manager.clearPersona();
      persistPersonaState();
      updateStatusBar(ctx);
      ctx.ui.notify("Persona cleared (using default)", "info");
    },
  });

  // ==========================================================================
  // /persona:list
  // ==========================================================================

  pi.registerCommand("persona:list", {
    description: "List available personas and profiles",
    handler: async (_args, ctx) => {
      const [personas, profiles, profileFiles] = await Promise.all([
        discovery.discoverPersonas(),
        discovery.discoverProfiles(),
        discovery.discoverProfileFiles(),
      ]);

      if (
        personas.length === 0 &&
        profiles.length === 0 &&
        profileFiles.length === 0
      ) {
        ctx.ui.notify(
          "No personas or profiles found. Create personas in ~/.pi/agent/personas/ " +
            'or define profiles in .pi/settings.json under "pi-persona.profiles"',
          "info",
        );
        return;
      }

      let message = "";

      if (profiles.length > 0) {
        message += "Profiles (settings.json):\n";
        for (const p of profiles) {
          const personaLabel = p.persona
            ? (looksLikePath(p.persona)
              ? displayPath(p.persona)
              : `"${p.persona.slice(0, 40)}${p.persona.length > 40 ? "..." : ""}"`)
            : "(no persona)";
          message += `  📦 ${p.name} → ${personaLabel}`;
          if (p.context.length > 0) {
            const fileCount = p.context.filter(looksLikePath).length;
            const textCount = p.context.length - fileCount;
            const parts: string[] = [];
            if (fileCount > 0)
              parts.push(`${fileCount} file${fileCount !== 1 ? "s" : ""}`);
            if (textCount > 0) parts.push(`${textCount} text`);
            message += ` + ${parts.join(", ")}`;
          }
          message += "\n";
        }
      }

      if (profileFiles.length > 0) {
        if (message) message += "\n";
        message += "Profile files (.yml/.yaml):\n";
        for (const pf of profileFiles) {
          const personaLabel = pf.config.persona
            ? (looksLikePath(pf.config.persona)
              ? displayPath(pf.config.persona)
              : `"${pf.config.persona.slice(0, 40)}${pf.config.persona.length > 40 ? "..." : ""}"`)
            : "(no persona)";
          message += `  📋 ${pf.name} → ${personaLabel}`;
          const ctxCount = pf.config.context?.length ?? 0;
          if (ctxCount > 0) message += ` + ${ctxCount} context`;
          if (pf.description) message += ` — ${pf.description}`;
          message += ` (${displayPath(pf.fullPath)})`;
          message += "\n";
        }
      }

      if (personas.length > 0) {
        if (message) message += "\n";
        message += "Personas:\n";
        for (const p of personas) {
          message += `  • ${p.name}`;
          if (p.description) message += ` — ${p.description}`;
          message += "\n";
        }
      }

      ctx.ui.notify(message, "info");
    },
  });

  // ==========================================================================
  // /persona:config
  // ==========================================================================

  pi.registerCommand("persona:config", {
    description: "Show persona configuration",
    handler: async (_args, ctx) => {
      const profileNames = Object.keys(profilesConfig);

      let message = "Persona directories:\n";
      for (const d of personaDirs) {
        message += `  • ${displayPath(d)}\n`;
      }

      if (profileNames.length > 0) {
        message += "\nProfiles:\n";
        for (const name of profileNames) {
          const p = profilesConfig[name];
          if (!p) continue;
          const personaLabel = p.persona
            ? (looksLikePath(p.persona)
              ? displayPath(p.persona)
              : `"${p.persona.slice(0, 40)}${p.persona.length > 40 ? "..." : ""}"`)
            : "(no persona)";
          message += `  📦 ${name} → ${personaLabel}`;
          if (p.context?.length) {
            const fileCount = p.context.filter(looksLikePath).length;
            const textCount = p.context.length - (fileCount || 0);
            const parts: string[] = [];
            if (fileCount > 0)
              parts.push(`${fileCount} file${fileCount !== 1 ? "s" : ""}`);
            if (textCount > 0) parts.push(`${textCount} text`);
            message += ` + ${parts.join(", ")}`;
          }
          message += "\n";
        }
      }

      message += '\nConfigure via "pi-persona" in .pi/settings.json';
      ctx.ui.notify(message, "info");
    },
  });

  // ==========================================================================
  // /persona:create
  // ==========================================================================

  pi.registerCommand("persona:create", {
    description: "Create a new persona file",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const pathBased = parseCreateArgs(
        {
          manager,
          discovery,
          io,
          homedir,
          tmpDir,
          profilesConfig,
          onSetPersona: setPersona,
          onResolveAndTrackContext: resolveAndTrackContext,
          onPersist: () => {},
          onUpdateStatusBar: () => {},
          onNotify: () => {},
          onInput: (t, i) => ctx.ui.input(t, i),
          displayPath,
          expandPath: expandPathFn,
          looksLikePath,
        },
        args,
      );

      if (pathBased) {
        // Path-based: create the file directly
        const { targetDir, personaName, expandedPath } = pathBased;
        const defaultContent = formatCreateDefaultContent(personaName);
        const content =
          (await ctx.ui.input(
            "Persona content (or leave empty for template):",
            "",
          )) ?? defaultContent;

        try {
          await io.mkdir(targetDir);
        } catch {
          ctx.ui.notify(`Failed to create directory: ${targetDir}`, "error");
          return;
        }

        try {
          await io.writeFile(expandedPath, content);
          ctx.ui.notify(`Created persona: ${expandedPath}`, "info");
        } catch (error) {
          ctx.ui.notify(`Failed to create persona: ${error}`, "error");
        }
        return;
      }

      // Interactive: choose folder + name
      const scopeOption = await ctx.ui.select(
        "Where to create persona?",
        SCOPE_OPTIONS,
      );
      if (!scopeOption) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      let targetDir: string;
      if (scopeOption.startsWith("Local")) {
        targetDir = path.join(".pi", "extensions", "pi-persona", "personas");
      } else if (scopeOption.startsWith("Global")) {
        targetDir = path.join(homedir, ".pi", "agent", "personas");
      } else {
        const customPath = await ctx.ui.input("Folder path:", "");
        if (!customPath) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }
        targetDir = expandPathFn(customPath);
      }

      const personaName =
        parts[0] || (await ctx.ui.input("Persona name:", "")) || "";
      if (!personaName) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      const defaultContent = formatCreateDefaultContent(personaName);
      const content =
        (await ctx.ui.input(
          "Persona content (or leave empty for template):",
          "",
        )) ?? defaultContent;

      try {
        await io.mkdir(targetDir);
      } catch {
        ctx.ui.notify(`Failed to create directory: ${targetDir}`, "error");
        return;
      }

      const filePath = path.join(targetDir, `${personaName}.md`);
      try {
        await io.writeFile(filePath, content);
        ctx.ui.notify(`Created persona: ${filePath}`, "info");
      } catch (error) {
        ctx.ui.notify(`Failed to create persona: ${error}`, "error");
      }
    },
  });
  // ==========================================================================
  // /context:add
  // ==========================================================================

  const contextDeps: ContextDeps = {
    manager,
    tempFilePaths,
    onCleanupTempFiles: cleanupTempFiles,
    onPersist: () => {
      persistContextState();
    },
    onUpdateStatusBar: (ctx: ExtensionContext) => updateStatusBar(ctx),
    resolveAndTrackContext,
    io,
    resolveFilePath: (p) => resolveFilePath(p, homedir),
    displayPath,
    looksLikePath,
    onNotify: (msg, kind) => {
      // We need ctx here — captured in the handler
    },
    onInput: () => Promise.resolve(null),
  };

  pi.registerCommand("context:add", {
    description:
      "Add context files or free-form text (re-read from disk each turn)",
    handler: async (args, ctx) => {
      const deps: ContextDeps = {
        manager,
        tempFilePaths,
        onCleanupTempFiles: cleanupTempFiles,
        onPersist: () => {
          persistContextState();
        },
        onUpdateStatusBar: () => updateStatusBar(ctx),
        resolveAndTrackContext,
        io,
        resolveFilePath: (p) => resolveFilePath(p, homedir),
        displayPath,
        looksLikePath,
        onNotify: (msg, kind) => ctx.ui.notify(msg, kind),
        onInput: (t, i) => ctx.ui.input(t, i),
      };

      const trimmed = args.trim();
      if (!trimmed) {
        ctx.ui.notify(formatAddUsageError(), "error");
        return;
      }

      const result = await handleContextAdd(deps, trimmed);
      if (result.addedFiles.length === 0 && result.failedFiles.length === 0) {
        return; // no-op (already in context or empty)
      }

      const message = formatAddSuccess(
        deps,
        result.addedFiles,
        result.failedFiles,
      );
      if (message) {
        deps.onPersist();
        deps.onUpdateStatusBar(ctx);
        const kind = result.failedFiles.length > 0 ? "warning" : "info";
        ctx.ui.notify(message, kind);
      }
    },
  });

  // ==========================================================================
  // /context:remove
  // ==========================================================================

  pi.registerCommand("context:remove", {
    description: "Remove context file(s) from the system prompt",
    handler: async (args, ctx) => {
      const filePaths = args.trim().split(/\s+/);
      if (filePaths.length === 0 || (filePaths.length === 1 && !filePaths[0])) {
        const deps: ContextDeps = {
          manager,
          tempFilePaths,
          onCleanupTempFiles: cleanupTempFiles,
          onPersist: () => {
            persistContextState();
          },
          onUpdateStatusBar: () => updateStatusBar(ctx),
          resolveAndTrackContext,
          io,
          resolveFilePath: (p) => resolveFilePath(p, homedir),
          displayPath,
          looksLikePath,
          onNotify: (msg, kind) => ctx.ui.notify(msg, kind),
          onInput: (t, i) => ctx.ui.input(t, i),
        };
        ctx.ui.notify(formatRemoveUsageError(deps), "error");
        return;
      }

      const deps: ContextDeps = {
        manager,
        tempFilePaths,
        onCleanupTempFiles: cleanupTempFiles,
        onPersist: () => {
          persistContextState();
        },
        onUpdateStatusBar: () => updateStatusBar(ctx),
        resolveAndTrackContext,
        io,
        resolveFilePath: (p) => resolveFilePath(p, homedir),
        displayPath,
        looksLikePath,
        onNotify: (msg, kind) => ctx.ui.notify(msg, kind),
        onInput: (t, i) => ctx.ui.input(t, i),
      };

      const result = await handleContextRemove(deps, filePaths);
      deps.onPersist();
      deps.onUpdateStatusBar(ctx);
      ctx.ui.notify(formatRemoveMessage(deps, result, filePaths), "info");
    },
  });

  // ==========================================================================
  // /context:clean
  // ==========================================================================

  pi.registerCommand("context:clean", {
    description: "Remove all context files from the system prompt",
    handler: async (_, ctx) => {
      handleContextClean({
        manager,
        tempFilePaths,
        onCleanupTempFiles: cleanupTempFiles,
        onPersist: () => {
          persistContextState();
        },
        onUpdateStatusBar: () => updateStatusBar(ctx),
        resolveAndTrackContext,
        io,
        resolveFilePath: (p) => resolveFilePath(p, homedir),
        displayPath,
        looksLikePath,
        onNotify: (msg, kind) => ctx.ui.notify(msg, kind),
        onInput: (t, i) => ctx.ui.input(t, i),
      });
      ctx.ui.notify(formatCleanMessage(), "info");
    },
  });

  // ==========================================================================
  // /context:list
  // ==========================================================================

  pi.registerCommand("context:list", {
    description: "List current context files",
    handler: async (_, ctx) => {
      const deps: ContextDeps = {
        manager,
        tempFilePaths,
        onCleanupTempFiles: cleanupTempFiles,
        onPersist: () => {
          persistContextState();
        },
        onUpdateStatusBar: () => updateStatusBar(ctx),
        resolveAndTrackContext,
        io,
        resolveFilePath: (p) => resolveFilePath(p, homedir),
        displayPath,
        looksLikePath,
        onNotify: (msg, kind) => ctx.ui.notify(msg, kind),
        onInput: (t, i) => ctx.ui.input(t, i),
      };
      const message = handleContextList(deps);
      if (message === null) {
        ctx.ui.notify(formatListEmpty(), "info");
      } else {
        ctx.ui.notify(message, "info");
      }
    },
  });
}
