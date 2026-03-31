'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUsageBucket, normalizeUsagePayload } = require('../src/lib/usage-normalizer');

test('normalizeUsageBucket keeps utilization and reset time', () => {
  const normalized = normalizeUsageBucket({
    utilization: 61.2,
    resets_at: '2026-03-30T20:00:00.000Z'
  });

  assert.deepEqual(normalized, {
    utilization: 61.2,
    resetsAt: '2026-03-30T20:00:00.000Z'
  });
});

test('normalizeUsagePayload maps five-hour and seven-day data', () => {
  const payload = normalizeUsagePayload({
    five_hour: {
      utilization: 12.3,
      resets_at: '2026-03-30T18:00:00.000Z'
    },
    seven_day: {
      utilization: 48.7,
      resets_at: '2026-04-02T18:00:00.000Z'
    }
  });

  assert.equal(payload.authState, 'connected');
  assert.equal(payload.fiveHour.utilization, 12.3);
  assert.equal(payload.sevenDay.utilization, 48.7);
  assert.ok(payload.fetchedAt);
});

test('normalizeUsagePayload tolerates missing buckets', () => {
  const payload = normalizeUsagePayload({});

  assert.equal(payload.fiveHour, null);
  assert.equal(payload.sevenDay, null);
});
