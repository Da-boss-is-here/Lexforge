/* Persistence smoke test: exercises the REAL app script (extracted straight out of
   vocab-trainer 2.0.html, not a duplicate) via node:vm. Storage/WordModel/etc. don't
   touch the DOM, so this can run headless with a minimal localStorage + document stub
   -- no browser needed. Covers: state round-trips through save/load, and a pre-existing
   (pre-FSRS) save migrates correctly on load. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const DueQueue = require('../lib/due-queue.js');
const FSRSScheduler = require('../lib/fsrs-scheduler.js');

const HTML_PATH = path.join(__dirname, '..', 'vocab-trainer 2.0.html');

class FakeLocalStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
}

function extractAppScript() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const src = matches[matches.length - 1][1];
  // The real file wraps everything in `(function(){ ... })();` so nothing leaks
  // to global scope in the browser. For testing, run the same body unwrapped in
  // an isolated vm context so top-level `const`s become reachable from a second
  // script run in that same context -- this doesn't touch the shipped file.
  const inner = src.replace(/^\s*\(function\(\)\{/, '').replace(/\}\)\(\);\s*$/, '');
  return inner.replace(/document\.addEventListener\('DOMContentLoaded'.*?\);?\s*$/, '');
}

function buildSandbox() {
  const FSRSScheduler = require('../lib/fsrs-scheduler.js');
  const DueQueue = require('../lib/due-queue.js');
  const sandbox = {
    console,
    localStorage: new FakeLocalStorage(),
    // getElementById returns a harmless fake element (not null) so DOM-touching routing
    // code -- e.g. App.showTab, called by Views.runDimensionPractice (Phase E) -- doesn't
    // throw when a test exercises it; existing tests never called anything that touches
    // getElementById's result, so this is purely additive.
    document: {
      addEventListener() {}, getElementById() { return { classList: { add(){}, remove(){}, toggle(){} }, innerHTML: '', style: {}, querySelector(){ return null; }, querySelectorAll(){ return []; }, appendChild(){}, remove(){} }; },
      querySelectorAll() { return []; }, createElement() { return { style: {}, classList: { add(){}, remove(){} }, remove(){}, appendChild(){} }; }
    },
    window: undefined,
    navigator: { languages: ['en-US'] },
    FSRSScheduler,
    DueQueue,
    // Fake timers: Utils.toast schedules a removal via setTimeout, but tests don't care
    // whether/when that fires -- a no-op avoids both a real multi-second wait and an
    // uncaught exception from the callback running after the test (and its fake DOM) is gone.
    setTimeout(){ return 0; }, clearTimeout(){},
    // Also no-ops by default (Exam.ensureTimer's setInterval) -- individual tests that need to
    // observe/drive the exam countdown override ctx.setInterval/clearInterval themselves.
    setInterval(){ return 0; }, clearInterval(){}
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(extractAppScript(), { filename: 'app-under-test.js' });
  script.runInContext(ctx);
  // Pull the pieces the tests need into the sandbox's reachable scope (top-level
  // const/class bindings share the context's global lexical scope across runs).
  new vm.Script('this.__exports = { Storage, WordModel, defaultState, validateAndRepair, Practice, App, Analytics, Utils, computeCalibration, computeBrier, computeStabilityGrowth, computeRetentionByInterval, computeFirstPostTeachingRetention, DailyActivity, Milestones, Achievements, ErrorIntegration, computeWeekOverWeek, computeStreakFromActivity, computeHeatmapCells, computeHighestSingleDay, computeFastestMastery, relativeDate, DimModel, computeLapseRates, computeFailuresByDimension, computeDimensionCoverage, Views, DIM_PRACTICE_LEVEL, repairWord, Teaching, Session, computeArmComparison, Exam, CATEGORY_TO_DIM, ERROR_CATEGORIES, Modal, Audit };', { filename: 'export-hook.js' }).runInContext(ctx);
  return { ctx, exports: sandbox.__exports, localStorage: sandbox.localStorage };
}

test('a fresh app boots to defaultState() version 2 with fsrs settings present', () => {
  const { exports: E } = buildSandbox();
  const s = E.defaultState();
  assert.equal(s.version, 2);
  assert.equal(s.settings.fsrs.desiredRetention, 0.9);
  assert.equal(s.fsrsReviewLog.length, 0);
});

test('Storage.save() then Storage.load() round-trips words, including fsrs card state, through localStorage', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load(); // seeds this.state with defaultState() since localStorage is empty
  const word = E.WordModel.create({
    word: 'ephemeral', meaning: 'lasting a very short time', form: 'adjective', grammar: '',
    collocations: ['ephemeral beauty', 'ephemeral nature'], contrast: 'permanent', contexts: ['a', 'b'],
    production: 'Fame can be ephemeral.', cloze: [], wordType: 'general'
  });
  word.teaching.completed = true;
  E.Storage.state.words.push(word);
  E.Storage.save();

  // Reload as if the page were refreshed.
  E.Storage.load();
  const reloaded = E.Storage.state.words.find(w => w.word === 'ephemeral');
  assert.ok(reloaded, 'word should survive a save/load round-trip');
  assert.equal(reloaded.fsrs.recognition.state, 0);
  assert.equal(reloaded.teaching.completed, true);
});

test('validateAndRepair migrates a pre-FSRS save (v1, no fsrs fields anywhere) without throwing', () => {
  const { exports: E } = buildSandbox();
  const legacySave = {
    version: 1,
    words: [{
      id: 'w1', word: 'legacy', meaning: 'old', form: '', grammar: '', collocations: [], contrast: '',
      contexts: [], production: '', cloze: [], created: '2025-01-01',
      srs: { interval: 5, nextReview: '2025-06-01', easeStreak: 2, lastPracticed: '2025-05-27' },
      levelState: { level: 3 }, history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} }
      // no `dims`, no `fsrs` -- exactly what a save from before this migration looks like
    }],
    errorLog: [], settings: { examDate: null, theme: 'system' }, // no settings.fsrs either
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  };
  const repaired = E.validateAndRepair(legacySave);
  const w = repaired.words[0];
  assert.equal(w.srs.interval, 5, 'legacy srs field should be preserved untouched');
  assert.ok(w.fsrs && w.fsrs.recognition, 'a fresh recognition card should be synthesized for a pre-FSRS word');
  assert.equal(w.fsrs.recognition.state, 0);
  assert.equal(repaired.settings.fsrs.desiredRetention, 0.9, 'settings.fsrs should default when absent from the legacy save');
  assert.equal(repaired.fsrsReviewLog.length, 0);
});

test('validateAndRepair migrates a Phase-1-era save (has fsrs.recognition, no fsrs.production yet) without throwing', () => {
  const { exports: E } = buildSandbox();
  const phase1Save = {
    version: 2,
    words: [{
      id: 'w1', word: 'interim', meaning: 'temporary', form: '', grammar: '', collocations: [], contrast: '',
      contexts: [], production: '', cloze: [], created: '2025-01-01',
      srs: { interval: 5, nextReview: '2025-06-01', easeStreak: 2, lastPracticed: '2025-05-27' },
      levelState: { level: 4 }, history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} },
      dims: {}, // repaired to fresh dims
      fsrs: { recognition: { state: 2, due: '2026-01-01T00:00:00Z', stability: 25, difficulty: 5, elapsed_days: 3, scheduled_days: 5, reps: 4, lapses: 0, learning_steps: 0, last_review: '2025-12-27T00:00:00Z' } }
      // no `fsrs.production` -- exactly what a save from Phase 1 (before this change) looks like
    }],
    errorLog: [], settings: { examDate: null, theme: 'system', fsrs: FSRSScheduler.defaultSettings() },
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null, fsrsReviewLog: []
  };
  const repaired = E.validateAndRepair(phase1Save);
  const w = repaired.words[0];
  assert.equal(w.fsrs.recognition.stability, 25, 'existing recognition card should be preserved untouched');
  assert.ok(w.fsrs.production, 'a fresh production card should be synthesized for a Phase-1-era word');
  assert.equal(w.fsrs.production.state, 0);
});

test('validateAndRepair migrates a Phase-2-era save (has fsrs.recognition + fsrs.production, no fsrs.meaningRecall yet) without throwing', () => {
  const { exports: E } = buildSandbox();
  const phase2Save = {
    version: 2,
    words: [{
      id: 'w1', word: 'stopgap', meaning: 'temporary substitute', form: '', grammar: '', collocations: [], contrast: '',
      contexts: [], production: '', cloze: [], created: '2025-01-01',
      srs: { interval: 5, nextReview: '2025-06-01', easeStreak: 2, lastPracticed: '2025-05-27' },
      levelState: { level: 2 }, history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} },
      dims: {},
      fsrs: {
        recognition: { state: 2, due: '2026-01-01T00:00:00Z', stability: 12, difficulty: 4, elapsed_days: 2, scheduled_days: 4, reps: 2, lapses: 0, learning_steps: 0, last_review: '2025-12-30T00:00:00Z' },
        production: { state: 0, due: '2026-01-01T00:00:00Z', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0, last_review: null }
      }
      // no `fsrs.meaningRecall` -- exactly what a save from Phase 2 (before this change) looks like
    }],
    errorLog: [], settings: { examDate: null, theme: 'system', fsrs: FSRSScheduler.defaultSettings() },
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null, fsrsReviewLog: []
  };
  const repaired = E.validateAndRepair(phase2Save);
  const w = repaired.words[0];
  assert.equal(w.fsrs.recognition.stability, 12, 'existing recognition card should be preserved untouched');
  assert.equal(w.fsrs.production.reps, 0, 'existing production card should be preserved untouched');
  assert.ok(w.fsrs.meaningRecall, 'a fresh meaningRecall card should be synthesized for a Phase-2-era word');
  assert.equal(w.fsrs.meaningRecall.state, 0);
});

test('a migrated legacy word is immediately eligible for the FSRS recognition queue (cold start)', () => {
  const { exports: E } = buildSandbox();
  const legacySave = {
    version: 1,
    words: [{
      id: 'w1', word: 'legacy', meaning: 'old', form: '', grammar: '', collocations: [], contrast: '',
      contexts: [], production: '', cloze: [], created: '2025-01-01',
      srs: { interval: 5, nextReview: '2099-01-01', easeStreak: 2, lastPracticed: '2025-05-27' },
      levelState: { level: 3 }, history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} }
    }],
    errorLog: [], settings: {}, sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  };
  const repaired = E.validateAndRepair(legacySave);
  const items = DueQueue.buildDimensionItems(repaired.words, 'recognition', new Date());
  assert.equal(items.length, 1, 'a freshly-migrated word should be due for its recognition card immediately, even though its legacy srs.nextReview is far in the future');
});

test('repairWord coerces errorCounts values to numbers, so WordModel.logError adds instead of concatenating strings', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = E.repairWord({
    id: 'w1', word: 'test', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], created: '2025-01-01', history: [],
    errorCounts: { Spelling: '3', Meaning: 'not-a-number' }, lastClozeIndex: -1, wordType: 'general',
    teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} }
  });
  assert.equal(w.errorCounts.Spelling, 3, 'a numeric-looking string should be coerced to a number');
  assert.equal(w.errorCounts.Meaning, undefined, 'a non-numeric string should be dropped rather than kept as-is');

  E.WordModel.logError(w, 'Spelling', 1);
  assert.equal(w.errorCounts.Spelling, 4, 'logError should add to a coerced numeric count, not concatenate ("3"+1==="31")');
});

test('repairWord does not mark teaching completed from history entries that all get dropped for invalid dates', () => {
  const { exports: E } = buildSandbox();
  const w = E.repairWord({
    id: 'w1', word: 'test', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], created: '2025-01-01',
    // Every history entry has an invalid date, so the repaired history ends up empty --
    // teaching.completed must follow the REPAIRED history, not the raw one.
    history: [{ date: 'not-a-date', level: 1, correct: true }],
    errorCounts: {}, lastClozeIndex: -1, wordType: 'general', teaching: undefined
  });
  assert.equal(w.history.length, 0, 'invalid-date history entries should be dropped');
  assert.equal(w.teaching.completed, false, 'teaching should not be marked completed when the repaired history is empty');
});

test('Storage.importJSON merge mode sorts capped logs by ts before slicing, so an older imported backup cannot evict newer local entries', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Storage.state.words.push(E.WordModel.create({
    word: 'local-anchor', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], wordType: 'general'
  }));
  // Local already has 5000 newer entries -- exactly at MERGE_LOG_CAP -- at ts 2000..6999.
  const LOCAL_COUNT = 5000;
  E.Storage.state.sessionLog = Array.from({ length: LOCAL_COUNT }, (_, i) => ({ ts: 2000 + i, correct: true }));

  // Incoming backup is entirely OLDER than local (ts 0..4999): a stale backup being merged in.
  const incomingSessionLog = Array.from({ length: 5000 }, (_, i) => ({ ts: i, correct: true }));
  const incoming = JSON.stringify({
    version: 2,
    words: [{
      id: 'w-imported', word: 'imported-anchor', meaning: 'm', form: '', grammar: '', collocations: [],
      contrast: '', contexts: [], production: '', cloze: [], created: '2025-01-01',
      history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} }
    }],
    sessionLog: incomingSessionLog,
    errorLog: [], settings: {}, writingLog: [], examLog: [], practiceSession: null
  });

  const ok = E.Storage.importJSON(incoming, 'merge');
  assert.ok(ok, 'merge import should succeed');
  const tsValues = E.Storage.state.sessionLog.map(s => s.ts);
  // Without the fix, concat-then-slice(-CAP) keeps whatever lands at the END of the raw
  // concatenation -- i.e. all of the older `incoming` entries -- and drops every newer local one.
  assert.ok(tsValues.includes(6999), 'the newest local entry must survive the merge');
  assert.ok(!tsValues.includes(0), 'the oldest imported entry should be evicted by the cap, not a newer local one');
  assert.equal(E.Storage.state.sessionLog.length, LOCAL_COUNT, 'merged log should stay capped at MERGE_LOG_CAP');
});

test('Practice.buildDueQueue only surfaces a production item once recognition stability clears the unlock threshold', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'seuil', meaning: 'threshold', form: 'noun', grammar: '', collocations: ['a', 'b'],
    contrast: '', contexts: ['x', 'y'], production: 'p', cloze: [], wordType: 'general'
  });
  word.teaching.completed = true;
  word.history.push({ date: '2025-01-01', level: 1, correct: true, phase: 'practice' }); // so it isn't filtered as "new"
  word.fsrs.recognition.stability = 5; // below FSRSScheduler.PRODUCTION_UNLOCK_STABILITY (21)
  word.fsrs.production.due = new Date(Date.now() - 1000).toISOString(); // due, but not yet eligible
  E.Storage.state.words.push(word);

  const before = E.Practice.buildDueQueue({});
  assert.ok(!before.some(i => i.track === 'fsrs' && i.dimension === 'production'), 'production should not surface below the unlock threshold');

  word.fsrs.recognition.stability = 25; // above the threshold now
  const after = E.Practice.buildDueQueue({});
  assert.ok(after.some(i => i.track === 'fsrs' && i.dimension === 'production' && i.word.id === word.id), 'production should surface once recognition stability clears the threshold');
});

test('Practice.buildDueQueue surfaces a brand-new word\'s meaningRecall item immediately -- ungated, unlike production', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'apprise', meaning: 'to inform', form: 'verb', grammar: '', collocations: ['a', 'b'],
    contrast: '', contexts: ['x', 'y'], production: 'p', cloze: [], wordType: 'general'
  });
  word.teaching.completed = true;
  word.history.push({ date: '2025-01-01', level: 2, correct: true, phase: 'practice' });
  // recognition stability is 0 (never reviewed) -- would keep production locked, but
  // meaningRecall has no such gate and should surface anyway.
  E.Storage.state.words.push(word);

  const items = E.Practice.buildDueQueue({});
  assert.ok(items.some(i => i.track === 'fsrs' && i.dimension === 'meaningRecall' && i.word.id === word.id), 'meaningRecall should be immediately eligible for a fresh word with zero recognition stability');
});

/* ---- Phase 4: exam-date awareness ---- */

// Test-only helper: Practice.gradeFsrs (product code, unchanged) always calls `new Date()`
// itself at call time to get "now" -- it has no way to accept an injected clock. A test that
// separately computes an expected "natural" FSRS result using its own fixed `now` can only match
// gradeFsrs's real output if both use the exact same instant down to the millisecond (FSRS's
// `due` is `now + scheduled_days`, so any drift between the two `now`s leaks straight into `due`).
// This freezes the sandbox's own `Date` (a separate realm from the test file's host Date, since
// gradeFsrs runs as vm-sandboxed code) so its zero-arg `new Date()` returns a fixed instant;
// `new Date(x)` with explicit arguments is left working normally, since other code (e.g.
// `new Date(examDate + 'T23:59:59.999')`) still needs that. Returns a restore function.
function freezeSandboxDate(ctx, fixedMs) {
  const install = new vm.Script(
    '(function(fixedMs){' +
    '  const RealDate = Date;' +
    '  class FrozenDate extends RealDate {' +
    '    constructor(...args){ super(...(args.length ? args : [fixedMs])); }' +
    '    static now(){ return fixedMs; }' +
    '  }' +
    '  Date = FrozenDate;' +
    '  return function restore(){ Date = RealDate; };' +
    '})',
    { filename: 'freeze-sandbox-date.js' }
  ).runInContext(ctx);
  return install(fixedMs);
}

function makeExamReadyEligibleWord(E) {
  const word = E.WordModel.create({
    word: 'sedulous', meaning: 'diligent', form: 'adjective', grammar: '', collocations: ['a', 'b'],
    contrast: '', contexts: ['x', 'y'], production: 'p', cloze: [], wordType: 'general'
  });
  word.teaching.completed = true;
  word.dims.independentProduction = { status: 'Achieved', success: 2, fail: 0 };
  word.dims.novelApplication = { status: 'Achieved', success: 1, fail: 0 };
  const today = new Date().toISOString().slice(0, 10);
  word.history.push({ date: today, level: 4, correct: true, phase: 'practice' });
  word.history.push({ date: today, level: 4, correct: true, phase: 'practice' });
  word.history.push({ date: today, level: 4, correct: true, phase: 'practice' });
  word.srs.nextReview = today; // satisfies the existing legacy srsOk check
  return word;
}

test('computeMastery: an exam-ready word with all-New FSRS cards is not penalized -- unreviewed dimensions are exempt', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Storage.state.settings.examDate = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const word = makeExamReadyEligibleWord(E);
  // recognition/meaningRecall/production are all freshCard() -- reps 0, New state.
  assert.equal(E.WordModel.computeMastery(word), 'Exam Ready');
});

test('computeMastery: a Relearning (lapsing) FSRS dimension downgrades Exam Ready to Stable', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Storage.state.settings.examDate = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const word = makeExamReadyEligibleWord(E);
  const now = new Date();
  const afterEasy = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'easy', { now }).card;
  const afterLapse = FSRSScheduler.grade(afterEasy, 'again', { now }).card;
  assert.equal(afterLapse.state, FSRSScheduler.State.Relearning, 'sanity check: this card is actually Relearning');
  word.fsrs.production = afterLapse;
  assert.equal(E.WordModel.computeMastery(word), 'Stable');
});

test('computeMastery: an FSRS dimension due past the exam downgrades Exam Ready to Stable', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Storage.state.settings.examDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const word = makeExamReadyEligibleWord(E);
  const now = new Date();
  const reviewed = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'easy', { now }).card;
  reviewed.due = new Date(Date.now() + 90 * 86400000).toISOString(); // long past the 5-day-away exam
  word.fsrs.meaningRecall = reviewed;
  assert.equal(E.WordModel.computeMastery(word), 'Stable');
});

test('Practice.gradeFsrs evaluates the "already Exam Ready?" gate AFTER writing this review\'s grade, not before', () => {
  const { exports: E, ctx } = buildSandbox();
  E.Storage.load();
  const word = makeExamReadyEligibleWord(E);
  const fixedMs = Date.UTC(2026, 0, 1); // arbitrary fixed instant -- see freezeSandboxDate
  const now = new Date(fixedMs);

  // Build a Relearning-state production card the same way FSRS itself would produce one.
  const afterEasy = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'easy', { now }).card;
  const relearningCard = FSRSScheduler.grade(afterEasy, 'again', { now }).card;
  assert.equal(relearningCard.state, FSRSScheduler.State.Relearning);

  // Learn what FSRS would naturally produce for grading this exact card 'easy' -- a lapsed
  // card graduating back out of Relearning -- without going through gradeFsrs or compression.
  const natural = FSRSScheduler.grade(relearningCard, 'easy', { now });
  assert.notEqual(natural.card.state, FSRSScheduler.State.Relearning, 'sanity check: easy graduates it out of Relearning');
  const examDate = new Date(new Date(natural.card.due).getTime() + 2 * 86400000).toISOString().slice(0, 10);

  // Fabricate a due far in the future on the PRE-grade card. This must have zero effect on the
  // natural grade() computation (due is never read back in as an input -- confirmed against
  // fsrs.umd.js's own elapsed_days computation), but if gradeFsrs's exam-ready gate incorrectly
  // read word.fsrs.production BEFORE writing this review's result, it would still see this
  // far-future due (and the Relearning state) and wrongly conclude "not ready" -> compress.
  relearningCard.due = new Date(fixedMs + 200 * 86400000).toISOString();
  word.fsrs.production = relearningCard;
  E.Storage.state.settings.examDate = examDate;
  E.Storage.state.words.push(word);

  // gradeFsrs calls `new Date()` itself (it can't take an injected clock -- that's product
  // code, left untouched). Freeze the sandbox's clock to the exact instant `natural` was
  // computed with, so the two computations are deterministically comparable down to the
  // millisecond instead of racing real wall-clock time (see freezeSandboxDate).
  const restoreDate = freezeSandboxDate(ctx, fixedMs);
  try {
    E.Practice.gradeFsrs(word, 'production', 'easy');
  } finally {
    restoreDate();
  }

  const logEntry = E.Storage.state.fsrsReviewLog[E.Storage.state.fsrsReviewLog.length - 1];
  assert.ok(!logEntry.examCompressed, 'the word became ready by virtue of THIS review, so the post-write gate should see it as ready and skip compression');
  assert.equal(word.fsrs.production.due, natural.card.due, 'the stored due should be the natural FSRS result, untouched by compression');
});

test('Practice.gradeFsrs compresses a due date past the exam, and logs the compression on the same log entry', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = makeExamReadyEligibleWord(E);
  const now = new Date();
  const reviewed = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'easy', { now }).card;
  reviewed.due = new Date(Date.now() + 90 * 86400000).toISOString();
  reviewed.stability = 60; // large enough that grading 'easy' again naturally lands past the exam
  word.fsrs.meaningRecall = reviewed;
  E.Storage.state.settings.examDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  E.Storage.state.words.push(word);

  E.Practice.gradeFsrs(word, 'meaningRecall', 'easy');

  const logEntry = E.Storage.state.fsrsReviewLog[E.Storage.state.fsrsReviewLog.length - 1];
  assert.equal(logEntry.examCompressed, true);
  assert.ok(logEntry.naturalDue, 'the pre-compression natural due should be preserved in the log');
  const compressedDueMs = new Date(word.fsrs.meaningRecall.due).getTime();
  const examMs = new Date(E.Storage.state.settings.examDate + 'T23:59:59.999').getTime();
  assert.ok(compressedDueMs <= examMs, 'the compressed due should land on/before the exam');
});

test('Practice.gradeFsrs never compresses when no exam date is set -- identical to pre-Phase-4 behavior', () => {
  const { exports: E, ctx } = buildSandbox();
  E.Storage.load();
  const word = makeExamReadyEligibleWord(E);
  const fixedMs = Date.UTC(2026, 0, 1);
  const now = new Date(fixedMs);
  const reviewed = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'easy', { now }).card;
  reviewed.due = new Date(fixedMs + 90 * 86400000).toISOString();
  reviewed.stability = 60;
  word.fsrs.meaningRecall = reviewed;
  E.Storage.state.settings.examDate = null;
  E.Storage.state.words.push(word);

  const naturalResult = FSRSScheduler.grade(reviewed, 'easy', { now });
  // Same wall-clock race as the "AFTER writing this review's grade" test above -- gradeFsrs
  // calls `new Date()` itself, so freeze the sandbox's clock to match `now` (see freezeSandboxDate).
  const restoreDate = freezeSandboxDate(ctx, fixedMs);
  try {
    E.Practice.gradeFsrs(word, 'meaningRecall', 'easy');
  } finally {
    restoreDate();
  }

  const logEntry = E.Storage.state.fsrsReviewLog[E.Storage.state.fsrsReviewLog.length - 1];
  assert.ok(!logEntry.examCompressed);
  assert.equal(word.fsrs.meaningRecall.due, naturalResult.card.due);
});

/* ---- Phase 5 micro-fixes: mnemonic fading + dims-status cross-contamination ---- */

function makeWordWithMnemonic(E) {
  return E.WordModel.create({
    word: 'sedulous', meaning: 'diligent', form: 'adjective', grammar: '', collocations: ['a', 'b'],
    contrast: '', contexts: ['x', 'y'], production: 'p', cloze: [], wordType: 'general'
  });
}

test('WordModel.mnemonicFaded also fades once an FSRS-tracked dimension reaches PRODUCTION_UNLOCK_STABILITY, even with zero legacy easeStreak', () => {
  const { exports: E } = buildSandbox();
  const word = makeWordWithMnemonic(E);
  word.mnemonic = 'said-you\'ll-us -- diligently keeping a promise';
  assert.equal(word.srs.easeStreak, 0);
  assert.equal(E.WordModel.mnemonicFaded(word), false, 'sanity: not faded yet -- no legacy streak, all FSRS dims fresh');

  word.fsrs.recognition.stability = FSRSScheduler.PRODUCTION_UNLOCK_STABILITY; // reached entirely via FSRS review, never touching easeStreak
  assert.equal(E.WordModel.mnemonicFaded(word), true, 'should fade once FSRS stability alone clears the threshold');
});

test('WordModel.mnemonicFaded still fades via the legacy easeStreak path -- pre-existing behavior unchanged', () => {
  const { exports: E } = buildSandbox();
  const word = makeWordWithMnemonic(E);
  word.mnemonic = 'hint';
  word.srs.easeStreak = 4;
  assert.equal(E.WordModel.mnemonicFaded(word), true);
});

test('WordModel.mnemonicFaded returns false with no mnemonic regardless of FSRS stability', () => {
  const { exports: E } = buildSandbox();
  const word = makeWordWithMnemonic(E);
  word.mnemonic = '';
  word.fsrs.production.stability = 999;
  assert.equal(E.WordModel.mnemonicFaded(word), false);
});

// Removed: tested logError's testedDims parameter, removed in 037bbaa.

test('WordModel.logError still downgrades an Achieved dim when the fail is on-target for the question type actually tested', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = makeWordWithMnemonic(E);
  word.dims.meaningRecall = { status: 'Achieved', success: 2, fail: 0 };
  // A Cued Recall question (tests meaningRecall/formRecall) went wrong and was tagged "Meaning".
  E.WordModel.logError(word, 'Meaning', 2, ['meaningRecall', 'formRecall']);
  assert.equal(word.dims.meaningRecall.status, 'Developing', 'on-target fail must still downgrade, exactly as before');
  assert.equal(word.dims.meaningRecall.fail, 1);
});

test('WordModel.logError preserves the original always-downgrade behavior when no testedDims is passed (Teaching/ErrorIntegration callers, unchanged)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = makeWordWithMnemonic(E);
  word.dims.grammar = { status: 'Achieved', success: 2, fail: 0 };
  E.WordModel.logError(word, 'Grammar', 0); // 3-arg call, exactly as Teaching/ErrorIntegration still call it
  assert.equal(word.dims.grammar.status, 'Developing');
});

/* ---- X1: runDimensionPractice's queue items name their target dim, so the coverage table's
   per-dimension Practice button credits the right dim instead of whatever recordDimForQuestion's
   type-based inference happens to land on (DIM_PRACTICE_LEVEL groups multiple dims per level). ---- */

function makeWordForDimPractice(E, word) {
  const w = E.WordModel.create({
    word, meaning: 'm', form: '', grammar: '', collocations: ['a', 'b'], contrast: 'c',
    contexts: ['x', 'y'], production: 'p', cloze: [], wordType: 'general'
  });
  w.teaching.completed = true;
  E.Storage.state.words.push(w);
  return w;
}

['formRecognition', 'semanticDiscrimination', 'grammar', 'collocation', 'guidedProduction'].forEach(dimKey => {
  test('runDimensionPractice(\'' + dimKey + '\'): grading correct credits ' + dimKey + ', not a sibling dim', () => {
    const { exports: E } = buildSandbox();
    E.Storage.load();
    const word = makeWordForDimPractice(E, dimKey.toLowerCase() + '-word');
    word.dims[dimKey].fail = 1; // matches runDimensionPractice's own eligibility filter

    // Reproduces runDimensionPractice's queue item exactly: track:'legacy', level from
    // DIM_PRACTICE_LEVEL, and (after the X1 fix) dimension: dimKey.
    const level = E.DIM_PRACTICE_LEVEL[dimKey];
    const item = { track: 'legacy', word, level, dimension: dimKey };
    const q = E.Practice.generateQuestion(item);
    E.Views.recordDimForQuestion(q, true);

    assert.equal(word.dims[dimKey].success, 1, dimKey + ' itself must be credited');

    // No sibling dim (whatever the old type-based inference would have hit instead) should move.
    const DIM_KEYS = ['formRecognition','formRecall','meaningRecognition','meaningRecall',
      'semanticDiscrimination','grammar','collocation','contextualComprehension',
      'guidedProduction','independentProduction','novelApplication'];
    DIM_KEYS.filter(k => k !== dimKey).forEach(other => {
      assert.equal(word.dims[other].success, 0, other + ' must not be touched by practicing ' + dimKey);
    });
  });
});

test('generateQuestion + recordDimForQuestion: the normal ladder (no item.dimension) still credits meaningRecognition for a level-1 recognition question', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = makeWordForDimPractice(E, 'ladder-word');
  // A plain buildDueQueue-shaped legacy item -- no dimension field, exactly as today.
  const item = { track: 'legacy', word, level: 1 };
  const q = E.Practice.generateQuestion(item);
  assert.equal(q.dimension, undefined, 'a normal ladder item must not gain a dimension field');
  E.Views.recordDimForQuestion(q, true);
  assert.equal(word.dims.meaningRecognition.success, 1);
  assert.equal(word.dims.formRecognition.success, 0);
});

test('generateQuestion + recordDimForQuestion: an FSRS-track meaningRecall review still credits both meaningRecall and formRecall (X1 fix must not touch this)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = makeWordForDimPractice(E, 'fsrs-word');
  const item = { track: 'fsrs', dimension: 'meaningRecall', word };
  const q = E.Practice.generateQuestion(item);
  E.Views.recordDimForQuestion(q, true);
  assert.equal(word.dims.meaningRecall.success, 1, 'FSRS meaningRecall must still credit the legacy meaningRecall dim');
  assert.equal(word.dims.formRecall.success, 1, 'FSRS meaningRecall must still credit the paired formRecall dim, not just meaningRecall alone');
});

/* ---- Analytics Phase A: broadened streak definition + teaching/retrieval accuracy split ---- */

function makeWord(E, word) {
  return E.WordModel.create({
    word, meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], wordType: 'general'
  });
}

// Analytics.computeStreak()/activityDates() were removed in Phase E (superseded by
// computeStreakFromActivity, which reads the single unified dailyActivity source -- see its
// own tests above). The teaching-only-day case those old tests covered is re-asserted here
// against the function that actually ships now.
test('computeStreakFromActivity: a day with only teaching>0 (no reviews at all) still counts', () => {
  const { exports: E } = buildSandbox();
  const today = '2026-06-15';
  const activity = {};
  activity[today] = { reviews: 0, correct: 0, teaching: 2, newWords: 0 };
  const result = E.computeStreakFromActivity(activity, today);
  assert.equal(result.current, 1);
});

test('accuracy split: teaching-phase attempts are excluded from headline (retrieval) accuracy but included in teaching accuracy', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'echo');
  // Teaching: 1 correct, 1 wrong -> 50% teaching accuracy, should not affect retrieval accuracy.
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 0, correct: true, phase: 'teaching' });
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 0, correct: false, phase: 'teaching' });
  // Retrieval: 3 correct, 1 wrong -> 75% retrieval accuracy.
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 2, correct: true });
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 2, correct: true });
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 3, correct: true });
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 3, correct: false });
  E.Storage.state.words.push(w);

  const html = E.Analytics.renderAchievementsSection();
  assert.match(html, /75%<\/div><div class="label">Retrieval Accuracy/, 'headline tile should reflect only levels 1-4 (non-teaching) attempts');
  assert.match(html, /50%<\/div><div class="label">Teaching Accuracy/, 'secondary tile should reflect only teaching-phase attempts');
});

test('accuracy split: a word with only teaching attempts contributes 0 retrieval attempts (no NaN / divide-by-zero)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'foxtrot');
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 0, correct: true, phase: 'teaching' });
  E.Storage.state.words.push(w);

  const html = E.Analytics.renderAchievementsSection();
  assert.match(html, /0%<\/div><div class="label">Retrieval Accuracy/);
  assert.match(html, /100%<\/div><div class="label">Teaching Accuracy/);
});

test('full-session count is tracked separately from the broadened streak', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const today = E.Utils.todayISO();
  E.Storage.state.sessionLog.push({ ts: Date.now(), date: today, summary: {} });

  const html = E.Analytics.renderAchievementsSection();
  assert.match(html, /1<\/div><div class="label">Full Sessions/);
});

/* ---- Analytics Phase B: Learning Health pure aggregations over state.fsrsReviewLog ---- */

function reviewEntry(overrides) {
  return Object.assign({
    ts: Date.now(), wordId: 'w1', dimension: 'recognition', rating: 'good',
    predictedR: 0.8, outcome: true, stabilityBefore: 1, stabilityAfter: 2,
    difficultyBefore: 5, difficultyAfter: 5, elapsedDays: 1, scheduledDays: 3
  }, overrides || {});
}

test('computeCalibration: empty log returns all 4 buckets with n=0 and actual=null', () => {
  const { exports: E } = buildSandbox();
  const buckets = E.computeCalibration([]);
  assert.equal(buckets.length, 4);
  buckets.forEach(b => { assert.equal(b.n, 0); assert.equal(b.actual, null); });
});

test('computeCalibration: all-same-prediction log lands entirely in one bucket with the right actual rate', () => {
  const { exports: E } = buildSandbox();
  const log = [
    reviewEntry({ predictedR: 0.8, outcome: true }),
    reviewEntry({ predictedR: 0.8, outcome: true }),
    reviewEntry({ predictedR: 0.8, outcome: false }),
    reviewEntry({ predictedR: 0.8, outcome: true })
  ];
  const buckets = E.computeCalibration(log);
  const bucket79 = buckets.find(b => b.label === '0.7–0.9');
  assert.equal(bucket79.n, 4);
  assert.equal(bucket79.actual, 0.75);
  buckets.filter(b => b.label !== '0.7–0.9').forEach(b => assert.equal(b.n, 0));
});

test('computeCalibration: predictedR===1 lands in the top bucket, not dropped', () => {
  const { exports: E } = buildSandbox();
  const buckets = E.computeCalibration([reviewEntry({ predictedR: 1, outcome: true })]);
  const top = buckets.find(b => b.label === '0.9–1.0');
  assert.equal(top.n, 1);
});

test('computeBrier: empty log returns { value:null, n:0 } rather than NaN', () => {
  const { exports: E } = buildSandbox();
  const emptyBrier = E.computeBrier([]);
  assert.equal(emptyBrier.value, null);
  assert.equal(emptyBrier.n, 0);
});

test('computeBrier: an all-correct log scores (1-predictedR)^2 averaged, not 0', () => {
  const { exports: E } = buildSandbox();
  const log = [reviewEntry({ predictedR: 0.6, outcome: true }), reviewEntry({ predictedR: 0.9, outcome: true })];
  const result = E.computeBrier(log);
  const expected = ((0.6 - 1) ** 2 + (0.9 - 1) ** 2) / 2;
  assert.ok(Math.abs(result.value - expected) < 1e-9);
  assert.equal(result.n, 2);
});

test('computeBrier: an all-wrong log scores predictedR^2 averaged', () => {
  const { exports: E } = buildSandbox();
  const log = [reviewEntry({ predictedR: 0.6, outcome: false }), reviewEntry({ predictedR: 0.9, outcome: false })];
  const result = E.computeBrier(log);
  const expected = (0.6 ** 2 + 0.9 ** 2) / 2;
  assert.ok(Math.abs(result.value - expected) < 1e-9);
});

test('computeBrier: entries missing predictedR/outcome are excluded rather than poisoning the mean with NaN', () => {
  const { exports: E } = buildSandbox();
  const log = [reviewEntry({ predictedR: 0.5, outcome: true }), { ts: Date.now(), wordId: 'w2', dimension: 'recognition' }];
  const result = E.computeBrier(log);
  assert.equal(result.n, 1);
  assert.ok(!Number.isNaN(result.value));
});

test('computeStabilityGrowth: a dimension with exactly 1 data point still returns that 1 point (hiding is the render layer\'s job, not this function\'s)', () => {
  const { exports: E } = buildSandbox();
  const log = [reviewEntry({ dimension: 'production', wordId: 'w1', stabilityAfter: 3 })];
  const growth = E.computeStabilityGrowth(log);
  assert.equal(growth.production.length, 1);
  assert.equal(growth.production[0].n, 1);
  assert.equal(growth.production[0].median, 3);
});

test('computeStabilityGrowth: median (not mean) across words at the same review index resists one runaway outlier', () => {
  const { exports: E } = buildSandbox();
  const t0 = Date.now();
  const log = [
    reviewEntry({ wordId: 'w1', dimension: 'recognition', stabilityAfter: 5, ts: t0 }),
    reviewEntry({ wordId: 'w2', dimension: 'recognition', stabilityAfter: 6, ts: t0 + 1 }),
    reviewEntry({ wordId: 'w3', dimension: 'recognition', stabilityAfter: 1000, ts: t0 + 2 }) // outlier
  ];
  const growth = E.computeStabilityGrowth(log);
  assert.equal(growth.recognition[0].n, 3);
  assert.equal(growth.recognition[0].median, 6, 'median of [5,6,1000] is 6, not skewed by the outlier');
});

test('computeStabilityGrowth: orders each word\'s own reviews by ts to build its index, independent of push order', () => {
  const { exports: E } = buildSandbox();
  const t0 = Date.now();
  // Pushed out of chronological order -- function must sort by ts per word before indexing.
  const log = [
    reviewEntry({ wordId: 'w1', dimension: 'recognition', stabilityAfter: 20, ts: t0 + 10 }),
    reviewEntry({ wordId: 'w1', dimension: 'recognition', stabilityAfter: 10, ts: t0 })
  ];
  const growth = E.computeStabilityGrowth(log);
  assert.equal(growth.recognition[0].median, 10, 'first review by ts should be index 1');
  assert.equal(growth.recognition[1].median, 20, 'second review by ts should be index 2');
});

test('computeRetentionByInterval: empty log returns all 6 buckets with n=0 and rate=null', () => {
  const { exports: E } = buildSandbox();
  const buckets = E.computeRetentionByInterval([]);
  assert.equal(buckets.length, 6);
  buckets.forEach(b => { assert.equal(b.n, 0); assert.equal(b.rate, null); });
});

test('computeRetentionByInterval: bucket boundaries are half-open (elapsedDays exactly 1 goes to the 1-3d bucket, not 0-1d)', () => {
  const { exports: E } = buildSandbox();
  const log = [reviewEntry({ elapsedDays: 1, outcome: true }), reviewEntry({ elapsedDays: 30, outcome: true })];
  const buckets = E.computeRetentionByInterval(log);
  assert.equal(buckets.find(b => b.label === '0–1d').n, 0);
  assert.equal(buckets.find(b => b.label === '1–3d').n, 1);
  assert.equal(buckets.find(b => b.label === '14–30d').n, 0);
  assert.equal(buckets.find(b => b.label === '30d+').n, 1);
});

test('computeRetentionByInterval: an all-wrong bucket reports rate 0, distinct from a no-data bucket reporting null', () => {
  const { exports: E } = buildSandbox();
  const log = [reviewEntry({ elapsedDays: 0.5, outcome: false }), reviewEntry({ elapsedDays: 0.5, outcome: false })];
  const buckets = E.computeRetentionByInterval(log);
  const bucket01 = buckets.find(b => b.label === '0–1d');
  assert.equal(bucket01.rate, 0);
  assert.equal(bucket01.n, 2);
  const bucket13 = buckets.find(b => b.label === '1–3d');
  assert.equal(bucket13.rate, null);
});

test('computeFirstPostTeachingRetention: empty word list returns n=0, y=0, rate=null (tile should hide, not show 0%)', () => {
  const { exports: E } = buildSandbox();
  const empty = E.computeFirstPostTeachingRetention([]);
  assert.equal(empty.n, 0);
  assert.equal(empty.y, 0);
  assert.equal(empty.rate, null);
});

test('computeFirstPostTeachingRetention: a word with teaching completed but no non-teaching attempt yet is excluded from the denominator', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'golf');
  w.teaching.completed = true;
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 0, correct: true, phase: 'teaching' });
  const result = E.computeFirstPostTeachingRetention([w]);
  assert.equal(result.n, 0);
  assert.equal(result.y, 0);
  assert.equal(result.rate, null);
});

test('computeFirstPostTeachingRetention: a word not taught at all is excluded even with non-teaching history', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'hotel');
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 2, correct: true });
  const result = E.computeFirstPostTeachingRetention([w]);
  assert.equal(result.n, 0);
  assert.equal(result.y, 0);
  assert.equal(result.rate, null);
});

test('computeFirstPostTeachingRetention: uses the FIRST non-teaching attempt, not the most recent, for correctness', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'india');
  w.teaching.completed = true;
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 0, correct: true, phase: 'teaching' });
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 2, correct: false }); // first non-teaching attempt: wrong
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 2, correct: true });  // later attempt: right, must not count
  const result = E.computeFirstPostTeachingRetention([w]);
  assert.equal(result.n, 0);
  assert.equal(result.y, 1);
  assert.equal(result.rate, 0);
});

test('computeFirstPostTeachingRetention: mixed set of words produces the right n/y/rate', () => {
  const { exports: E } = buildSandbox();
  const success = makeWord(E, 'juliet');
  success.teaching.completed = true;
  success.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 0, correct: true, phase: 'teaching' });
  success.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 2, correct: true });

  const failure = makeWord(E, 'kilo');
  failure.teaching.completed = true;
  failure.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 0, correct: true, phase: 'teaching' });
  failure.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 2, correct: false });

  const notYetPracticed = makeWord(E, 'lima');
  notYetPracticed.teaching.completed = true;

  const result = E.computeFirstPostTeachingRetention([success, failure, notYetPracticed]);
  assert.equal(result.n, 1);
  assert.equal(result.y, 2);
  assert.equal(result.rate, 0.5);
});

/* ---- Analytics Phase C: dailyActivity/achievements/milestones/firstMasteryAt infrastructure ---- */

test('DailyActivity.bump: accumulates across repeated calls on the same date, and on separate dates independently', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.DailyActivity.bump('2026-01-05', { reviews: 2, correct: 1 });
  E.DailyActivity.bump('2026-01-05', { reviews: 1, teaching: 3 });
  E.DailyActivity.bump('2026-01-06', { newWords: 1 });
  const jan5 = E.Storage.state.dailyActivity['2026-01-05'];
  const jan6 = E.Storage.state.dailyActivity['2026-01-06'];
  assert.equal(jan5.reviews, 3);
  assert.equal(jan5.correct, 1);
  assert.equal(jan5.teaching, 3);
  assert.equal(jan5.newWords, 0);
  assert.equal(jan6.newWords, 1);
  assert.equal(jan6.reviews, 0);
});

test('DailyActivity.bump: a falsy date or missing deltas is a no-op, not a crash', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  assert.doesNotThrow(() => E.DailyActivity.bump(null, { reviews: 1 }));
  assert.doesNotThrow(() => E.DailyActivity.bump('2026-01-05', null));
  assert.deepEqual(Object.keys(E.Storage.state.dailyActivity), []);
});

test('backfillDailyActivity: buckets a teaching-phase history entry under `teaching`, a non-teaching entry under `reviews`/`correct`, and word.created under `newWords`, on their own dates', () => {
  const { exports: E } = buildSandbox();
  const raw = {
    version: 2,
    words: [{
      id: 'w1', word: 'alpha', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
      contexts: [], production: '', cloze: [], created: '2026-02-01',
      srs: { interval: 1, nextReview: '2026-02-01', easeStreak: 0, lastPracticed: null },
      levelState: { level: 2 }, errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} },
      history: [
        { ts: 1, date: '2026-02-02', level: 0, correct: true, phase: 'teaching' },
        { ts: 2, date: '2026-02-03', level: 2, correct: true },
        { ts: 3, date: '2026-02-03', level: 2, correct: false }
      ]
    }],
    errorLog: [], settings: { examDate: null, theme: 'system' },
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  };
  E.Storage.state = E.validateAndRepair(raw);
  E.Storage.backfillDailyActivity();
  assert.equal(E.Storage.state.dailyActivity['2026-02-01'].newWords, 1);
  assert.equal(E.Storage.state.dailyActivity['2026-02-02'].teaching, 1);
  assert.equal(E.Storage.state.dailyActivity['2026-02-03'].reviews, 2);
  assert.equal(E.Storage.state.dailyActivity['2026-02-03'].correct, 1);
});

test('backfillDailyActivity: running it twice does not double-count (one-shot guard)', () => {
  const { exports: E } = buildSandbox();
  const raw = {
    version: 2,
    words: [{
      id: 'w1', word: 'bravo', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
      contexts: [], production: '', cloze: [], created: '2026-02-10',
      srs: { interval: 1, nextReview: '2026-02-10', easeStreak: 0, lastPracticed: null },
      levelState: { level: 2 }, errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} },
      history: [{ ts: 1, date: '2026-02-10', level: 2, correct: true }]
    }],
    errorLog: [], settings: { examDate: null, theme: 'system' },
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  };
  // Bypass Storage.load() (which would run the backfill itself against localStorage-sourced
  // state) so this test controls exactly when backfillDailyActivity() first runs.
  E.Storage.state = E.validateAndRepair(raw);
  E.Storage.backfillDailyActivity();
  const firstPassCount = E.Storage.state.dailyActivity['2026-02-10'].reviews;
  const backfilledAt = E.Storage.state.dailyActivityBackfilledAt;
  assert.equal(firstPassCount, 1);
  assert.ok(backfilledAt);

  E.Storage.backfillDailyActivity(); // second call -- guard should make this a no-op
  assert.equal(E.Storage.state.dailyActivity['2026-02-10'].reviews, 1, 'reviews must not double from 1 to 2');
  assert.equal(E.Storage.state.dailyActivityBackfilledAt, backfilledAt, 'the guard timestamp itself must not be touched on the no-op call');
});

test('validateAndRepair accepts a save missing all five Phase C fields (pre-Phase-C save) without throwing, and defaults them', () => {
  const { exports: E } = buildSandbox();
  const legacy = {
    version: 2,
    words: [{ id: 'w1', word: 'legacy', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '', contexts: [], production: '', cloze: [], created: '2025-01-01', srs: { interval: 1, nextReview: '2025-01-01', easeStreak: 0, lastPracticed: null }, levelState: { level: 2 }, history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general', teaching: { completed: false, currentStep: 1, errorHistory: [], stepResults: {} } }],
    errorLog: [], settings: { examDate: null, theme: 'system' }, sessionLog: [], writingLog: [], examLog: [], practiceSession: null
    // no dailyActivity, achievements, milestones, dailyActivityBackfilledAt; word has no firstMasteryAt
  };
  const repaired = E.validateAndRepair(legacy);
  assert.equal(Object.keys(repaired.dailyActivity).length, 0);
  assert.equal(Object.keys(repaired.achievements).length, 0);
  assert.equal(repaired.milestones.length, 0);
  assert.equal(repaired.dailyActivityBackfilledAt, null);
  assert.equal(repaired.words[0].firstMasteryAt, null);
});

test('validateAndRepair does not crash on garbage/partial Phase C field values', () => {
  const { exports: E } = buildSandbox();
  const garbage = {
    version: 2, words: [], errorLog: [], settings: {}, sessionLog: [], writingLog: [], examLog: [], practiceSession: null,
    dailyActivity: { '2026-01-01': { reviews: 'not a number', correct: null }, 'bad-bucket': 'not even an object', ok: null },
    achievements: { first_word: { unlockedAt: 'garbage' }, scholar: 'not an object', good_one: { unlockedAt: 123 } },
    milestones: [{ ts: 1, type: 'first_word' }, 'not an object', { ts: 'nope', type: 'x' }, { type: 'missing_ts' }],
    dailyActivityBackfilledAt: 'garbage'
  };
  assert.doesNotThrow(() => E.validateAndRepair(garbage));
  const repaired = E.validateAndRepair(garbage);
  assert.equal(repaired.dailyActivity['2026-01-01'].reviews, 0);
  assert.equal(repaired.dailyActivity['2026-01-01'].correct, 0);
  assert.equal(repaired.dailyActivity.ok, undefined, 'a non-object bucket value should be skipped, not crash');
  assert.equal(repaired.achievements.first_word.unlockedAt, null, 'a garbage unlockedAt should fall back to null');
  assert.equal(repaired.achievements.good_one.unlockedAt, 123);
  assert.equal(repaired.milestones.length, 1, 'only the one well-formed milestone entry should survive');
  assert.equal(repaired.dailyActivityBackfilledAt, null);
});

test("Milestones.append('first_word', ...) fires only once even if called multiple times directly", () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Milestones.append('first_word', { wordId: 'w1' });
  E.Milestones.append('first_word', { wordId: 'w2' });
  E.Milestones.append('first_word', { wordId: 'w3' });
  const firstWordEntries = E.Storage.state.milestones.filter(m => m.type === 'first_word');
  assert.equal(firstWordEntries.length, 1);
  assert.equal(firstWordEntries[0].wordId, 'w1', 'the first call should be the one that sticks');
});

test('WordModel.create appends the first_word milestone only for the very first word ever created', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const fields = { word: 'x', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '', contexts: [], production: '', cloze: [], wordType: 'general' };
  const w1 = E.WordModel.create(fields);
  E.Storage.state.words.push(w1);
  const w2 = E.WordModel.create(Object.assign({}, fields, { word: 'y' }));
  E.Storage.state.words.push(w2);
  const firstWordEntries = E.Storage.state.milestones.filter(m => m.type === 'first_word');
  assert.equal(firstWordEntries.length, 1);
  assert.equal(firstWordEntries[0].wordId, w1.id);
});

test('WordModel.create does not crash when Storage.state has not been loaded yet (no first_word milestone either, since there is nothing to compare against)', () => {
  const { exports: E } = buildSandbox();
  const fields = { word: 'x', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '', contexts: [], production: '', cloze: [], wordType: 'general' };
  assert.doesNotThrow(() => E.WordModel.create(fields));
});

function makeStableWord(E, word) {
  const w = makeWord(E, word);
  w.teaching.completed = true;
  w.levelState.level = 3;
  w.srs.interval = 10;
  for (let i = 0; i < 5; i++) w.history.push({ ts: i, date: '2026-03-0' + (i + 1), level: 2, correct: true });
  return w;
}

test('WordModel.checkFirstMastery: sets firstMasteryAt and appends a first_mastery milestone the first time a word reaches Stable', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeStableWord(E, 'charlie');
  assert.equal(E.WordModel.computeMastery(w), 'Stable');
  E.WordModel.checkFirstMastery(w);
  assert.ok(w.firstMasteryAt);
  const entries = E.Storage.state.milestones.filter(m => m.type === 'first_mastery' && m.wordId === w.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].detail, 'Stable');
});

test('WordModel.checkFirstMastery: set-once -- a word that wobbles Stable -> Unstable -> Stable keeps its ORIGINAL firstMasteryAt and does not append a second milestone', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeStableWord(E, 'delta');
  E.WordModel.checkFirstMastery(w);
  const originalAt = w.firstMasteryAt;
  assert.ok(originalAt);

  // Wobble down to Unstable: recent failures in the last-5 window.
  w.history.push({ ts: 10, date: '2026-03-06', level: 2, correct: false });
  w.history.push({ ts: 11, date: '2026-03-07', level: 2, correct: false });
  assert.equal(E.WordModel.computeMastery(w), 'Unstable');
  E.WordModel.checkFirstMastery(w); // should no-op: firstMasteryAt already set
  assert.equal(w.firstMasteryAt, originalAt);

  // Wobble back up to Stable.
  for (let i = 12; i < 17; i++) w.history.push({ ts: i, date: '2026-03-08', level: 2, correct: true });
  assert.equal(E.WordModel.computeMastery(w), 'Stable');
  E.WordModel.checkFirstMastery(w);
  assert.equal(w.firstMasteryAt, originalAt, 'firstMasteryAt must stay at the ORIGINAL date, not update to the second Stable crossing');
  const entries = E.Storage.state.milestones.filter(m => m.type === 'first_mastery' && m.wordId === w.id);
  assert.equal(entries.length, 1, 'still only one first_mastery milestone for this word, despite two Stable crossings');
});

test('WordModel.checkFirstMastery: a word that never reaches Stable/Exam Ready is left alone (no firstMasteryAt, no milestone)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'echo');
  w.teaching.completed = true;
  E.WordModel.checkFirstMastery(w);
  assert.equal(w.firstMasteryAt, null);
  assert.equal(E.Storage.state.milestones.filter(m => m.type === 'first_mastery').length, 0);
});

test('Achievements.evaluate: sets unlockedAt only the first time a threshold is crossed, and never overwrites it on later re-evaluations', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const ctxUnlocked = { taughtCount: 1, examReadyCount: 0, streak: 0, errorLogCount: 0, writingSessions: 0 };
  E.Achievements.evaluate(ctxUnlocked);
  assert.ok(E.Storage.state.achievements.first_word.unlockedAt);
  const firstAt = E.Storage.state.achievements.first_word.unlockedAt;

  E.Achievements.evaluate(ctxUnlocked); // re-evaluate with the same (still-unlocked) ctx
  assert.equal(E.Storage.state.achievements.first_word.unlockedAt, firstAt, 'must not refresh the timestamp on re-evaluation');
});

test('Achievements.evaluate: a still-locked achievement gets no entry at all', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const ctxAllLocked = { taughtCount: 0, examReadyCount: 0, streak: 0, errorLogCount: 0, writingSessions: 0 };
  E.Achievements.evaluate(ctxAllLocked);
  assert.equal(E.Storage.state.achievements.first_word, undefined);
});

test('ErrorIntegration.recordProductionSuccess bumps dailyActivity reviews+correct for today (a graded attempt outside Practice.handleGraded)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'foxtrot');
  const today = E.Utils.todayISO();
  E.ErrorIntegration.recordProductionSuccess(w, 'timed-exam');
  assert.equal(E.Storage.state.dailyActivity[today].reviews, 1);
  assert.equal(E.Storage.state.dailyActivity[today].correct, 1);
});

test('ErrorIntegration.recordProductionError bumps dailyActivity reviews (not correct) for today', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'golf');
  const today = E.Utils.todayISO();
  E.ErrorIntegration.recordProductionError(w, 'Meaning', 'timed-exam');
  assert.equal(E.Storage.state.dailyActivity[today].reviews, 1);
  assert.equal(E.Storage.state.dailyActivity[today].correct, 0);
});

/* ---- Analytics Phase D: "This Week" pure aggregations ---- */

test('computeWeekOverWeek: an empty prior week yields priorWeekEmpty=true and deltas=null (no "up from nothing")', () => {
  const { exports: E } = buildSandbox();
  const today = '2026-06-15';
  const activity = {};
  activity[today] = { reviews: 10, correct: 8, teaching: 0, newWords: 1 };
  activity[E.Utils.addDays(today, -3)] = { reviews: 5, correct: 5, teaching: 0, newWords: 0 };
  const result = E.computeWeekOverWeek(activity, today);
  assert.equal(result.priorWeekEmpty, true);
  assert.equal(result.deltas, null);
  assert.equal(result.thisWeek.reviews, 15);
  assert.equal(result.thisWeek.correct, 13);
  assert.equal(result.thisWeek.accuracy, 87);
  assert.equal(result.priorWeek.reviews, 0);
});

test('computeWeekOverWeek: a non-empty prior week produces real deltas, correctly separated from this week by the 7-day boundary', () => {
  const { exports: E } = buildSandbox();
  const today = '2026-06-15';
  const activity = {};
  activity[today] = { reviews: 20, correct: 20, teaching: 0, newWords: 2 };
  activity[E.Utils.addDays(today, -7)] = { reviews: 10, correct: 5, teaching: 0, newWords: 1 };
  const result = E.computeWeekOverWeek(activity, today);
  assert.equal(result.priorWeekEmpty, false);
  assert.equal(result.thisWeek.reviews, 20);
  assert.equal(result.priorWeek.reviews, 10);
  assert.equal(result.deltas.reviews, 10);
  assert.equal(result.deltas.newWords, 1);
  assert.equal(result.deltas.accuracy, 100 - 50);
});

test('computeStreakFromActivity: a gap breaks the streak, and the longest historical run can exceed the current one', () => {
  const { exports: E } = buildSandbox();
  const today = '2026-06-15';
  const activity = {};
  // Older 4-day run: today-10..today-7.
  [10, 9, 8, 7].forEach(n => { activity[E.Utils.addDays(today, -n)] = { reviews: 1, correct: 1, teaching: 0, newWords: 0 }; });
  // Gap: today-6..today-2 have no activity at all.
  // Current 2-day run: today-1, today.
  [1, 0].forEach(n => { activity[E.Utils.addDays(today, -n)] = { reviews: 1, correct: 1, teaching: 0, newWords: 0 }; });
  const result = E.computeStreakFromActivity(activity, today);
  assert.equal(result.current, 2);
  assert.equal(result.longest, 4);
});

test('computeStreakFromActivity: current streak is 0 when neither today nor yesterday has activity', () => {
  const { exports: E } = buildSandbox();
  const today = '2026-06-15';
  const activity = {};
  activity[E.Utils.addDays(today, -5)] = { reviews: 3, correct: 3, teaching: 0, newWords: 0 };
  const result = E.computeStreakFromActivity(activity, today);
  assert.equal(result.current, 0);
  assert.equal(result.longest, 1);
});

test('computeHeatmapCells: bucket boundaries are 0 / 1-5 / 6-15 / 16+, and cells come back oldest-first for the requested window', () => {
  const { exports: E } = buildSandbox();
  const today = '2026-06-15';
  const activity = {};
  const withReviews = (n, reviews) => { activity[E.Utils.addDays(today, -n)] = { reviews, correct: 0, teaching: 0, newWords: 0 }; };
  withReviews(5, 0); withReviews(4, 1); withReviews(3, 5); withReviews(2, 6); withReviews(1, 15); withReviews(0, 16);
  const cells = E.computeHeatmapCells(activity, today, 6);
  assert.equal(cells.length, 6);
  assert.equal(cells[0].date, E.Utils.addDays(today, -5), 'first cell should be the oldest day in the window');
  assert.equal(cells[5].date, today, 'last cell should be today');
  const levelByOffset = {};
  cells.forEach(c => { levelByOffset[E.Utils.diffDays(c.date, today)] = c.level; });
  assert.equal(levelByOffset[5], 0); // 0 reviews
  assert.equal(levelByOffset[4], 1); // 1 review
  assert.equal(levelByOffset[3], 1); // 5 reviews (top of the 1-5 bucket)
  assert.equal(levelByOffset[2], 2); // 6 reviews (bottom of the 6-15 bucket)
  assert.equal(levelByOffset[1], 2); // 15 reviews (top of the 6-15 bucket)
  assert.equal(levelByOffset[0], 3); // 16 reviews
});

test('computeHighestSingleDay: returns null when every day is zero, rather than a fabricated best', () => {
  const { exports: E } = buildSandbox();
  assert.equal(E.computeHighestSingleDay({}), null);
  assert.equal(E.computeHighestSingleDay({ '2026-01-01': { reviews: 0, correct: 0, teaching: 0, newWords: 0 } }), null);
});

test('computeHighestSingleDay: picks the date with the most reviews', () => {
  const { exports: E } = buildSandbox();
  const best = E.computeHighestSingleDay({
    '2026-01-01': { reviews: 5, correct: 5, teaching: 0, newWords: 0 },
    '2026-01-02': { reviews: 12, correct: 10, teaching: 0, newWords: 0 },
    '2026-01-03': { reviews: 3, correct: 3, teaching: 0, newWords: 0 }
  });
  assert.equal(best.date, '2026-01-02');
  assert.equal(best.reviews, 12);
});

test('computeFastestMastery: a word with firstMasteryAt===null is excluded, not treated as instant (0-day) mastery', () => {
  const { exports: E } = buildSandbox();
  const noMastery = makeWord(E, 'mike');
  noMastery.created = '2026-01-01';
  noMastery.firstMasteryAt = null;
  const slow = makeWord(E, 'november');
  slow.created = '2026-01-01';
  slow.firstMasteryAt = new Date('2026-01-31T00:00:00.000Z').getTime(); // 30 days
  const fast = makeWord(E, 'oscar');
  fast.created = '2026-01-01';
  fast.firstMasteryAt = new Date('2026-01-06T00:00:00.000Z').getTime(); // 5 days
  const best = E.computeFastestMastery([noMastery, slow, fast]);
  assert.equal(best.word, 'oscar');
  assert.equal(Math.round(best.days), 5);
});

test('computeFastestMastery: returns null when no word has reached mastery yet', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'papa');
  assert.equal(E.computeFastestMastery([w]), null);
  assert.equal(E.computeFastestMastery([]), null);
});

test('relativeDate: today, yesterday, and N days ago are worded distinctly', () => {
  const { exports: E } = buildSandbox();
  const now = new Date('2026-06-15T12:00:00.000Z').getTime();
  assert.equal(E.relativeDate(now, now), 'today');
  assert.equal(E.relativeDate(now - 86400000, now), 'yesterday');
  assert.equal(E.relativeDate(now - 3 * 86400000, now), '3 days ago');
});

test('Analytics.renderMilestoneWall: orders milestones most-recent-first regardless of push order', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w1 = makeWord(E, 'quebec'); E.Storage.state.words.push(w1);
  const w2 = makeWord(E, 'romeo'); E.Storage.state.words.push(w2);
  const w3 = makeWord(E, 'sierra'); E.Storage.state.words.push(w3);
  // Pushed oldest-first, out of display order on purpose.
  E.Milestones.append('first_mastery', { wordId: w1.id, detail: 'Stable' });
  E.Storage.state.milestones[E.Storage.state.milestones.length - 1].ts = 1000;
  E.Milestones.append('first_mastery', { wordId: w2.id, detail: 'Stable' });
  E.Storage.state.milestones[E.Storage.state.milestones.length - 1].ts = 3000;
  E.Milestones.append('first_mastery', { wordId: w3.id, detail: 'Stable' });
  E.Storage.state.milestones[E.Storage.state.milestones.length - 1].ts = 2000;

  const html = E.Analytics.renderMilestoneWall();
  const idxRomeo = html.indexOf('romeo');   // ts 3000, newest
  const idxSierra = html.indexOf('sierra'); // ts 2000, middle
  const idxQuebec = html.indexOf('quebec'); // ts 1000, oldest
  assert.ok(idxRomeo > -1 && idxSierra > -1 && idxQuebec > -1);
  assert.ok(idxRomeo < idxSierra, 'romeo (newest) should render before sierra (middle)');
  assert.ok(idxSierra < idxQuebec, 'sierra (middle) should render before quebec (oldest)');
});

/* ---- Analytics Phase E: everAchievedAt, lapse rate, coverage table, Practice routing ---- */

test('DimModel.record: sets dims[k].everAchievedAt the first time a dim reaches Achieved', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'tango');
  assert.equal(w.dims.grammar.everAchievedAt, null, 'sanity: freshDims starts null');
  E.DimModel.record(w, 'grammar', true); // success 1 -> Developing
  assert.equal(w.dims.grammar.status, 'Developing');
  assert.equal(w.dims.grammar.everAchievedAt, null, 'not Achieved yet, so not stamped yet');
  E.DimModel.record(w, 'grammar', true); // success 2 -> Achieved
  assert.equal(w.dims.grammar.status, 'Achieved');
  assert.ok(w.dims.grammar.everAchievedAt, 'stamped the moment it first reaches Achieved');
});

test('DimModel.record: everAchievedAt is set-once -- a wobble Achieved -> Developing -> Achieved keeps the ORIGINAL timestamp', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'uniform');
  E.DimModel.record(w, 'collocation', true);
  E.DimModel.record(w, 'collocation', true); // -> Achieved
  const originalAt = w.dims.collocation.everAchievedAt;
  assert.ok(originalAt);

  E.DimModel.record(w, 'collocation', false); // lapse -> Developing
  assert.equal(w.dims.collocation.status, 'Developing');
  assert.equal(w.dims.collocation.everAchievedAt, originalAt, 'a lapse must not clear the historical stamp');

  E.DimModel.record(w, 'collocation', true);
  E.DimModel.record(w, 'collocation', true); // success count already >=2 -> back to Achieved immediately
  assert.equal(w.dims.collocation.status, 'Achieved');
  assert.equal(w.dims.collocation.everAchievedAt, originalAt, 'must NOT update to the second Achieved crossing');
});

test('WordModel.resetDim preserves everAchievedAt across a reset (so ErrorIntegration-triggered lapses still count as matured)', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'victor');
  E.DimModel.record(w, 'independentProduction', true);
  E.DimModel.record(w, 'independentProduction', true);
  const originalAt = w.dims.independentProduction.everAchievedAt;
  assert.ok(originalAt);

  E.WordModel.resetDim(w, 'independentProduction');
  assert.equal(w.dims.independentProduction.status, 'Not assessed');
  // 782e5da: success is preserved as a lifetime tally and snapshotted into successAtReset,
  // so every "successes since the last reset" reader compares (success - successAtReset).
  assert.equal(w.dims.independentProduction.success, 2);
  assert.equal(w.dims.independentProduction.successAtReset, 2);
  assert.equal(w.dims.independentProduction.everAchievedAt, originalAt, 'everAchievedAt is historical, not a mirror of current status');

  // And the reset genuinely costs the dim its progress: it takes two fresh successes to
  // re-achieve, not one off the back of the preserved lifetime count.
  E.DimModel.record(w, 'independentProduction', true);
  assert.equal(w.dims.independentProduction.status, 'Developing', 'one post-reset success is not enough');
  E.DimModel.record(w, 'independentProduction', true);
  assert.equal(w.dims.independentProduction.status, 'Achieved', 'two post-reset successes re-achieve the dim');
});

test('updateLadder ignores teaching-phase entries when checking for a level promotion', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'zulu');
  w.levelState.level = 3;
  // Two correct entries AT level 3 but tagged teaching -- these must not count toward the
  // "two recent correct at this level" promotion rule, matching the last5 filter two lines
  // above it and computeMastery's convention.
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 3, correct: true, phase: 'teaching' });
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 3, correct: true, phase: 'teaching' });

  E.WordModel.updateLadder(w, 3, true);
  assert.equal(w.levelState.level, 3, 'teaching entries must not promote the ladder');

  // Two real retrieval entries at level 3 do promote it.
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 3, correct: true });
  w.history.push({ ts: Date.now(), date: E.Utils.todayISO(), level: 3, correct: true });
  E.WordModel.updateLadder(w, 3, true);
  assert.equal(w.levelState.level, 4, 'two real correct attempts at the current level still promote');
});

test('logAttempt gates firstRetrieval on the resolved phase, so an attemptsPhase-only teaching attempt is not stamped as the first retrieval', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'yankee');
  E.Storage.state.words.push(w);
  // attemptsPhase without a matching entry.phase -- the exact drift case logAttempt's own
  // comment calls out for the DailyActivity bump. firstRetrieval must honor it too.
  E.WordModel.logAttempt(w, 0, true, { attemptsPhase: 'teaching' });
  assert.equal(w.firstRetrieval, null, 'a teaching attempt must not become the first retrieval');

  // A genuine retrieval still stamps it.
  E.WordModel.logAttempt(w, 2, true, { attemptsPhase: 'practice' });
  assert.ok(w.firstRetrieval, 'a non-teaching attempt still sets firstRetrieval');
});

test('repairDims clamps successAtReset to success, so a corrupted save cannot strand a dim below the Achieved threshold', () => {
  const { exports: E } = buildSandbox();
  // successAtReset > success is not producible by resetDim (it snapshots the current success),
  // so this only arises from a hand-edited or corrupted save -- but unclamped it makes
  // (success - successAtReset) negative and the dim needs 6 successes to re-achieve, not 2.
  const w = E.repairWord({
    id: 'w1', word: 'clamp', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], created: '2025-01-01', history: [], errorCounts: {},
    lastClozeIndex: -1, wordType: 'general',
    teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} },
    dims: { grammar: { status: 'Developing', success: 1, fail: 0, successAtReset: 5 } }
  });
  assert.equal(w.dims.grammar.success, 1);
  assert.equal(w.dims.grammar.successAtReset, 1, 'successAtReset must be clamped down to the success count');

  E.DimModel.record(w, 'grammar', true);
  assert.equal(w.dims.grammar.status, 'Developing', 'one success since the repaired reset point');
  E.DimModel.record(w, 'grammar', true);
  assert.equal(w.dims.grammar.status, 'Achieved', 'two successes must reach Achieved, not six');
});

test('repairDims accepts a save missing everAchievedAt entirely (pre-Phase-E) without throwing, and defaults it to null even for an Achieved dim', () => {
  const { exports: E } = buildSandbox();
  const raw = { grammar: { status: 'Achieved', success: 4, fail: 0 } }; // no everAchievedAt key at all
  const repaired = E.validateAndRepair({ version: 2, words: [{ id: 'w1', word: 'x', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '', contexts: [], production: '', cloze: [], created: '2025-01-01', srs: { interval: 1, nextReview: '2025-01-01', easeStreak: 0, lastPracticed: null }, levelState: { level: 2 }, history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general', teaching: { completed: false, currentStep: 1, errorHistory: [], stepResults: {} }, dims: raw }], errorLog: [], settings: { examDate: null, theme: 'system' }, sessionLog: [], writingLog: [], examLog: [], practiceSession: null });
  assert.equal(repaired.words[0].dims.grammar.status, 'Achieved', 'status itself is preserved');
  assert.equal(repaired.words[0].dims.grammar.everAchievedAt, null, 'not backfilled -- starts null per Phase C\'s firstMasteryAt precedent');
});

test('computeLapseRates: a dimension with matured===0 reports rate=null, not a divide-by-zero', () => {
  const { exports: E } = buildSandbox();
  const w = makeWord(E, 'whiskey'); // freshDims, nothing ever Achieved
  const rates = E.computeLapseRates([w]);
  assert.equal(rates.length, 11);
  rates.forEach(r => { assert.equal(r.matured, 0); assert.equal(r.rate, null); assert.equal(r.lapsed, 0); });
});

test('computeLapseRates: correctly separates a lapsed dim from one still Achieved and one never touched', () => {
  const { exports: E } = buildSandbox();
  const lapsedWord = makeWord(E, 'xray');
  E.DimModel.record(lapsedWord, 'grammar', true); E.DimModel.record(lapsedWord, 'grammar', true);
  E.DimModel.record(lapsedWord, 'grammar', false); // Achieved -> Developing, everAchievedAt stays set

  const stillAchievedWord = makeWord(E, 'yankee');
  E.DimModel.record(stillAchievedWord, 'grammar', true); E.DimModel.record(stillAchievedWord, 'grammar', true);

  const untouchedWord = makeWord(E, 'zulu'); // dims.grammar never touched

  const rates = E.computeLapseRates([lapsedWord, stillAchievedWord, untouchedWord]);
  const grammar = rates.find(r => r.key === 'grammar');
  assert.equal(grammar.matured, 2, 'only the two words that ever reached Achieved count as matured');
  assert.equal(grammar.lapsed, 1, 'only the one currently not-Achieved-but-matured word counts as lapsed');
  assert.equal(grammar.rate, 0.5);
});

test('computeDimensionCoverage: always returns exactly 11 rows, one per real mastery dimension', () => {
  const { exports: E } = buildSandbox();
  const rows = E.computeDimensionCoverage([]);
  assert.equal(rows.length, 11);
  const rowsPopulated = E.computeDimensionCoverage([makeWord(E, 'alfa'), makeWord(E, 'bravo')]);
  assert.equal(rowsPopulated.length, 11);
});

test('computeDimensionCoverage: %Achieved/%Developing are percentages of ASSESSED words, not all words, and fails/hasFailures are correct', () => {
  const { exports: E } = buildSandbox();
  const achieved = makeWord(E, 'charlie');
  E.DimModel.record(achieved, 'meaningRecall', true); E.DimModel.record(achieved, 'meaningRecall', true);
  const developing = makeWord(E, 'delta');
  E.DimModel.record(developing, 'meaningRecall', true);
  const neverAssessed = makeWord(E, 'echo'); // dims.meaningRecall left at 'Not assessed'

  const rows = E.computeDimensionCoverage([achieved, developing, neverAssessed]);
  const mr = rows.find(r => r.key === 'meaningRecall');
  assert.equal(mr.assessed, 2, 'the never-assessed word must not count in the denominator');
  assert.equal(mr.pctAchieved, 50);
  assert.equal(mr.pctDeveloping, 50);
  assert.equal(mr.fails, 0);
  assert.equal(mr.hasFailures, false);
});

test('Views.runDimensionPractice: builds a queue containing exactly the words that failed the seeded dimension, at the right level, and leaves other words out', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const failedGrammar = makeWord(E, 'foxtrot');
  failedGrammar.dims.grammar.fail = 2;
  const failedOtherDim = makeWord(E, 'golf');
  failedOtherDim.dims.collocation.fail = 1; // grammar never failed for this word
  const cleanWord = makeWord(E, 'hotel'); // no fails anywhere
  [failedGrammar, failedOtherDim, cleanWord].forEach(w => E.Storage.state.words.push(w));

  // The queue-building logic under test (the part before App.showTab) fully completes
  // before this throws -- the test sandbox's fake DOM has no real querySelector, so the
  // interactive practice-card rendering that showTab cascades into (building the actual
  // question UI, well past routing) can't run headlessly here. That's fine: this test is
  // about the queue Practice.session ends up with, not about rendering the card.
  try { E.Views.runDimensionPractice('grammar'); } catch (e) {}
  const queueWordIds = E.Practice.session.queue.map(item => item.word.id);
  assert.equal(queueWordIds.length, 1, 'only the word that actually failed grammar should be queued');
  assert.equal(queueWordIds[0], failedGrammar.id);
  assert.equal(E.Practice.session.queue[0].level, E.DIM_PRACTICE_LEVEL.grammar);
  assert.equal(E.Practice.session.queue[0].level, 3);
  assert.equal(E.Practice.session.queue[0].track, 'legacy');
});

test('Views.runDimensionPractice: does not start a session when no word has failed the dimension', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Storage.state.words.push(makeWord(E, 'india')); // no fails anywhere
  E.Views.runDimensionPractice('novelApplication');
  assert.equal(E.Practice.session, null, 'no words failed novelApplication, so no session should start');
});

test('validateAndRepair rejects malformed settings.examDate and dailyActivity keys before they reach Utils.diffDays', () => {
  const { exports: E } = buildSandbox();
  const today = E.Utils.todayISO();

  const repaired = E.validateAndRepair({
    version: 2, words: [], errorLog: [],
    settings: { examDate: 'not-a-date', theme: 'system' },
    dailyActivity: {
      'not-a-date': { reviews: 3, correct: 2, teaching: 0, newWords: 1 },
      [today]: { reviews: 1, correct: 1, teaching: 0, newWords: 0 }
    },
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  });

  assert.equal(repaired.settings.examDate, null, 'a malformed examDate should repair to null, not pass through');
  assert.deepEqual(Object.keys(repaired.dailyActivity), [today], 'the malformed dailyActivity key should be dropped');

  // The unvalidated values used to reach Utils.diffDays as NaN (and examDate reached
  // compressForExam's new Date(...).toISOString(), which throws). After repair, neither
  // consumer sees a bad date.
  const streak = E.computeStreakFromActivity(repaired.dailyActivity, today);
  assert.ok(Number.isFinite(streak.current) && Number.isFinite(streak.longest),
    'streak math should stay finite -- a bad dailyActivity key would make diffDays return NaN');
  assert.ok(Number.isFinite(E.Utils.diffDays(today, repaired.settings.examDate || today)),
    'the repaired examDate should be safe to hand to diffDays');
});

test('Teaching.wireStep5 records a fail against formRecall/meaningRecall (not just history/attempts) on a failed supported-retrieval attempt', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'lucid', meaning: 'clear and easy to understand', form: 'adjective', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: [],
    wordType: 'general' // not difficultSpelling, so wireStep5 takes the hint-ladder retrieval path
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = { word, step: 5, retry: 0, inputs: {}, stepLogged: new Set(), step5Data: { cue: 'x', hintLevel: 0 } };

  const nodes = {};
  const makeNode = () => ({ value: '', disabled: false, innerHTML: '', addEventListener() {}, focus() {} });
  ctx.document.getElementById = id => {
    if(!nodes[id]) nodes[id] = makeNode();
    return nodes[id];
  };
  nodes.retrieveSubmit = makeNode();
  let doCheck = null;
  nodes.retrieveSubmit.addEventListener = (ev, fn) => { if(ev==='click') doCheck = fn; };

  E.Teaching.wireStep5();
  nodes.retrieveInput.value = 'not-the-word'; // deliberately wrong
  doCheck();

  const historyEntry = word.history[word.history.length-1];
  assert.equal(historyEntry.phase, 'teaching');
  assert.equal(historyEntry.correct, false, 'history/attempts logging should be unchanged');

  assert.equal(word.dims.formRecall.fail, 1, 'a failed supported-retrieval attempt should count against formRecall');
  assert.equal(word.dims.meaningRecall.fail, 1, 'a failed supported-retrieval attempt should count against meaningRecall');
});

// Shared fake-DOM node for the double-click regression tests below: addEventListener records
// handlers per event, and click() -- unlike a plain handler call -- mirrors real browser
// semantics by refusing to fire once .disabled is true, so these tests actually exercise the
// "disable before logging" fix rather than just calling the captured handler twice by hand.
function makeClickNode() {
  return {
    value: '', disabled: false, innerHTML: '', style: {}, dataset: {}, _handlers: {},
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    click() { if (this.disabled) return; (this._handlers.click || []).forEach(fn => fn()); },
    focus() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

test('Teaching.wireStep4 cloze branch disables input/submit before logging, so a double-click does not double-count the attempt', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'gust', meaning: 'a sudden strong rush of wind', form: 'noun', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = {
    word, step: 4, retry: 0, inputs: {}, stepLogged: new Set(),
    step4Data: { type: 'cloze', cloze: { answer: 'gust', display: 'A cool _____ blew through.' } }
  };

  const nodes = {};
  ctx.document.getElementById = id => { if (!nodes[id]) nodes[id] = makeClickNode(); return nodes[id]; };
  nodes.clozeInput = makeClickNode();
  nodes.clozeInput.value = 'gust';

  E.Teaching.wireStep4();
  nodes.clozeSubmit.click();
  nodes.clozeSubmit.click(); // simulated double-click

  assert.equal(word.dims.contextualComprehension.success, 1, 'a double-click on Check should only count the attempt once');
});

test('Teaching.wireStep5 difficultSpelling branch disables spellInput/spellSubmit before logging, so a double-click does not double-count the spelling check', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'lucid', meaning: 'clear and easy to understand', form: 'adjective', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: [],
    wordType: 'difficultSpelling'
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = { word, step: 5, retry: 0, inputs: {}, stepLogged: new Set() };

  const nodes = {};
  ctx.document.getElementById = id => { if (!nodes[id]) nodes[id] = makeClickNode(); return nodes[id]; };
  nodes.spellInput = makeClickNode();
  nodes.spellInput.value = 'lusid'; // deliberately wrong

  E.Teaching.wireStep5();
  nodes.spellSubmit.click();
  nodes.spellSubmit.click(); // simulated double-click

  assert.equal(word.dims.formRecall.fail, 1, 'a double-click on Check Spelling should only count the attempt once');
});

test('Teaching.wireStep6 selfYes/selfNo disable each other before logging, so a double-click does not double-count the self-assessment', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'ponder', meaning: 'to think carefully about something', form: 'verb', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = { word, step: 6, retry: 0, inputs: {}, stepLogged: new Set() };

  const nodes = {};
  const feedbackNode = makeClickNode();
  feedbackNode.querySelector = sel => {
    if (sel === '#selfYes') return nodes.selfYes || (nodes.selfYes = makeClickNode());
    if (sel === '#selfNo') return nodes.selfNo || (nodes.selfNo = makeClickNode());
    return null;
  };
  ctx.document.getElementById = id => {
    if (id === 'teachFeedback') return feedbackNode;
    if (!nodes[id]) nodes[id] = makeClickNode();
    return nodes[id];
  };
  nodes.constrainedInput = makeClickNode();
  nodes.constrainedInput.value = 'I pondered the question for a while.';

  E.Teaching.wireStep6();
  nodes.constrainedSubmit.click(); // opens the self-check panel and wires selfYes/selfNo

  nodes.selfYes.click();
  nodes.selfYes.click(); // simulated double-click

  assert.equal(word.dims.guidedProduction.success, 1, 'a double-click on selfYes should only count the outcome once');
});

test('Teaching.handleStepOutcome disables error-category buttons before logging, so a double-click on one category does not double-log it', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'ponder', meaning: 'to think carefully about something', form: 'verb', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = { word, step: 6, retry: 0, inputs: {}, stepLogged: new Set() };

  const catButtons = E.ERROR_CATEGORIES.map(c => { const n = makeClickNode(); n.dataset = { c }; return n; });
  const feedbackNode = makeClickNode();
  feedbackNode.querySelectorAll = sel => sel === '.error-cats button' ? catButtons : [];
  const nodes = { teachFeedback: feedbackNode };
  ctx.document.getElementById = id => { if (!nodes[id]) nodes[id] = makeClickNode(); return nodes[id]; };

  E.Teaching.handleStepOutcome(false, { correctAnswerText: 'x' });

  const cat = E.ERROR_CATEGORIES[0];
  const btn = catButtons[0];
  btn.click();
  btn.click(); // simulated double-click on the same category

  const dimKey = E.CATEGORY_TO_DIM[cat];
  assert.equal(word.dims[dimKey].fail, 1, 'a double-click on one error category should only log once');
  assert.equal(word.teaching.errorHistory.length, 1, 'a double-click on one error category should only push one errorHistory entry');
});

test('Teaching.state.stepLogged blocks a step-4 answer replayed via Back -> Forward from double-logging, but an explicit retry still counts', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'gambit', meaning: 'a risky opening move', form: 'noun', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);
  // Force genStep4 to always draw 'mcq' (with word.production first, so it's the correct
  // option) once step4Data is regenerated by an explicit retry below.
  E.Utils.pick = arr => arr[0];
  E.Utils.shuffle = arr => arr;

  const options = [{ text: 'p', correct: true }, { text: 'wrong', correct: false }];
  const correctIdx = 0, wrongIdx = 1;
  E.Teaching.state = { word, step: 4, retry: 0, inputs: {}, stepLogged: new Set(), step4Data: { type: 'mcq', options } };

  const makeMcqBtn = () => { const n = makeClickNode(); n.classList = { add(){}, remove(){}, toggle(){} }; return n; };
  let currentMcqBtns = null;
  ctx.document.querySelectorAll = sel => {
    if (sel === '#mcqOptions button') { currentMcqBtns = options.map(makeMcqBtn); return currentMcqBtns; }
    return [];
  };

  const genericNodes = {};
  const feedbackNode = makeClickNode();
  let currentCatBtns = null;
  feedbackNode.querySelectorAll = sel => {
    if (sel === '.error-cats button') { currentCatBtns = E.ERROR_CATEGORIES.map(c => { const n = makeClickNode(); n.dataset = { c }; return n; }); return currentCatBtns; }
    return [];
  };
  const retryNode = makeClickNode(), advanceNode = makeClickNode();
  feedbackNode.querySelector = sel => (sel === '#retryBtn' ? retryNode : sel === '#advanceBtn' ? advanceNode : null);
  ctx.document.getElementById = id => {
    if (id === 'teachFeedback') return feedbackNode;
    if (!genericNodes[id]) genericNodes[id] = makeClickNode();
    return genericNodes[id];
  };

  E.Teaching.wireStep4();
  currentMcqBtns[correctIdx].click();
  assert.equal(word.dims.meaningRecognition.success, 1, 'sanity: the first correct answer should log a success');

  // Simulate Back -> Forward: real navigation re-renders and re-wires step 4 from scratch
  // (still against the same cached step4Data/options), producing a fresh, un-disabled button
  // set -- exactly the replay this guard exists to catch.
  E.Teaching.goStep(5);
  E.Teaching.goStep(4);
  currentMcqBtns[correctIdx].click(); // replay the same already-logged answer

  assert.equal(word.dims.meaningRecognition.success, 1, 'replaying an already-logged step via Back -> Forward must not double-count');

  // Now fail on the replayed visit and explicitly retry -- a deliberate new attempt, which
  // should count once it resolves. The previous click already disabled that button set, so
  // re-wire (as a fresh render would) to get a live one to fail on.
  E.Teaching.wireStep4();
  currentMcqBtns[wrongIdx].click(); // wrong answer -> handleStepOutcome(false, ...)
  currentCatBtns[0].click(); // first failure -> retry===1 -> "Try This Step Again" is offered
  retryNode.click(); // resets step4Data and clears stepLogged for step 4, then re-renders

  currentMcqBtns[correctIdx].click(); // answer again, for real, after the explicit retry

  assert.equal(word.dims.meaningRecognition.success, 2, 'an explicit retry is a deliberate new attempt and should count');
});

test('Teaching.handleStepOutcome logs a step-6 failure immediately, so clicking Back before picking a category does not drop the attempt', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'ponder', meaning: 'to think carefully about something', form: 'verb', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = { word, step: 6, retry: 0, inputs: {}, stepLogged: new Set() };

  const nodes = {};
  const feedbackNode = makeClickNode();
  feedbackNode.querySelectorAll = sel => sel === '.error-cats button' ? [] : [];
  ctx.document.getElementById = id => {
    if (id === 'teachFeedback') return feedbackNode;
    if (!nodes[id]) nodes[id] = makeClickNode();
    return nodes[id];
  };

  E.Teaching.handleStepOutcome(false, { correctAnswerText: 'x' });
  E.Teaching.goBack(); // clicks the global "<- Back" button instead of ever picking a category

  const teachingEntries = word.history.filter(h => h.phase === 'teaching');
  assert.equal(teachingEntries.length, 1, 'the failed attempt should be logged even though no category was ever picked');
  assert.equal(teachingEntries[0].correct, false);
  assert.ok(Object.values(word.dims).every(d => d.fail === 0), 'no dim fail should be written until a category is chosen');
});

test('Teaching.handleStepOutcome does not add a second history entry when a category is picked after the failure was already logged', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'ponder', meaning: 'to think carefully about something', form: 'verb', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = { word, step: 6, retry: 0, inputs: {}, stepLogged: new Set() };

  const catButtons = E.ERROR_CATEGORIES.map(c => { const n = makeClickNode(); n.dataset = { c }; return n; });
  const feedbackNode = makeClickNode();
  feedbackNode.querySelectorAll = sel => sel === '.error-cats button' ? catButtons : [];
  const nodes = { teachFeedback: feedbackNode };
  ctx.document.getElementById = id => { if (!nodes[id]) nodes[id] = makeClickNode(); return nodes[id]; };

  E.Teaching.handleStepOutcome(false, { correctAnswerText: 'x' });

  const cat = E.ERROR_CATEGORIES[0];
  catButtons[0].click(); // pick a category after the failure was already logged on entry

  const teachingEntries = word.history.filter(h => h.phase === 'teaching');
  assert.equal(teachingEntries.length, 1, 'picking a category must not add a second history entry for the same failed attempt');

  const dimKey = E.CATEGORY_TO_DIM[cat];
  assert.equal(word.dims[dimKey].fail, 1, 'picking a category should still record the category-specific dim fail');
  assert.equal(word.teaching.errorHistory.length, 1);
});

test('Teaching.state.stepLogged blocks a step-6 failure replayed via Back -> Forward from double-logging the attempt', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'ponder', meaning: 'to think carefully about something', form: 'verb', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);

  E.Teaching.state = { word, step: 6, retry: 0, inputs: {}, stepLogged: new Set() };

  const nodes = {};
  const feedbackNode = makeClickNode();
  feedbackNode.querySelectorAll = sel => sel === '.error-cats button' ? [] : [];
  ctx.document.getElementById = id => {
    if (id === 'teachFeedback') return feedbackNode;
    if (!nodes[id]) nodes[id] = makeClickNode();
    return nodes[id];
  };

  E.Teaching.handleStepOutcome(false, { correctAnswerText: 'x' }); // first failure, logs one entry
  E.Teaching.goBack();   // step 5
  E.Teaching.goStep(6);  // back to step 6 -- stepLogged still has 6 from before, never cleared
  E.Teaching.handleStepOutcome(false, { correctAnswerText: 'x' }); // replayed failure

  const teachingEntries = word.history.filter(h => h.phase === 'teaching');
  assert.equal(teachingEntries.length, 1, 'replaying the same already-logged failure via Back -> Forward must not double-count');
});

test('Exam.restore both subtracts elapsed wall-clock time AND restarts the countdown timer, so time is not frozen until the user opens the Writing tab', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();

  const realNow = Date.now();
  const T = realNow - 60000; // saved 60 real seconds ago
  E.Storage.state.examSession = {
    status: 'running', prompt: 'Write about X', minutes: 10, text: 'draft so far',
    remainingSec: 600, lastTickAt: T, targetWordIds: [], checklist: {}
  };

  // Capture the interval callback restore()'s ensureTimer() call installs, instead of a real
  // setInterval, so "10 seconds later" can be simulated by invoking it 10 times rather than
  // actually sleeping -- tick() itself decrements remainingSec by 1 per call regardless of
  // real elapsed time.
  let tickFn = null;
  ctx.setInterval = (fn) => { tickFn = fn; return 1; };
  ctx.clearInterval = () => { tickFn = null; };

  E.Exam.restore();

  assert.equal(E.Exam.remainingSec, 540, 'elapsed wall-clock time since lastTickAt should be subtracted immediately');
  assert.ok(tickFn, 'restore() should have started the countdown timer via ensureTimer(), not left it frozen until Exam.render()');

  for(let i=0;i<10;i++) tickFn();
  assert.equal(E.Exam.remainingSec, 530, 'the timer should now be running, so 10 further ticks bring it down by 10 more');
});

test('Exam.finishWriting does not throw when the countdown reaches zero before the user ever opens the Writing tab', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();

  E.Storage.state.examSession = {
    status: 'running', prompt: 'Write about X', minutes: 10, text: 'draft so far',
    remainingSec: 1, lastTickAt: Date.now(), targetWordIds: [], checklist: {}
  };

  let tickFn = null;
  ctx.setInterval = (fn) => { tickFn = fn; return 1; };
  ctx.clearInterval = () => { tickFn = null; };

  // Restore, but never call Exam.render() -- Exam.container stays null, matching a user who
  // hasn't opened the Writing tab since the countdown was restored.
  E.Exam.restore();
  assert.equal(E.Exam.container, null, 'sanity: container should still be unset');

  assert.doesNotThrow(() => tickFn(), 'the countdown reaching zero with no container must not throw');

  assert.equal(E.Exam.status, 'review', 'the exam should still transition to review');
  assert.equal(E.Storage.state.examSession.status, 'review', 'the transition must still be persisted durably');
});

test('Audit.createReviewItems records wordId on matched writingLog entries and null on unmatched ones', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'lucid', meaning: 'clear and easy to understand', form: 'adjective', grammar: '',
    collocations: ['a', 'b'], contrast: '', contexts: ['x', 'y'], production: 'p', cloze: []
  });
  E.Storage.state.words.push(word);

  E.Audit.essayText = 'The explanation was lucid but the argument was flimflam.';
  E.Audit.tags = [
    { id: 'tag-1', quoted: 'lucid', word: 'lucid', category: 'Grammar', correction: 'clear' },
    { id: 'tag-2', quoted: 'flimflam', word: 'flimflam', category: 'Meaning', correction: 'nonsense' }
  ];
  // createReviewItems ends by re-drawing (needs a rich container) and, since there's an
  // unmatched tag, opening the "New Words Found" modal via Modal.show (needs a rich
  // document.getElementById('modalRoot') too) -- give those two ids a node whose
  // querySelector/querySelectorAll return further wireable nodes instead of null. Utils.toast
  // still needs the default sandbox stub's real (no-op) appendChild for 'toastRoot'.
  const richNode = () => { const n = makeClickNode(); n.querySelector = () => richNode(); n.querySelectorAll = () => []; return n; };
  const container = richNode();
  const modalRoot = richNode();
  const origGetElementById = ctx.document.getElementById.bind(ctx.document);
  ctx.document.getElementById = id => id === 'modalRoot' ? modalRoot : origGetElementById(id);
  E.Audit.container = container;

  E.Audit.createReviewItems();

  const entry = E.Storage.state.writingLog[E.Storage.state.writingLog.length - 1];
  const matchedErr = entry.errors.find(e => e.word === 'lucid');
  const unmatchedErr = entry.errors.find(e => e.word === 'flimflam');

  assert.equal(matchedErr.wordId, word.id, 'a matched tag should record the real word\'s id');
  assert.equal(matchedErr.matched, true);
  assert.equal(unmatchedErr.wordId, null, 'an unmatched tag should record wordId: null');
  assert.equal(unmatchedErr.matched, false);
});

test('App.init flushes a debounced config-phase Exam edit on visibilitychange, not just running/review', () => {
  const { ctx, exports: E } = buildSandbox();

  // App.init touches a lot (applyTheme, restore(), tab wiring, renderDashboard via showTab) --
  // give every getElementById lookup a node rich enough to survive it. With no words in the
  // bank, renderDashboard takes its empty-state early-return branch, so this stays cheap.
  const richNode = () => { const n = makeClickNode(); n.querySelector = () => richNode(); n.querySelectorAll = () => []; return n; };
  ctx.document.getElementById = () => richNode();
  ctx.document.documentElement = { removeAttribute(){}, setAttribute(){} };
  ctx.addEventListener = () => {}; // window.addEventListener('beforeunload', ...)

  const docHandlers = {};
  ctx.document.addEventListener = (ev, fn) => { docHandlers[ev] = fn; };

  E.App.init();
  assert.ok(docHandlers.visibilitychange, 'App.init should register a visibilitychange handler');

  E.Exam.status = 'config';
  E.Exam.prompt = 'A freshly edited prompt';
  E.Exam.persist(); // debounced (500ms) -- not yet flushed to Storage.state.examSession
  assert.equal(E.Storage.state.examSession, null, 'sanity: the debounced edit should not be persisted yet');

  ctx.document.visibilityState = 'hidden';
  docHandlers.visibilitychange();

  assert.ok(E.Storage.state.examSession, 'a config-phase edit should be flushed on visibilitychange, not silently dropped');
  assert.equal(E.Storage.state.examSession.prompt, 'A freshly edited prompt');
});

test('Practice.restore remaps savedIdx through originalToNew, so returnToCurrent lands on the right card after a queued word was deleted', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const alpha = makeWord(E, 'alpha');
  const charlie = makeWord(E, 'charlie');
  // 'bravo' is deliberately NOT added to Storage.state.words -- it stands for a word deleted
  // between persist() and restore(), so original queue index 1 gets dropped (0->0, 2->1).
  E.Storage.state.words.push(alpha, charlie);

  E.Storage.state.practiceSession = {
    mode: 'legacy', idx: 0, reviewing: true,
    savedIdx: 2, // ORIGINAL position of charlie -- sits past the item about to be dropped
    queue: [
      { wordId: alpha.id, level: 2, drillType: null, track: null, dimension: null },
      { wordId: 'deleted-bravo', level: 2, drillType: null, track: null, dimension: null },
      { wordId: charlie.id, level: 2, drillType: null, track: null, dimension: null }
    ],
    results: []
  };

  E.Practice.restore();
  const s = E.Practice.session;
  assert.equal(s.queue.length, 2, 'sanity: the deleted word should have been dropped from the queue');
  assert.equal(s.savedIdx, 1, 'savedIdx should be remapped from original index 2 to new index 1');
  assert.equal(s.reviewing, true, 'a savedIdx that still resolves should leave reviewing alone');

  E.Practice.returnToCurrent();
  assert.equal(s.idx, 1);
  assert.equal(s.queue[s.idx].word.word, 'charlie', 'returnToCurrent should land on charlie, not past the end');
});

test('Practice.restore falls back to queue.length + reviewing:false when no original index at or after savedIdx survives', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const alpha = makeWord(E, 'alpha');
  E.Storage.state.words.push(alpha);

  E.Storage.state.practiceSession = {
    mode: 'legacy', idx: 0, reviewing: true,
    savedIdx: 1, // original position of the word that is about to be dropped; nothing survives after it
    queue: [
      { wordId: alpha.id, level: 2, drillType: null, track: null, dimension: null },
      { wordId: 'deleted-bravo', level: 2, drillType: null, track: null, dimension: null }
    ],
    results: []
  };

  E.Practice.restore();
  const s = E.Practice.session;
  assert.equal(s.savedIdx, s.queue.length, 'savedIdx should park at queue.length when nothing survives after it');
  assert.equal(s.reviewing, false, 'reviewing must be cleared alongside the sentinel, mirroring _pruneDeletedWord');

  const idxBefore = s.idx;
  E.Practice.returnToCurrent();
  assert.equal(s.idx, idxBefore, 'with reviewing false, returnToCurrent early-returns and never consumes the sentinel');
});

test('Teaching.genStep4 flushes word.lastClozeIndex when the cloze branch is drawn, so a refresh does not lose it', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'zephyr', meaning: 'a gentle breeze', form: 'noun', grammar: '', collocations: ['a', 'b'],
    contrast: '', contexts: ['x', 'y'], production: 'A zephyr drifted through the valley.',
    wordType: 'general', cloze: ['A cool ___ drifted by.', 'The ___ rustled the leaves.']
  });
  E.Storage.state.words.push(word);
  E.Storage.save();

  E.Teaching.state = { word, step: 4, inputs: {} };
  // Force the cloze branch: types is ['mcq','explain','cloze'] (cloze pushed last since this
  // word has usable cloze candidates) -- always picking the last element forces 'cloze'.
  const origPick = E.Utils.pick;
  E.Utils.pick = arr => arr[arr.length-1];
  try{
    const data = E.Teaching.genStep4();
    assert.equal(data.type, 'cloze', 'sanity: the forced pick should have drawn the cloze branch');
  } finally {
    E.Utils.pick = origPick;
  }
  const drawnIdx = word.lastClozeIndex;

  E.Storage.load(); // simulate a refresh: reload from localStorage
  const reloaded = E.Storage.state.words.find(w => w.id === word.id);
  assert.equal(reloaded.lastClozeIndex, drawnIdx,
    'the drawn cloze index should have been flushed to storage before any refresh');
});

test('Practice.genCloze flushes word.lastClozeIndex so a refresh does not lose the cloze rotation', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'gambit', meaning: 'a risky opening move', form: 'noun', grammar: '', collocations: ['a', 'b'],
    contrast: '', contexts: ['x', 'y'], production: '', wordType: 'general',
    cloze: ['The opening ___ surprised everyone.', 'Her ___ paid off in the end.']
  });
  E.Storage.state.words.push(word);
  E.Storage.save();

  E.Practice.genCloze(word);
  const idxAfterCall = word.lastClozeIndex;
  assert.ok(idxAfterCall === 0 || idxAfterCall === 1, 'sanity: getClozeSentence should have picked one of the two candidates');

  // Simulate a refresh: reload straight from localStorage rather than reusing the in-memory word.
  E.Storage.load();
  const reloaded = E.Storage.state.words.find(w => w.id === word.id);
  assert.equal(reloaded.lastClozeIndex, idxAfterCall,
    'lastClozeIndex should have been flushed to storage before any refresh, not left in memory only');
});

test('Views.handleParseFill counts pasted words toward Session.log.newAdded even when the Phase 2 patch is not live', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  E.Session.active = true;
  E.Session.log = { reviewed: 0, correct: 0, newAdded: 0, errors: 0 };
  // The Phase 2 Add-flow patch is NOT live -- what you get by opening the Add tab from the
  // tab bar mid-session rather than via Phase 2's "Add a Word" button.
  E.Session._origHandleSaveWord = null;

  const line = w => [w, 'meaning of ' + w, 'noun', 'countable', 'c1 ' + w + '; c2 ' + w,
    'opposite', 'ctx one; ctx two', w + ' in a sentence.', '', ''].join('|');
  const pasted = ['alpha', 'bravo', 'charlie'].map(line).join('\n');

  // handleParseFill reads its fields off the passed element and, on full success, calls
  // renderBeginTeaching -> document.getElementById(...).querySelector(...).addEventListener.
  // The shared fake returns null from querySelector, so stub a DOM that wires up.
  const stubNode = () => ({ innerHTML: '', textContent: '', after() {}, addEventListener() {} });
  const el = { querySelector: sel => (sel === '#pasteArea' ? { value: pasted } : stubNode()) };
  ctx.document.getElementById = () => ({
    innerHTML: '', querySelector: () => ({ addEventListener() {} })
  });

  const before = E.Session.log.newAdded;
  E.Views.handleParseFill(el);

  assert.equal(E.Storage.state.words.length, 3, 'sanity: all three pasted words should be added');
  assert.equal(E.Session.log.newAdded - before, 3,
    'all three pasted words should count toward the session, regardless of which path inserted them');
});

test('Session.renderPhase Phase 4 excludes a word whose teaching is not completed', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  const today = E.Utils.todayISO();

  const untaught = makeWord(E, 'alpha');
  untaught.teaching.completed = false;
  const taught = makeWord(E, 'beta');
  taught.teaching.completed = true;
  E.Storage.state.words.push(untaught, taught);

  // Phase 4's "pending error review" is derived, not a stored flag: an errorLog entry dated
  // today that no later correct attempt today has resolved.
  E.Storage.state.errorLog.push(
    { wordId: untaught.id, category: 'Meaning', date: today },
    { wordId: taught.id, category: 'Meaning', date: today }
  );

  // renderPhase wires buttons via el.querySelector(...).addEventListener; the shared fake
  // element returns null from querySelector, so give this test a DOM stub that records the
  // handlers instead, and capture the queue handed to _beginQueue.
  const handlers = {};
  ctx.document.getElementById = () => ({
    innerHTML: '',
    querySelector: sel => ({ addEventListener: (ev, fn) => { handlers[sel] = fn; } })
  });
  let captured = null;
  E.Session._beginQueue = q => { captured = q; };

  E.Session.phase = 3; // 0-indexed: phase 3 is the "Phase 4 · Error Review" screen
  E.Session.renderPhase();
  handlers['#beginBtn']();

  assert.ok(captured, 'Phase 4 should offer a Begin button with a queue');
  const queueWords = captured.map(item => item.word.word);
  assert.equal(queueWords.length, 1, 'the untaught word should not enter Phase 4 retrieval practice');
  assert.equal(queueWords[0], 'beta', 'only the word whose teaching is complete should be queued');
});

// Shared DOM stub for the Session.start tests below: renderPhase's phase-0 screen wires
// #skipBtn via el.querySelector(...).addEventListener -- give it a node that records handlers
// instead of the shared fake element's querySelector, which always returns null.
function stubPracticeView(ctx) {
  ctx.document.getElementById = () => ({
    innerHTML: '', classList: { add(){}, remove(){}, toggle(){} },
    querySelector: () => ({ addEventListener: () => {} })
  });
}

test('Session.start confirms before clearing a live Practice.session, then starts the Daily Session clean', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  stubPracticeView(ctx);

  E.Practice.session = { queue: [{}], idx: 0, results: [{ correct: true }], mode: 'free' };
  E.Storage.state.practiceSession = { queue: [], idx: 0, results: [], mode: 'free' };

  let confirmCalls = 0;
  E.Modal.confirm = (msg, cb) => { confirmCalls++; cb(); };

  E.Session.start();

  assert.equal(confirmCalls, 1, 'a live Practice.session should trigger exactly one confirm');
  assert.equal(E.Practice.session, null, 'confirming should clear the in-memory Practice.session');
  assert.equal(E.Storage.state.practiceSession, null, 'confirming should clear the persisted practiceSession too');
  assert.equal(E.Session.active, true, 'the Daily Session should start once the stale session is cleared');
});

test('Session.start leaves everything untouched if the user cancels the confirm', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  stubPracticeView(ctx);

  const staleSession = { queue: [{}], idx: 0, results: [{ correct: true }], mode: 'free' };
  E.Practice.session = staleSession;
  E.Storage.state.practiceSession = { queue: [], idx: 0, results: [], mode: 'free' };

  let confirmCalls = 0;
  E.Modal.confirm = (msg, cb) => { confirmCalls++; }; // Cancel: never invoke cb

  E.Session.start();

  assert.equal(confirmCalls, 1, 'a live Practice.session should still trigger exactly one confirm');
  assert.equal(E.Session.active, false, 'cancelling must not start the Daily Session');
  assert.equal(E.Practice.session, staleSession, 'cancelling must leave the live Practice.session untouched');
  assert.notEqual(E.Storage.state.practiceSession, null, 'cancelling must leave the persisted practiceSession untouched');
});

test('Session.start does not confirm at all when there is no live Practice.session', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();
  stubPracticeView(ctx);

  E.Practice.session = null;

  let confirmCalls = 0;
  E.Modal.confirm = () => { confirmCalls++; };

  E.Session.start();

  assert.equal(confirmCalls, 0, 'a clean start should never show a confirm dialog');
  assert.equal(E.Session.active, true);
});

test('repairWord rejects a whitespace-only word, and Teaching.wireStep5 tolerates a null word', () => {
  const { exports: E } = buildSandbox();
  assert.equal(E.repairWord({ word: '   ' }), null, 'a whitespace-only word should not survive repair');

  E.Teaching.state = { word: null };
  assert.doesNotThrow(() => E.Teaching.wireStep5());
});

function rawWordWithHistory(historyDate){
  return {
    id: 'w1', word: 'echo', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], created: '2026-01-01',
    srs: { interval: 1, nextReview: '2026-01-01', easeStreak: 0, lastPracticed: null },
    levelState: { level: 2 }, errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
    teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} },
    history: [{ ts: 1, date: historyDate, level: 2, correct: false }]
  };
}

test('validateAndRepair drops an errorLog entry with a malformed date, instead of letting it reach Utils.diffDays', () => {
  const { exports: E } = buildSandbox();
  const repaired = E.validateAndRepair({
    version: 2, words: [], errorLog: [{ ts: 1, wordId: 'w1', word: 'x', category: 'Meaning', level: 0, date: 'not-a-date' }],
    settings: {}, sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  });
  assert.equal(repaired.errorLog.length, 0, 'the malformed-date errorLog entry should be dropped');
  assert.doesNotThrow(() => E.Utils.diffDays('not-a-date', E.Utils.todayISO()));
});

test('validateAndRepair drops a word.history entry with a malformed date, instead of letting it reach the dailyActivity backfill', () => {
  const { exports: E } = buildSandbox();
  const repaired = E.validateAndRepair({
    version: 2, words: [rawWordWithHistory('not-a-date')], errorLog: [], settings: {},
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  });
  assert.equal(repaired.words[0].history.length, 0, 'the malformed-date history entry should be dropped');

  E.Storage.state = repaired;
  assert.doesNotThrow(() => E.Storage.backfillDailyActivity());
  // word.created ('2026-01-01') is well-formed and legitimately backfills a newWords bucket;
  // what must NOT happen is a 'not-a-date' bucket keyed off the malformed history entry.
  assert.deepEqual(Object.keys(E.Storage.state.dailyActivity), ['2026-01-01']);
  assert.equal(E.Storage.state.dailyActivity['2026-01-01'].reviews, 0,
    'the dropped history entry must not have contributed a reviews bump anywhere');
  assert.doesNotThrow(() => E.computeStreakFromActivity(E.Storage.state.dailyActivity, E.Utils.todayISO()));
});

test('a valid word.history date survives repair and reaches diffDays finite via the backfill/streak path', () => {
  const { exports: E } = buildSandbox();
  const repaired = E.validateAndRepair({
    version: 2, words: [rawWordWithHistory('2026-01-05')], errorLog: [], settings: {},
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  });
  assert.equal(repaired.words[0].history.length, 1, 'a well-formed history entry should survive repair');

  E.Storage.state = repaired;
  E.Storage.backfillDailyActivity();
  const streak = E.computeStreakFromActivity(E.Storage.state.dailyActivity, E.Utils.todayISO());
  assert.ok(Number.isFinite(streak.current) && Number.isFinite(streak.longest));
});

test('word.srs.lastPracticed, word.firstRetrieval, attempts[].date, and *Log[].date are inert -- a malformed value passes through repair without crashing anything, because none of them are ever read in a date-arithmetic context', () => {
  const { exports: E } = buildSandbox();
  const rawWord = rawWordWithHistory('2026-01-05');
  rawWord.srs.lastPracticed = 'not-a-date';
  rawWord.firstRetrieval = { date: 'not-a-date', correct: true, ts: 1 };

  let repaired;
  assert.doesNotThrow(() => {
    repaired = E.validateAndRepair({
      version: 2, words: [rawWord],
      errorLog: [], settings: {},
      sessionLog: [{ ts: 1, date: 'not-a-date', summary: {} }],
      writingLog: [{ ts: 1, date: 'not-a-date' }],
      examLog: [{ ts: 1, date: 'not-a-date' }],
      practiceSession: null
    });
  });
  // Not sanitized -- these fields are never read in arithmetic anywhere in the app, so
  // validating them would have no observable effect (see bug #7's investigation notes).
  assert.equal(repaired.words[0].srs.lastPracticed, 'not-a-date');
  assert.equal(repaired.words[0].firstRetrieval.date, 'not-a-date');
  assert.equal(repaired.sessionLog.length, 1);
  assert.equal(repaired.writingLog.length, 1);
  assert.equal(repaired.examLog.length, 1);

  E.Storage.state = repaired;
  E.Storage.state.attempts = [{ ts: 1, date: 'not-a-date', wordId: 'w1', correct: true, phase: null, track: 'legacy', dimension: null, rating: null }];
  assert.doesNotThrow(() => E.computeArmComparison(E.Storage.state.words, E.Storage.state.attempts));
  assert.doesNotThrow(() => E.computeFirstPostTeachingRetention(E.Storage.state.words));
});

test('renderAchievementsSection keeps an achievement unlocked once earned, even after the underlying metric regresses (A1)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();

  const today = E.Utils.todayISO();
  for (let i = 0; i < 7; i++) {
    E.Storage.state.dailyActivity[E.Utils.addDays(today, -i)] = { reviews: 5, correct: 5, teaching: 0, newWords: 0 };
  }

  E.Achievements.evaluate(E.Analytics.buildAchievementContext());
  assert.ok(E.Storage.state.achievements.consistent_learner && E.Storage.state.achievements.consistent_learner.unlockedAt,
    'a 7-day streak should stamp consistent_learner as unlocked');

  let html = E.Analytics.renderAchievementsSection();
  let card = html.split('Consistent Learner')[0].split('achv-card ').pop();
  assert.ok(card.startsWith('unlocked"'), 'card should render unlocked right after earning it');

  // Break the streak: today and yesterday now have no activity, so the live check fails.
  delete E.Storage.state.dailyActivity[today];
  delete E.Storage.state.dailyActivity[E.Utils.addDays(today, -1)];
  assert.equal(E.Analytics.buildAchievementContext().streak, 0, 'the streak should genuinely be broken now');

  html = E.Analytics.renderAchievementsSection();
  card = html.split('Consistent Learner')[0].split('achv-card ').pop();
  assert.ok(card.startsWith('unlocked"'), 'card must stay unlocked once earned, even though the live streak check now fails');
  const afterName = html.split('Consistent Learner')[1];
  const cardBody = afterName.slice(0, afterName.indexOf('achv-card'));
  assert.ok(!cardBody.includes('🔒 Locked'),
    'an earned achievement must not show the Locked badge after the metric regresses');
});

test('validateAndRepair drops an errorLog entry with a non-numeric ts (F4)', () => {
  const { exports: E } = buildSandbox();
  const repaired = E.validateAndRepair({
    version: 2, words: [], settings: {},
    errorLog: [{ category: 'Meaning', date: '2026-01-01', ts: NaN }],
    sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  });
  assert.equal(repaired.errorLog.length, 0, 'an errorLog entry with a non-numeric ts must be dropped');
});

test('Storage.importJSON merge mode unions dailyActivityBackfilledAt instead of leaving a null local marker (F5)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Storage.state.words.push(E.WordModel.create({
    word: 'local-anchor', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], wordType: 'general'
  }));
  E.Storage.state.dailyActivityBackfilledAt = null;

  const incoming = JSON.stringify({
    version: 2,
    words: [{
      id: 'w-imported', word: 'imported-anchor', meaning: 'm', form: '', grammar: '', collocations: [],
      contrast: '', contexts: [], production: '', cloze: [], created: '2025-01-01',
      history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
      teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} }
    }],
    errorLog: [], settings: {}, sessionLog: [], writingLog: [], examLog: [], practiceSession: null,
    dailyActivityBackfilledAt: 1234
  });

  const ok = E.Storage.importJSON(incoming, 'merge');
  assert.ok(ok, 'merge import should succeed');
  assert.equal(E.Storage.state.dailyActivityBackfilledAt, 1234,
    'a null local marker should adopt the incoming backfilledAt rather than staying null');
});

test('Storage.importJSON merge mode dedupes incoming words sharing an id, not just against local ids (F6)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  E.Storage.state.words = [{ id: 'a', word: 'alpha' }];

  const dupWord = {
    id: 'b', word: 'beta', meaning: 'm', form: '', grammar: '', collocations: [],
    contrast: '', contexts: [], production: '', cloze: [], created: '2025-01-01',
    history: [], errorCounts: {}, lastClozeIndex: -1, wordType: 'general',
    teaching: { completed: true, currentStep: 8, errorHistory: [], stepResults: {} }
  };
  const incoming = JSON.stringify({
    version: 2,
    words: [dupWord, dupWord],
    errorLog: [], settings: {}, sessionLog: [], writingLog: [], examLog: [], practiceSession: null
  });

  const ok = E.Storage.importJSON(incoming, 'merge');
  assert.ok(ok, 'merge import should succeed');
  assert.equal(E.Storage.state.words.length, 2,
    'two incoming entries sharing an id should merge in as one, alongside the untouched local word');
});

test('Views.renderDashboard only counts taught words as Overdue/Due Today, matching the hero card\'s buildDueQueue-derived total', () => {
  const { ctx, exports: E } = buildSandbox();
  E.Storage.load();

  // A partially-taught word: has a teaching-phase history entry (history.length>0) and a
  // stale nextReview (still sitting at WordModel.create's creation-day default, now in the
  // past), but teaching.completed is still false. WordModel.isOverdue only checks
  // history.length>0 and nextReview<today -- it doesn't know teaching-phase entries aren't
  // retrieval attempts -- so this word satisfies isOverdue despite never having entered
  // Practice.buildDueQueue's taught-only pool.
  const untaught = E.WordModel.create({
    word: 'unfinished', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], wordType: 'general'
  });
  untaught.history.push({ ts: 1, date: E.Utils.addDays(E.Utils.todayISO(), -1), level: 0, correct: true, phase: 'teaching' });
  untaught.srs.nextReview = E.Utils.addDays(E.Utils.todayISO(), -1);
  E.Storage.state.words.push(untaught);

  const nodes = {};
  const makeNode = () => ({
    innerHTML: '', style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, querySelector(){ return makeNode(); }, querySelectorAll(){ return []; }
  });
  const root = makeNode();
  ctx.document.getElementById = id => { if(!nodes[id]) nodes[id] = (id==='view-dashboard' ? root : makeNode()); return nodes[id]; };

  E.Views.renderDashboard();

  const overdueMatch = root.innerHTML.match(/<div class="num">(\d+)<\/div><div class="label">Overdue<\/div>/);
  assert.ok(overdueMatch, 'the Today grid should render an Overdue stat');
  assert.equal(overdueMatch[1], '0', 'a partially-taught word must not be counted as Overdue in the Dashboard grid');

  const dueTotal = E.Practice.buildDueQueue({ includeNew: false }).length;
  assert.equal(dueTotal, 0, 'the untaught word should not appear in the hero card\'s due-queue total either');
  assert.ok(root.innerHTML.includes('You&#39;re caught up') || root.innerHTML.includes("You're caught up"),
    'the hero card should agree with the grid and show "caught up"');
});

test('Practice.buildProductionQueue excludes a word with a level-4 history entry dated today (Fix B investigation)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = E.WordModel.create({
    word: 'excludeme', meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], wordType: 'general'
  });
  word.teaching.completed = true;
  word.history.push({ ts: 1, date: E.Utils.todayISO(), level: 4, correct: true });
  E.Storage.state.words.push(word);

  const queue = E.Practice.buildProductionQueue(8);
  assert.ok(!queue.some(item => item.word.id === word.id),
    'a word already graded at level 4 today must not be re-offered by buildProductionQueue');
});
