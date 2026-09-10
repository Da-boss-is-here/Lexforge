/* Analytics tests: exercises the REAL app script (extracted from vocab-trainer 2.0.html,
   same approach as persistence.smoke.test.js) via node:vm. Covers Phase A correctness
   fixes: the broadened streak definition and the teaching/retrieval accuracy split. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FSRSScheduler = require('../lib/fsrs-scheduler.js');
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
  const inner = src.replace(/^\s*\(function\(\)\{/, '').replace(/\}\)\(\);\s*$/, '');
  return inner.replace(/document\.addEventListener\('DOMContentLoaded'.*?\);?\s*$/, '');
}

function buildSandbox() {
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
  new vm.Script('this.__exports = { Storage, WordModel, Analytics, Utils, defaultState };', { filename: 'export-hook.js' }).runInContext(ctx);
  return { ctx, exports: sandbox.__exports };
}

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
