'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_WINDOW_RULES, describeWindowRule, getWindowStatus } = require('../src/lib/window-status');

test('Monday 15:00 Europe/Berlin is within the default peak window', () => {
  const date = new Date('2026-03-30T13:00:00.000Z');
  const status = getWindowStatus({
    date,
    rules: DEFAULT_WINDOW_RULES,
    systemTimeZone: 'Europe/Berlin'
  });

  assert.equal(status.state, 'Peak');
  assert.equal(status.isPeak, true);
});

test('Monday 21:00 Europe/Berlin is outside the default peak window', () => {
  const date = new Date('2026-03-30T19:00:00.000Z');
  const status = getWindowStatus({
    date,
    rules: DEFAULT_WINDOW_RULES,
    systemTimeZone: 'Europe/Berlin'
  });

  assert.equal(status.state, 'Off-Peak');
  assert.equal(status.isPeak, false);
});

test('Saturday always resolves to off-peak for the default weekday-only rule', () => {
  const date = new Date('2026-04-04T15:00:00.000Z');
  const status = getWindowStatus({
    date,
    rules: DEFAULT_WINDOW_RULES,
    systemTimeZone: 'Europe/Berlin'
  });

  assert.equal(status.state, 'Off-Peak');
});

test('Peak window starts at 05:00 PT and ends at 11:00 PT exactly', () => {
  const start = new Date('2026-03-30T12:00:00.000Z');
  const end = new Date('2026-03-30T18:00:00.000Z');

  const startStatus = getWindowStatus({
    date: start,
    rules: DEFAULT_WINDOW_RULES,
    systemTimeZone: 'Europe/Berlin'
  });
  const endStatus = getWindowStatus({
    date: end,
    rules: DEFAULT_WINDOW_RULES,
    systemTimeZone: 'Europe/Berlin'
  });

  assert.equal(startStatus.state, 'Peak');
  assert.equal(endStatus.state, 'Off-Peak');
});

test('Local display range reflects DST-aware conversion for Europe/Berlin and Asia/Tokyo', () => {
  const date = new Date('2026-03-30T13:00:00.000Z');
  const berlin = describeWindowRule(DEFAULT_WINDOW_RULES[0], 'Europe/Berlin', date);
  const tokyo = describeWindowRule(DEFAULT_WINDOW_RULES[0], 'Asia/Tokyo', date);

  assert.match(berlin.local, /14:00-20:00/);
  assert.match(tokyo.local, /21:00-03:00|22:00-04:00/);
});
