# SyncFu MVP — Design & Implementation Plan

**Date**: 2026-03-19
**PRD**: `tasks/prd-syncfu-mvp.md`
**Status**: Pending approval

---

## Scope

### Delivers
- Rust CLI binary with 16 commands across 6 groups
- Global + project-scoped skill management with global project registry
- Agent adapters: Claude Code + Cursor (auto-detect, link, format conversion)
- Git-backed construct (team registry): create, connect, uplink, downlink, sync
- SkillPill registry client: search, take, list from community Git repo
- Skill file validation
- AI agent auto-sync skill (`agents install-skill`)
- Install script (`curl | sh`)

### Does NOT Deliver
- SyncFu Cloud, web dashboard, analytics
- Roles/governance, approval workflows
- `pills publish`, security scanning
- Agents beyond Claude Code + Cursor
- MCP propagation, paid tiers

### Deviations
- **Step 9**: Used `--resolve-local`/`--resolve-remote` CLI flags instead of interactive `dialoguer` prompts. ConflictStrategy enum supports adding interactive resolution later. Simpler, more scriptable.

---

## Analogous References

Since this is a greenfield project, these open-source repos serve as architectural references:

| Reference | What to learn from it |
|-----------|----------------------|
| **block/ai-rules** (Rust, Apache-2.0) | Rust CLI skeleton for AI rule management, `clap` command structure, agent detection patterns |
| **ruler** (TypeScript, MIT, 34 agents) | Agent adapter registry pattern — how to abstract detection + linking across many agents |
| **ai-rulez** (Go, MIT) | Config profiles, TOML-based config, remote includes, agent-specific generation |
| **skillshare** (Go, MIT) | Symlink-based sync, backup/restore, validation patterns |

---

## Architecture Overview

```
src/
├── main.rs                    # Entry point, clap CLI definition
├── cli/
│   ├── mod.rs                 # CLI arg parsing, command routing
│   ├── init.rs                # syncfu init [--project]
│   ├── agents.rs              # syncfu agents {configure,status,link,install-skill}
│   ├── construct.rs           # syncfu construct {create,connect,info}
│   ├── sync.rs                # syncfu {uplink,downlink,sync,status}
│   ├── pills.rs               # syncfu pills {search,take,list,info}
│   ├── projects.rs            # syncfu projects list
│   └── validate.rs            # syncfu validate
├── config/
│   ├── mod.rs                 # Config loading, resolution (global + project)
│   └── types.rs               # Config structs (SyncfuConfig, ProjectEntry, etc.)
├── agents/
│   ├── mod.rs                 # AgentAdapter trait, agent registry
│   ├── detect.rs              # Auto-detection of installed agents
│   ├── claude_code.rs         # Claude Code adapter
│   └── cursor.rs              # Cursor adapter
├── sync/
│   ├── mod.rs                 # Sync engine orchestration
│   ├── construct.rs           # Construct Git repo management
│   ├── uplink.rs              # Push logic
│   ├── downlink.rs            # Pull logic
│   └── conflict.rs            # Conflict detection + interactive resolution
├── pills/
│   ├── mod.rs                 # SkillPill registry client
│   ├── registry.rs            # Search, fetch from registry repo
│   └── install.rs             # Take (install) + list + info
├── validate/
│   └── mod.rs                 # Skill file validation rules
└── util/
    ├── mod.rs
    ├── paths.rs               # Path resolution (~/.syncfu, project .syncfu, agent paths)
    └── git.rs                 # git2 wrapper helpers
```

**Key crate dependencies:**
- `clap` (derive) — CLI arg parsing
- `git2` — libgit2 bindings for all Git operations
- `serde` + `toml` — config serialization
- `dialoguer` — interactive prompts (conflict resolution, confirmations)
- `console` — colored output, Unicode indicators
- `dirs` — cross-platform home directory resolution
- `walkdir` — directory traversal for skill file discovery
- `reqwest` (optional) — HTTP for future registry API; MVP uses git2 clone

---

## TDD Implementation Plan — 14 Steps

### Step 1: Project Scaffold & CLI Skeleton
**Goal**: Cargo project with clap CLI, all commands stubbed, `syncfu --version` works.

**Files**:
- `Cargo.toml`
- `src/main.rs`
- `src/cli/mod.rs`

**Tests**:
- `syncfu --version` prints version
- `syncfu --help` lists all command groups
- Each subcommand (`init`, `agents configure`, etc.) parses without error
- Unknown command returns error

**Implementation**: Create Cargo.toml with dependencies, define clap command tree with `#[derive(Parser)]`, stub all handlers with `todo!()` or "not yet implemented" messages.

**Verify**: `cargo test`, `cargo build`, run binary with `--version` and `--help`

**Commit**: `feat: scaffold Rust CLI with clap command tree`

---

### Step 2: Config System
**Goal**: Parse, load, merge global + project `syncfu.toml`. Project registry in global config.

**Files**:
- `src/config/mod.rs`
- `src/config/types.rs`
- `src/util/paths.rs`

**Tests**:
- Parse a valid global `syncfu.toml` into `SyncfuConfig` struct
- Parse a valid project `syncfu.toml` into `ProjectConfig` struct
- Merge project config over global (project overrides global fields)
- Load project registry (`[[projects]]` array) from global config
- Add/remove project entry from registry
- Handle missing config file gracefully (return defaults)
- Handle malformed TOML with clear error

**Implementation**: Define serde structs for global config (`SyncfuConfig`), project config (`ProjectConfig`), project registry entry (`ProjectEntry`). Path resolution helpers for `~/.syncfu/`, `<cwd>/.syncfu/`.

**Verify**: `cargo test`

**Commit**: `feat: config system with global + project scoping and project registry`

---

### Step 3: Init Command
**Goal**: `syncfu init` creates `~/.syncfu/` with default config. `syncfu init --project` creates `.syncfu/` in cwd and registers globally.

**Files**:
- `src/cli/init.rs`
- Updates to `src/config/mod.rs`

**Tests**:
- `init` creates `~/.syncfu/` directory structure
- `init` creates default `syncfu.toml` with expected fields
- `init` detects installed agents (mocked) and lists them
- `init --project` creates `.syncfu/` in cwd
- `init --project` registers project path in global `syncfu.toml`
- `init` on already-initialized dir warns without overwriting
- `init --project` on already-initialized project warns without overwriting

**Implementation**: Directory creation, default config generation, agent detection calls (stubs OK, real detection in Step 4). Use `tempdir` for test isolation.

**Verify**: `cargo test`, manual `cargo run -- init` in a temp dir

**Commit**: `feat: init command with global and project-scoped initialization`

---

### Step 4: Agent Adapter Trait + Claude Code Adapter
**Goal**: `AgentAdapter` trait defined. Claude Code adapter detects installation, links skills via symlink/include.

**Files**:
- `src/agents/mod.rs`
- `src/agents/detect.rs`
- `src/agents/claude_code.rs`

**Tests**:
- Claude Code adapter detects presence by checking `~/.claude/` existence
- `configure()` creates symlinks from `~/.syncfu/skills/*` → `~/.claude/skills/*`
- `configure()` with include method injects directive into `CLAUDE.md`
- `status()` returns linked/unlinked/broken for each skill
- `unlink()` removes symlinks cleanly
- Handles missing `~/.claude/` gracefully (agent not installed)

**Implementation**: Define `AgentAdapter` trait with `name()`, `detect()`, `configure()`, `status()`, `unlink()`. Implement for Claude Code. Use temp dirs for testing to avoid touching real `~/.claude/`.

**Verify**: `cargo test`

**Commit**: `feat: AgentAdapter trait and Claude Code adapter`

---

### Step 5: Cursor Adapter
**Goal**: Cursor adapter detects installation, generates `.mdc` files from `.md` sources or symlinks.

**Files**:
- `src/agents/cursor.rs`

**Tests**:
- Cursor adapter detects presence by checking `.cursor/` or Cursor config
- `configure()` with generate method converts `.md` → `.mdc` format
- `configure()` with symlink method creates symlinks
- Generated `.mdc` files have correct frontmatter format
- `status()` reports correctly for generated vs symlinked
- `unlink()` cleans up generated/symlinked files

**Implementation**: Implement `AgentAdapter` for Cursor. Format conversion: wrap `.md` content in `.mdc` frontmatter structure.

**Verify**: `cargo test`

**Commit**: `feat: Cursor agent adapter with .mdc generation`

---

### Step 6: Agents Commands
**Goal**: `syncfu agents configure`, `agents status`, `agents link <agent>` work end-to-end.

**Files**:
- `src/cli/agents.rs`
- `src/agents/mod.rs` (agent registry)

**Tests**:
- `agents configure` calls configure on all detected agents
- `agents status` shows status for each registered agent
- `agents link claude-code` links only Claude Code
- `agents link` with unknown agent returns clear error
- Output formatting: `✓`/`✗` indicators, agent names, linked paths

**Implementation**: Wire CLI handlers to agent adapter calls. Agent registry maps names to adapter instances.

**Verify**: `cargo test`, manual `cargo run -- agents status`

**Commit**: `feat: agents commands (configure, status, link)`

---

### Step 7: Construct Management
**Goal**: `syncfu construct create <name>`, `construct connect <url>`, `construct info` using git2.

**Files**:
- `src/cli/construct.rs`
- `src/sync/construct.rs`
- `src/util/git.rs`

**Tests**:
- `construct create` initializes a bare Git repo structure in `~/.syncfu/constructs/<name>/`
- `construct create` updates `syncfu.toml` with construct name
- `construct connect <url>` clones remote into `~/.syncfu/constructs/`
- `construct connect --project` stores connection in project config
- `construct info` shows name, remote URL, skill count, last sync time
- Handle invalid Git URLs gracefully
- Handle auth failure with clear message

**Implementation**: git2 wrappers for init, clone, remote management. Store construct metadata in `construct.toml`.

**Verify**: `cargo test` (use temp dirs with local Git repos — no network calls in tests)

**Commit**: `feat: construct management (create, connect, info)`

---

### Step 8: Uplink & Downlink
**Goal**: `syncfu uplink` pushes local skills to construct. `syncfu downlink` pulls. Aliases `upload`/`download` work.

**Files**:
- `src/cli/sync.rs`
- `src/sync/uplink.rs`
- `src/sync/downlink.rs`
- `src/sync/mod.rs`

**Tests**:
- Uplink: copies local skills into construct repo, commits, pushes
- Uplink: detects no changes → "already up to date"
- Uplink: detects conflicts → warns before push
- Downlink: fetches remote changes, merges into local skills
- Downlink: detects no changes → "already up to date"
- `upload` alias resolves to uplink
- `download` alias resolves to downlink
- Uplink with no construct connected → clear error

**Implementation**: git2 add/commit/push for uplink. git2 fetch/merge for downlink. File-level diffing to detect changes.

**Verify**: `cargo test` (use local bare repo as "remote" in tests)

**Commit**: `feat: uplink/downlink with upload/download aliases`

---

### Step 9: Sync, Status & Conflict Resolution
**Goal**: `syncfu sync` does bidirectional sync. `syncfu status` shows drift. Interactive conflict resolution.

**Files**:
- `src/sync/mod.rs` (sync orchestration)
- `src/sync/conflict.rs`
- `src/cli/sync.rs` (status command)

**Tests**:
- Sync: no changes on either side → "up to date"
- Sync: local-only changes → uplinks
- Sync: remote-only changes → downlinks
- Sync: both sides changed different files → merges cleanly
- Sync: both sides changed same file → triggers conflict prompt
- Conflict resolution: user picks local → local version kept
- Conflict resolution: user picks remote → remote version applied
- Status: shows local changes, remote changes, conflict count
- `sync --all`: iterates all registered projects + global

**Implementation**: Combine uplink + downlink with conflict detection in between. Use `dialoguer` for interactive prompts. Status compares local hashes vs construct HEAD.

**Verify**: `cargo test`

**Commit**: `feat: bidirectional sync with conflict resolution and status`

---

### Step 10: SkillPill Registry Client
**Goal**: `syncfu pills search`, `pills take`, `pills list`, `pills info` against a Git-backed registry.

**Files**:
- `src/cli/pills.rs`
- `src/pills/mod.rs`
- `src/pills/registry.rs`
- `src/pills/install.rs`

**Tests**:
- Search: finds pills by keyword in name, description, tags
- Search: returns formatted results with name, description, version, stars
- Take: clones pill into `~/.syncfu/pills/<name>/`, copies skill to `~/.syncfu/skills/`
- Take: creates `pill.toml` with version metadata
- Take: links installed skill to configured agents
- List: shows all installed pills with version
- Info: shows full pill metadata
- Take: already-installed pill prompts for upgrade
- Search with no results → clear message

**Implementation**: Clone/pull registry Git repo to local cache. Parse `pill.toml` for metadata. Search over in-memory index.

**Verify**: `cargo test` (use temp Git repo as mock registry)

**Commit**: `feat: SkillPill registry client (search, take, list, info)`

---

### Step 11: Validation Engine
**Goal**: `syncfu validate` checks skill file structure, encoding, size, format.

**Files**:
- `src/cli/validate.rs`
- `src/validate/mod.rs`

**Tests**:
- Valid `.md` file passes
- File with invalid encoding fails with message
- File over size limit (e.g., >1MB) warns
- Empty file warns
- File with no markdown headers warns (likely not a skill file)
- `validate` with no args validates all skills in scope
- `validate <file>` validates specific file
- Exit code 0 on all pass, 1 on any warning/error

**Implementation**: Read skill files, check UTF-8, size, basic markdown structure (has at least one `#` header).

**Verify**: `cargo test`

**Commit**: `feat: skill file validation engine`

---

### Step 12: Projects List & Sync All
**Goal**: `syncfu projects list` shows all registered projects. `syncfu sync --all` syncs everything.

**Files**:
- `src/cli/projects.rs`
- Updates to `src/cli/sync.rs`

**Tests**:
- `projects list` with no projects → "No projects registered"
- `projects list` shows path, construct, skill count, sync status per project
- `sync --all` syncs global + all registered projects
- `sync --all` reports per-project results
- Handles stale project entries (path no longer exists) with warning

**Implementation**: Read `[[projects]]` from global config. Iterate and run sync for each. Format tabular output.

**Verify**: `cargo test`

**Commit**: `feat: projects list and sync --all`

---

### Step 13: Agent Skill Install
**Goal**: `syncfu agents install-skill` generates and installs a SyncFu management skill into Claude Code and Cursor.

**Files**:
- `src/cli/agents.rs` (add install-skill subcommand)
- `src/agents/skill_template.rs` (skill file templates)

**Tests**:
- Generates `~/.claude/skills/syncfu-manager.md` for Claude Code
- Generates `.cursor/rules/syncfu-manager.mdc` for Cursor
- Generated Claude skill contains instructions for detecting skill changes
- Generated Claude skill contains `syncfu uplink`/`downlink` commands
- Generated Cursor rule has correct `.mdc` frontmatter
- Overwrites existing skill with confirmation prompt
- Skips agents that aren't configured

**Implementation**: Embed skill templates as `const` strings. Write to appropriate agent paths. Cursor version wraps in `.mdc` format.

**Verify**: `cargo test`, manual inspection of generated files

**Commit**: `feat: agents install-skill for AI-powered auto-sync`

---

### Step 14: Install Script
**Goal**: `install.sh` script for `curl -fsSL https://syncfu.dev/install | sh`.

**Files**:
- `scripts/install.sh`

**Tests**:
- Script detects OS (darwin/linux)
- Script detects architecture (arm64/x86_64)
- Script constructs correct download URL
- Script validates checksum
- Script installs to correct path
- Script prints success message with next steps
- Script fails gracefully on unsupported OS/arch

**Implementation**: Shell script following `rustup`/`bun` patterns. Download from GitHub Releases, verify SHA-256, install binary.

**Verify**: `shellcheck scripts/install.sh`, manual test on macOS

**Commit**: `feat: install script for curl-pipe-sh distribution`

---

## Step Dependency Graph

```
Step 1 (scaffold)
  └→ Step 2 (config)
       └→ Step 3 (init)
       │    └→ Step 6 (agents commands)
       │    └→ Step 12 (projects list)
       └→ Step 4 (claude adapter)
       │    └→ Step 5 (cursor adapter)
       │         └→ Step 6 (agents commands)
       │              └→ Step 13 (install-skill)
       └→ Step 7 (construct)
            └→ Step 8 (uplink/downlink)
                 └→ Step 9 (sync/status/conflict)
                      └→ Step 12 (sync --all)
       └→ Step 10 (pills) — independent after Step 2
       └→ Step 11 (validate) — independent after Step 2

Step 14 (install script) — independent, can be done anytime
```

## Quality Checkpoints

- **After Step 6**: Full `init` → `agents configure` → `agents status` flow works end-to-end
- **After Step 9**: Full team flow works: `construct create` → `uplink` → `connect` → `downlink` → `sync`
- **After Step 10**: Full pill flow works: `pills search` → `pills take` → `pills list`
- **After Step 13**: AI agent integration works: `agents install-skill` → verify generated skill content
- **After Step 14**: Distribution works: `install.sh` downloads and installs correctly
