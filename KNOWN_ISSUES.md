# Known Issues

Bugs found by scanning but not yet fixed. Organized by section, matching
the app's actual module layout. Each entry:

- [ ] **P0/P1/P2/P3** — one-line description.
      Found: YYYY-MM-DD. Location: file:line or function name.
      Notes: root cause, why deferred, or which other section it depends on.

P0 = crash or data loss. P1 = wrong behavior a user would notice.
P2 = cosmetic or rare. P3 = latent, hard to trigger.

## Persistence (Storage, validateAndRepair, repairWord, defaultState,
importJSON, load/save)
- [ ] **P2** — `validateAndRepair`'s `errorLog` filter doesn't require a
      numeric `ts`, unlike every sibling log filter; `NaN` comparisons
      then break `Views.renderErrors`' sort.
      Found: 2026-09-12. Location: `validateAndRepair`
      (vocab-trainer 2.0.html:722).
      Notes: `sessionLog`/`writingLog`/`examLog`/`fsrsReviewLog`/`attempts`
      all filter on `s.ts`; `errorLog` is the outlier and only checks
      `category` + `date`. Fix: add `typeof e.ts === 'number'`.

- [ ] **P2** — Merge import doesn't union `dailyActivityBackfilledAt`, so
      a `null` local marker can trigger a re-backfill that overwrites the
      merged `dailyActivity`.
      Found: 2026-09-12. Location: `Storage.importJSON`, merge branch.
      Notes: `backfillDailyActivity` reconstructs from `word.history`,
      which is capped at 200 entries per word — so any daily activity
      not represented by a surviving history entry is lost on the next
      load. Reachable path: Erase All Data → import (merge). Fix: take
      `this.state.dailyActivityBackfilledAt || incoming.dailyActivityBackfilledAt || Date.now()`
      after merging `dailyActivity`.

- [ ] **P2** — Merge import builds `existingIds` once and never adds ids
      of newly-merged words, so a backup containing two entries with the
      same id produces duplicate word ids in the merged bank.
      Found: 2026-09-12. Location: `Storage.importJSON`, merge branch.
      Notes: `incoming.words.forEach(w=>{ if(!existingIds.has(w.id)) merged.push(w); })`
      never mutates `existingIds`. Later `Storage.state.words.find(w=>w.id===id)`
      returns the first match, so behavior is inconsistent. Fix: add
      `existingIds.add(w.id)` after each push.

- [ ] **P3** — `repairWord`'s `firstRetrieval` validation accepts any
      string date and doesn't coerce `correct` to boolean, so malformed
      values can skew `computeFirstPostTeachingRetention`.
      Found: 2026-09-12. Location: `repairWord`
      (vocab-trainer 2.0.html:806).
      Notes: Gate is only `typeof w.firstRetrieval.date === 'string'`.
      Fix: require `isValidDateStr(date)` and `typeof ts === 'number'`,
      and store `correct: !!correct`.

## WordModel + DimModel
- [ ] **P3** — `logError`'s `opts` parameter is duck-typed; a truthy
      non-opts 4th arg silently proceeds to the dim write.
      Found: 2026-09-12. Location: `WordModel.logError`
      (vocab-trainer 2.0.html:1280).
      Notes: Gate is `opts && opts.skipDimRecord`, so any truthy value
      without that key falls through to the `CATEGORY_TO_DIM` →
      `DimModel.record` write instead of erroring. No current caller passes
      a non-opts 4th arg. Fix only when `logError` is next touched for
      another reason.

- [ ] **P3** — `word.teaching.stepResults` is a dead field: defined by the
      schema (`WordModel.create`, `repairWord`) but never read or written
      anywhere, including by `Teaching`.
      Found: 2026-09-12 (during the Teaching scan). Location:
      `WordModel.create`, `repairWord` (`w.teaching.stepResults` handling).
      Notes: Noticed while scanning `Teaching` for T1–T6, but the fix (if
      any -- populate it, or drop it from the schema) belongs to
      Persistence/WordModel, not Teaching. No current reader depends on it,
      so leaving it as dead weight is also a valid option.

## Practice
_(scanned 2026-09-12, no findings)_

- [ ] **P3** — `Practice.session` shape comment references a nonexistent
      `phase` field.
      Found: 2026-09-12. Location: `Practice` object, ~line 1495.
      Notes: Stale doc comment -- `phase` belongs to the separate `Session`
      (Daily Session phase nav) singleton, not `Practice.session`.

- [ ] **P3** — `buildProductionQueue`'s items omit an explicit `track`
      field.
      Found: 2026-09-12. Location: `Practice.buildProductionQueue`.
      Notes: Inconsistent with the documented queue item shape
      (`{track, word, level, drillType, dimension}`) -- `buildDueQueue`'s
      legacy items always set `track:'legacy'`, but these don't set `track`
      at all. Harmless today since every check on `item.track` is an
      `===` comparison that tolerates `undefined`.

## Teaching
_(scanned 2026-09-12, T1–T6 fixed)_

## Session
_(scanned 2026-09-13, S1 fixed)_

## Exam + Audit
_(scanned 2026-09-13, E1/E2/A1/A2 fixed)_

## Views
_(scanned 2026-09-13, no findings)_

## Analytics
_(not yet scanned)_

## CROSS-SECTION
_(none yet)_

## Future
- Audit has no persistence — an in-progress essay and its tags are
  lost on refresh, unlike Practice/Session/Exam. Feature gap, not a
  defect.
- _pruneDeletedWord has no Teaching block, but the abandonment path
  it would guard is unreachable: navigating away from Teaching
  discards the session (no resume mechanism), and any orphaned
  reference is inert until the next Teaching.startQueue overwrites it.
  Not a defect. Revisit if Teaching ever gains a resume path.