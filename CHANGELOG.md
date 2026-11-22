# Changelog

All notable changes to this project will be documented in this file.

## [3.1.0] - 2026-11-22

### Added

- **Agent-friendly JSON everywhere**: `install` / `update` (single and `--all`) / `uninstall` / `list` / `inspect` now support `--json` with a result envelope (`command`, `status`, `skill`, `version`, `install_dir`, `up_to_date`, …). Progress logs are redirected to stderr so stdout stays pure JSON
- **Structured error codes** (`lib/errors.ts`): failures throw `GetSkillError` with a machine-readable `code` (`NETWORK_ERROR`, `SKILL_NOT_FOUND`, `VERSION_NOT_AVAILABLE`, `TARGET_NOT_CONFIGURED`, `STATE_LOCKED`, `INVALID_ARGS`); with `--json`, any command prints `{ command, error: { code, message } }` to stdout and exits non-zero
- **Search failure vs. no results**: `searchSkills` now throws `NETWORK_ERROR` when the index cannot be fetched and no cache exists (previously it silently returned `[]`, indistinguishable from "no matches"); offline fallback to a stale cache still works. `index_file` is only included in the no-results payload when the file actually exists
- `search --limit N --page N` pagination and `search --brief` (descriptions truncated to ~120 characters) to save agent context
- New `getskill index` command for compact full-index browsing: `--categories` lists categories with counts; `--category <name>` lists compact entries (`name` / truncated `description` / `version` / `category`, 100 per page, `--limit` / `--page` supported). Empty search results now point agents to these commands instead of reading the multi-MB raw index file
- New `getskill show <name>` command: previews the skill's `SKILL.md` from the registry (`<base-url>/skills/<id>/SKILL.md`), falling back to the local installed/cached copy; `--json` returns `skill_md` plus `source` (`remote` / `local`)
- Empty search results guide the agent to browse the full index: text output prints the local index file path (when present) and the online index URL; `search --json` adds `message` / `hint` / `index_file` / `index_url` when `count` is 0
- **State lockfile** (`state.json.lock`): install-state writes (`updateInstallState` / `removeInstallState` / `pruneInstallState`) are serialized across processes; locks older than 30s are reclaimed as stale, waiting longer than 5s (configurable via `GETSKILL_STATE_LOCK_TIMEOUT_MS`) fails with `STATE_LOCKED`
- `skill/getskill/SKILL.md`: a ready-to-publish skill package describing the getskill agent workflow (search → decide → install/update, index browsing, JSON envelopes, error codes)
- Unit tests: boolean flag parsing, search error codes, offline fallback, `SKILL_NOT_FOUND` / `VERSION_NOT_AVAILABLE`, `fetchSkillMarkdown`, search pagination, uninstall gate, stale-lock reclamation and `STATE_LOCKED` timeout (53 tests total)

### Fixed

- Boolean flags (`--json`, `--force`, `--all`, `--prune`, `--keep-cache`, `--brief`, `--categories`, `--help`) no longer swallow the next token: `getskill --json search pdf` and `getskill uninstall --keep-cache <name>` now work; `--json=false` is honored
- `list --json` no longer leaks the "技能目录不存在" notice into stdout (logged at debug level on stderr)

### Changed

- **Safety gate extended to `uninstall`**: like install/update, it refuses to run when the skills directory only comes from auto-detection (`TARGET_NOT_CONFIGURED`), preventing accidental deletion in another agent's directory
- Missing-argument usage errors now go through the unified error envelope (`INVALID_ARGS`) instead of ad-hoc stdout messages
- Argument parsing extracted to `lib/cli-args.ts`; help/README/EXAMPLES/architecture docs updated for the new commands and JSON contract

## [3.0.0] - 2026-11-22

### Changed

- **Breaking (safety gate)**: `install` / `update` / `update --all` now require an explicitly configured target: `agent` or `skills-dir` must come from a CLI flag, environment variable, or the config file. When the skills directory would only come from auto-detection (`agent = auto` with no explicit settings), these commands fail with guidance instead of silently installing into a possibly wrong agent directory. Read-only commands (`search`, `list`, `path`, `inspect`, `agents`, `config get`) are unaffected; auto-detection still powers their display output
- `debug` logs now go to stderr, and the one-time legacy install-state migration notice is logged at debug level, keeping `search --json` stdout pure JSON

### Added

- `assertExplicitSkillsDir()` in `lib/config.ts`, enforced at the entry of `downloadSkill` / `updateSkill` / `updateAllSkills` before any network request or file write
- Unit tests covering the gate (reject on detect, allow via file/env/CLI, re-close after `config unset`)
- Local skills-index cache at `<cache-dir>/skills-index.json` with a 1-day TTL: searches read the cache first, stale caches are re-downloaded, and a failed download falls back to the stale cache (offline search). `update` / `update --all` force one refresh per process; `clean` removes the cache
- Search results now include the local install state: `installed`, `installed_version`, and `suggested_action` (`skip` = same version installed, `update` = newer version available, `install` = not installed), shown as a `本地: …` line in text output
- Idempotent `install`: skips the download when the same version is already installed; new `--force` flag to reinstall anyway
- Clarified the agent workflow: `search` only returns candidate skills with descriptions and local install state (never installs anything); the agent decides which skill it needs and runs `install` / `update` itself. Search output now ends with an explicit hint, local-state lines use optional wording ("如需要: …"), and help/README/EXAMPLES document the search → decide → install/update flow
- Unit tests for index caching, offline fallback, install-state annotation, and install/update skip behavior (local HTTP server)

## [2.1.0]

### Added

- Agent-agnostic skill installation: built-in presets for Claude Code, OpenClaw, Codex, Cursor, Gemini CLI, Qwen Code, GitHub Copilot CLI, Amp, OpenCode, and a generic `~/.agent/skills` directory
- Automatic agent detection (`agent = auto`) based on previous install records and existing skills directories
- Arbitrary agent support through `skills-dir` (config), `--skills-dir` (per command), or `GETSKILL_SKILLS_DIR`
- Persistent configuration in `~/.getskill/config.json` with `getskill config get|set|unset|path|agents`
- New `getskill agents` command listing presets and the active one
- Global per-invocation flags `--agent`, `--skills-dir`, `--cache-dir`, `--base-url`
- `getskill update --all --prune` to clean install records for skills that no longer exist in the index
- Environment variables `GETSKILL_AGENT`, `GETSKILL_SKILLS_DIR`, `GETSKILL_CACHE_DIR`, `GETSKILL_HOME`, `GETSKILL_STATE_FILE`, `GETSKILL_RESTART_CMD`
- Unit tests for config resolution/persistence and per-directory install state filtering

### Changed

- **Breaking (paths)**: config, install state, and cache now live under `~/.getskill` (`config.json`, `state.json`, `cache/`) instead of `~/.openclaw/getskill` and `~/.openclaw/skills-cache`; the legacy state file is migrated automatically on first run
- `config set` now persists values (previously in-memory only, lost after the process exited); `getskill config set <URL>` remains supported as an alias for `base-url`
- `getskill inspect` reports the agent, skills directory, cache directory, and the real extracted skill root
- `getskill update --all` reports skills missing from the index as skipped instead of failed
- `getskill list` / `path` show the active agent and its skills directory
- The optional post-install reload hook only runs when the agent preset defines a restart command or `GETSKILL_RESTART_CMD` is set (`restartOpenClawGateway` → `restartAgentGateway`)
- Node.js requirement corrected to `>=18` in `package.json`
- CLI parsing now accepts global flags before the command (e.g. `getskill --agent cursor path`)

## [2.0.0]

### Removed

- **Breaking**: removed the `publish` command and all Git-related code (Git detection, Git installer download, `skill-validator`); the CLI now focuses on the three core features: search, download (install), and update
- Removed principle/internals documentation sections; docs now describe supported functionality only

## [1.2.0]

### Changed

- **Breaking (backend migration)**: getskill.work moved to Cloudflare static hosting; the CLI now reads the static skill index at `https://getskill.work/data/skills.json` instead of the Gitea search API
- Skill install/update now downloads `https://getskill.work/skills/<id>.zip` and extracts it locally with a dependency-free ZIP implementation — Git is no longer required for search/install/update
- Updates are version-based: locally recorded skill versions are compared against the remote index version
- `search` output now includes version, category, and download URL
- `publish` now requires a user-provided Git remote (`--repo <git-url>`); official registry login/auto-create was removed

### Added

- `lib/unzip.ts`: built-in ZIP parsing/extraction with path traversal protection and wrapper-directory resolution
- Unit tests for static index helpers and ZIP extraction (`tests/network.test.ts`, `tests/unzip.test.ts`)
- No-auth end-to-end smoke test `test-pdf-flow.ts` (search → install → list → update check)

### Previous (pre-1.2.0 unreleased work)

- Full source migration to TypeScript with compiled `dist/` output
- Modular CLI entry based on `main.ts` + `lib/*.ts` helpers
- Vitest unit tests and GitHub Actions CI workflow
- ESLint / Prettier quality gates
- Contributor and architecture documentation
- `update --all`, `uninstall`, and `inspect` CLI commands
- `search --json`, `install/update --version`, and enhanced `publish` CLI support
- Publishing runs lint + tests before release
- Hardened command execution to avoid shell injection and stopped persisting registry tokens in Git remote URLs
- Password prompts are now masked, and the npm package ships runtime artifacts only

## [1.1.8] - Existing Release

### Features

- Search, install, update, list, clean, and config commands
- Cross-platform skill and cache directory management
- Git auto-detection and install guidance
