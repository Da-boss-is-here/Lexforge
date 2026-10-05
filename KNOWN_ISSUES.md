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
- [x] **P2** — `validateAndRepair`'s `errorLog` filter doesn't require a
      numeric `ts`, unlike every sibling log filter; `NaN` comparisons
      then break `Views.renderErrors`' sort.
      Found: 2026-09-12. Location: `validateAndRepair`
      (index.html:722).
      Notes: `sessionLog`/`writingLog`/`examLog`/`fsrsReviewLog`/`attempts`
      all filter on `s.ts`; `errorLog` is the outlier and only checks
      `category` + `date`. Fix: add `typeof e.ts === 'number'`.
      Fixed: 2026-10-01 (verified during P0 reconciliation pass) —
      already present in code at index.html:740
      (`typeof e.ts==='number' && !Number.isNaN(e.ts)`).

- [x] **P2** — Merge import doesn't union `dailyActivityBackfilledAt`, so
      a `null` local marker can trigger a re-backfill that overwrites the
      merged `dailyActivity`.
      Found: 2026-09-12. Location: `Storage.importJSON`, merge branch.
      Notes: `backfillDailyActivity` reconstructs from `word.history`,
      which is capped at 200 entries per word — so any daily activity
      not represented by a surviving history entry is lost on the next
      load. Reachable path: Erase All Data → import (merge). Fix: take
      `this.state.dailyActivityBackfilledAt || incoming.dailyActivityBackfilledAt || Date.now()`
      after merging `dailyActivity`.
      Fixed: 2026-10-01 (verified during P0 reconciliation pass) —
      already present in code at index.html:1059.

- [x] **P2** — Merge import builds `existingIds` once and never adds ids
      of newly-merged words, so a backup containing two entries with the
      same id produces duplicate word ids in the merged bank.
      Found: 2026-09-12. Location: `Storage.importJSON`, merge branch.
      Notes: `incoming.words.forEach(w=>{ if(!existingIds.has(w.id)) merged.push(w); })`
      never mutates `existingIds`. Later `Storage.state.words.find(w=>w.id===id)`
      returns the first match, so behavior is inconsistent. Fix: add
      `existingIds.add(w.id)` after each push.
      Fixed: 2026-10-01 (verified during P0 reconciliation pass) —
      already present in code at index.html:994
      (`existingIds.add(w.id)` inside the push branch).

- [ ] **P3** — `repairWord`'s `firstRetrieval` validation accepts any
      string date and doesn't coerce `correct` to boolean, so malformed
      values can skew `computeFirstPostTeachingRetention`.
      Found: 2026-09-12. Location: `repairWord`
      (index.html:806).
      Notes: Gate is only `typeof w.firstRetrieval.date === 'string'`.
      Fix: require `isValidDateStr(date)` and `typeof ts === 'number'`,
      and store `correct: !!correct`.

## WordModel + DimModel
- [x] **P2** — `WordModel.maskWord` over-masked via stem matching: the stem
      length was `min(6, word.length)`, which equals the whole word for any
      target ≤6 chars, so the wildcard-suffix regex matched any unrelated
      word sharing that prefix (e.g. target "act" masked "actor",
      "actually", "action", "acting" in hints/mnemonics/contexts that never
      contained "act" at all).
      Found: 2026-09-28 (Algorithm/Debugging Part 0 triage). Location:
      `WordModel.maskWord` (index.html).
      Fixed: the stem-plus-wildcard branch now only runs when the
      component is actually truncated (`p.length>6`); a ≤6-char word is
      already covered by the exact-match replace earlier in the function.
      Trade-off: a short target's own inflected endings (e.g. "act" ->
      "acted"/"acting") are no longer masked by the fallback -- accepted,
      since there's no way to distinguish a real inflection from an
      unrelated word sharing a short prefix without a real
      stemmer/lemmatizer, and under-masking (word peeks through unblanked)
      is far less harmful than masking unrelated text. Regression tests
      added to `tests/persistence.smoke.test.js`.

- [ ] **P3** — `updateLadder`'s level-drop rule reads `word.history`
      filtered to non-teaching entries but NOT scoped to the level the
      word is currently being tested at, while its level-promotion rule
      IS scoped (`h.level===level`). A word could be demoted off failures
      logged during unrelated category-drill practice at a different
      level. Confirmed real during Algorithm/Debugging Part 0 triage but
      deliberately deferred -- changing it shifts existing-user behavior
      and needs a decided policy reason, not an emergent fix.
      Found: 2026-09-28. Location: `WordModel.updateLadder`
      (index.html:1295-1307).
      Notes: fix candidate is to filter `last5` on `h.level===level` the
      same way the promotion branch does, symmetric with how
      `computeMastery`/`buildDueQueue`'s `failedRecent` already filter
      teaching-phase entries out but not by level.

      ACCEPTED (2026-10-01): updateLadder's demotion window is
      intentionally not level-scoped. Rationale: a word failing across
      mixed levels is genuinely regressing. Revisit only if real usage
      shows spurious demotions.

      ACCEPTED (2026-10-01): updateLadder's demotion branch early-returns
      before the promotion path, so a correct answer does not rescue a
      word whose trailing-5 rate is <0.5. Intentional — the streak, not
      the current answer, is the signal that matters here.

- [ ] **P3** — `logError`'s `opts` parameter is duck-typed; a truthy
      non-opts 4th arg silently proceeds to the dim write.
      Found: 2026-09-12. Location: `WordModel.logError`
      (index.html:1280).
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
_(scanned 2026-09-12, no findings; genRecognition fix 2026-09-28)_

- [x] **P1** — `Practice.genRecognition` could produce an unanswerable
      1-2 option MCQ when the bank has fewer than ~4 words with a meaning.
      Found: 2026-09-28 (Algorithm/Debugging Part 0 triage). Location:
      `Practice.genRecognition` (index.html).
      Fixed: falls back to a self-graded recall prompt (`autoGrade:false`,
      no `options`) when zero distractor words exist, instead of returning
      a single-option MCQ that always grades "correct" regardless of
      recall. Stays `type:'recognition'` so `recordDimForQuestion`'s
      meaningRecognition credit is unaffected. `Views.renderPracticeCard`
      gates its MCQ branch on `q.autoGrade` too, so it falls through to
      the existing self-check textarea UI. Regression tests added to
      `tests/persistence.smoke.test.js`.

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
- [ ] **P3** — `Views.removeSampleWords` can't roll back aggregate counters:
      the demo's `dailyActivity` counts and the `first_word` achievement stay
      after the sample words are removed (word-keyed logs and milestones are purged).
      Found: 2026-10-05. Location: `Views.removeSampleWords`.
      Notes: `dailyActivity` is per-day totals with no per-word breakdown, so the
      demo's contribution can't be subtracted exactly. Deferred: cosmetic, and
      only affects someone who tries the samples and then keeps using the app.

## Analytics
_(scanned 2026-09-13, A1 fixed; A2/A3 deferred)_

- [ ] **P3** — `computeArmComparison`'s `reviewsToStable` averages fully-
      and partially-observed words together. `attempts[]` is a rolling
      window (cap 15000); for an old word whose earliest attempts were
      trimmed, `upToStable.length` undercounts and drags the headline
      mean down. The `upToStable.length > 0` guard only excludes words
      trimmed entirely.
      Found: 2026-09-13. Location: `computeArmComparison`,
      index.html:4141-4151.
      Fix: exclude words whose `firstMasteryAt` predates `attempts[0].ts`,
      plus a card note that the metric covers only in-window words.

- [ ] **P3** — `validReviewEntries` accepts any finite `predictedR`, not
      just [0,1]. Every `CALIBRATION_BUCKETS` bin rejects out-of-range
      values, so `hasCalibrationData` (which is `brier.n`) can clear the
      20-entry gate while the scatter chart draws zero points.
      `computeRetentionByInterval` has the same shape with negative
      `elapsedDays`.
      Found: 2026-09-13. Location: `validReviewEntries` ~3764, and the
      mirrored `retentionN` count at ~4246.
      Not producible by the app (`gradeFsrs` always writes in-range);
      only bites on a corrupt/hand-edited import.
      Fix: add `predictedR>=0 && predictedR<=1` to `validReviewEntries`,
      and `elapsedDays>=0` to both the `computeRetentionByInterval` filter
      and the `retentionN` count (they must stay identical).

## CROSS-SECTION
_(none yet)_

## Unverified findings
_(Surfaced during the 2026-10-01 P0 pre-publish reconciliation pass.
These have NOT been independently verified or triaged — they are raw
observations from sub-agents cross-checking KNOWN_ISSUES.md against the
code, flagged in passing while reading sections they weren't assigned to
scan. Treat each as a lead, not a confirmed defect, until someone
verifies it the way the entries above were verified.)_

- `DimModel.record` silently no-ops on an unrecognized `dimKey`
  (index.html:616-636).
- `DimModel.record`'s failure path unconditionally demotes `status` to
  `'Developing'` on a single miss, regardless of `everAchievedAt`
  (index.html:616-636).
- `logError` writes `errorCounts`/`errorLog` even when
  `opts.skipDimRecord` is set — only the dim write is skipped
  (index.html:1297).
- `updateLadder`'s demotion branch can fire on a correct answer via its
  early return, making "just got it right" and "just got it wrong"
  behaviourally identical when the trailing-5 rate is <0.5
  (index.html:1302-1315).
- `repairWord.srs.lastPracticed` accepted with no date-shape validation,
  unlike every sibling date field (index.html:852).
- `repairWord.levelState.level` uses `||2` fallback, coercing a saved
  level `0` to `2` instead of clamping to `1`
  (index.html:854).
- `defaultState` comment claiming `dailyActivityBackfilledAt` is "never
  touched again" is stale — the merge branch does touch it
  (index.html:726-728 vs :1059).
- `achievements` repair accepts arbitrary keys with no validation against
  known achievement ids (index.html:811-815).
- `computeCalibration`/`computeBrier`/`computeRetentionByInterval`/
  `retentionN` each re-implement the same filter predicate independently
  (index.html:3790-3792, :3847-3855, :4272).
- `CALIBRATION_BUCKETS` uses a `1.0001` epsilon for its tail bucket while
  `computeRetentionByInterval` uses `Infinity` for the same purpose —
  inconsistent idiom, not a bug.
- `Audit.tags` entries carry a `word` field never validated against
  `Storage.state.words` before review-item creation
  (index.html:3253).
- Teaching/Session coupling via hijacked function references
  (`_origRenderBeginTeaching`, `_backToSession`) is fragile and not a
  documented pattern (index.html:2472).
- `_pruneDeletedWord` has no Teaching block; harmless today because
  Teaching has no resume path (index.html:2472).

## Future
- Audit has no persistence — an in-progress essay and its tags are
  lost on refresh, unlike Practice/Session/Exam. Feature gap, not a
  defect.
- `repairWord` validates date format but not plausibility; an imported
  word with a future `created` date collapses `buildLearningProgressData`
  to zero labels (the `while cursor<=today` loop exits immediately).
  Root cause is `repairWord`; defensive fix could go in either place.
  Found: 2026-09-13. Location: `repairWord` / `buildLearningProgressData`.
  Only reachable via corrupt import or user clock changes.
- _pruneDeletedWord has no Teaching block, but the abandonment path
  it would guard is unreachable: navigating away from Teaching
  discards the session (no resume mechanism), and any orphaned
  reference is inert until the next Teaching.startQueue overwrites it.
  Not a defect. Revisit if Teaching ever gains a resume path.
