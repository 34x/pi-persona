# pi-persona

[![CI](https://github.com/34x/pi-persona/actions/workflows/ci.yml/badge.svg)](https://github.com/34x/pi-persona/actions/workflows/ci.yml)

Manage the agent's behavioral profile: **who it is** (persona), **what it knows** (context files), and **how it thinks** (inference params).

Persona replaces the default identity while preserving skills, tools, date, and working directory. Context files append reference material alongside. Profiles bundle both into one command. **Params** let you fine-tune temperature, top_p, top_k, max_tokens, and any other provider-native setting.

## Installation

```bash
# Install from GitHub (recommended)
pi install git:github.com/34x/pi-persona

# Or install locally from a clone
pi install /path/to/pi-persona
```

Run ad-hoc without installing:

```bash
pi -e /path/to/pi-persona/index.ts
```

## Quick Start

Set a persona — five different ways:

```bash
/persona You are a helpful assistant     # 1. inline text (just type it)
/persona ./my-prompts/reviewer.md        # 2. file path (.md / .txt)
/persona expert-reviewer                 # 3. registered persona name
/persona my-project                      # 4. registered profile name
/persona path/to/profile.yml             # 5. YAML profile bundle
```

**Set a default per-project** — add to `.pi/settings.json`:

```json
{
  "pi-persona": {
    "default": "my-profile"
  }
}
```
Now every `pi` session in this project starts with that persona.

**Fine-tune inference params:**

```bash
/persona:params temperature=0.3 top_p=0.8
```

**Check the status bar** — it shows the active persona, source, context count, and params.

See [Commands](#commands) for the full list.

## Commands

### Persona — who the agent is

| Command | Description |
|---------|-------------|
| `/persona <name>` | Load profile/file by name, or persona from text |
| `/persona <path>.yml` | Load a profile bundle file |
| `/persona` | Interactive selector (profiles + personas) |
| `/persona:params [key=val...]` | Set/clear inference params (see below) |
| `/persona:clear` | Clear persona (restore default prompt) |
| `/persona:list` | List available personas and profiles |
| `/persona:config` | Show persona directories and profile config |
| `/persona:create` | Create a new persona file |

### Context — what the agent knows

| Command | Description |
|---------|-------------|
| `/context:add <path> [path…]` | Add file(s) as context (re-read each turn) |
| `/context:add <text>` | Add free-form text as context |
| `/context:remove <path>` | Remove specific context file(s) |
| `/context:clean` | Remove all context files |
| `/context:list` | Show current context files |

## Inference Params — how the agent thinks

Set provider-native parameters at three levels. **Precedence:** runtime command > profile > persona.

### Runtime command — `/persona:params`

```bash
/persona:params temperature=0.7 top_p=0.9 max_tokens=4096
/persona:params clear                             # remove all
/persona:params                                   # show current
```

- Values are coerced automatically: numbers, booleans (`true`/`false`), strings.
- `temp` is normalised to `temperature` for convenience.
- Works even when no persona is active.
- Params are injected into the provider payload via `before_provider_request`.

### Profile bundle files (.yml / .yaml)

Add a `params` block to any profile:

```yaml
# creative.yml
persona: creative.md
context:
  - ./guidelines.md
params:
  temperature: 0.9
  top_p: 0.95
  max_tokens: 2048
```

### Settings profiles (.pi/settings.json)

```json
{
  "pi-persona": {
    "profiles": {
      "creative-project": {
        "persona": "~/.pi/agent/personas/creative.md",
        "context": ["./guidelines.md"],
        "params": {
          "temperature": 0.9,
          "top_p": 0.95
        }
      }
    }
  }
}
```

### Persona files (.md / .txt)

Set the persona's default params in frontmatter:

```markdown
---
name: Creative Writer
description: A brainstorming companion
context:
  - ./brainstorm-rules.md
params:
  temperature: 0.9
  top_p: 0.95
---

You are a creative writing assistant...
```

**Precedence rules:**
1. `/persona:params` runtime overrides — highest priority
2. Profile `params` override persona `params`
3. Persona frontmatter `params` — base defaults

## Profile Bundle Files (.yml / .yaml)

**Standalone, portable profile files** that live in your persona directories alongside `.md` files. Drop a `.yml` file in `~/.pi/agent/personas/` (or any `personaPaths` directory) and it's automatically discovered.

### Path resolution convention

Profile files use a simple convention for `persona` and `context` entries:

| Written as | Resolves to |
|---|---|
| `./file.md` or `../file.md` | Relative to **the `.yml` file's directory** |
| `file.md` (no prefix) | Relative to **project root / CWD** |
| `/absolute/path.md` | Absolute path (used as-is) |
| `~/path.md` | Home directory (expanded by adapter) |
| `"inline text"` (non-path) | Used as inline content |

This means:
- **Self-contained profile bundles** use `./` prefix to reference sibling files
- **Project-level references** (like `AGENTS.md`) use bare paths with no prefix

```yaml
# profile-example.yml — all path resolution cases
persona: ./sibling-persona.md          # ./ → relative to this .yml file
context:
  - ./coding-rules.md                  # ./ → relative to this .yml file
  - ../shared/guidelines.md            # ../ → parent of this .yml file
  - AGENTS.md                          # bare → project root / CWD
  - docs/api-overview.md               # bare with subdir → project root
  - /etc/config/policy.md              # absolute → used as-is
  - ~/.pi/agent/personas/tdd-rules.md  # home → expanded to $HOME
  - |
    Always use TypeScript strict mode.
    Never use the `any` type.
params:
  temperature: 0.3
  top_p: 0.8
```

**All in one table:**

| Written in .yml | Resolves to |
|---|---|
| `./sibling-persona.md` | Relative to the `.yml` file's directory |
| `../shared/guidelines.md` | Parent of the `.yml` file's directory |
| `AGENTS.md` | Project root / CWD |
| `docs/api-overview.md` | Project root / CWD |
| `/etc/config/policy.md` | Absolute path (used as-is) |
| `~/.pi/…/tdd-rules.md` | Home directory (expanded by adapter) |
| `\| …` (multiline block) | Inline text (appended verbatim) |

**How it works:**

- `/persona profile-example` — matches by filename (without extension)
- `/persona` — interactive selector shows profile files (📋) alongside profiles (📦) and personas
- `/persona path/to/profile-example.yml` — load by path
- `persona` accepts a file path or inline text (same as profiles in settings.json)

## Settings Profiles

Profiles defined in `.pi/settings.json` — useful for project-specific configurations:

```json
{
  "pi-persona": {
    "personaPaths": ["~/.pi/agent/personas"],
    "profiles": {
      "tdd-project": {
        "persona": "~/.pi/agent/personas/tdd.md",
        "context": ["./test-guidelines.md", "./conventions.md"]
      },
      "pirate": {
        "persona": "You are Jack Sparrow!",
        "context": ["Speak with a touch of old British humor"]
      }
    }
  }
}
```

Both `persona` and `context` entries accept **file paths** or **free-form text**:
- Path-like values (`/path/to/file.md`, `./relative.md`, `~/home.md`) → loaded as files
- Everything else → used as inline text

## Persona Files (.md / .txt)

Persona files with optional `context` and `params` frontmatter — self-contained and portable:

```markdown
---
name: TDD Expert
description: A test-driven development specialist
context:
  - ./test-guidelines.md
  - ./conventions.md
  - Always use TypeScript strict mode
params:
  temperature: 0.3
  top_p: 0.8
---

You are a TDD expert. Always write tests first.

1. Write the test
2. See it fail
3. Write the minimum code to pass
4. Refactor
5. Repeat
```

When you load a persona file with `/persona path/to/persona.md`, any `context` entries are automatically added and `params` are applied.

Store in `~/.pi/agent/personas/` or configure via `personaPaths`.

## Context Files

Context files are re-read from disk each turn, so edits are always current. Paths persist across `/reload` and model switches.

```bash
/context:add ./API.md ./CONTRIBUTING.md   # add files
/context:add "Always use TypeScript strict mode"  # free-form text
/context:remove ./API.md                   # remove one
/context:clean                             # remove all
```

## Status Bar

Shows persona (with source), context file count, and active inference params:
- `[persona: TDD Expert via profile:tdd] ctx: 2 t:0.30 p:0.80` — loaded via settings profile
- `[persona: Dev via dev.yml] ctx: 2 t:0.30 p:0.80` — loaded via .yml profile file
- `[persona: TDD Expert] ctx: 2` — loaded via persona file or inline text
- `ctx: 3` — no persona, 3 context files
- `t:0.7` — no persona, params active

When no persona or context is active and no params are set, the status bar is hidden.

Source labels indicate how the persona was loaded:

| Source | Label | Example |
|-------|-------|---------|
| Settings profile | `via profile:<name>` | `[persona: TDD via profile:tdd-project]` |
| Profile file (.yml/.yaml) | `via <name>.yml` | `[persona: Dev via dev.yml]` |
| Persona file (.md/.txt) | *(none)* | `[persona: TDD Expert]` |
| Inline text | *(none)* | `[persona: You are a helpful...]` |

## CLI Flags

Set persona and params at startup via command-line flags:

```bash
# Load persona by name, path, or inline text
pi --persona "expert-reviewer"
pi --persona "~/.pi/agent/personas/tdd.md"
pi --persona "You are a helpful assistant"

# Set inference params as comma-separated key=value pairs
pi --persona-params temperature=0.7,top_p=0.9
pi --persona-params temperature=0.3

# Combine with other flags
pi --persona my-profile --persona-params temperature=0.3,top_p=0.8

# List available personas and profiles (requires --print to avoid TUI)
pi --persona-list --print
```

**Note:** The `--persona-params` flag expects **comma-separated** `key=value` pairs:
- `temperature=0.7,top_p=0.9` ✓
- `temperature=0.7 top_p=0.9` ✗ (spaces are not supported)
- `0.1` ✗ (must specify parameter name)

CLI flags are applied during `session_start` and persist for the session.

| Flag | Description | Example |
|------|-------------|---------|
| `--persona <value>` | Load persona by name, path, or inline text | `--persona tdd` |
| `--persona-params <k=v,k2=v2>` | Set inference params (comma-separated) | `--persona-params temperature=0.7,top_p=0.9` |
| `--persona-list` | List available personas and profiles, then exit | `--persona-list --print` |

**Precedence:** CLI flags override restored session state (which is restored first). CLI flags can in turn be overridden by `/persona` or `/persona:params` commands during the session. The default persona (from settings) only loads when no persona is active after all of the above.

## Default Persona (Project Config)

Set a default persona/profile that loads automatically when pi starts and no persona is active. Configured in `.pi/settings.json` (or `.pi/pi-persona.json`) under `"pi-persona"`:

```json
{
  "pi-persona": {
    "default": "my-profile"
  }
}
```

The default can be:
- **A string** — resolved as a profile name, persona name, or file path (same resolution as `/persona`)
- **An object** — explicitly specify which type of default to load

### String form

```json
{
  "pi-persona": {
    "default": "my-profile"
  }
}
```

Resolution order:
1. Settings profile named `"my-profile"`
2. Profile file named `my-profile.yml` or `my-profile.yaml` in persona directories
3. File path (if it looks like a path)
4. Inline text (fallback)

### Object form

```json
{
  "pi-persona": {
    "default": {
      "profile": "tdd-project"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `profile` | Load a settings profile by name |
| `persona` | Load a persona by name (from persona directories) |
| `path` | Load a persona/profile file by path |

### How it works

- The default is loaded during `session_start`, **after** session restore and CLI flags
- If a persona is already active (from CLI flag or restored session), the default is **not** applied
- This means `--persona` and session persistence take precedence over the project default
- The default only activates when no persona is active after restore and CLI flags

### Example: project with a default persona

```json
{
  "pi-persona": {
    "default": "my-profile",
    "profiles": {
      "my-profile": {
        "persona": "~/.pi/agent/personas/my-persona.yml",
        "context": ["./AGENTS.md"]
      }
    }
  }
}
```

Now every time you open pi in this project, the `my-profile` profile loads automatically.