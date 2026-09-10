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
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {}, classList: { add(){}, remove(){} } }; } },
    window: undefined,
    navigator: { languages: ['en-US'] },
    FSRSScheduler,
    DueQueue
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(extractAppScript(), { filename: 'app-under-test.js' });
  script.runInContext(ctx);
  // Pull the pieces the tests need into the sandbox's reachable scope (top-level
  // const/class bindings share the context's global lexical scope across runs).
  new vm.Script('this.__exports = { Storage, WordModel, defaultState, validateAndRepair, Practice, App, Analytics, Utils, computeCalibration, computeBrier, computeStabilityGrowth, computeRetentionByInterval, computeFirstPostTeachingRetention };', { filename: 'export-hook.js' }).runInContext(ctx);
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

test('WordModel.logError does not downgrade an Achieved dim\'s status when the fail is off-target for the question type actually tested', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const word = makeWordWithMnemonic(E);
  word.dims.meaningRecall = { status: 'Achieved', success: 2, fail: 0 };
  // A Cloze question (tests contextualComprehension) went wrong, tagged "Meaning" -- CATEGORY_TO_DIM
  // maps Meaning -> meaningRecall, but meaningRecall was never what this question tested.
  E.WordModel.logError(word, 'Meaning', 3, ['contextualComprehension']);
  assert.equal(word.dims.meaningRecall.status, 'Achieved', 'status should not be knocked down by an off-target fail');
  assert.equal(word.dims.meaningRecall.fail, 1, 'the fail count itself must still increment exactly as before');
});

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

/* ---- Analytics Phase A: broadened streak definition + teaching/retrieval accuracy split ---- */

function makeWord(E, word) {
  return E.WordModel.create({
    word, meaning: 'm', form: '', grammar: '', collocations: [], contrast: '',
    contexts: [], production: '', cloze: [], wordType: 'general'
  });
}

test('computeStreak: a day with only teaching activity (no full Session, no sessionLog entry) still counts', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'alpha');
  const today = E.Utils.todayISO();
  // Simulate a teaching-only step, no sessionLog entry (Session.finish() never ran).
  w.history.push({ ts: Date.now(), date: today, level: 0, correct: true, phase: 'teaching', step: 1 });
  E.Storage.state.words.push(w);

  assert.equal(E.Storage.state.sessionLog.length, 0, 'sanity: no full-session log for this day');
  assert.equal(E.Analytics.computeStreak(), 1, 'teaching-only activity should count as a streak day');
});

test('computeStreak: a drill/practice attempt with no matching word.history phase still counts (levels 1-4)', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'bravo');
  const today = E.Utils.todayISO();
  w.history.push({ ts: Date.now(), date: today, level: 2, correct: false, errorCategory: 'Meaning' });
  E.Storage.state.words.push(w);

  assert.equal(E.Analytics.computeStreak(), 1);
});

test('computeStreak: a free-write session with no matched target words still counts via writingLog', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const today = E.Utils.todayISO();
  E.Storage.state.writingLog.push({ ts: Date.now(), date: today, text: 'free write', errors: [] });

  assert.equal(E.Analytics.computeStreak(), 1);
});

test('computeStreak: consecutive days of mixed activity types (no full sessions at all) chain into a multi-day streak', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'charlie');
  const today = E.Utils.todayISO();
  const yesterday = E.Utils.addDays(today, -1);
  const twoDaysAgo = E.Utils.addDays(today, -2);
  w.history.push({ ts: Date.now(), date: twoDaysAgo, level: 0, correct: true, phase: 'teaching' });
  w.history.push({ ts: Date.now(), date: yesterday, level: 3, correct: true });
  E.Storage.state.words.push(w);
  E.Storage.state.examLog.push({ ts: Date.now(), date: today, prompt: 'p', minutes: 10, text: 't', targetWords: [] });

  assert.equal(E.Analytics.computeStreak(), 3);
});

test('computeStreak: a gap day breaks the streak', () => {
  const { exports: E } = buildSandbox();
  E.Storage.load();
  const w = makeWord(E, 'delta');
  const today = E.Utils.todayISO();
  const threeDaysAgo = E.Utils.addDays(today, -3);
  w.history.push({ ts: Date.now(), date: threeDaysAgo, level: 0, correct: true, phase: 'teaching' });
  w.history.push({ ts: Date.now(), date: today, level: 1, correct: true });
  E.Storage.state.words.push(w);

  assert.equal(E.Analytics.computeStreak(), 1, 'the isolated old day should not chain through the gap');
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
