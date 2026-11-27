import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJoinUrl, detectPlatform, parseMeetingUrl, resolveAccount } from '../src/lib/platform.js';

test('detects Google Meet links', () => {
  for (const u of ['https://meet.google.com/abc-defg-hij', 'meet.google.com/abc-defg-hij?authuser=1', 'http://meet.google.com/abc-defg-hij/']) {
    const r = parseMeetingUrl(u);
    assert.equal(r.ok, true, u);
    assert.equal(r.platform, 'meet');
    assert.equal(r.url, 'https://meet.google.com/abc-defg-hij');
  }
  assert.equal(parseMeetingUrl('https://meet.google.com/lookup/abc123').ok, true);
});

test('rejects bad Meet links', () => {
  assert.equal(parseMeetingUrl('https://meet.google.com/').ok, false);
  assert.equal(parseMeetingUrl('https://meet.google.com/landing').ok, false);
  assert.equal(parseMeetingUrl('https://meet.google.com.evil.com/abc-defg-hij').ok, false);
});

test('detects Zoom links and keeps the passcode', () => {
  const r = parseMeetingUrl('https://us02web.zoom.us/j/81234567890?pwd=AbC123');
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'zoom');
  assert.equal(r.id, '81234567890');
  assert.match(r.url, /pwd=AbC123/);
  assert.equal(parseMeetingUrl('https://zoom.us/my/some.name').ok, true);
  assert.equal(detectPlatform('https://zoom.us/j/123456789'), 'zoom');
});

test('rejects other sites and junk', () => {
  for (const u of ['', '   ', 'https://example.com/j/123456789', 'https://zoom.us/j/12', 'https://notzoom.us.evil.com/j/123456789', 'ftp://zoom.us/j/123456789', 'hello world']) {
    assert.equal(parseMeetingUrl(u).ok, false, u);
  }
});

test('Meet join URL carries the chosen account, falling back to the default', () => {
  const m = { platform: 'meet', url: 'https://meet.google.com/abc-defg-hij', account: 'work@corp.com' };
  assert.equal(new URL(buildJoinUrl(m, { defaultAccount: 'me@gmail.com' })).searchParams.get('authuser'), 'work@corp.com');
  const d = { ...m, account: '' };
  assert.equal(new URL(buildJoinUrl(d, { defaultAccount: 'me@gmail.com' })).searchParams.get('authuser'), 'me@gmail.com');
  assert.equal(buildJoinUrl(d, {}), 'https://meet.google.com/abc-defg-hij');
  assert.equal(resolveAccount({ platform: 'zoom', account: 'x@y.z' }, {}), '');
});

test('Zoom join URL goes straight to the browser client', () => {
  const m = { platform: 'zoom', url: 'https://us02web.zoom.us/j/81234567890?pwd=AbC123', account: '' };
  assert.equal(buildJoinUrl(m), 'https://app.zoom.us/wc/81234567890/join?pwd=AbC123');
});
