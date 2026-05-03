/**
 * Params injection into provider request payloads.
 *
 * Pure function — takes the manager at call time (not via closure),
 * so the handler always reads the latest params state.
 */

import type { PersonaManager } from "./persona-manager";

/**
 * Core handler: inject manager params into the provider request payload.
 *
 * - Params with `null` or `undefined` values are skipped.
 * - Returns the modified payload (so pi can use it), or `undefined`
 *   when there are no params (no mutation, no return value).
 *
 * @example
 * ```ts
 * // Direct use:
 * handler(event);
 *
 * // Via factory (recommended for event registration):
 * pi.on("before_provider_request", createBeforeProviderRequestHandler(manager));
 * ```
 */
export function beforeProviderRequest(
  manager: PersonaManager,
  event: { payload?: Record<string, unknown> },
): Record<string, unknown> | undefined {
  const params = manager.getParams();
  const keys = Object.keys(params);
  if (keys.length === 0) return undefined;

  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return undefined;

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      payload[k] = v;
    }
  }
  return payload;
}

/**
 * Create a `before_provider_request` event handler that injects
 * inference params into the provider payload.
 *
 * The handler reads params from the manager **at call time** (not
 * via closure capture), so runtime changes to params are always
 * reflected without needing to re-register the handler.
 *
 * @example
 * ```ts
 * pi.on("before_provider_request", createBeforeProviderRequestHandler(manager));
 * ```
 */
export function createBeforeProviderRequestHandler(manager: PersonaManager) {
  return (event: { payload?: Record<string, unknown> }) =>
    beforeProviderRequest(manager, event);
}
