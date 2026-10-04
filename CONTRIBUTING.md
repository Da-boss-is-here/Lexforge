# Contributing

## Run the app

Open `index.html` directly in a browser. There is no server, build step, or install.

## Run the tests

```
node --test tests/*.test.js
```

The glob is required. `node --test tests/` alone finds nothing. There is no `package.json` and nothing to install.

## Layout

- `index.html` is the whole app: markup, CSS, and one inline script. It is the single source of truth, so don't fork or duplicate it.
- `lib/` holds modules shared by the app and the tests. `fsrs-scheduler.js` and `due-queue.js` must keep working both as a `<script>` global and as a CommonJS `require`, so keep their UMD wrapper intact.
- `tests/` uses Node's built-in test runner. `persistence.smoke.test.js` extracts the real script from `index.html` and runs it in `node:vm`, so editing the script changes what that test runs. Avoid changing the script's top and bottom wrapper lines unless you update that test.

## Rules

- Don't hand-edit `lib/fsrs.umd.js` or `lib/fsrs.LICENSE`. They are vendored.
- After a change that moves, renames, or adds a function or file, update `CONTEXT.md` in the same commit.
- Run the tests before committing. Docs-only commits don't need a run.
- `vocab-trainer-backup-*.json` files are personal data exports and are gitignored. Never commit one, and don't use a real backup as a test fixture.

## Open bugs

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md). If you spot an unrelated bug while working on something else, add it there instead of fixing it in the same commit.
