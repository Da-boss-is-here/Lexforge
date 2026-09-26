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

## Process rules (session-established)

- **In-flight P2/P3 fixes**: notice one while working on something else?
  Log it in `KNOWN_ISSUES.md` in the commit you're already making — do not
  fix it there. Only fix it immediately, as a clean second commit, if it's
  1-3 lines and touches a line you were already editing this task (message:
  `fix: <bug> (found in-flight during <original task>)`), removing the
  `KNOWN_ISSUES.md` entry in that same fix commit. Otherwise it waits for
  its section's scan — never bundle an in-flight fix into an unrelated
  commit. Rationale: keeps "fix I was there for" and "fix I noticed"
  separately revertable.
- **Test suite cadence**: run `node --test tests/*.test.js` before every
  commit, no exceptions — except docs-only commits (`KNOWN_ISSUES.md`,
  `AGENTS.md`, `README.md`), which don't require a run. Suspect a failure
  is pre-existing? Prove it: stash, run on the clean tree, confirm, unstash,
  note "pre-existing" in the commit message. Rationale: a full run takes
  seconds; "I only touched X" is how regressions ship.
- **Manual browser verification**: never test in the primary browser
  profile — use a dedicated profile (e.g. "vocab-test") or incognito.
  Before any manual test touching Storage (import/export/erase/backfill),
  export a real backup from the primary profile first. Also check Safari
  before calling something fixed — different Date parsing,
  `speechSynthesis` voices, and `localStorage` quota behavior. `file://` is
  fine for logic testing; serve over `http://localhost` (`npx serve .`) if
  the test needs a secure context (clipboard, some speech APIs). Rationale:
  real `localStorage` is real data, and most "works on my machine" reports
  are Chrome-only.
- **Real backup files**: `vocab-trainer-backup-*.json` files are real user
  data — read-only, off-limits on your own initiative. Need a fixture?
  Generate a synthetic one with representative shape; never copy from a
  real backup. Explicitly pointed at a real backup? Read-only: no copies
  into fixtures, no commits referencing its contents. Never round-trip a
  real backup through an import→export debugging script without asking.
  Rationale: these files can hold personal vocabulary, real exam dates,
  and full history.
