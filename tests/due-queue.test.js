const test = require('node:test');
const assert = require('node:assert/strict');
const DueQueue = require('../lib/due-queue.js');

function word(id, opts) {
  opts = opts || {};
  return Object.assign({
    id: id,
    teaching: { completed: opts.completed !== false },
    fsrs: opts.due !== undefined ? { recognition: { due: opts.due } } : undefined
  }, opts.extra || {});
}

test('buildDimensionItems excludes words whose teaching is not completed', () => {
  const words = [word('a', { due: '2026-01-01T00:00:00Z', completed: false })];
  const items = DueQueue.buildDimensionItems(words, 'recognition', new Date('2026-01-02T00:00:00Z'));
  assert.equal(items.length, 0);
});

test('buildDimensionItems excludes words with no fsrs state for that dimension', () => {
  const words = [word('a', { completed: true })]; // no fsrs field at all
  const items = DueQueue.buildDimensionItems(words, 'recognition', new Date('2026-01-02T00:00:00Z'));
  assert.equal(items.length, 0);
});

test('buildDimensionItems excludes words not yet due', () => {
  const words = [word('a', { due: '2026-01-05T00:00:00Z' })];
  const items = DueQueue.buildDimensionItems(words, 'recognition', new Date('2026-01-01T00:00:00Z'));
  assert.equal(items.length, 0);
});

test('buildDimensionItems includes due and overdue words, sorted most-overdue first', () => {
  const words = [
    word('due-today', { due: '2026-01-10T00:00:00Z' }),
    word('overdue-5d', { due: '2026-01-05T00:00:00Z' }),
    word('overdue-1d', { due: '2026-01-09T00:00:00Z' })
  ];
  const items = DueQueue.buildDimensionItems(words, 'recognition', new Date('2026-01-10T00:00:00Z'));
  assert.deepEqual(items.map(i => i.word.id), ['overdue-5d', 'overdue-1d', 'due-today']);
  items.forEach(i => {
    assert.equal(i.track, 'fsrs');
    assert.equal(i.dimension, 'recognition');
  });
});

test('buildDimensionItems is generic across dimension keys (Phase 2 production reuse)', () => {
  const words = [{ id: 'p1', teaching: { completed: true }, fsrs: { production: { due: '2026-01-01T00:00:00Z' } } }];
  const items = DueQueue.buildDimensionItems(words, 'production', new Date('2026-01-02T00:00:00Z'));
  assert.equal(items.length, 1);
  assert.equal(items[0].dimension, 'production');
});

test('buildDimensionItems applies an isEligible gate on top of due (Phase 2 production unlock)', () => {
  const words = [
    { id: 'unlocked', teaching: { completed: true }, fsrs: { recognition: { stability: 30 }, production: { due: '2026-01-01T00:00:00Z' } } },
    { id: 'locked', teaching: { completed: true }, fsrs: { recognition: { stability: 5 }, production: { due: '2026-01-01T00:00:00Z' } } }
  ];
  const isEligible = w => w.fsrs.recognition.stability >= 21;
  const items = DueQueue.buildDimensionItems(words, 'production', new Date('2026-01-02T00:00:00Z'), isEligible);
  assert.deepEqual(items.map(i => i.word.id), ['unlocked']);
});

test('buildDimensionItems with no isEligible argument behaves exactly as before (recognition has no gate)', () => {
  const words = [word('a', { due: '2026-01-01T00:00:00Z' })];
  const items = DueQueue.buildDimensionItems(words, 'recognition', new Date('2026-01-02T00:00:00Z'));
  assert.equal(items.length, 1);
});

test('meaningRecall (Phase 3, cued recall) is ungated like recognition -- due is the only condition, no isEligible predicate needed', () => {
  const words = [{ id: 'w1', teaching: { completed: true }, fsrs: { meaningRecall: { due: '2026-01-01T00:00:00Z' } } }];
  const items = DueQueue.buildDimensionItems(words, 'meaningRecall', new Date('2026-01-02T00:00:00Z'));
  assert.equal(items.length, 1);
  assert.equal(items[0].dimension, 'meaningRecall');
});

test('mergeQueues preserves each input list\'s internal order', () => {
  const a = [{ id: 'a1' }, { id: 'a2' }];
  const b = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }];
  const merged = DueQueue.mergeQueues(a, b);
  assert.deepEqual(
    merged.filter(x => x.id.startsWith('a')).map(x => x.id),
    ['a1', 'a2']
  );
  assert.deepEqual(
    merged.filter(x => x.id.startsWith('b')).map(x => x.id),
    ['b1', 'b2', 'b3', 'b4']
  );
});

test('mergeQueues spreads the smaller list across the larger one instead of clustering it', () => {
  const a = [{ id: 'a1' }, { id: 'a2' }];
  const b = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }, { id: 'b5' }, { id: 'b6' }];
  const merged = DueQueue.mergeQueues(a, b);
  const positions = merged.map((x, i) => x.id.startsWith('a') ? i : null).filter(i => i !== null);
  // With 2 a's spread across 8 total slots, neither should land in the very first or very last slot only.
  assert.notDeepEqual(positions, [0, 1]);
  assert.notDeepEqual(positions, [6, 7]);
});

test('mergeQueues handles an empty fsrs track (no recognition cards due yet)', () => {
  const b = [{ id: 'b1' }, { id: 'b2' }];
  const merged = DueQueue.mergeQueues([], b);
  assert.deepEqual(merged.map(x => x.id), ['b1', 'b2']);
});
