# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-file, browser-based vocabulary trainer with spaced repetition (FSRS),
guided word teaching, practice sessions, exam mode, and analytics. No server,
no build step — all state lives in `localStorage`.

## Commands

- Run all tests: `node --test tests/*.test.js`
  (`node --test tests/` alone finds nothing — must glob the files).
- Run a single test file: `node --test tests/due-queue.test.js`
- No build, no lint, no package.json, no npm dependencies.
- To manually verify a change: open `index.html` directly in a
  browser (or use the `run` skill if present).

## Architecture

- **`index.html`** is the entire app — markup, CSS, and one
  inline `<script>` (starting at `index.html:430`, IIFE-wrapped,
  booted via `DOMContentLoaded` → `App.init()` near the end of the file).
  There is no other copy of the app; a prior `vocab-trainer.html` was
  deleted and must not be recreated.
- **`lib/fsrs-scheduler.js`** and **`lib/due-queue.js`** are dual-use
  modules: loaded as a `<script>` global by the app AND `require`d directly
  by tests, via a UMD wrapper. Keep that wrapper pattern intact when editing
  either file. `lib/fsrs.umd.js` (ts-fsrs) and `lib/chart.umd.js`
  (Chart.js 4.5.1, loaded in `<head>`) are vendored third-party dependencies —
  never hand-edit them or `lib/fsrs.LICENSE` / `lib/chart.LICENSE`.
- **`tests/persistence.smoke.test.js`** doesn't test a copy — it extracts
  the real script out of `index.html` via `node:vm`
  (`extractAppScript()`) by regex-stripping the IIFE wrapper and the
  `DOMContentLoaded` line. Editing the app script's top/bottom wrapper can
  silently break this extraction; editing anything else in the script
  changes what this test actually executes.
- Persisted state is a single `localStorage` key, `STORAGE_KEY`
  (`index.html:664`, currently `coreVocabTrainer.v1`). Schema
  defaults and migration logic live in `defaultState`, `validateAndRepair`,
  and `repairWord` (~`:678`-`:806`) — touch these when the save shape
  changes. `Storage` (`:856`) handles load/save/export/merge-import.
- Data flow through the app's top-level objects, in file order:
  `Utils`/`Speech` (helpers, TTS) → config constants (`ERROR_CATEGORIES`,
  `DIMENSIONS`, `WORD_TYPES`, etc., `:502`-`:575`) → `DimModel` (per-word
  dimension stats, `:605`) → `BulkImport` (pipe-delimited paste import,
  `:635`) → `Storage` → `DailyActivity`/`Milestones`/`Achievements` →
  `WordModel` (word CRUD, mastery/exam-readiness, `:1079`) →
  `ErrorIntegration` (mistake category → dimension linking, `:1411`) →
  `Practice` (session/question building, `buildDueQueue` uses `DueQueue`
  from `lib/` for FSRS items plus legacy level-based items, `:1453`) →
  `App`/`Views`/`Modal`/`Audit` (tab routing + rendering, `:1840`-`:3279`)
  → `Exam` (`:3279`) → Analytics helpers feeding `Analytics` (`:3649`-
  `:4051`) → `Session` (free-practice runner, `MAX_SESSION = 25`, `:4694`)
  → `Teaching` (guided new-word flow, `:4953`).
- FSRS scheduling is per (word, dimension) card. Phase 1 covers recognition;
  Phase 2 adds production the same way (gated by a recognition-stability
  threshold in `DueQueue.isEligible`). Every other dimension (cued recall,
  cloze, drill) is still selected by the older `word.srs.nextReview` /
  `levelState.level` logic inline in the HTML — `lib/due-queue.js` does not
  touch or reimplement that path, so the two systems currently coexist by
  design (with an accepted duplication tradeoff for legacy level-4
  production items).

## Rules

- `index.html` is the single source of truth for the app — do
  not fork or duplicate it.
- `lib/*.js` (except the vendored `fsrs.umd.js` and `chart.umd.js`) must keep working both as a `<script>`
  global and as a CommonJS `require`.
- `vocab-trainer-backup-*.json` files are gitignored user data exports —
  never treat them as source, never commit new ones.
- After any change that moves, renames, or adds a function/file, update
  `CONTEXT.md` (the file/function map) in the same commit.
- `KNOWN_ISSUES.md` tracks bugs found by section-by-section scans but not
  yet fixed, organized by the app's module layout (P0=crash/data-loss down
  to P3=latent). Check it before deep-diving a section that's already been
  scanned, and add entries there rather than fixing unrelated bugs
  in-flight.

## User Preferences

_(populated over the session: after each task, a note on how it could have
been done faster or with fewer tokens.)_

## Capabilities

_(populated over the session: things Claude is explicitly allowed to do
that it might otherwise hesitate on or underestimate, added when a "can't"
turns out to be a missing instruction rather than a real limitation.)_

## Lab Notes — What Not To Do

_(populated over the session: mistakes made and fixes that didn't work, so
future sessions don't repeat them.)_
