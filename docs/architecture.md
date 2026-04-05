# GetSkill Architecture

## Overview

`getskill` is a lightweight CLI for discovering and installing OpenClaw skills from the `getskill.work` registry.

## Current module layout

### `main.ts`

- CLI argument parsing
- Help / version output
- High-level command dispatch

### `lib/config.ts`

- `GETSKILL_BASE_URL` handling
- OpenClaw directory resolution
- Shared constants

### `lib/network.ts`

- HTTP/HTTPS request wrapper
- Redirect + timeout handling
- Search response filtering and `SKILL.md` validation

### `lib/state.ts`

- Local install state persistence
- Skill directory copy / replacement
- Local skill listing and cleanup helpers

### `lib/skill-manager.ts`

- Clone / pull workflows
- Install and update orchestration
- Gateway restart hook

### `tests/`

- Input normalization checks
- Search filtering tests
- File collection behavior tests

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
