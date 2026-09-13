# AGENTS.md

Rules for AI agents (and humans) working in this repo.

## Project layout

- `vocab-trainer 2.0.html` — the entire app: HTML + CSS + one inline `<script>`
  (starts `vocab-trainer 2.0.html:430`). No build step, no bundler. Open the
  file directly in a browser to run it.
- `lib/fsrs.umd.js` — vendored third-party FSRS library (do not hand-edit;
  see `lib/fsrs.LICENSE`).
- `lib/fsrs-scheduler.js` — thin wrapper around `fsrs.umd.js`, used by both
  the app (via `<script src="lib/fsrs-scheduler.js">`) and by tests (via
  `require`).
- `lib/due-queue.js` — pure due-item selection logic, same dual-use pattern
  as `fsrs-scheduler.js`.
- `tests/` — Node's built-in `node:test` runner. `persistence.smoke.test.js`
  loads the real script out of `vocab-trainer 2.0.html` via `node:vm` — it is
  not a copy, so editing the HTML's script changes what that test executes.
- `vocab-trainer-backup-*.json` — user data export/backup files. Gitignored
  (see `.gitignore`). Never treat these as source; never commit new ones.
- No `package.json`. No npm dependencies, no build/lint tooling installed.

## Commands

- Run tests: `node --test tests/*.test.js`
  (`node --test tests/` alone does not work — must glob the files).
- No build, no lint, no dev server. Test in a real browser by opening the
  HTML file, or use the `run` skill if present.

## Rules

- `vocab-trainer 2.0.html` is the single source of truth for the app. There
  is no other copy — a prior `vocab-trainer.html` was deleted; don't
  recreate it.
- `lib/*.js` (except `fsrs.umd.js`) must stay usable both as a `<script>`
  global and as a CommonJS `require` — keep the UMD wrapper pattern intact.
- Don't hand-edit `lib/fsrs.umd.js` or `lib/fsrs.LICENSE`.
- All user data lives in `localStorage` under `STORAGE_KEY` inside the app
  script (`vocab-trainer 2.0.html:664`) — there is no server/backend.
- After any change that moves, renames, or adds a function/file, update
  `CONTEXT.md` in the same commit.
