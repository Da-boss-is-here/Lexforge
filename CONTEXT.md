# CONTEXT.md

Map of the codebase. Keep this current — see AGENTS.md's update rule.

## Files

- `vocab-trainer 2.0.html` — the whole app. Script body:
  `vocab-trainer 2.0.html:430`-5442, IIFE-wrapped. Boot: `:5439`
  (`DOMContentLoaded` → `App.init()`).
- `lib/fsrs-scheduler.js` — FSRS card scheduling (one card per
  word+dimension), UMD export `:17`. `lib/due-queue.js` — builds/merges
  due-item queues per dimension, UMD export `:17`.
- `lib/fsrs.umd.js` — vendored ts-fsrs library. Don't edit.
- `tests/due-queue.test.js`, `tests/fsrs-scheduler.test.js` — unit tests
  against `lib/`.
- `tests/persistence.smoke.test.js` — extracts and runs the real app
  script from the HTML file in a `node:vm` sandbox (`extractAppScript()`
  :24). Not a copy — editing the app script changes this test directly.

## Key sections in `vocab-trainer 2.0.html` (top-level objects, file order)

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
- `App` :1840 (tab routing, `init()` :1844); `Views` :1926 (view renderers);
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
