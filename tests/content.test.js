import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['common.js', 'meet.js', 'zoom.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src/content', f), 'utf8'), sandbox, { filename: f });
}
const { meet, zoom } = sandbox.AutoMeetCS.registry;

test('Meet page text classification', () => {
  assert.equal(meet.classifyText('Asking to be let in…').state, 'waiting');
  assert.equal(meet.classifyText('Someone in the meeting denied your request to join').state, 'blocked');
  assert.equal(meet.classifyText('No one responded to your request to join').state, 'blocked');
  assert.equal(meet.classifyText('You left the meeting').state, 'ended');
  assert.equal(meet.classifyText('You were removed from the meeting').state, 'ended');
  assert.equal(meet.classifyText('Check your meeting code').state, 'blocked');
  assert.equal(meet.classifyText('Ready to join? Join now'), null);
});

test('Zoom page text classification', () => {
  assert.equal(zoom.classifyText('Please wait, the meeting host will let you in soon.').state, 'waiting');
  assert.equal(zoom.classifyText('Please wait for the host to start this meeting.').state, 'waiting');
  assert.equal(zoom.classifyText('This meeting has been ended by host').state, 'ended');
  assert.equal(zoom.classifyText('Invalid meeting ID').state, 'blocked');
  assert.equal(zoom.classifyText('Sign in to join this meeting').state, 'blocked');
  assert.equal(zoom.classifyText('Enter your name and join'), null);
});

test('content scripts do nothing outside an extension context', () => {
  // No chrome.runtime in the sandbox: loading the scripts must not have started anything.
  assert.equal(typeof sandbox.AutoMeetCS.start, 'function');
});
