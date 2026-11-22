# GetSkill Architecture

## Overview

`getskill` is a lightweight CLI for discovering and installing Agent skills from the `getskill.work` registry into any AI agent's skills directory (Claude Code, OpenClaw, Codex, Cursor, ... or a fully custom path).

## Current module layout

### `main.ts`

- CLI argument parsing lives in `lib/cli-args.ts` (global flags: `--agent`, `--skills-dir`, `--cache-dir`, `--base-url`, `--timeout`; boolean flags such as `--json`/`--force`/`--all`/`--prune`/`--keep-cache`/`--brief`/`--categories`/`--dry-run`/`--keep-index`/`--refresh` never consume the next token; duplicate options keep the last value with a stderr warning)
- Help / version output; `--help --json` emits a machine-readable command table (`buildHelpPayload`)
- High-level command dispatch, including `index`, `show`, `status`, `config`, `agents`, `path`, `clean`; command aliases `get`/`download` normalize to `install`
- Batch install/update/uninstall (multiple positional names) with per-item results and `succeeded`/`failed` counts; `--dry-run` read-only plans via `planSkillAction`
- JSON contract: **every** command supports `--json` (pure JSON on stdout, progress logs redirected to stderr via `captureStdout`/`runCaptured`); failures print `{ command, skill?, keyword?, error: { code, message, suggestions? } }` and exit non-zero; unknown commands/flags/invalid numbers fail with `INVALID_ARGS` (plus a did-you-mean suggestion); `SKILL_NOT_FOUND` errors carry offline did-you-mean `suggestions` from the cached index (`errorPayload`/`suggestSkillNames`, edit distance ≤ 2, top 3); batch partial failures set exit code 1
- Install/update envelopes carry activation signals (`skill_md_path`, `next_step`, `reload_command`, `reloaded`), `local_modified`, `warnings[]` (non-fatal copy/download warnings) and index freshness (`index`); batch envelopes include `index` too
- `update --all --dry-run` mirrors real semantics (only `SKILL_NOT_FOUND` → stale; other errors are failed plans with non-zero exit); `uninstall --dry-run` reports `managed`/`blocked` for unmanaged dirs; `clean --dry-run` returns `would_remove`; `status --json` adds `cli_version`/`lock_pid`/`lock_stale`; `--help --json` includes `exit_codes`

### `lib/cli-args.ts`

- Strict token parser: known boolean/value flag sets; unknown flags, missing values and invalid boolean values throw `GetSkillError('INVALID_ARGS')`
- `--flag=value` support (`--json=0/no/off` → false); `--` terminator; value flags never swallow a following command name; `-V` = skill version, `-v`/`--version` = CLI version
- `positiveIntOption` validates `--limit`/`--page`/`--timeout` (no silent fallback)

### `lib/errors.ts`

- `GetSkillError` with machine-readable codes: `NETWORK_ERROR`, `SKILL_NOT_FOUND`, `VERSION_NOT_AVAILABLE`, `TARGET_NOT_CONFIGURED`, `STATE_LOCKED`, `INVALID_ARGS`, `AMBIGUOUS_SKILL`, `EXTRACT_ERROR`, `PACKAGE_INVALID`, `UNMANAGED_SKILL`, `UNKNOWN_ERROR`; optional `suggestions` (did-you-mean) on `SKILL_NOT_FOUND`
- `getErrorCode(error)` maps unknown errors to `UNKNOWN_ERROR`

### `lib/safe-name.ts`

- Single source of truth for path-segment safety (`isSafePathSegment`): rejects `.`/`..`, `:` (drive/NTFS ADS), control characters, Windows reserved device names (CON/NUL/COM1-9/LPT1-9), trailing dot/space
- `assertSafeSkillName` (INVALID_ARGS), `assertContainedChildPath` (child must resolve exactly one level under the parent — defense in depth for install/uninstall targets), `isPathWithin` (containment check used to gate `repoPath` deletion)

### `lib/system.ts`

- `executeCommand`: on win32 runs via shell so npm `.cmd` shims (e.g. `openclaw`) resolve; 60s default timeout (`GETSKILL_RESTART_TIMEOUT_MS` override), 1MB output capture cap, single-settle guard

### `lib/version.ts`

- `compareVersions`: full semver ordering — numeric core segments (`1.10.0 > 1.9.0`, missing segments pad 0, `v` prefix ignored), prerelease < matching release (`1.0.0-beta < 1.0.0`, dot-identifier ordering), build metadata ignored; non-semver values (e.g. `unknown`) sort below any semver so dirty records trigger one corrective update instead of being stuck "up to date"; used for `suggested_action` and install/update skip logic (no silent downgrades)

### `lib/config.ts`

- Agent presets and auto-detection (`detectAgentName`)
- Write gate (`assertExplicitSkillsDir`): install/update/uninstall refuse to run when the skills directory only comes from auto-detection (`TARGET_NOT_CONFIGURED`); an explicit `agent`/`skills-dir` via CLI, env, or config file is required
- Persistent configuration in `~/.getskill/config.json` (`readConfigFile` / `writeConfigFile` / `setConfigValue` / `unsetConfigValue`); validation errors throw `GetSkillError('INVALID_ARGS')`
- Resolution precedence: CLI flag > environment variable > config file > auto-detect > default
- Directory resolution (`getSkillsDirectory`, `getSkillsCacheDirectory`, `getStateFilePath`)
- `getRequestTimeoutMs` / `setRequestTimeoutOverride`: per-process network timeout override (`--timeout <ms>`, default 60s)

### `lib/network.ts`

- HTTP/HTTPS request wrapper with redirect + timeout handling (timeout from `getRequestTimeoutMs`); refuses HTTPS→HTTP downgrade redirects; response size caps (10MB text / 100MB download)
- Static index loading, multi-token AND filtering (`matchIndexEntries`), and package URL helpers; `assertPackageUrlAllowed` enforces same-origin package downloads (`GETSKILL_ALLOW_CROSS_ORIGIN=1` opt-out) and warns on plain-HTTP non-loopback downloads — called at download time only, search/show URL display is unaffected
- Local index cache (`<cache-dir>/skills-index.json`, TTL 1 day, atomic tmp+rename writes): searches read the cache first; stale caches are re-downloaded, and a failed download falls back to the stale cache for offline use. `update` forces one refresh per process (`forceRefresh`)
- `getSkillsIndexMeta` / `peekSkillsIndexCache` / `readCachedIndexEntries`: index freshness (`fetched_at` / `source` / `stale`) for JSON envelopes and the `status` command; cached entries power offline did-you-mean suggestions
- `searchSkillsPage` returns results plus `total` / `page` / `limit` / `has_more`; results annotated with local install state (`installed`, `installed_version`, `suggested_action` via semver compare); `searchSkills` wraps it for API compatibility
- `searchSkills` throws `NETWORK_ERROR` when the index cannot be fetched and no cache exists (failure is distinguishable from "no matches"); stale-cache offline fallback still applies
- `findSkillIndexEntry` throws `AMBIGUOUS_SKILL` when a normalized name matches multiple distinct ids
- `fetchSkillMarkdown` previews `<base-url>/skills/<id>/SKILL.md` for `getskill show` (null when unavailable or when the body is an HTML SPA fallback/error page)

### `lib/state.ts`

- Local install state persistence (`~/.getskill/state.json`, atomic tmp+rename writes; corrupt files are warned about once, backed up as `state.json.corrupt-<ts>` and treated as empty) plus migration from the legacy `~/.openclaw/getskill/state.json`; records include `contentHash` for local-modification detection
- Naming: `normalizeSkillName` (local dir keys, validated by `assertSafeSkillName`), `normalizeSkillIndexKey` (case-insensitive lookup key, re-exported by network), `resolveLocalSkillName` (input → real state key / on-disk dir name, NTFS-safe via readdir); `normalizeCliSkillArgument` rejects unsafe names at the CLI entry
- Cross-process state lockfile (`state.json.lock`): mutations serialized; reentrant in-process (`withStateLockAsync` covers copy+state as one critical section); locks older than 30s are reclaimed via rename-claim (no concurrent mutual deletion), waiting beyond `GETSKILL_STATE_LOCK_TIMEOUT_MS` (default 5s) fails with `STATE_LOCKED`
- Skill directory copy / replacement (targets validated by `assertContainedChildPath`; skipped symlinks/oversized files collected into `warnings[]`); `computeSkillDirHash` (sorted relpath + raw file bytes SHA-256, same exclusions as copy — binary files no longer false-positive as modified)
- Uninstall safety: unmanaged directories (no state record for the current skills dir) refuse deletion unless `force` (`UNMANAGED_SKILL`); `repoPath` deletion is gated to the cache root / `~/.getskill` via `isPathWithin`
- `listLocalSkillsDetailed` merges directory scan with state (`managed` flag); inspection reports `localModified`; stale-record pruning
- Installed-skill snapshots (`getInstalledSkillsSnapshot`) scoped to the current skills directory, used to annotate search results

### `lib/skill-manager.ts`

- ZIP download / extract workflows; cache and install dirs use the canonical name resolved from `entry.id`; unique temp zip/extract names per fetch (concurrent installs of the same skill no longer clobber each other), canonical cache dir swapped in only after successful extraction; package size mismatches vs the index become `warnings[]`
- Install and update orchestration; semver-based skip (no silent downgrade; explicit `--version` allows older versions); `--refresh` forces an index refresh for install; `updateAllSkills` returns `{ results, pruned }` with per-item `status` (`updated`/`up_to_date`/`stale`/`missing`/`failed`) and `code`; records whose install dir was manually deleted are reported `missing` and skipped (no resurrection), or `stale` when also delisted from the index (prunable via `--prune`)
- Local-modification detection before overwrite (`detectLocalModification` → `DownloadResult.localModified`); copy+state wrapped in `withStateLockAsync`
- Agent reload hook (`restartAgentGateway`) is invoked by the CLI after successful install/update and returns `{ attempted, ok, command }` for the envelope

### `lib/unzip.ts`

- Dependency-free ZIP parsing/extraction with path traversal protection; per-segment safety validation (`isSafePathSegment`: ADS/reserved names/control chars/trailing dot-space), symlink entries rejected, per-entry 20MB / total 200MB decompression limits (`inflateRawSync` `maxOutputLength` + declared-size precheck), CRC32 verification per entry; failures throw `GetSkillError('EXTRACT_ERROR')`

### `tests/`

- Config resolution / persistence checks
- Input normalization checks; strict argument parsing (unknown flags/values, `--`, boolean synonyms)
- Search filtering (multi-token AND) and pagination metadata tests
- Index cache TTL / offline fallback / install-state annotation tests (local HTTP server)
- Error-code tests (`NETWORK_ERROR` / `INVALID_ARGS` / `SKILL_NOT_FOUND` / `VERSION_NOT_AVAILABLE` / `TARGET_NOT_CONFIGURED` / `STATE_LOCKED` / `AMBIGUOUS_SKILL`)
- Agent contract tests (`tests/agent-contract.test.ts`): canonical naming + case-insensitive uninstall, no-downgrade, local-modified detection, missing-dir skip, HTML fallback rejection, managed list, content hash, unmanaged-dir refusal/`--force`, warnings envelope, non-semver update trigger, and spawned-process JSON envelope checks (unknown command/flag, aliases, `--json` everywhere, `not_installed`, dry-run, suggestions, blocked uninstall, status lock fields, clean dry-run, help exit_codes)
- Safety/robustness tests: `tests/safe-name.test.ts` (segment validation, containment), `tests/version.test.ts` (semver/prerelease/non-semver), unzip hardening (CRC/symlink/ADS/limits/bomb), state robustness (atomic write, corrupt backup, S1/S2/S3), network policy (cross-origin) — 121 unit tests total; `npm run test:smoke` runs a 62-check live-registry smoke

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
