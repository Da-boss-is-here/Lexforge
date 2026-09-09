/* ==============================================================================
   DueQueue — generalizes Practice.buildDueQueue's due-item selection to
   (word, dimension) pairs instead of one item per word.

   Phase 1 uses this for exactly one dimension: recognition, scheduled by
   FSRS on its own independent due date (word.fsrs.recognition.due), shown
   regardless of the word's ladder level (word.levelState.level). Every other
   dimension (cued recall, cloze, drill, production) keeps being selected by
   the existing word.srs.nextReview / levelState.level logic in the HTML file,
   completely unchanged — this module does not touch or reimplement that path.

   Phase 2 adds a second FSRS-scheduled dimension (production) by calling
   buildDimensionItems again with dimension:'production' and merging its
   result in — the shape here is deliberately per-dimension from the start
   so that doesn't require reworking this module.
   ============================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DueQueue = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Selects words whose given FSRS-scheduled dimension is due, sorted
  // overdue-first (most overdue due date first), mirroring the legacy
  // queue's overdue-first ordering. `words` may be any array of word-like
  // objects that expose `teaching.completed` and `fsrs[dimension].due`.
  function buildDimensionItems(words, dimension, now) {
    now = now || new Date();
    var nowMs = now.getTime();
    var pool = words.filter(function (w) {
      return w.teaching && w.teaching.completed &&
        w.fsrs && w.fsrs[dimension] && w.fsrs[dimension].due != null;
    }).filter(function (w) {
      return new Date(w.fsrs[dimension].due).getTime() <= nowMs;
    });
    pool.sort(function (a, b) {
      return new Date(a.fsrs[dimension].due).getTime() - new Date(b.fsrs[dimension].due).getTime();
    });
    return pool.map(function (w) {
      return { track: 'fsrs', dimension: dimension, word: w };
    });
  }

  // Evenly interleaves two already-ordered item lists so the smaller list
  // (typically the newer FSRS-scheduled track) doesn't all cluster at the
  // start or end of a session — each list's own internal order is preserved.
  function mergeQueues(itemsA, itemsB) {
    var a = itemsA.slice();
    var b = itemsB.slice();
    var result = [];
    var ai = 0, bi = 0;
    while (ai < a.length || bi < b.length) {
      if (bi >= b.length) { result.push(a[ai++]); continue; }
      if (ai >= a.length) { result.push(b[bi++]); continue; }
      if ((ai + 1) * b.length <= (bi + 1) * a.length) {
        result.push(a[ai++]);
      } else {
        result.push(b[bi++]);
      }
    }
    return result;
  }

  return {
    buildDimensionItems: buildDimensionItems,
    mergeQueues: mergeQueues
  };
});
