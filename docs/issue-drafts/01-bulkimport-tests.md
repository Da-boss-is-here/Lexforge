Title: Add unit tests for BulkImport.parseLine
Labels: good first issue, tests

## Context

`BulkImport.parseLine` (in `index.html`) turns one pipe-delimited line from Paste Import into a word record, and throws a specific error for each bad input. It currently has no tests at all (`grep BulkImport tests/*.js` finds nothing), even though it is the front door for every pasted word.

## What to do

Add tests in `tests/persistence.smoke.test.js` (it already loads the real app script, so no copy of the parser is involved). `BulkImport` isn't in the export list at the `new vm.Script('this.__exports = { ... }')` line yet; add it there.

Cover, at minimum:

- a valid 10-field line parses (pronunciation defaults to `''`)
- a valid 11-field line keeps the pronunciation
- 9 or 12 fields throws, and the message names the count it found
- fewer than 2 collocations, fewer than 2 typical contexts, and each empty required field throws the matching message
- `;` splitting trims whitespace and drops empty entries
- an optional Mnemonic may be empty

## Notes

- Run: `node --test tests/*.test.js` (the glob is required).
- This is tests only. If you think the parser has a bug, open a separate issue rather than changing it here.
- See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Done when

The new tests pass and fail if the corresponding check in `parseLine` is removed.
