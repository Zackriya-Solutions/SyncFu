# SyncFu — Product Bible

**Date**: 2026-03-11
**Status**: Pre-launch research & product definition
**Inspiration**: The Matrix (1999) — "I know Kung Fu."

---

## 1. The Golden Circle — Why, How, What

### 1.1 WHY — The Problem That Shouldn't Exist

Every developer on your team is teaching their AI assistant the same lessons from scratch.

Developer A writes a brilliant skill file that makes Claude Code review PRs like a senior engineer. Developer B, sitting three desks away, spends two hours writing an inferior version of the same thing. Developer C doesn't even know skill files exist. Developer D left the company — their best skills died with their laptop.

**This is the knowledge silo problem, reborn for the AI age.**

We solved this for code 20 years ago with Git. We solved it for packages with npm/pip/cargo. We solved it for infrastructure with Terraform. But right now, in 2026, the most valuable files on a developer's machine — the skill files that multiply their AI assistant's effectiveness by 10x — are **trapped on individual laptops with zero sharing infrastructure**.

Every team is a crew of Neos, each one plugged into the Matrix but loading their own skill programs one by one, when Tank could upload the entire martial arts library to everyone simultaneously.

**SyncFu exists because your team's collective AI mastery shouldn't be locked in `~/.claude/skills/` on one person's MacBook.**

### 1.2 HOW — Git for Skill Files, But Purpose-Built

SyncFu is built **on top of Git** — not beside it, not replacing it. Git is the transport layer, the versioning engine, the source of truth. SyncFu adds a purpose-built layer on top that understands what skill files *are* and how teams actually use them.

**Why not just use Git directly?**

You *can* use Git directly. Just like you *can* use Git to manage packages instead of using npm. Just like you *can* use Git to manage infrastructure instead of Terraform. But you don't — because domain-specific tooling matters:

| Raw Git | SyncFu |
|---------|--------|
| Clone a repo of `.md` files | `syncfu downlink` — instant team skill sync with conflict resolution |
| Manually copy files into `~/.claude/skills/` | SyncFu auto-configures your agent to read from the right directory |
| No discovery — you need to know the repo URL | `syncfu search "kubernetes"` — browse SkillPills from community |
| One repo, one structure | Namespaced scopes: personal → team → org → community |
| No validation | SyncFu validates skill file structure, warns on conflicts, prevents clobber |
| No metrics | Track which skills your team actually uses, which ones drive impact |
| Agent-specific paths | Agent-agnostic — works with Claude Code, Cursor, Windsurf, Cline, Copilot, any agent |

**The insight**: Git is to SyncFu what the filesystem is to a database. The foundation is there, but the domain-specific layer is what makes it usable at scale.

### 1.3 WHAT — The Product

SyncFu is an **open-source CLI tool** that syncs AI coding assistant skill files across teams, devices, and agents. It ships in **two variants**:

- **Self-Hosted** (free, forever) — your Git repo, your infrastructure, zero SyncFu involvement. Full-featured CLI, all agent adapters, unlimited teams. You own everything.
- **SyncFu Cloud** (paid) — managed infrastructure, web dashboard, analytics, governance, SSO. We run it, you use it. Zero Git knowledge needed.

**One sentence**: SyncFu is Git for skill files — with agent-agnostic configuration, team sync, and a community SkillPill marketplace. Self-host for free or use SyncFu Cloud for managed teams.

**Core primitives**:
- **SkillPills** — pre-built, ready-to-use skill files (community or official)
- **Uplink** — push skills from local to shared team registry
- **Downlink** — pull skills from team registry to local
- **The Construct** — the shared skill registry (Git-backed for self-hosted, managed for Cloud)
- **Operator mode** — team admin curation and governance

---

## 2. Product Ideology

### 2.1 Agent-Agnostic by Design

This is the most critical architectural decision and the primary competitive moat.

**SyncFu does NOT bet on any single AI coding agent.**

Today's landscape:
- Claude Code reads from `.claude/skills/`
- Cursor reads from `.cursor/rules/`
- Windsurf reads from `.windsurfrules`
- Cline reads from `.clinerules`
- Copilot reads from `.github/copilot-instructions.md`
- Codex reads from `AGENTS.md`
- More are coming

SyncFu maintains a **canonical skill directory** (`.syncfu/skills/`) and generates **agent-specific symlinks or config overrides** so every agent on a developer's machine reads from the same source of truth.

```
~/.syncfu/
├── skills/                    # Canonical skill storage
│   ├── team/                  # Team-synced skills
│   │   ├── pr-review.md
│   │   ├── security-audit.md
│   │   └── deploy-checklist.md
│   ├── personal/              # Your private skills
│   │   └── my-workflow.md
│   └── pills/                 # Installed SkillPills
│       ├── @syncfu/rust-expert/
│       └── @community/k8s-debug/
├── agents/                    # Agent adapter configs
│   ├── claude.toml            # How to configure Claude Code
│   ├── cursor.toml            # How to configure Cursor
│   ├── windsurf.toml          # How to configure Windsurf
│   └── cline.toml             # How to configure Cline
├── construct.toml             # Registry connection config
└── syncfu.lock                # Lockfile for reproducible installs
```

**How agent configuration works:**

```bash
syncfu agents configure
# Detects installed agents on this machine
# → Found: Claude Code, Cursor
# → Configuring Claude Code to read skills from ~/.syncfu/skills/
# → Configuring Cursor to read rules from ~/.syncfu/skills/
# → Done. Both agents now share the same skill source.
```

For Claude Code specifically, SyncFu would:
1. Add a `skill_directories` entry pointing to `~/.syncfu/skills/` (if Claude Code supports configurable skill paths)
2. Or symlink `.claude/skills/ → ~/.syncfu/skills/` as a fallback
3. Or inject an include directive in `.claude/CLAUDE.md` referencing SyncFu-managed skills

**The principle**: SyncFu is the **universal adapter** between your team's shared knowledge and whatever AI agent each developer prefers. Teams shouldn't be locked into one agent just to share skills.

### 2.2 SkillPills — The Matrix Reference That Keeps Giving

In The Matrix, the red pill is the moment of awakening. Once you take it, you see the world differently. SkillPills are the same — pre-packaged skill files that, once installed, immediately make your AI assistant dramatically more capable in a specific domain.

**What a SkillPill is:**

A SkillPill is a **versioned, validated, ready-to-use skill package** — not just a single file, but a complete "ability" with:

```
@syncfu/rust-expert/              # A SkillPill
├── pill.toml                     # Metadata, version, compatibility
├── skills/
│   ├── rust-review.md            # PR review for Rust code
│   ├── rust-patterns.md          # Idiomatic Rust patterns
│   └── rust-perf.md              # Performance optimization rules
├── tests/                        # Validation tests (optional)
│   └── test-review-output.md
└── README.md                     # What this pill does
```

```toml
# pill.toml
[pill]
name = "rust-expert"
version = "2.1.0"
description = "Senior Rust engineer review, patterns, and perf optimization"
author = "syncfu-team"
license = "MIT"
agents = ["claude-code", "cursor", "cline"]  # Compatible agents

[pill.requires]
syncfu = ">=1.0.0"

[pill.tags]
languages = ["rust"]
domains = ["code-review", "performance", "patterns"]
```

**SkillPill tiers:**

| Tier | Source | Trust Level | Example |
|------|--------|-------------|---------|
| **Official** (`@syncfu/*`) | SyncFu core team | Curated, tested, maintained | `@syncfu/rust-expert`, `@syncfu/security-audit` |
| **Verified** (`@verified/*`) | Community, reviewed by SyncFu | Code-reviewed, validated | `@verified/django-pro`, `@verified/aws-architect` |
| **Community** (`@user/*`) | Anyone | Use at your own discretion | `@johndoe/my-workflow`, `@acme-corp/internal-review` |
| **Team** (no prefix) | Your org's private registry | Internal trust model | `pr-review`, `deploy-checklist` |

**CLI for SkillPills:**

```bash
# Discover
syncfu pills search "kubernetes"       # Search community pills
syncfu pills trending                   # What's popular this week
syncfu pills inspect @syncfu/k8s-ops   # View pill contents before install

# Install
syncfu pills take @syncfu/rust-expert  # "Take the pill" — install it
syncfu pills take @syncfu/security     # Stack multiple pills
syncfu pills prescribe @syncfu/rust-expert --team  # Push to entire team

# Manage
syncfu pills list                       # What pills am I on?
syncfu pills update                     # Update all pills to latest
syncfu pills eject @syncfu/rust-expert # Remove a pill
syncfu pills pin @syncfu/rust-expert@2.1.0  # Pin to specific version

# Create
syncfu pills create my-workflow         # Scaffold a new pill
syncfu pills publish                    # Publish to community registry
syncfu pills test                       # Validate pill structure
```

### 2.3 The Matrix-Themed CLI Command Language

Every CLI command maps to a Matrix concept. This isn't cosmetic — it creates **intuitive muscle memory** because the metaphors carry meaning.

```
SYNCFU COMMAND REFERENCE
========================

CORE OPERATIONS (The Neural Jack)
─────────────────────────────────
syncfu init                    Initialize a SyncFu project / team construct
syncfu status                  Show sync status, pending changes, agent health

SYNC OPERATIONS (The Data Stream)
─────────────────────────────────
syncfu uplink                  Push local skill changes to team construct
syncfu downlink                Pull latest skills from team construct
syncfu sync                    Bi-directional sync (uplink + downlink)

SKILL MANAGEMENT (The Training Programs)
────────────────────────────────────────
syncfu skills add <file>       Add a skill file to SyncFu management
syncfu skills remove <name>    Remove a skill
syncfu skills list             List all managed skills
syncfu skills diff             Show what changed since last sync
syncfu skills edit <name>      Open a skill in $EDITOR

SKILLPILLS (The Red Pills)
──────────────────────────
syncfu pills take <pill>       Install a SkillPill
syncfu pills eject <pill>      Remove a SkillPill
syncfu pills prescribe <pill>  Push a pill to your team
syncfu pills search <query>    Search the pill registry
syncfu pills create <name>     Scaffold a new pill
syncfu pills publish           Publish pill to registry

TEAM OPERATIONS (The Crew)
──────────────────────────
syncfu crew join <construct>   Join a team's construct (registry)
syncfu crew invite <email>     Invite a member to your construct
syncfu crew list               List crew members
syncfu crew role <user> <role> Set member role (operator/pilot/crew)

AGENT CONFIGURATION (The Jack)
──────────────────────────────
syncfu agents detect           Auto-detect installed AI coding agents
syncfu agents configure        Configure agents to read from SyncFu
syncfu agents status           Show which agents are connected
syncfu agents link <agent>     Manually link a specific agent

CONSTRUCT (The Loading Program)
───────────────────────────────
syncfu construct create <name> Create a new shared skill registry
syncfu construct connect <url> Connect to existing construct (Git remote)
syncfu construct info          Show construct details
syncfu construct log           View sync history

ADVANCED
────────
syncfu operator                Enter Operator mode (admin dashboard TUI)
syncfu doctor                  Diagnose sync issues, agent config problems
syncfu export --format <fmt>   Export skills to standalone format
syncfu import <path>           Import skills from agent-native format
```

### 2.4 Built on Git — The Architecture

```
                    ┌─────────────────────────────────┐
                    │         CONSTRUCT                │
                    │    (Remote Git Repository)       │
                    │                                  │
                    │  team-skills/                    │
                    │  ├── pr-review.md                │
                    │  ├── security-audit.md           │
                    │  └── deploy-checklist.md         │
                    │  pills/                          │
                    │  └── pill.lock                   │
                    │  construct.toml                  │
                    └──────────┬───────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │    Git Protocol     │
                    │  (SSH / HTTPS)      │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌──────▼────────┐ ┌─────▼─────────┐
    │  Developer A   │ │  Developer B  │ │  Developer C  │
    │                │ │               │ │               │
    │ ~/.syncfu/     │ │ ~/.syncfu/    │ │ ~/.syncfu/    │
    │ ├── skills/    │ │ ├── skills/   │ │ ├── skills/   │
    │ ├── pills/     │ │ ├── pills/    │ │ ├── pills/    │
    │ └── agents/    │ │ └── agents/   │ │ └── agents/   │
    │                │ │               │ │               │
    │  ┌──────────┐  │ │  ┌─────────┐ │ │  ┌─────────┐  │
    │  │Claude    │  │ │  │Cursor   │ │ │  │Claude   │  │
    │  │Code      │  │ │  │         │ │ │  │+ Cline  │  │
    │  └──────────┘  │ │  └─────────┘ │ │  └─────────┘  │
    └────────────────┘ └──────────────┘ └───────────────┘
```

**Why Git as the foundation:**

1. **Zero new infrastructure** — your construct is just a Git repo (GitHub, GitLab, Bitbucket, self-hosted)
2. **Battle-tested sync** — merge, conflict resolution, branching are solved problems
3. **Audit trail** — every skill change is a commit with author, timestamp, message
4. **Access control** — leverage existing Git permissions (SSH keys, deploy keys, org roles)
5. **Offline-first** — works on planes, in air-gapped environments
6. **Familiar** — every developer already knows Git mental models
7. **No vendor lock-in** — your skills live in a Git repo you own, forever

**What SyncFu adds on top of Git:**

| Layer | What SyncFu adds |
|-------|-----------------|
| **Schema** | Validates skill file structure, catches malformed pills |
| **Scoping** | Personal / team / org / community namespaces |
| **Agent bridging** | Symlinks + config injection for each AI agent |
| **Conflict UX** | Skill-aware merge strategies (not line-by-line text merge) |
| **Discovery** | Search, trending, categories for community pills |
| **Governance** | Operator roles, approval workflows for team skills |
| **Metrics** | Which skills are used, by whom, how often |
| **Multi-device** | Same developer, multiple machines, always in sync |

---

## 3. Name ↔ Product Alignment

Every product concept has a Matrix name. Every Matrix name maps to exactly one product concept. No orphan metaphors.

### 3.1 Complete Naming Taxonomy

```
THE MATRIX                    SYNCFU
─────────────────────────────────────────────────────────
The Matrix itself         →   The AI coding landscape
Neo                       →   The developer
Morpheus                  →   SyncFu (the tool that awakens)
Tank / Link (Operators)   →   Team admins / skill curators
The Crew                  →   Your team
Neural Jack               →   Agent adapter layer
The Construct             →   Shared skill registry (Git remote)
Skill Programs            →   Skill files (.md)
Red Pill                  →   SkillPills (pre-built packages)
"I know Kung Fu"          →   Skill successfully loaded
Uplink                    →   Push skills to construct
Downlink                  →   Pull skills from construct
Jacking In                →   `syncfu agents configure`
The Operator's Chair      →   `syncfu operator` (admin TUI)
Loading Program           →   `syncfu pills take`
"Show me"                 →   Skill validation / testing
Residual Self Image       →   Personal skill overrides
The One                   →   The skill file that transforms your workflow
Agents (Smith, etc.)      →   (Intentionally unused — negative connotation)
The Oracle                →   `syncfu doctor` (diagnostic tool)
```

### 3.2 Why the Name "SyncFu" Works at Every Level

| Level | How it works |
|-------|-------------|
| **Surface** | Sync + Fu → syncing things, with a martial arts flair |
| **Matrix fan** | "I know Kung Fu" — instant skill download, exactly what this tool does |
| **Technical** | "Fu" implies mastery (as in "command-fu", "Google-fu") — this tool gives your team command-fu |
| **Phonetic** | Two syllables, punchy, easy to say in any language |
| **CLI** | 6 characters — fast to type, no ambiguity |
| **Verb form** | "SyncFu it to the team" — natural as a verb |
| **Search** | Zero Google collisions — completely unique term |
| **Cultural** | "Kung fu" literally means "skill achieved through effort" in Chinese (功夫) — SyncFu means "skill achieved through sync" |

### 3.3 Sub-brand Naming Consistency

| Sub-brand | Name | Matrix reference | Consistency |
|-----------|------|-----------------|-------------|
| CLI tool | **SyncFu** | "I know Kung Fu" | Core brand |
| Skill packages | **SkillPills** | Red/blue pill | "Take the pill" = install |
| Shared registry | **Construct** | The loading program | Where skills are loaded from |
| Team unit | **Crew** | Nebuchadnezzar crew | Natural team term |
| Push to remote | **Uplink** | Ship-to-Matrix data connection | Technical + thematic |
| Pull from remote | **Downlink** | Matrix-to-ship data connection | Technical + thematic |
| Admin role | **Operator** | Tank loads the programs | The person in charge |
| Agent config | **Jack** | Neural jack | The connection interface |
| Diagnostics | **Oracle** | The Oracle sees all | Knows what's wrong |

---

## 4. Defensive Strategy — The Claude Code Threat

### 4.1 The Risk

Claude Code (or Cursor, or any dominant agent) could build native skill sharing:

```
# Hypothetical future Claude Code feature
claude skills share pr-review.md --team acme-corp
claude skills pull --team
claude skills marketplace search "kubernetes"
```

If Anthropic ships this, it would:
- Have zero-friction adoption (built into the tool developers already use)
- Have Anthropic's brand trust and distribution
- Be deeply integrated with Claude Code internals
- Make SyncFu look like unnecessary middleware

**This is the #1 existential threat.** Take it seriously.

### 4.2 The Defense: Why SyncFu Survives (and Thrives)

**MOAT 1: Agent-Agnostic Is the Whole Point**

Claude Code's native skill sharing would only work with Claude Code. That's the opening.

Real teams use mixed tooling:
- Frontend devs prefer Cursor (visual, integrated)
- Backend devs prefer Claude Code (CLI, powerful)
- DevOps uses Copilot (GitHub-integrated)
- The new hire uses Cline (free, VS Code)
- Next year, three new agents emerge

**SyncFu is the Switzerland of skill sharing.** It doesn't care what agent you use. The moment any vendor ships native skill sharing, it only works within their walled garden. SyncFu is the bridge.

> "Claude Code skills sharing only works with Claude Code. SyncFu works with everything."

This is the same pattern as:
- **Docker** vs VM-specific packaging — Docker won because it was runtime-agnostic
- **Terraform** vs AWS CloudFormation — Terraform won because it was cloud-agnostic
- **VS Code** vs vendor IDEs — VS Code won because it was language-agnostic
- **Git** vs Perforce/SVN — Git won because it was platform-agnostic

**MOAT 2: Git-Native = No Lock-in**

If Claude Code ships skill sharing, it will probably be:
- Proprietary sync protocol
- Anthropic-hosted registry
- Claude Code-specific file format
- Requires Anthropic account

SyncFu's construct is **a Git repo you own**. If SyncFu disappears tomorrow, your skills are still there, in Git, in Markdown. You can read them, share them, version them with standard tools. Zero lock-in.

**MOAT 3: SkillPills Marketplace = Network Effects**

The first mover to build a **community ecosystem** of shareable, versioned skill packages wins. npm didn't win because of technical superiority — it won because of the package ecosystem.

If SyncFu has 500 community SkillPills covering Rust, Python, K8s, security, etc. before Claude Code ships anything, developers won't switch to a closed marketplace with 0 packages.

**MOAT 4: Enterprise Features Vendors Won't Build**

Enterprise teams need things AI agent vendors won't prioritize:
- **Approval workflows** — skills must be reviewed before team-wide deployment
- **Compliance audit** — who changed which skill, when, why (Git gives this free)
- **Air-gapped sync** — government/defense teams can't use cloud registries
- **Skill governance** — prevent prompt injection via malicious skill files
- **Cross-agent consistency** — ensure all developers, regardless of agent, get the same instructions
- **Metrics & analytics** — which skills are actually used, adoption rates

### 4.3 Defensive Positioning Matrix

| If Claude Code ships... | SyncFu's response |
|------------------------|-------------------|
| Skill sharing within Claude Code | "Great for Claude-only teams. Most teams aren't." |
| Skill marketplace | "Vendor-locked marketplace vs open Git-backed registry you own." |
| Team skill sync | "Does it work when half your team uses Cursor? Ours does." |
| Nothing (status quo) | SyncFu is the clear leader in an uncontested space. |

### 4.4 Strategic Timeline

```
PHASE 1 — Land (Months 1-3)
├── Ship CLI: init, uplink, downlink, sync, pills take
├── Support Claude Code + Cursor adapters
├── 20 official SkillPills (Rust, Python, JS, Security, DevOps...)
├── Open-source, MIT license
└── Target: 500 GitHub stars, 100 weekly active users

PHASE 2 — Expand (Months 4-8)
├── Community pill registry (pills.syncfu.dev)
├── Support Cline, Windsurf, Copilot adapters
├── Team/org features: crew management, roles, approvals
├── VS Code extension: SyncFu sidebar
└── Target: 2000 stars, 50 community pills, 500 WAU

PHASE 3 — Defend (Months 9-12)
├── Enterprise features: SSO, audit logs, compliance
├── SyncFu Cloud (hosted constructs, optional)
├── Metrics dashboard: skill usage analytics
├── Plugin system: custom agent adapters
└── Target: 5000 stars, 200 pills, 2000 WAU, first enterprise customers

PHASE 4 — Dominate (Year 2)
├── Become the de facto standard before vendors react
├── Agent vendors integrate WITH SyncFu rather than competing
│   (e.g., `claude skills sync --source syncfu`)
├── Training & certification for skill file authoring
└── SyncFu becomes a verb: "Just SyncFu it"
```

### 4.5 The Best Defense: Become the Standard

The ultimate defensive strategy is to be so widely adopted that agent vendors **integrate with SyncFu** rather than building their own.

Precedent:
- Docker became so standard that every CI/CD tool integrated with it
- npm became so standard that Node.js ships with it built-in
- Terraform became so standard that cloud providers publish official modules

**If SyncFu reaches critical mass, the threat becomes an opportunity:**

> Claude Code v4.0 release notes:
> "New: Native SyncFu integration. Run `claude config set skill_source syncfu` to automatically load skills from your SyncFu construct."

This is the end state to aim for. Not competing with agent vendors — becoming **infrastructure they build on**.

---

## 5. User Journeys

### 5.1 Solo Developer — First Contact

```
$ syncfu init
 Initializing SyncFu in ~/.syncfu/
 Detected agents: Claude Code v4.2, Cursor v0.48
 Configure agents to use SyncFu skills? [Y/n] y
 Claude Code: linked ~/.claude/skills/ → ~/.syncfu/skills/
 Cursor: updated .cursor/rules to include ~/.syncfu/skills/
 Ready. Your agents now share the same skill source.

$ syncfu pills search "rust"
 @syncfu/rust-expert      v2.1.0  ★★★★★  Senior Rust review & patterns
 @syncfu/rust-unsafe      v1.3.0  ★★★★☆  Unsafe code audit specialist
 @verified/rust-embedded  v1.0.2  ★★★★☆  Embedded Rust (no_std) expert
 @community/rust-wasm     v0.9.1  ★★★☆☆  Rust → WASM compilation

$ syncfu pills take @syncfu/rust-expert
 Downloaded @syncfu/rust-expert v2.1.0
 Installed 3 skill files:
   → rust-review.md (PR review for Rust)
   → rust-patterns.md (idiomatic patterns)
   → rust-perf.md (performance optimization)
 Skill loaded. "I know Rust Fu."

$ claude
 Claude Code now has 3 new skills from @syncfu/rust-expert
```

### 5.2 Team Lead — Setting Up Team Sync

```
$ syncfu construct create acme-engineering
 Created construct: acme-engineering
 Remote: git@github.com:acme-corp/syncfu-skills.git
 You are the Operator of this construct.

$ syncfu skills add ./our-pr-review-skill.md
 Added: our-pr-review-skill.md → team/our-pr-review-skill.md

$ syncfu uplink -m "Add team PR review standard"
 Uplinked 1 skill to acme-engineering
 Commit: a3f7c2d "Add team PR review standard"

$ syncfu crew invite alice@acme.com bob@acme.com
 Invited 2 members to acme-engineering construct
 They'll receive setup instructions via email.
```

### 5.3 Team Member — Joining and Syncing

```
$ syncfu crew join acme-engineering
 Connecting to acme-engineering construct...
 Cloning from git@github.com:acme-corp/syncfu-skills.git
 Downloaded 12 team skills, 3 prescribed pills
 Configuring agents: Claude Code ✓, Cursor ✓
 You're jacked in. Welcome to the crew.

$ syncfu downlink
 Already up to date.

# ... later, after the team lead pushes new skills ...

$ syncfu downlink
 ↓ 2 skills updated, 1 new skill
   ~ team/pr-review.md (updated)
   ~ team/security-audit.md (updated)
   + team/incident-response.md (new)
 Skills loaded. Your agents are up to date.
```

### 5.4 Multi-Device Developer — Home + Work Sync

```
# On work laptop
$ syncfu uplink -m "Refine deployment skill from production learnings"
 Uplinked 1 skill change

# On home desktop (same developer, same construct)
$ syncfu downlink
 ↓ 1 skill updated
   ~ personal/deployment.md (updated from work laptop)
 Synced across devices.
```

---

## 6. Security Architecture & Private Team Model

### 6.1 Fundamental Principle: BYOG (Bring Your Own Git)

SyncFu is a **local CLI tool**, not a cloud service. For private teams, SyncFu operates the same way Terraform does — the CLI runs on the developer's machine, talks to infrastructure the team already controls, and the company behind it never touches the data.

```
┌─────────────────────────────────────────────────────────┐
│                   YOUR INFRASTRUCTURE                    │
│                                                          │
│  GitHub.com/acme-corp/syncfu-skills (PRIVATE repo)      │
│  ├── Encrypted at rest (GitHub's encryption)             │
│  ├── Access: GitHub collaborators only                   │
│  ├── Audit: GitHub audit log                             │
│  └── 2FA: GitHub's 2FA enforcement                      │
│                                                          │
│  Developer laptops:                                      │
│  └── ~/.syncfu/constructs/acme-engineering/ (local Git)  │
│                                                          │
│                    ┌──────────────────┐                   │
│                    │  SyncFu (company)│                   │
│                    │                  │                   │
│                    │  Sees: NOTHING   │                   │
│                    │  Has: NO ACCESS  │                   │
│                    │  Stores: NOTHING │                   │
│                    └──────────────────┘                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**SyncFu servers are ONLY involved when users choose to:**
1. Use SyncFu Cloud (hosted constructs) instead of their own Git
2. Browse the public SkillPills registry (`pills.syncfu.dev`)
3. Use the optional web analytics dashboard

### 6.2 One Team = One Repo (Isolation Model)

```
TEAM ISOLATION
══════════════

Team A (Frontend):
  github.com/acme-corp/syncfu-frontend-skills (private)
  └── Members: 8 frontend devs

Team B (Backend):
  github.com/acme-corp/syncfu-backend-skills (private)
  └── Members: 12 backend devs

Team C (Platform):
  github.com/acme-corp/syncfu-platform-skills (private)
  └── Members: 5 platform devs

Org-wide (shared):
  github.com/acme-corp/syncfu-org-skills (private)
  └── Members: All 25 devs

No cross-contamination. Frontend can't see backend skills.
But everyone gets org-wide standards.
```

A developer can join **multiple constructs**:

```bash
syncfu crew join acme-frontend     # team-specific skills
syncfu crew join acme-org          # org-wide skills

# Skill precedence (most specific wins):
# personal skills > team skills > org skills > public pills
```

### 6.3 Access Control = Git's Access Control

No new auth system. No SyncFu accounts. No tokens to manage. **Zero new attack surface.**

```
ACCESS CONTROL = GITHUB'S ACCESS CONTROL
════════════════════════════════════════

Organization level:
  GitHub Org > Settings > Member privileges
  ├── Base permissions: None (can't see private repos by default)
  └── Require 2FA: Yes

Repo level:
  github.com/acme-corp/syncfu-skills > Settings > Collaborators
  ├── alice (Operator)  → Admin access
  ├── bob (Pilot)       → Write access
  ├── carol (Crew)      → Write access
  └── dave (Crew)       → Read access (can downlink but not uplink)

Branch protection:
  main branch > Require PR reviews before merge
  ├── Required reviewers: 1 (Operator must approve)
  └── No direct pushes to main

Revoke access:
  Remove from GitHub collaborators → instantly loses access
  Their local clone still exists but can't pull updates
```

### 6.4 What SyncFu Touches on a Developer's Machine

```
WHAT SYNCFU CREATES (isolated, in its own directory):
════════════════════════════════════════════════════
~/.syncfu/
├── constructs/acme-engineering/     # Git clone of team skills
├── pills/                           # Installed public pills
├── config.toml                      # SyncFu settings
└── agents/                          # Agent adapter configs

WHAT SYNCFU MODIFIES IN EXISTING TOOLS (non-destructive):
═════════════════════════════════════════════════════════
Option A — Symlinks (default, safest):
  ~/.claude/skills/acme/ → symlink to ~/.syncfu/constructs/.../team/
  .cursor/rules/acme-*.mdc → symlink to converted files

Option B — Include directive:
  Appends ONE LINE to CLAUDE.md:
    "Also read skills from ~/.syncfu/constructs/acme-engineering/team/"

WHAT SYNCFU DOES NOT TOUCH (ever):
══════════════════════════════════
  ✗ Your code repositories
  ✗ Your .git directories
  ✗ Your existing .cursorrules (adds alongside, never replaces)
  ✗ Your existing CLAUDE.md content (appends, never overwrites)
  ✗ Your CI/CD pipelines
  ✗ Your environment variables
  ✗ Your SSH keys (reads for Git auth, never writes or copies)
  ✗ Any system files or root-level config

UNINSTALL:
  rm -rf ~/.syncfu/ + remove one symlink/include line = zero residue
```

### 6.5 Full User Flow: Private Team Setup

**Step 1 — Team Lead creates construct:**

```bash
$ syncfu construct create acme-engineering

? Where should your construct live?
  > My own GitHub/GitLab (recommended — you keep full control)
    SyncFu Cloud (we host it for you)

? GitHub org: acme-corp
? Repository visibility: Private

Creating construct...
→ Using YOUR GitHub credentials (gh auth / SSH key)
→ Creating private repo: github.com/acme-corp/syncfu-skills
→ SyncFu does NOT get access to this repo

✓ Construct created: acme-engineering
  Remote: git@github.com:acme-corp/syncfu-skills.git
  You are the Operator.
```

Under the hood, SyncFu ran:
```bash
# Using alice's existing gh CLI / git credentials:
gh repo create acme-corp/syncfu-skills --private
git clone git@github.com:acme-corp/syncfu-skills.git ~/.syncfu/constructs/acme-engineering/
# Created initial structure: team/, pills/, agents/, construct.toml
git add . && git commit -m "Initialize construct" && git push
```

**Step 2 — Invite team members:**

```bash
$ syncfu crew invite bob@acme.com carol@acme.com

? How should they get access?
  > GitHub collaborators (uses GitHub's permission system)

→ gh api repos/acme-corp/syncfu-skills/collaborators/bob --method PUT
→ gh api repos/acme-corp/syncfu-skills/collaborators/carol --method PUT

✓ 2 members invited via GitHub's standard collaboration system.
```

No SyncFu accounts. No new tokens. Standard GitHub invitation emails.

**Step 3 — Team member joins:**

```bash
$ syncfu crew join acme-engineering
? Construct URL: git@github.com:acme-corp/syncfu-skills.git

→ Using YOUR SSH key to clone (SyncFu never sees this key)
→ Downloaded 8 team skills

Detecting agents...
→ Found: Claude Code v4.2, Cursor v0.52

Configuring agents...
→ Claude Code: Added skill include path
→ Cursor: Generated .mdc rules from team skills

✓ You're jacked in. 8 skills loaded across 2 agents.
```

**Step 4 — Publish a skill:**

```bash
$ syncfu uplink -m "Add API design review standard"

Pre-flight checks...
→ Validating skill file structure... ✓
→ Security scan (no credentials, no prompt injection)... ✓
→ Checking for conflicts... ✓

→ git add team/api-design.md
→ git commit -m "Add API design review standard"
→ git push origin main

✓ Uplinked. 14 team members will get this on next downlink.
```

**Step 5 — Everyone syncs:**

```bash
$ syncfu downlink

→ git pull origin main
→ 1 new skill: team/api-design.md
→ Converting to Cursor .mdc format... ✓
→ Updating Copilot instructions... ✓

✓ 1 skill added. All agents up to date.
```

### 6.6 What Could Go Wrong (Honest Risk Assessment)

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Skill contains a secret** (API key in markdown) | High | `syncfu uplink` runs credential detection BEFORE commit. Blocks push if found. |
| **Malicious skill** (prompt injection) | Medium | Security scan on uplink. Operator approval workflow on Team tier. |
| **Merge conflict** (two people edit same skill) | Low | Skill-aware merge (section-level). `syncfu resolve` interactive UI. |
| **Someone leaves company** | Low | Remove from GitHub repo = access revoked. Skills are instructions, not secrets. |
| **SyncFu CLI vulnerability** | Medium | Open-source (community audit). No elevated privileges. User-space files only. No root, no daemon, no background process. |
| **Git repo gets too big** | Negligible | Skills are ~1-10KB Markdown. 1,000 skills = ~5MB. Git handles this effortlessly. |
| **Symlink breaks** | Low | `syncfu doctor` diagnoses and repairs. Agent falls back to local skills. |

### 6.7 Two Deployment Variants

SyncFu ships as **two clear products** — same CLI, two backends:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SyncFu CLI (same binary)                        │
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │    SELF-HOSTED (Free)        │  │    CLOUD (Paid)                  │ │
│  │                              │  │                                  │ │
│  │  Your Git, your infra        │  │  SyncFu-hosted infrastructure   │ │
│  │  Your access control         │  │  Managed Git + Web Dashboard    │ │
│  │  Zero SyncFu involvement    │  │  Zero Git knowledge needed      │ │
│  │  100% open source           │  │  Team analytics + governance    │ │
│  │  Community support only     │  │  SLA + priority support         │ │
│  │                              │  │                                  │ │
│  │  YOU own it. Period.        │  │  WE run it. You use it.         │ │
│  └──────────────────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### VARIANT 1: Self-Hosted (Free, Forever)

**Who it's for**: Teams that have Git, know Git, and want full control.

```
SELF-HOSTED — $0
════════════════
What you get:
├── Full CLI binary (MIT open source)
├── ALL agent adapters (Claude Code, Cursor, Windsurf, Cline, Copilot, Codex, etc.)
├── ALL SkillPills (community registry access)
├── Private team sync (your own GitHub/GitLab/Gitea repo)
├── Public multi-device sync
├── Pre-flight security scanning on uplink
├── Conflict resolution UI
├── Operator role + approval workflows
├── Unlimited teams, unlimited members, unlimited skills
└── Every CLI feature. No gates. No limits.

What you handle:
├── Git repo creation and management
├── Access control (GitHub/GitLab collaborators)
├── Backups (your Git host handles this)
├── Uptime (your Git host's SLA)
└── Onboarding (sharing the repo URL with teammates)

What SyncFu (the company) gets:
└── Nothing. Zero telemetry. Zero access. Zero knowledge of your existence.
```

**This is not a "free trial" or a "starter tier"**. Self-hosted is the full product. Every feature the CLI can do, self-hosted users get. The model is identical to:
- **Git** — free to self-host, GitHub charges for the cloud layer
- **GitLab CE** — free self-hosted, GitLab.com is the paid cloud
- **Gitea** — free forever, Gitea Cloud is the paid option
- **Bitwarden** — free self-hosted, Bitwarden Cloud is the convenience layer
- **n8n** — free self-hosted, n8n Cloud for managed hosting

**Why give everything away?** Because the CLI is the **distribution channel**, not the product. The more self-hosted teams use SyncFu, the more teams discover they'd rather not manage Git repos for skill files. The cloud conversion funnel fills itself.

```
USER JOURNEY (Self-Hosted):
═══════════════════════════

1. Developer discovers SyncFu on GitHub/HN/Reddit
2. `brew install syncfu` or `cargo install syncfu`
3. `syncfu construct create my-team --remote git@github.com:acme/skills.git`
4. Team uses it for 3 months, loves it
5. New hire joins → "here's the Git URL, clone it, run syncfu crew join"
6. IT asks: "can we get a dashboard? audit logs? SSO?"
7. Team lead thinks: "managing this Git repo is annoying, I just want it to work"
8. → Upgrades to SyncFu Cloud
```

---

#### VARIANT 2: SyncFu Cloud (Paid)

**Who it's for**: Teams that want managed infrastructure, analytics, and governance without touching Git.

```
CLOUD — Team $12/user/mo
═════════════════════════
Everything in Self-Hosted, PLUS:

Infrastructure (we handle it):
├── Hosted private constructs (Git repos managed by SyncFu)
├── Web dashboard for skill browsing, editing, and management
├── Built-in team invitations (email-based, no GitHub account needed)
├── Automatic backups (daily, 90-day retention)
├── 99.9% uptime SLA
├── Data residency choice (US / EU / APAC)
└── CDN-backed SkillPill downloads (fast globally)

Team intelligence layer:
├── Analytics dashboard — who uses which skills, adoption rates, sync health
├── Skill impact scoring — which skills correlate with faster PR cycles
├── Slack/Teams/Discord notifications on skill updates
├── Scheduled downlink (auto-sync on interval or Git hook)
├── Onboarding automation — new hire runs `syncfu crew join <code>` (no Git URL needed)
└── Email + chat support (24h response)

Governance:
├── Operator approval workflows with web UI
├── Skill change history with diff viewer
├── Role-based access (Operator / Pilot / Crew / Viewer)
└── Skill expiration + review reminders
```

```
CLOUD — Enterprise $35/user/mo
═══════════════════════════════
Everything in Team, PLUS:

Identity & compliance:
├── SAML SSO + SCIM directory sync (Okta, Azure AD, OneLogin)
├── Audit log API + SIEM integration (Splunk, Datadog, etc.)
├── Compliance exports (SOC2 evidence packs)
├── Policy enforcement engine (block skills matching patterns)
├── IP allowlisting
└── Custom data retention policies

Deployment flexibility:
├── Air-gapped deployment kit (Docker Compose + Gitea bundle)
├── On-prem option (SyncFu Cloud on YOUR infrastructure)
├── Custom agent adapters (proprietary internal tools)
└── Dedicated instance (single-tenant, isolated DB)

Support:
├── Dedicated customer success manager
├── 4-hour SLA for critical issues
├── Quarterly business reviews
├── Custom onboarding program
└── Private Slack/Teams channel with SyncFu engineering
```

---

#### Why This Model Works

```
THE CONVERSION FUNNEL:
══════════════════════

  Self-Hosted (free)          ←── 90% of users start here
       │
       │  "This is great, but managing Git repos
       │   for skill files is overhead I don't want"
       │
       │  "My manager wants analytics on skill adoption"
       │
       │  "New hires keep asking me for the Git URL"
       │
       ▼
  Cloud Team ($12/user/mo)    ←── 8% convert within 6 months
       │
       │  "Legal needs SOC2 evidence"
       │
       │  "IT wants SSO + SCIM"
       │
       │  "We need audit logs for compliance"
       │
       ▼
  Cloud Enterprise ($35/user/mo) ←── 2% (but highest revenue per user)
```

**Key insight**: Self-hosted is not a loss leader. It's the **growth engine**. Every self-hosted team is:
1. Validating the product (free QA)
2. Contributing to the community (pills, bug reports, adapters)
3. A future Cloud customer when their team scales
4. An evangelist who tells other teams about SyncFu

**The gate is NOT features**. Self-hosted gets every CLI feature. **The gate is operational burden**:
- "Do I want to manage a Git repo just for skill files?" → Cloud
- "Do I want to set up GitHub collaborators for every new hire?" → Cloud
- "Do I want to build my own analytics dashboard?" → Cloud
- "Do I want to handle SOC2 audit evidence myself?" → Enterprise Cloud

This is the exact model that made GitLab ($500M ARR), Bitwarden ($100M+ ARR), and n8n ($40M funding) successful. **Give away the engine, charge for the cloud.**

---

## 7. Naming Research — Full Candidate Analysis

### 6.1 GitHub & Domain Availability (Researched 2026-03-11)

| Name | GitHub Status | Key Conflicts | Domain Likelihood | Verdict |
|------|-------------|---------------|-------------------|---------|
| **SyncFu** | **WIDE OPEN** — no repos, no org, no topic | Only Syncfusion (unrelated UI library) | `syncfu.dev` likely available | **TOP PICK** |
| **SkillJack** | **WIDE OPEN** — no repos | Only Shadowrun RPG reference | `skilljack.dev` likely available | Strong runner-up |
| **Loadout** | Topic exists, no dominant repo | Gaming loadout builders (different space) | `loadout.dev` — common word, check | Good option |
| **SkillPill** | Nearly open — only university lectures | Educational "skill pill" content | `skillpill.dev` likely available | Used as sub-brand |
| **Imprint** | Lightly taken — scattered repos | Imprint-Tech org, various small projects | `imprint.dev` — common word | Professional but weak Matrix ref |

### 6.2 Names Ruled Out

| Name | Why Avoid |
|------|----------|
| **Construct** | `construct/construct` — Python binary parser (5k+ stars), Scirra game engine |
| **Engram** | 6+ repos: DeepSeek, AI memory systems, keyboard layouts. Saturated. |
| **SkillSync** | 10+ repos — all skill-sharing platforms. Zero differentiation. |
| **SkillForge** | 8+ repos including Claude Code skill tool. Direct collision. |
| **Dendrite** | `matrix-org/dendrite` — major Matrix protocol homeserver |
| **Synapse** | `matrix-org/synapse` — 12k+ stars. Heavily established. |
| **Myelin** | `myelin-ai` org exists. Multiple neuroscience tools. |
| **JackIn** | Clojure ecosystem owns this term completely. |
| **Cortex** | Multiple major ML infrastructure projects. |
| **NeoSync** | `nucleuscloud/neosync` — data anonymization, ~2k stars. |
| **Operator** | Kubernetes Operator pattern dominates entirely. |

---

## 7. Brand Identity

### 7.1 Visual Identity

**Logo concept**: Minimal neural jack icon — two parallel lines (the connection) with a pulse/flow between them. Matrix green on black.

**Color palette**:
```
Primary:   #00FF41  (Matrix green — terminal, code, "the signal")
Dark:      #0D0D0D  (Near-black — the void before jacking in)
Light:     #F0F0F0  (Clean white — documentation, readability)
Accent:    #FFB000  (Amber — warnings, attention)
Pill Red:  #FF3333  (SkillPill branding)
Pill Blue: #3366FF  (Alternative pill color for contrast)
```

**Typography**: Monospace for CLI output and brand moments. Clean sans-serif for docs.

### 7.2 Voice & Tone

| Context | Tone | Example |
|---------|------|---------|
| README | Confident, slightly playful | "Like Neo downloading Kung Fu, but for your whole team." |
| CLI output | Concise, warm, Matrix-flavored | `Skill loaded. "I know Rust Fu."` |
| Error messages | Helpful, not cute | `Error: Construct unreachable. Check your Git remote URL.` |
| Docs | Technical, clear, no fluff | Standard technical writing |
| Marketing | Bold, opinionated | "Your AI assistant is only as good as the skills you feed it." |

### 7.3 README Opener

```
   ____              ___
  / __/_ _____  ____/ __/_ __
 _\ \/ // / _ \/ __/ _// // /
/___/\_, /_//_/\__/_/  \_,_/
    /___/

"I know Kung Fu." — Neo

Git for AI skill files. Agent-agnostic. Team-ready.

$ syncfu pills take @syncfu/rust-expert
 Skill loaded. "I know Rust Fu."
```

### 7.4 Taglines (Ranked)

1. **"I know Kung Fu." — Skill sync for AI-native teams.**
2. **Git for skill files. Agent-agnostic. Team-ready.**
3. **Your team's collective AI mastery, always in sync.**
4. **Download skills. Share mastery. Ship faster.**
5. **The universal skill layer for AI coding agents.**

### 7.5 Elevator Pitches

**5 seconds**: "Git for AI skill files."

**15 seconds**: "SyncFu syncs AI coding assistant skill files across your team. Built on Git, works with any agent — Claude Code, Cursor, Copilot, whatever. One developer writes a great skill, the whole team gets it instantly."

**60 seconds**: "Every developer on your team is teaching their AI assistant the same lessons independently. Developer A writes a brilliant PR review skill for Claude Code. Developer B writes an inferior version for Cursor. Developer C doesn't know skills exist. SyncFu fixes this — it's an open-source CLI that syncs skill files across teams and devices, built on Git, and works with any AI coding agent. It includes SkillPills — pre-built skill packages you can install in one command. Think npm for AI skills, or Docker for prompts. Agent-agnostic by design, because real teams don't all use the same tool."

---

## 8. Technical Differentiation — Why Not Just a Git Repo?

### 8.1 The "Just Use Git" Objection

Skeptics will say: *"This is just a Git repo of Markdown files with a fancy CLI wrapper."*

They're right about the foundation. They're wrong about the value.

**Counter-arguments (with historical parallels):**

| "Just use..." | What won instead | Why the wrapper matters |
|--------------|-----------------|----------------------|
| "Just use Git for packages" | npm, pip, cargo | Dependency resolution, versioning, registry, search |
| "Just use shell scripts for infra" | Terraform, Ansible | Declarative syntax, state management, plan/apply |
| "Just use Makefiles for builds" | Webpack, Vite, Turbopack | HMR, tree-shaking, code splitting, DX |
| "Just use cURL for APIs" | Postman, httpie | Collections, environments, auth management |
| "Just use Git for skill files" | **SyncFu** | Agent bridging, SkillPills, team governance, discovery |

### 8.2 What SyncFu Does That Raw Git Cannot

1. **Agent auto-configuration** — Git doesn't know what Claude Code, Cursor, or Cline are. SyncFu detects installed agents and configures each one to read from the canonical skill directory.

2. **Skill validation** — Git accepts any file. SyncFu validates skill file structure, catches common errors (missing metadata, broken references, incompatible agent targets).

3. **Namespace scoping** — Git has branches. SyncFu has semantic scopes (personal → team → org → community) with inheritance and override rules.

4. **SkillPill packaging** — Git has repos. SyncFu has versioned, tested, discoverable skill packages with metadata, compatibility declarations, and a registry.

5. **Conflict resolution for skills** — Git merge on Markdown produces confusing diffs. SyncFu understands skill file sections and can merge intelligently (e.g., two people adding different rules to the same skill).

6. **Usage analytics** — Git tracks commits. SyncFu tracks which skills are actually loaded by agents, how often, by whom — so teams can prune unused skills and double down on valuable ones.

7. **Multi-device identity** — Git requires SSH keys per machine. SyncFu links devices under one developer identity so personal skills sync seamlessly.

---

## 9. Competitive Landscape

### 9.1 Current Solutions (March 2026)

| Solution | Approach | Limitation |
|----------|----------|-----------|
| **Manual copy-paste** | Share skill files via Slack/email | No versioning, no sync, no validation |
| **Shared Git repo** | Team repo of `.md` files | No agent config, no discovery, no packaging |
| **Dotfiles managers** (chezmoi, yadm) | Sync config files across machines | Not skill-aware, no team features, no marketplace |
| **SkillForge** (Claude Code) | Skill router for Claude Code | Claude Code only, no team sync, no registry |
| **Agent-native sharing** | None exist yet | — |

### 9.2 SyncFu's Position

```
                    Agent-Specific ◄──────────────────► Agent-Agnostic
                         │                                    │
     Individual ─────────┤                                    │
                         │  SkillForge                        │
                         │  (Claude only,                     │
                         │   single user)                     │
                         │                                    │
                         │                              ┌─────┴─────┐
                         │                              │  SyncFu   │
                         │                              │           │
         Team ───────────┤                              │  Git-based│
                         │                              │  Any agent│
                         │  Future Claude               │  Team sync│
                         │  native sharing              │  SkillPills│
                         │  (if shipped)                └─────┬─────┘
                         │                                    │
    Enterprise ──────────┤                                    │
                         │                              SyncFu Enterprise
                         │                              (SSO, audit, gov)
```

---

## 10. Next Steps

### Immediate (This Week)
- [ ] Verify domain availability: `syncfu.dev`, `syncfu.io`, `syncfu.com`
- [ ] Register GitHub org: `github.com/syncfu`
- [ ] Claim npm/crates.io/PyPI: `syncfu`
- [ ] Claim social: `@syncfu` on X, Discord

### Phase 1 Build (Month 1)
- [ ] Scaffold CLI (Rust or Go — fast, single binary, cross-platform)
- [ ] Implement: `init`, `uplink`, `downlink`, `sync`, `status`
- [ ] Implement: `pills take`, `pills search`, `pills list`
- [ ] Build agent adapters: Claude Code, Cursor
- [ ] Create 10 official SkillPills
- [ ] Write README, docs, contribution guide
- [ ] Ship v0.1.0, announce on HN/Reddit/X

### Phase 1 Validate (Month 2-3)
- [ ] Gather feedback from 50+ early adopters
- [ ] Track: adoption friction, most-requested features, agent coverage gaps
- [ ] Iterate on CLI UX based on real usage patterns
- [ ] Grow community pills to 30+

---

*This document is the product bible for SyncFu. It should be the single source of truth for product decisions, naming consistency, and competitive positioning. Update it as the product evolves.*
