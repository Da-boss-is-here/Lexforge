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
  new vm.Script('this.__exports = { Storage, WordModel, defaultState, validateAndRepair, Practice, App };', { filename: 'export-hook.js' }).runInContext(ctx);
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
