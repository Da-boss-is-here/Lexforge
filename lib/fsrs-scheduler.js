/* ==============================================================================
   FSRSScheduler — thin wrapper around the vendored ts-fsrs library (lib/fsrs.umd.js).

   Scope: this module schedules ONE task-type card (currently: recognition only).
   It is deliberately generic per-card, not per-word — a word with multiple
   schedulable dimensions (recognition, production, ...) gets one of these
   card records per dimension. See lib/due-queue.js for how (word, dimension)
   pairs are turned into due items across dimensions.

   Framing: FSRS is used here as the recall-prediction / interval-scheduling
   engine, in place of the old fixed-multiplier scheduler. That's a settled
   choice, not an experiment — it's used because it predicts recall
   probability more accurately on large offline benchmarks. It is not a claim
   that it improves vocabulary-learning outcomes specifically; keep that
   distinction in any copy that touches this module.
   ============================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./fsrs.umd.js'));
  } else {
    root.FSRSScheduler = factory(root.FSRS);
  }
})(typeof self !== 'undefined' ? self : this, function (FSRSLib) {
  'use strict';

  var fsrs = FSRSLib.fsrs;
  var generatorParameters = FSRSLib.generatorParameters;
  var createEmptyCard = FSRSLib.createEmptyCard;
  var Rating = FSRSLib.Rating;
  var State = FSRSLib.State;

  // The FSRS "generation" (algorithm version) actually implemented by the vendored
  // library. FSRS-7 was the target per the original research review, but as of
  // integration time no maintained JS/TS port of FSRS-7 exists (ts-fsrs and the
  // fsrs-rs reference crate were both still on FSRS-6). Tracked as a constant,
  // not hardcoded into claims elsewhere, so upgrading is a contained change:
  // bump this, swap the vendored lib, re-run the unit tests below against it.
  var FSRS_GENERATION = 6;

  // ts-fsrs requires a finite maximum_interval; "no soft ceiling" (the Phase 1
  // default) is modeled as a very large number rather than a special case.
  var NO_CEILING_DAYS = 36500;

  var DEFAULT_DESIRED_RETENTION = 0.9;

  // Phase 2 promotion policy: production only enters the due-queue once recognition
  // for that word has reached this much stability (in days, FSRS's own unit — roughly
  // "how long until predicted recall drops to the target retention"). This is an
  // engineering policy for sequencing practice, not a validated learning principle —
  // refine the number if real usage shows it's off. Recomputed live off current
  // recognition stability each time the queue is built (not a persisted "unlocked"
  // flag), so it isn't sticky if recognition stability later drops.
  var PRODUCTION_UNLOCK_STABILITY = 21;

  // Inspectable rating map (not buried in a switch) — the app's UI only ever
  // emits three outcomes (auto-Again on a wrong answer, user-chosen Hard/Easy
  // on a correct one). FSRS's own Rating.Good is never emitted by this app yet.
  var RATING_MAP = {
    again: Rating.Again,
    hard: Rating.Hard,
    easy: Rating.Easy
  };

  function buildEngine(opts) {
    opts = opts || {};
    return fsrs(generatorParameters({
      request_retention: opts.desiredRetention != null ? opts.desiredRetention : DEFAULT_DESIRED_RETENTION,
      maximum_interval: opts.maxIntervalDays || NO_CEILING_DAYS,
      w: opts.params || undefined
    }));
  }

  function toISO(d) {
    return d instanceof Date ? d.toISOString() : d;
  }

  // Storage shape uses the library's own field names (elapsed_days, etc.) so
  // converting to/from the library's Card type is a direct field copy, not a
  // second mapping to invent and keep in sync.
  function serializeCard(card) {
    return {
      state: card.state,
      due: toISO(card.due),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsed_days,
      scheduled_days: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      learning_steps: card.learning_steps || 0,
      last_review: card.last_review ? toISO(card.last_review) : null
    };
  }

  function deserializeCard(stored) {
    return {
      state: stored.state,
      due: new Date(stored.due),
      stability: stored.stability,
      difficulty: stored.difficulty,
      elapsed_days: stored.elapsed_days,
      scheduled_days: stored.scheduled_days,
      reps: stored.reps,
      lapses: stored.lapses,
      learning_steps: stored.learning_steps || 0,
      last_review: stored.last_review ? new Date(stored.last_review) : undefined
    };
  }

  // A brand-new card, cold-started on FSRS's own default parameters (per-user
  // parameter optimization is a separate, later step — see optimizeAfterReviews
  // in settings.fsrs, not implemented by this module).
  function freshCard(now) {
    return serializeCard(createEmptyCard(now || new Date()));
  }

  // Predicted recall probability for a card right now, without grading it.
  // Returns null for a card that has never been reviewed (New state) — FSRS
  // has nothing to predict from yet.
  function predictRecall(stored, now, opts) {
    now = now || new Date();
    if (stored.state === State.New) return null;
    var engine = buildEngine(opts);
    var card = deserializeCard(stored);
    return engine.get_retrievability(card, now, false);
  }

  function isDue(stored, now) {
    now = now || new Date();
    return new Date(stored.due).getTime() <= now.getTime();
  }

  // Grades a card and returns its next state plus a record suitable for the
  // debug log (fsrsReviewLog): the recall probability FSRS predicted for this
  // review *before* the outcome was known.
  function grade(stored, ratingKey, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var g = RATING_MAP[ratingKey];
    if (g == null) throw new Error('Unknown FSRS rating: ' + ratingKey);

    var engine = buildEngine(opts);
    var card = deserializeCard(stored);
    var predictedR = stored.state === State.New ? null : engine.get_retrievability(card, now, false);
    var result = engine.next(card, now, g);

    return {
      card: serializeCard(result.card),
      predictedR: predictedR,
      log: {
        rating: ratingKey,
        due: toISO(result.log.due),
        review: toISO(result.log.review),
        state: result.log.state,
        stability: result.log.stability,
        difficulty: result.log.difficulty,
        elapsed_days: result.log.elapsed_days,
        scheduled_days: result.log.scheduled_days
      }
    };
  }

  // Phase 4: exam-date compression. ts-fsrs computes elapsed_days (the only time
  // input to its memory math on the *next* review) from last_review, never from
  // due -- see FSRS.init() in fsrs.umd.js. That means due is a pure scheduling
  // output, never fed back in as an input, so nudging it earlier here does not
  // desync stability/difficulty/predictRecall from what FSRS actually computed;
  // it only changes when the app chooses to surface the card again. Mirrors the
  // spirit (and the exact day-count formula) of the legacy exam-date compression
  // in WordModel.applyRating, which shrinks word.srs.interval the same way.
  //
  // Returns null if the card's natural due already lands on/before the exam --
  // i.e. there's nothing to compress. Only `due` and `scheduled_days` differ in
  // the returned card; stability, difficulty, reps, lapses, last_review are the
  // untouched, genuine outputs of the grade() call that produced `card`.
  function compressForExam(card, examDate, now) {
    now = now || new Date();
    var examEndOfDay = new Date(examDate + 'T23:59:59.999');
    var dueMs = new Date(card.due).getTime();
    if (dueMs <= examEndOfDay.getTime()) return null;

    var daysToExam = Math.round((examEndOfDay.getTime() - now.getTime()) / 86400000);
    if (daysToExam <= 0) return null;

    var cappedDays = Math.max(1, Math.ceil(daysToExam / 2));
    var newDue = new Date(now.getTime() + cappedDays * 86400000);
    var compressed = {};
    Object.keys(card).forEach(function (k) { compressed[k] = card[k]; });
    compressed.due = newDue.toISOString();
    compressed.scheduled_days = cappedDays;
    return compressed;
  }

  // Dimensions FSRS is responsible for scheduling. Phase 1 added recognition;
  // Phase 2 added production (gated by PRODUCTION_UNLOCK_STABILITY above — see
  // lib/due-queue.js for the eligibility check). Phase 3 adds meaningRecall
  // (cued recall) ungated, same as recognition — investigation found cued
  // recall has no real prerequisite in this app (every word starts at legacy
  // ladder level 2, the cued-recall level, and never falls below it), unlike
  // production which is genuinely gated behind climbing the ladder. Gating
  // meaningRecall the same way production is gated would have been a
  // regression versus current behavior, not a neutral copy of the pattern.
  // Every other dimension stays on the legacy word.srs/levelState scheduler,
  // untouched, selected elsewhere (see lib/due-queue.js + the main app's
  // Practice.buildDueQueue). A word's card for each of these is created
  // uniformly (see freshWordFsrs/repairWordFsrs) even before it's actually
  // eligible to surface — eligibility only gates whether the due-queue
  // selects it, not whether the card exists.
  var DIMENSIONS = ['recognition', 'production', 'meaningRecall'];

  // Repairs one stored card (word.fsrs.<dimension>) read back from localStorage.
  // Anything missing or malformed becomes a brand-new card, due immediately —
  // this is also what a pre-existing save with no `fsrs` field at all migrates to.
  function repairCard(raw) {
    if (raw && typeof raw === 'object' && typeof raw.due === 'string') {
      return {
        state: [0, 1, 2, 3].indexOf(raw.state) !== -1 ? raw.state : 0,
        due: raw.due,
        stability: Number(raw.stability) || 0,
        difficulty: Number(raw.difficulty) || 0,
        elapsed_days: Number(raw.elapsed_days) || 0,
        scheduled_days: Number(raw.scheduled_days) || 0,
        reps: Number(raw.reps) || 0,
        lapses: Number(raw.lapses) || 0,
        learning_steps: Number(raw.learning_steps) || 0,
        last_review: typeof raw.last_review === 'string' ? raw.last_review : null
      };
    }
    return freshCard();
  }

  function freshWordFsrs() {
    var d = {};
    DIMENSIONS.forEach(function (k) { d[k] = freshCard(); });
    return d;
  }

  // Repairs word.fsrs as a whole (all schedulable dimensions) for one word read
  // back from storage.
  function repairWordFsrs(raw) {
    var d = {};
    DIMENSIONS.forEach(function (k) { d[k] = repairCard(raw && raw[k]); });
    return d;
  }

  function defaultSettings() {
    return {
      desiredRetention: DEFAULT_DESIRED_RETENTION,
      maxIntervalDays: null,
      optimizeAfterReviews: 1000,
      params: null
    };
  }

  // Repairs settings.fsrs read back from storage (or a pre-existing save that
  // predates this field entirely, in which case `raw` is undefined).
  function repairSettings(raw) {
    var d = defaultSettings();
    if (raw && typeof raw === 'object') {
      if (Number.isFinite(raw.desiredRetention)) {
        d.desiredRetention = Math.min(0.99, Math.max(0.5, raw.desiredRetention));
      }
      if (Number.isFinite(raw.maxIntervalDays) && raw.maxIntervalDays > 0) {
        d.maxIntervalDays = raw.maxIntervalDays;
      }
      if (Number.isFinite(raw.optimizeAfterReviews)) {
        d.optimizeAfterReviews = raw.optimizeAfterReviews;
      }
      if (Array.isArray(raw.params)) {
        d.params = raw.params;
      }
    }
    return d;
  }

  return {
    FSRS_GENERATION: FSRS_GENERATION,
    DEFAULT_DESIRED_RETENTION: DEFAULT_DESIRED_RETENTION,
    PRODUCTION_UNLOCK_STABILITY: PRODUCTION_UNLOCK_STABILITY,
    DIMENSIONS: DIMENSIONS,
    RATING_MAP: RATING_MAP,
    State: State,
    freshCard: freshCard,
    predictRecall: predictRecall,
    isDue: isDue,
    grade: grade,
    compressForExam: compressForExam,
    serializeCard: serializeCard,
    deserializeCard: deserializeCard,
    repairCard: repairCard,
    freshWordFsrs: freshWordFsrs,
    repairWordFsrs: repairWordFsrs,
    defaultSettings: defaultSettings,
    repairSettings: repairSettings
  };
});
