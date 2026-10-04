# Vocab Trainer

A single-file, browser-based vocabulary trainer with spaced repetition
(FSRS), guided word teaching, practice sessions, exam mode, and analytics.

## Run it

- Open `index.html` directly in a browser. No server, no
  build step, no install required.
- All data is stored in the browser's `localStorage` — nothing leaves the
  device. Use the in-app export to back up your data (produces a
  `vocab-trainer-backup-*.json` file).

## Tests

```
node --test tests/*.test.js
```

Requires Node.js (built-in `node:test` runner, no dependencies to install).

## Project layout

- `index.html` — the app (markup, styles, and logic in one file).
- `lib/` — FSRS scheduling and due-queue helper modules, shared between the
  app and the test suite.
- `tests/` — unit and smoke tests.

See [CONTEXT.md](CONTEXT.md) for a detailed file/function map, and
[AGENTS.md](AGENTS.md) for rules when making changes here.
