/**
 * Tests for src/handlers/interactive-selector.ts
 *
 * Uses real PersonaManager + mocked discovery.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersonaManager } from "../persona-manager";
import {
  buildSelectorList,
  formatInlineTextPrompt,
} from "./interactive-selector";
import type { SelectorItem } from "./interactive-selector";

// ---- Fake discovery factory ----

function makeFakeDiscovery(
  overrides: {
    discoverPersonas?: any[];
    discoverProfiles?: any[];
    discoverProfileFiles?: any[];
  } = {},
) {
  return {
    discoverPersonas: vi
      .fn()
      .mockResolvedValue(overrides.discoverPersonas ?? []),
    discoverProfiles: vi
      .fn()
      .mockResolvedValue(overrides.discoverProfiles ?? []),
    discoverProfileFiles: vi
      .fn()
      .mockResolvedValue(overrides.discoverProfileFiles ?? []),
    resolvePersona: vi
      .fn()
      .mockResolvedValue({ prompt: "You are a test", display: "Test" }),
    loadPersonaFile: vi.fn().mockResolvedValue(null),
    resolveProfilePaths: vi.fn().mockImplementation((cfg: any) => ({
      ...cfg,
      context: cfg.context ?? [],
    })),
  };
}

// ---- Tests ----

describe("buildSelectorList", () => {
  it("should return empty when no personas, profiles, or profile files", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery(),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p.replace("/home/user", "~"),
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { items, options } = await buildSelectorList(deps);
    expect(items).toHaveLength(0);
    expect(options).toHaveLength(0);
  });

  it("should include profiles with 📦 prefix", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverProfiles: [
          { name: "test", persona: "You are a test", context: [] },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { items, options } = await buildSelectorList(deps);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("settings-profile");
    expect(options[0]).toContain("📦 test:");
  });

  it("should include profile files with 📋 prefix", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverProfileFiles: [
          {
            name: "tdd-be",
            fullPath: "/home/user/.pi/personas/tdd-be.yml",
            config: { persona: "tdd.md", context: [] },
            description: null,
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { items, options } = await buildSelectorList(deps);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("profile-file");
    expect(options[0]).toContain("📋 tdd-be:");
  });

  it("should include personas with relative path display", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverPersonas: [
          {
            name: "dev",
            fullPath: "/home/user/.pi/personas/dev.md",
            description: "Development persona",
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { items, options } = await buildSelectorList(deps);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("persona");
    expect(options[0]).toContain("dev:");
  });

  it("should order: settings profiles → profile files → personas", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverProfiles: [{ name: "A-profile", persona: "p", context: [] }],
        discoverProfileFiles: [
          {
            name: "B-file",
            fullPath: "/f.yml",
            config: { persona: "p" },
            description: null,
          },
        ],
        discoverPersonas: [
          {
            name: "C-persona",
            fullPath: "/f.md",
            description: "",
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { items } = await buildSelectorList(deps);
    expect(items[0].kind).toBe("settings-profile");
    expect(items[1].kind).toBe("profile-file");
    expect(items[2].kind).toBe("persona");
  });

  it("should truncate long descriptions to 30 chars + ellipsis", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverPersonas: [
          {
            name: "long",
            fullPath: "/f.md",
            description:
              "This is a very long description that exceeds 30 characters",
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { options } = await buildSelectorList(deps);
    expect(options[0]).toContain("…");
    expect(options[0].length).toBeLessThan(60);
  });

  it("should show context count in profile preview", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverProfiles: [
          {
            name: "with-ctx",
            persona: "/persona.md",
            context: ["a.md", "b.md", "c.md"],
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { options } = await buildSelectorList(deps);
    expect(options[0]).toContain("+ 3 context");
  });

  it("should show description for profile files", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverProfileFiles: [
          {
            name: "pf",
            fullPath: "/f.yml",
            config: { persona: "p", context: [] },
            description: "Profile description here",
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { options } = await buildSelectorList(deps);
    expect(options[0]).toContain("Profile description");
  });

  it("should show context count for profile files", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverProfileFiles: [
          {
            name: "pf",
            fullPath: "/f.yml",
            config: { persona: "p", context: ["ctx.md"] },
            description: null,
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { options } = await buildSelectorList(deps);
    expect(options[0]).toContain("+ 1 context");
  });

  it("should handle null profile file description without crashing", async () => {
    const manager = new PersonaManager();
    const deps = {
      manager,
      discovery: makeFakeDiscovery({
        discoverProfileFiles: [
          {
            name: "pf",
            fullPath: "/f.yml",
            config: { persona: "p", context: [] },
            description: null,
          },
        ],
      }),
      io: { readFile: vi.fn(), access: vi.fn() },
      homedir: "/home/user",
      profilesConfig: {},
      onSetPersona: vi.fn().mockResolvedValue(undefined),
      onResolveAndTrackContext: vi
        .fn()
        .mockImplementation((v: string) => Promise.resolve(`/tmp/${v}`)),
      onPersist: vi.fn(),
      onUpdateStatusBar: vi.fn(),
      displayPath: (p: string) => p,
      looksLikePath: (s: string) => s.startsWith("/") || s.startsWith("."),
    };

    const { options } = await buildSelectorList(deps);
    expect(options[0]).toContain("📋 pf:");
  });
});

describe("formatInlineTextPrompt", () => {
  it("should truncate at 30 chars with ellipsis", () => {
    const long = "a".repeat(40);
    expect(formatInlineTextPrompt(long)).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...",
    );
  });

  it("should return text as-is when under 30 chars", () => {
    expect(formatInlineTextPrompt("short")).toBe("short");
  });

  it("should return exact text when exactly 30 chars", () => {
    const exact = "a".repeat(30);
    expect(formatInlineTextPrompt(exact)).toBe(exact);
  });

  describe("handleSelectorSelection", () => {
    // Fake context object for testing UI calls
    function makeFakeCtx() {
      return {
        ui: {
          notify: vi.fn(),
          select: vi.fn(),
          input: vi.fn(),
          theme: { fg: vi.fn((_style: string, text: string) => text) },
        },
        setCustomPrompt: vi.fn(),
      };
    }

    it("should notify error when settings profile persona cannot be resolved", async () => {
      const manager = new PersonaManager();
      const ctx = makeFakeCtx() as any;
      const discovery = {
        discoverPersonas: vi.fn().mockResolvedValue([]),
        discoverProfiles: vi.fn().mockResolvedValue([]),
        discoverProfileFiles: vi.fn().mockResolvedValue([]),
        resolvePersona: vi.fn().mockResolvedValue(null),
        loadPersonaFile: vi.fn().mockResolvedValue(null),
        resolveProfilePaths: vi.fn().mockImplementation((cfg: any) => ({
          ...cfg,
          context: cfg.context ?? [],
        })),
      };
      const deps = {
        manager,
        discovery,
        io: { readFile: vi.fn(), access: vi.fn() },
        homedir: "/home/user",
        profilesConfig: {},
        onSetPersona: vi.fn().mockResolvedValue(undefined),
        onResolveAndTrackContext: vi.fn().mockResolvedValue("/tmp/ctx.md"),
        onPersist: vi.fn(),
        onUpdateStatusBar: vi.fn(),
        displayPath: (p: string) => p,
        looksLikePath: (s: string) => s.startsWith("/"),
      };

      await import("./interactive-selector").then((m) =>
        m.handleSelectorSelection(
          deps,
          {
            kind: "settings-profile",
            profile: { name: "test", persona: "dev.md", context: [] },
          },
          ctx,
        ),
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load persona"),
        "error",
      );
    });

    it("should set persona and add context when settings profile has context", async () => {
      const manager = new PersonaManager();
      const ctx = makeFakeCtx() as any;
      const onSetPersona = vi.fn().mockResolvedValue(undefined);
      const onResolveAndTrackContext = vi.fn().mockResolvedValue("/tmp/ctx.md");
      const onPersist = vi.fn();
      const onUpdateStatusBar = vi.fn();
      const discovery = {
        discoverPersonas: vi.fn().mockResolvedValue([]),
        discoverProfiles: vi.fn().mockResolvedValue([]),
        discoverProfileFiles: vi.fn().mockResolvedValue([]),
        resolvePersona: vi
          .fn()
          .mockResolvedValue({ prompt: "You are dev", display: "Dev" }),
        loadPersonaFile: vi.fn().mockResolvedValue(null),
        resolveProfilePaths: vi.fn().mockImplementation((cfg: any) => ({
          ...cfg,
          context: cfg.context ?? [],
        })),
      };
      const deps = {
        manager,
        discovery,
        io: { readFile: vi.fn(), access: vi.fn() },
        homedir: "/home/user",
        profilesConfig: {},
        onSetPersona,
        onResolveAndTrackContext,
        onPersist,
        onUpdateStatusBar,
        displayPath: (p: string) => p,
        looksLikePath: (s: string) => s.startsWith("/"),
      };

      await import("./interactive-selector").then((m) =>
        m.handleSelectorSelection(
          deps,
          {
            kind: "settings-profile",
            profile: { name: "dev", persona: "dev.md", context: ["./ctx.md"] },
          },
          ctx,
        ),
      );

      expect(onSetPersona).toHaveBeenCalledWith("You are dev", "Dev", ctx, {
        type: "profile",
        name: "dev",
      });
      expect(onResolveAndTrackContext).toHaveBeenCalledWith("./ctx.md");
      // addContextPaths was called via deps.manager reference (spyOn set up below)
      expect(onPersist).toHaveBeenCalled();
      expect(onUpdateStatusBar).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Profile "dev" loaded'),
        "info",
      );
    });

    it("should notify error when persona file cannot be loaded", async () => {
      const manager = new PersonaManager();
      const ctx = makeFakeCtx() as any;
      const discovery = {
        discoverPersonas: vi.fn().mockResolvedValue([]),
        discoverProfiles: vi.fn().mockResolvedValue([]),
        discoverProfileFiles: vi.fn().mockResolvedValue([]),
        resolvePersona: vi.fn().mockResolvedValue(null),
        loadPersonaFile: vi.fn().mockResolvedValue(null),
        resolveProfilePaths: vi.fn().mockImplementation((cfg: any) => ({
          ...cfg,
          context: cfg.context ?? [],
        })),
      };
      const deps = {
        manager,
        discovery,
        io: { readFile: vi.fn(), access: vi.fn() },
        homedir: "/home/user",
        profilesConfig: {},
        onSetPersona: vi.fn().mockResolvedValue(undefined),
        onResolveAndTrackContext: vi.fn().mockResolvedValue("/tmp/ctx.md"),
        onPersist: vi.fn(),
        onUpdateStatusBar: vi.fn(),
        displayPath: (p: string) => p,
        looksLikePath: (s: string) => s.startsWith("/"),
      };

      await import("./interactive-selector").then((m) =>
        m.handleSelectorSelection(
          deps,
          {
            kind: "persona",
            persona: { name: "dev", fullPath: "/dev.md", description: "" },
          },
          ctx,
        ),
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load persona"),
        "error",
      );
    });

    it("should load persona file with frontmatter context", async () => {
      const manager = new PersonaManager();
      const ctx = makeFakeCtx() as any;
      const onPersist = vi.fn();
      const onUpdateStatusBar = vi.fn();
      const discovery = {
        discoverPersonas: vi.fn().mockResolvedValue([]),
        discoverProfiles: vi.fn().mockResolvedValue([]),
        discoverProfileFiles: vi.fn().mockResolvedValue([]),
        resolvePersona: vi.fn().mockResolvedValue(null),
        loadPersonaFile: vi.fn().mockResolvedValue({
          prompt: "You are a TDD expert",
          frontmatter: { context: ["./test.md"] },
        }),
        resolveProfilePaths: vi.fn().mockImplementation((cfg: any) => ({
          ...cfg,
          context: cfg.context ?? [],
        })),
      };
      const deps = {
        manager,
        discovery,
        io: { readFile: vi.fn(), access: vi.fn() },
        homedir: "/home/user",
        profilesConfig: {},
        onSetPersona: vi.fn().mockResolvedValue(undefined),
        onResolveAndTrackContext: vi.fn().mockResolvedValue("/tmp/ctx.md"),
        onPersist,
        onUpdateStatusBar,
        displayPath: (p: string) => p,
        looksLikePath: (s: string) => s.startsWith("/"),
      };

      await import("./interactive-selector").then((m) =>
        m.handleSelectorSelection(
          deps,
          {
            kind: "persona",
            persona: { name: "TDD", fullPath: "/tdd.md", description: "" },
          },
          ctx,
        ),
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Persona set"),
        "info",
      );
      // Should notify about added context
      const notifyCalls = ctx.ui.notify.mock.calls as any;
      const hasAdded = notifyCalls.some((call: [string, string]) =>
        call[0].includes("Added"),
      );
      expect(hasAdded).toBe(true);
    });

    it("should handle fallback mode for settings profile", async () => {
      const manager = new PersonaManager();
      const ctx = makeFakeCtx() as any;
      const discovery = {
        discoverPersonas: vi.fn().mockResolvedValue([]),
        discoverProfiles: vi.fn().mockResolvedValue([]),
        discoverProfileFiles: vi.fn().mockResolvedValue([]),
        resolvePersona: vi
          .fn()
          .mockResolvedValue({ prompt: "You are dev", display: "Dev" }),
        loadPersonaFile: vi.fn().mockResolvedValue(null),
        resolveProfilePaths: vi.fn().mockImplementation((cfg: any) => ({
          ...cfg,
          context: cfg.context ?? [],
        })),
      };
      const deps = {
        manager,
        discovery,
        io: { readFile: vi.fn(), access: vi.fn() },
        homedir: "/home/user",
        profilesConfig: {},
        onSetPersona: vi.fn().mockResolvedValue(undefined), // fallback mode always
        onResolveAndTrackContext: vi.fn().mockResolvedValue("/tmp/ctx.md"),
        onPersist: vi.fn(),
        onUpdateStatusBar: vi.fn(),
        displayPath: (p: string) => p,
        looksLikePath: (s: string) => s.startsWith("/"),
      };

      await import("./interactive-selector").then((m) =>
        m.handleSelectorSelection(
          deps,
          {
            kind: "settings-profile",
            profile: { name: "dev", persona: "dev.md", context: [] },
          },
          ctx,
        ),
      );

      // Should notify with 'info' (fallback is always used, no special warning)
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Profile"),
        "info",
      );
    });

    it("should load profile file with context", async () => {
      const manager = new PersonaManager();
      const ctx = makeFakeCtx() as any;
      const discovery = {
        discoverPersonas: vi.fn().mockResolvedValue([]),
        discoverProfiles: vi.fn().mockResolvedValue([]),
        discoverProfileFiles: vi.fn().mockResolvedValue([]),
        resolvePersona: vi
          .fn()
          .mockResolvedValue({ prompt: "You are a dev", display: "Dev" }),
        loadPersonaFile: vi.fn().mockResolvedValue(null),
        resolveProfilePaths: vi.fn().mockImplementation((cfg: any) => ({
          persona: cfg.persona,
          context: cfg.context ?? [],
        })),
      };
      const deps = {
        manager,
        discovery,
        io: { readFile: vi.fn(), access: vi.fn() },
        homedir: "/home/user",
        profilesConfig: {},
        onSetPersona: vi.fn().mockResolvedValue(undefined),
        onResolveAndTrackContext: vi.fn().mockResolvedValue("/tmp/ctx.md"),
        onPersist: vi.fn(),
        onUpdateStatusBar: vi.fn(),
        displayPath: (p: string) => p,
        looksLikePath: (s: string) => s.startsWith("/"),
      };

      await import("./interactive-selector").then((m) =>
        m.handleSelectorSelection(
          deps,
          {
            kind: "profile-file",
            pf: {
              name: "dev-profile",
              fullPath: "/home/user/.pi/personas/dev.yml",
              config: { persona: "dev.md", context: ["./ctx.md"] },
              description: "Development profile",
            },
          },
          ctx,
        ),
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Profile "dev-profile" loaded'),
        "info",
      );
    });
  });
});
