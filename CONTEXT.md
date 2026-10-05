# CONTEXT.md

Map of the codebase. Keep this current — see AGENTS.md's update rule.

## Files

- `index.html` — the whole app. Script body:
  `index.html:430`-5684, IIFE-wrapped. Boot: `:5682`
  (`DOMContentLoaded` → `App.init()`).
- `lib/fsrs-scheduler.js` — FSRS card scheduling (one card per
  word+dimension), UMD export `:17`. `lib/due-queue.js` — builds/merges
  due-item queues per dimension, UMD export `:17`.
- `lib/fsrs.umd.js` — vendored ts-fsrs library. Don't edit.
- `lib/chart.umd.js` — vendored Chart.js 4.5.1 (UMD, global `Chart`), loaded in
  `<head>` at `index.html:7`. Don't edit. Licenses: `lib/fsrs.LICENSE`,
  `lib/chart.LICENSE`.
- `tests/due-queue.test.js`, `tests/fsrs-scheduler.test.js` — unit tests
  against `lib/`.
- `tests/persistence.smoke.test.js` — extracts and runs the real app
  script from the HTML file in a `node:vm` sandbox (`extractAppScript()`
  :24). Not a copy — editing the app script changes this test directly.

- `docs/WALKTHROUGH.md` — annotated tour of every screen. `docs/screenshots/` — README
  images plus `analytics/`, `teaching/`, `practice/`, `views/` subfolders embedded by the walkthrough
  (all synthetic data, not real study data).
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` — public-facing docs.
- `THIRD_PARTY_NOTICES.md` — attribution for vendored ts-fsrs, Chart.js and inlined @kurkle/color (versions, SHA-256, license text).

## Key sections in `index.html` (top-level objects, file order)

- `Utils` :435, `Speech` :480 — helpers; Web Speech TTS wrapper.
- Config constants :502-575 (`AI_GENERATOR_PROMPT`, `ERROR_CATEGORIES`,
  `ERROR_EXPLANATIONS`, `CATEGORY_TO_DIM`, `DIMENSIONS`, `DIM_KEYS`,
  `DIM_PRACTICE_LEVEL`, `WORD_TYPES`); `freshDims`/`repairDims` :576/:581.
- `DimModel` :605 — per-word dimension stats. `BulkImport` :635 — parses
  pipe-delimited paste-import lines.
- Storage constants :664-676 (`STORAGE_KEY`, `STORAGE_BACKUP_KEY`, log
  caps); `defaultState` :678, `validateAndRepair` :722, `repairWord` :806
  — schema defaults + migration; touch when the save shape changes.
- `Storage` :856 — load/save/export/merge-import against `localStorage`.
- `DailyActivity` :1033, `Milestones` :1050, `Achievements` :1065.
- `WordModel` :1079 — word CRUD, cloze/example generation, mastery/exam-
  readiness (`computeMastery` ~1300-1360).
- `ErrorIntegration` :1411 — links mistake categories to dimensions.
- `Practice` :1453 — session/question building; `buildDueQueue` ~1505 uses
  `DueQueue` (lib) for FSRS items + legacy level-based items; FSRS grading
  ~1556 calls `FSRSScheduler.grade`.
- `App` :1929 (tab routing); `Views` :2025 (view renderers; `loadSampleWords`/`removeSampleWords`
  ~:2167, backed by `SAMPLE_PREFIX`/`SAMPLE_WORD_LINES` ~:2015 -- the empty Dashboard's
  "Try with sample words"; sample ids start with `sample-`, which is the only marker);
  `Modal` :3122, `Audit` :3139; `Exam` :3279 (exam-mode).
- Analytics helpers :3649-4050 feed `Analytics` :4051. `Session` :4694 —
  free-practice runner (`MAX_SESSION` = 25). `Teaching` :4953 — guided
  "teach a new word" flow (`STEP_NAMES` :4951).

## Data / config

- All persisted state: one `localStorage` key, `STORAGE_KEY` (:664,
  currently `coreVocabTrainer.v1`). No server, no DB.
- `vocab-trainer-backup-*.json` files are manual exports (gitignored).
- FSRS settings live under `Storage.state.settings.fsrs`.

## Gotchas

- `persistence.smoke.test.js` strips the IIFE wrapper and the
  `DOMContentLoaded` line (:29-31) by regex — changing the app script's
  wrapper can silently break this.
- `node --test tests/` (no glob) finds nothing — use
  `node --test tests/*.test.js`.
