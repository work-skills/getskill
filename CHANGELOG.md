# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Full source migration to TypeScript with compiled `dist/` output
- Modular CLI entry based on `main.ts` + `lib/*.ts` helpers
- Vitest unit tests and GitHub Actions CI workflow
- ESLint / Prettier quality gates
- Contributor and architecture documentation
- `update --all`, `uninstall`, and `inspect` CLI commands
- `search --json`, `install/update --version`, and `publish` CLI support

### Changed

- Publishing now runs lint + tests before release
- Verification now targets the modular entrypoint

## [1.1.8] - Existing Release

### Features

- Search, install, update, list, clean, and config commands
- Cross-platform skill and cache directory management
- Git auto-detection and install guidance
