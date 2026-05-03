/**
 * Context commands handler — /context:add, /context:remove, /context:clean, /context:list.
 *
 * Pure-ish functions — no pi types, no side effects (callbacks for persistence, UI, etc.)
 */

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { PersonaManager } from "../persona-manager";

// ---- Dependency bag ----

export interface ContextDeps {
  manager: PersonaManager;
  tempFilePaths: Set<string>;
  onCleanupTempFiles: () => void;
  onPersist: () => void;
  onUpdateStatusBar: (ctx: ExtensionCommandContext) => void;
  resolveAndTrackContext: (value: string) => Promise<string>;
  io: {
    readFile(path: string): Promise<string | null | undefined>;
    unlink(path: string): Promise<void>;
  };
  resolveFilePath: (p: string) => string;
  displayPath: (filePath: string) => string;
  looksLikePath: (s: string) => boolean;
  onNotify: (msg: string, kind: "info" | "warning" | "error") => void;
  onInput: (title: string, initial: string) => Promise<string | null | undefined>;
}

// ---- /context:add ----

export interface AddResult {
  addedFiles: string[];
  failedFiles: string[];
}

export async function handleContextAdd(
  deps: ContextDeps,
  raw: string,
): Promise<AddResult> {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/);
  const allLookLikePaths = tokens.every(deps.looksLikePath);

  if (!allLookLikePaths) {
    // Free-form text context — write to temp file
    const tmpPath = await deps.resolveAndTrackContext(trimmed);
    const { added } = deps.manager.addContextPaths([tmpPath]);
    if (added > 0) {
      // caller must call onPersist/onUpdateStatusBar
      const preview = trimmed.slice(0, 50) + (trimmed.length > 50 ? "..." : "");
      return { addedFiles: [preview], failedFiles: [] };
    }
    return { addedFiles: [], failedFiles: [] };
  }

  // File paths
  const addedFiles: string[] = [];
  const failedFiles: string[] = [];

  for (const filePath of tokens) {
    if (!filePath.trim()) continue;
    const resolved = deps.resolveFilePath(filePath);

    // Skip if already in context
    if (deps.manager.getContextPaths().includes(resolved)) continue;

    const content = await deps.io.readFile(resolved);
    if (content !== null) {
      deps.manager.addContextPaths([resolved]);
      addedFiles.push(filePath);
    } else {
      failedFiles.push(`${filePath} (not found or unreadable)`);
    }
  }

  return { addedFiles, failedFiles };
}

export function formatAddSuccess(
  deps: ContextDeps,
  addedFiles: string[],
  failedFiles: string[],
): string {
  if (addedFiles.length === 0 && failedFiles.length === 0) {
    return "";
  }

  let message = "";
  if (addedFiles.length > 0) {
    message += `Added context (${deps.manager.getContextPaths().length} total):\n`;
    message += deps.manager
      .getContextPaths()
      .map((f) => `- ${deps.displayPath(f)}`)
      .join("\n");
  }
  if (failedFiles.length > 0) {
    if (message) message += "\n\n";
    message += `Failed:\n` + failedFiles.join("\n");
  }
  return message;
}

export function formatAddUsageError(): string {
  return "Usage: /context:add <path> [path...]  or  /context:add <text>";
}

// ---- /context:remove ----

export interface RemoveResult {
  removed: string[];
  notFound: string[];
}

export async function handleContextRemove(
  deps: ContextDeps,
  filePaths: string[],
): Promise<RemoveResult> {
  const resolvedPaths = filePaths
    .filter((fp) => fp.trim())
    .map((fp) => deps.resolveFilePath(fp));

  const result = deps.manager.removeContextPaths(resolvedPaths);

  // Clean up temp files for removed entries
  for (const removedPath of result.removed) {
    if (deps.tempFilePaths.has(removedPath)) {
      deps.tempFilePaths.delete(removedPath);
      deps.io.unlink(removedPath).catch(() => {});
    }
  }

  return result;
}

export function formatRemoveMessage(
  deps: ContextDeps,
  result: RemoveResult,
  originalPaths: string[],
): string {
  let message = `Removed ${result.removed.length} file(s).`;
  const remaining = deps.manager.getContextPaths();
  if (remaining.length > 0) {
    message += `\n\nRemaining (${remaining.length}):\n`;
    message += remaining.map((f) => `- ${deps.displayPath(f)}`).join("\n");
  }
  if (result.notFound.length > 0) {
    const notFoundInputs = originalPaths.filter((fp: string) => fp.trim());
    message += `\n\nNot in context: ${notFoundInputs.join(", ")}`;
  }
  return message;
}

export function formatRemoveUsageError(deps: ContextDeps): string {
  const paths = deps.manager.getContextPaths();
  if (paths.length === 0) {
    return "No context files to remove.";
  }
  return (
    `Usage: /context:remove <path> [path...]\n\nCurrent files:\n` +
    paths.map((f) => `- ${deps.displayPath(f)}`).join("\n")
  );
}

// ---- /context:clean ----

export function handleContextClean(deps: ContextDeps): void {
  deps.manager.clearContext();
  deps.onCleanupTempFiles();
}

export function formatCleanMessage(): string {
  return "Context files cleared";
}

// ---- /context:list ----

export function handleContextList(deps: ContextDeps): string | null {
  const paths = deps.manager.getContextPaths();
  if (paths.length === 0) return null;
  return `Context files (${paths.length}):\n${paths.map((f) => `- ${deps.displayPath(f)}`).join("\n")}`;
}

export function formatListEmpty(): string {
  return "No context files added.";
}
