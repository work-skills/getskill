# GetSkill Architecture

## Overview

`getskill` is a lightweight CLI for discovering and installing Agent skills from the `getskill.work` registry into any AI agent's skills directory (Claude Code, OpenClaw, Codex, Cursor, ... or a fully custom path).

## Current module layout

### `main.ts`

- CLI argument parsing lives in `lib/cli-args.ts` (global flags: `--agent`, `--skills-dir`, `--cache-dir`, `--base-url`; boolean flags such as `--json`/`--force`/`--all`/`--prune`/`--keep-cache`/`--brief`/`--categories` never consume the next token)
- Help / version output
- High-level command dispatch, including `index`, `show`, `config`, `agents`, and `path`
- JSON contract: every data command supports `--json` (pure JSON on stdout, progress logs redirected to stderr via `captureStdout`); failures print `{ command, error: { code, message } }` and exit non-zero

### `lib/cli-args.ts`

- Token parser separating positionals from options; boolean flag set; `--flag=value` support (`--json=false` honored)

### `lib/errors.ts`

- `GetSkillError` with machine-readable codes: `NETWORK_ERROR`, `SKILL_NOT_FOUND`, `VERSION_NOT_AVAILABLE`, `TARGET_NOT_CONFIGURED`, `STATE_LOCKED`, `INVALID_ARGS`, `UNKNOWN_ERROR`
- `getErrorCode(error)` maps unknown errors to `UNKNOWN_ERROR`

### `lib/config.ts`

- Agent presets and auto-detection (`detectAgentName`)
- Write gate (`assertExplicitSkillsDir`): install/update/uninstall refuse to run when the skills directory only comes from auto-detection (`TARGET_NOT_CONFIGURED`); an explicit `agent`/`skills-dir` via CLI, env, or config file is required
- Persistent configuration in `~/.getskill/config.json` (`readConfigFile` / `writeConfigFile` / `setConfigValue` / `unsetConfigValue`)
- Resolution precedence: CLI flag > environment variable > config file > auto-detect > default
- Directory resolution (`getSkillsDirectory`, `getSkillsCacheDirectory`, `getStateFilePath`)
- Shared constants

### `lib/network.ts`

- HTTP/HTTPS request wrapper
- Redirect + timeout handling
- Static index loading, filtering, and package URL helpers
- Local index cache (`<cache-dir>/skills-index.json`, TTL 1 day): searches read the cache first; stale caches are re-downloaded, and a failed download falls back to the stale cache for offline use. `update` forces one refresh per process (`forceRefresh`)
- Search results are annotated with the local install state (`installed`, `installed_version`, `suggested_action`: `skip` / `update` / `install`)
- `searchSkills` throws `NETWORK_ERROR` when the index cannot be fetched and no cache exists (failure is distinguishable from "no matches"); stale-cache offline fallback still applies
- `fetchSkillMarkdown` previews `<base-url>/skills/<id>/SKILL.md` for `getskill show` (null when unavailable)

### `lib/state.ts`

- Local install state persistence (`~/.getskill/state.json`) plus migration from the legacy `~/.openclaw/getskill/state.json`
- Cross-process state lockfile (`state.json.lock`): mutations are serialized; locks older than 30s are reclaimed, waiting beyond `GETSKILL_STATE_LOCK_TIMEOUT_MS` (default 5s) fails with `STATE_LOCKED`
- Skill directory copy / replacement
- Local skill listing, inspection, and stale-record pruning
- Installed-skill snapshots (`getInstalledSkillsSnapshot`) scoped to the current skills directory, used to annotate search results

### `lib/skill-manager.ts`

- ZIP download / extract workflows
- Install and update orchestration (`updateAllSkills` skips and optionally prunes skills that disappeared from the index)
- Idempotent install: `downloadSkill` skips the download when the same version is already installed (`--force` overrides)
- Optional agent reload hook (`restartAgentGateway`, driven by the agent preset or `GETSKILL_RESTART_CMD`)

### `lib/unzip.ts`

- Dependency-free ZIP parsing/extraction with path traversal protection

### `tests/`

- Config resolution / persistence checks
- Input normalization checks
- Search filtering tests
- Index cache TTL / offline fallback / install-state annotation tests (local HTTP server)
- Error-code tests (`NETWORK_ERROR` / `INVALID_ARGS` / `SKILL_NOT_FOUND` / `VERSION_NOT_AVAILABLE` / `TARGET_NOT_CONFIGURED` / `STATE_LOCKED`), boolean flag parsing, search pagination, and `fetchSkillMarkdown` tests
- File collection and install-state behavior tests

## Verification contract

Before merging or publishing, run:

```bash
npm run lint
npm test
```

For a real remote smoke test, also run:

```bash
npm run test:flow
```
