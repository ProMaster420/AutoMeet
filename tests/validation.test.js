import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMeetingInput } from '../src/lib/validation.js';
import { formatRelative, fromInputValue, toInputValue } from '../src/lib/time.js';

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const MIN = 60000;
const base = { name: 'Standup', url: 'meet.google.com/abc-defg-hij', joinAt: NOW + 10 * MIN, leaveAt: null, account: '' };
const v = (over = {}, opts = {}) => validateMeetingInput({ ...base, ...over }, { now: NOW, ...opts });

test('accepts a valid meeting; leave is optional and stays null', () => {
  const r = v();
  assert.equal(r.ok, true);
  assert.equal(r.value.leaveAt, null);
  assert.equal(r.value.platform, 'meet');
});

test('join time is required and must be in the future', () => {
  assert.ok(v({ joinAt: null }).errors.joinAt);
  assert.ok(v({ joinAt: NOW - MIN }).errors.joinAt);
  assert.ok(v({ joinAt: NaN }).errors.joinAt);
});

test('leave must be after join', () => {
  assert.ok(v({ leaveAt: NOW + 10 * MIN }).errors.leaveAt);
  assert.ok(v({ leaveAt: NOW + 5 * MIN }).errors.leaveAt);
  assert.equal(v({ leaveAt: NOW + 40 * MIN }).ok, true);
});

test('invalid links and emails are rejected; Zoom ignores the account', () => {
  assert.ok(v({ url: 'https://example.com' }).errors.url);
  assert.ok(v({ account: 'nope' }).errors.account);
  const z = v({ url: 'https://zoom.us/j/123456789', account: 'nope' });
  assert.equal(z.ok, true);
  assert.equal(z.value.account, '');
});

test('blank name gets a default', () => {
  assert.match(v({ name: '  ' }).value.name, /Google Meet abc-defg-hij/);
});

test('exact duplicates are errors, overlaps are warnings', () => {
  const other = { id: 'a', name: 'Other', url: 'https://meet.google.com/abc-defg-hij', joinAt: NOW + 10 * MIN, leaveAt: null, status: 'scheduled' };
  assert.ok(v({}, { others: [other] }).errors.url);
  const overlap = { ...other, url: 'https://meet.google.com/zzz-yyyy-xxx', joinAt: NOW + 12 * MIN };
  const r = v({}, { others: [overlap] });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
  const finished = { ...overlap, status: 'completed' };
  assert.equal(v({}, { others: [finished] }).warnings.length, 0);
});

test('editing a meeting in progress only changes name and leave time', () => {
  const existing = { id: 'a', name: 'X', url: 'https://meet.google.com/abc-defg-hij', platform: 'meet', urlId: 'abc-defg-hij', joinAt: NOW - 5 * MIN, status: 'in_meeting' };
  const r = validateMeetingInput({ name: 'Renamed', url: 'ignored', joinAt: 1, leaveAt: NOW + 30 * MIN }, { now: NOW, existing, others: [existing] });
  assert.equal(r.ok, true);
  assert.equal(r.value.url, existing.url);
  assert.equal(r.value.joinAt, existing.joinAt);
});

test('datetime-local round trip and relative text', () => {
  const ms = new Date(2026, 10, 26, 14, 30).getTime();
  assert.equal(fromInputValue(toInputValue(ms)), ms);
  assert.equal(fromInputValue(''), null);
  assert.ok(Number.isNaN(fromInputValue('garbage')));
  assert.equal(formatRelative(NOW + 12 * MIN, NOW), 'in 12 min');
  assert.equal(formatRelative(NOW + 125 * MIN, NOW), 'in 2 h 5 min');
});
