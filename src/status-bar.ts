/**
 * Pure status bar formatting.
 *
 * Takes persona display name and context count, returns the formatted
 * status string (or null if nothing to show). No side effects.
 */

export function formatStatusBar(
  personaDisplay: string | null,
  contextCount: number,
): string | null {
  // The caller (adapter) handles theme.fg() styling.
  // This function returns the raw text components, or null if nothing to show.
  const parts: string[] = [];

  if (personaDisplay) {
    parts.push(`[persona: ${personaDisplay}]`);
  }

  if (contextCount > 0) {
    parts.push(`ctx: ${contextCount}`);
  }

  if (parts.length === 0) return null;

  return parts.join(" ");
}
