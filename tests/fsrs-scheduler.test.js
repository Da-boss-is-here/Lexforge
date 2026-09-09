const test = require('node:test');
const assert = require('node:assert/strict');
const FSRSScheduler = require('../lib/fsrs-scheduler.js');

/* Smoke-level coverage: is FSRSScheduler.grade() producing sane, usable output
   (a real next-due date and updated stability/difficulty), and does the
   migration/repair path handle a pre-existing save that predates this field
   entirely. Not an exhaustive spec of FSRS's own math -- ts-fsrs already has
   its own test suite for that. */

test('freshCard is a New-state card due immediately', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const card = FSRSScheduler.freshCard(now);
  assert.equal(card.state, 0); // State.New
  assert.equal(new Date(card.due).getTime(), now.getTime());
});

test('grading a card produces a sane next due date and initializes stability/difficulty', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const card = FSRSScheduler.freshCard(now);
  const result = FSRSScheduler.grade(card, 'easy', { now });
  assert.ok(result.card.stability > 0, 'stability should be initialized after review');
  assert.ok(result.card.difficulty > 0, 'difficulty should be initialized after review');
  assert.ok(new Date(result.card.due).getTime() > now.getTime(), 'due date should move forward');
});

test('grade("easy") schedules further out than grade("again") from the same starting card', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const again = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'again', { now });
  const easy = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'easy', { now });
  assert.ok(new Date(easy.card.due).getTime() > new Date(again.card.due).getTime());
});

test('grade() throws on an unknown rating key rather than silently no-op-ing', () => {
  assert.throws(() => FSRSScheduler.grade(FSRSScheduler.freshCard(), 'good', {}), /Unknown FSRS rating/);
});

test('FSRS_GENERATION is exposed as an inspectable constant, currently 6', () => {
  assert.equal(FSRSScheduler.FSRS_GENERATION, 6);
});

test('DIMENSIONS includes both recognition and production as of Phase 2', () => {
  assert.deepEqual(FSRSScheduler.DIMENSIONS, ['recognition', 'production']);
});

test('PRODUCTION_UNLOCK_STABILITY is exposed as an inspectable constant', () => {
  assert.equal(typeof FSRSScheduler.PRODUCTION_UNLOCK_STABILITY, 'number');
  assert.ok(FSRSScheduler.PRODUCTION_UNLOCK_STABILITY > 0);
});

/* ---- Migration / repair: what runs when a save is read back from localStorage ---- */

test('repairCard treats a missing/malformed card as brand-new (pre-FSRS save migration)', () => {
  const fromMissingField = FSRSScheduler.repairCard(undefined);
  assert.equal(fromMissingField.state, 0);
  assert.equal(fromMissingField.stability, 0);

  const fromGarbage = FSRSScheduler.repairCard({ due: 42, stability: 'not a number' });
  assert.equal(fromGarbage.state, 0);
});

test('repairCard round-trips a previously-saved, already-reviewed card', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const graded = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'hard', { now });
  const repaired = FSRSScheduler.repairCard(graded.card);
  assert.deepEqual(repaired, graded.card);
});

test('repairWordFsrs synthesizes a fresh recognition card for a word with no fsrs field at all', () => {
  const repaired = FSRSScheduler.repairWordFsrs(undefined);
  assert.ok(repaired.recognition);
  assert.equal(repaired.recognition.state, 0);
});

test('repairWordFsrs also synthesizes a fresh production card (Phase 2), uniformly with recognition', () => {
  const repaired = FSRSScheduler.repairWordFsrs(undefined);
  assert.ok(repaired.production);
  assert.equal(repaired.production.state, 0);
});

test('repairWordFsrs preserves an existing production card from a pre-Phase-2 save that only has recognition', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const graded = FSRSScheduler.grade(FSRSScheduler.freshCard(now), 'easy', { now });
  const repaired = FSRSScheduler.repairWordFsrs({ recognition: graded.card }); // no `production` key at all
  assert.deepEqual(repaired.recognition, graded.card);
  assert.equal(repaired.production.state, 0, 'missing production migrates to a fresh card, same as a pre-FSRS save migrated for recognition in Phase 1');
});

test('repairSettings falls back to defaults (0.90 desired retention, no cap) for a pre-existing save', () => {
  const s = FSRSScheduler.repairSettings(undefined);
  assert.equal(s.desiredRetention, 0.9);
  assert.equal(s.maxIntervalDays, null);
});

test('repairSettings preserves a valid stored desiredRetention/maxIntervalDays', () => {
  const s = FSRSScheduler.repairSettings({ desiredRetention: 0.95, maxIntervalDays: 60 });
  assert.equal(s.desiredRetention, 0.95);
  assert.equal(s.maxIntervalDays, 60);
});
