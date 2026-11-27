import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const fake = installFakeChrome();
const life = await import('../src/background/lifecycle.js');
const { readMeetings } = await import('../src/lib/storage.js');

const H = 3600_000;
const input = (over = {}) => ({ name: 'Standup', url: 'meet.google.com/abc-defg-hij', joinAt: Date.now() + H, leaveAt: Date.now() + 2 * H, account: '', ...over });
const get = async (id) => (await readMeetings()).find((m) => m.id === id);
const patch = async (id, p) => {
  const list = await readMeetings();
  Object.assign(list.find((m) => m.id === id), p);
  await chrome.storage.local.set({ meetings: list });
};
const sender = (tabId) => ({ tab: { id: tabId } });

beforeEach(() => {
  fake.reset();
  fake.state.sync.startDelaySec = 0; // most tests exercise the join itself, not the heads-up wait
});

test('creating a meeting stores it and arms join and leave alarms', async () => {
  const r = await life.createMeeting(input());
  assert.equal(r.ok, true);
  assert.ok(fake.state.alarms.has(`join:${r.meeting.id}`));
  assert.ok(fake.state.alarms.has(`leave:${r.meeting.id}`));
  assert.equal((await get(r.meeting.id)).status, 'scheduled');
});

test('no leave time means no leave alarm', async () => {
  const r = await life.createMeeting(input({ leaveAt: null }));
  assert.ok(fake.state.alarms.has(`join:${r.meeting.id}`));
  assert.equal(fake.state.alarms.has(`leave:${r.meeting.id}`), false);
});

test('invalid input is rejected and nothing is stored', async () => {
  const r = await life.createMeeting(input({ url: 'https://example.com' }));
  assert.equal(r.ok, false);
  assert.equal((await readMeetings()).length, 0);
});

test('join alarm opens one tab with the chosen account, even if it fires twice', async () => {
  const { meeting } = await life.createMeeting(input({ account: 'me@work.com' }));
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await Promise.all([life.onJoinAlarm(meeting.id), life.onJoinAlarm(meeting.id), life.reconcile()]);
  assert.equal(fake.state.tabs.size, 1);
  const tab = [...fake.state.tabs.values()][0];
  assert.match(tab.url, /authuser=me%40work\.com/);
  const m = await get(meeting.id);
  assert.equal(m.status, 'preparing');
  assert.equal(m.tabId, tab.id);
  assert.equal(m.attempts, 1);
});

test('only AutoMeet tabs are automated', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  const m = await get(meeting.id);
  const yes = await life.handleContentReady(sender(m.tabId));
  assert.equal(yes.start, true);
  assert.equal(yes.settings.micOff, true);
  const no = await life.handleContentReady(sender(9999));
  assert.equal(no.start, false);
});

test('full lifecycle: join, waiting room, in meeting, leave', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  let m = await get(meeting.id);
  const msg = (status, extra) => life.handleContentStatus({ meetingId: m.id, runId: m.runId, status, ...extra }, sender(m.tabId));

  await msg('joining');
  assert.equal((await get(m.id)).status, 'joining');
  await msg('waiting');
  assert.equal((await get(m.id)).status, 'waiting_for_host');
  await msg('in_meeting', { devices: { mic: 'off', camera: 'off' } });
  m = await get(m.id);
  assert.equal(m.status, 'in_meeting');
  assert.deepEqual(m.devices, { mic: 'off', camera: 'off' });
  assert.ok(m.joinedAt);

  await patch(m.id, { leaveAt: Date.now() - 1000 });
  await life.onLeaveAlarm(m.id);
  assert.equal((await get(m.id)).status, 'completed');
  assert.ok(fake.state.sent.some((s) => s.msg.type === 'AM_LEAVE'));
  assert.equal(fake.state.tabs.has(m.tabId), true, 'tab stays open when the Leave click worked');
});

test('status messages from the wrong run or tab are ignored', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  const m = await get(meeting.id);
  await life.handleContentStatus({ meetingId: m.id, runId: 'old-run', status: 'in_meeting' }, sender(m.tabId));
  await life.handleContentStatus({ meetingId: m.id, runId: m.runId, status: 'in_meeting' }, sender(4242));
  assert.equal((await get(m.id)).status, 'preparing');
});

test('leave falls back to closing the tab when the Leave button cannot be clicked', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  const m = await get(meeting.id);
  await life.handleContentStatus({ meetingId: m.id, runId: m.runId, status: 'in_meeting' }, sender(m.tabId));
  fake.state.sendMessageImpl = async () => { throw new Error('no receiver'); };
  await life.runLeave(m.id);
  const done = await get(m.id);
  assert.equal(done.status, 'completed');
  assert.match(done.statusDetail, /closing the tab/);
  assert.equal(fake.state.tabs.has(m.tabId), false);
});

test('no leave is attempted for a meeting that was never joined', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  const m = await get(meeting.id);
  await life.handleContentStatus({ meetingId: m.id, runId: m.runId, status: 'waiting' }, sender(m.tabId));
  await life.runLeave(m.id);
  const after = await get(m.id);
  assert.equal(after.status, 'failed');
  assert.equal(fake.state.sent.some((s) => s.msg.type === 'AM_LEAVE'), false);
  assert.equal(fake.state.tabs.has(m.tabId), false);
});

test('duplicate leave events do nothing the second time', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  const m = await get(meeting.id);
  await life.handleContentStatus({ meetingId: m.id, runId: m.runId, status: 'in_meeting' }, sender(m.tabId));
  await life.runLeave(m.id);
  await life.runLeave(m.id);
  assert.equal(fake.state.sent.filter((s) => s.msg.type === 'AM_LEAVE').length, 1);
});

test('missed join: late within grace still joins, long overdue fails', async () => {
  const a = (await life.createMeeting(input({ leaveAt: null }))).meeting;
  const b = (await life.createMeeting(input({ leaveAt: null, url: 'zoom.us/j/123456789' }))).meeting;
  await patch(a.id, { joinAt: Date.now() - 3 * 60_000 });
  await patch(b.id, { joinAt: Date.now() - 30 * 60_000 });
  await life.reconcile();
  assert.equal((await get(a.id)).status, 'preparing');
  const failed = await get(b.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.statusDetail, /Missed/);
});

test('alarms are rebuilt from storage after a restart', async () => {
  const { meeting } = await life.createMeeting(input());
  fake.state.alarms.clear(); // Chrome dropped them
  await life.reconcile();
  assert.ok(fake.state.alarms.has(`join:${meeting.id}`));
  assert.ok(fake.state.alarms.has(`leave:${meeting.id}`));
});

test('an in-progress meeting keeps a reconcile alarm; it is removed when nothing is active', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  assert.ok(fake.state.alarms.has('reconcile'));
  const m = await get(meeting.id);
  await life.handleTabRemoved(m.tabId);
  assert.equal(fake.state.alarms.has('reconcile'), false);
});

test('cancel, delete and emergency stop clear alarms', async () => {
  const a = (await life.createMeeting(input())).meeting;
  const b = (await life.createMeeting(input({ url: 'zoom.us/j/123456789' }))).meeting;
  const c = (await life.createMeeting(input({ url: 'zoom.us/j/987654321' }))).meeting;
  await life.cancelMeeting(a.id);
  assert.equal((await get(a.id)).status, 'cancelled');
  assert.equal(fake.state.alarms.has(`join:${a.id}`), false);
  const stop = await life.emergencyStop();
  assert.equal(stop.cancelled, 2);
  assert.equal(fake.state.alarms.size, 0);
  await life.deleteMeeting(c.id);
  assert.equal(await get(c.id), undefined);
  assert.equal((await get(b.id)).status, 'cancelled');
});

test('closing the tab ends or cancels depending on whether you were in', async () => {
  const a = (await life.createMeeting(input())).meeting;
  const b = (await life.createMeeting(input({ url: 'zoom.us/j/123456789' }))).meeting;
  for (const x of [a, b]) await patch(x.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(a.id);
  await life.onJoinAlarm(b.id);
  const ma = await get(a.id);
  const mb = await get(b.id);
  await life.handleContentStatus({ meetingId: ma.id, runId: ma.runId, status: 'in_meeting' }, sender(ma.tabId));
  await life.handleTabRemoved(ma.tabId);
  await life.handleTabRemoved(mb.tabId);
  assert.equal((await get(a.id)).status, 'completed');
  assert.equal((await get(b.id)).status, 'cancelled');
});

test('editing a finished meeting reschedules it; editing one in progress only changes name and leave', async () => {
  const { meeting } = await life.createMeeting(input());
  await life.cancelMeeting(meeting.id);
  const r = await life.updateMeeting(meeting.id, input({ name: 'Moved', joinAt: Date.now() + 5 * H, leaveAt: null }));
  assert.equal(r.ok, true);
  const m = await get(meeting.id);
  assert.equal(m.status, 'scheduled');
  assert.equal(m.name, 'Moved');
  assert.ok(fake.state.alarms.has(`join:${meeting.id}`));
  assert.equal(fake.state.alarms.has(`leave:${meeting.id}`), false);

  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  const joined = await get(meeting.id);
  await life.handleContentStatus({ meetingId: joined.id, runId: joined.runId, status: 'in_meeting' }, sender(joined.tabId));
  const u = await life.updateMeeting(meeting.id, { name: 'Renamed', url: 'zoom.us/j/111111111', joinAt: 5, leaveAt: Date.now() + 3 * H, account: '' });
  assert.equal(u.ok, true);
  const after = await get(meeting.id);
  assert.equal(after.name, 'Renamed');
  assert.equal(after.url, 'https://meet.google.com/abc-defg-hij');
  assert.ok(fake.state.alarms.has(`leave:${meeting.id}`));
});

test('browser restart ends anything that was active', async () => {
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  await life.handleBrowserStartup();
  assert.equal((await get(meeting.id)).status, 'failed');
});

test('heads-up: notification and chime fire, the tab waits for the countdown', async () => {
  fake.state.sync.startDelaySec = 20;
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  const m = await get(meeting.id);
  assert.equal(m.status, 'preparing');
  assert.equal(fake.state.tabs.size, 0, 'no tab yet');
  assert.ok(fake.state.alarms.has(`open:${meeting.id}`), 'open alarm armed');
  assert.ok(m.openAt - Date.now() > 15000);
  const note = fake.state.notifications.get(`automeet:${meeting.id}`);
  assert.ok(note, 'notification shown');
  assert.equal(note.buttons.length, 2);
  assert.equal(fake.state.sounds, 1);
  // too early: does nothing, even if called twice
  await Promise.all([life.openMeetingTab(meeting.id), life.onOpenAlarm(meeting.id)]);
  assert.equal(fake.state.tabs.size, 0);
  // countdown over
  await patch(meeting.id, { openAt: Date.now() - 1 });
  await Promise.all([life.onOpenAlarm(meeting.id), life.reconcile()]);
  assert.equal(fake.state.tabs.size, 1);
  assert.equal(fake.state.notifications.size, 0, 'notification cleared when the tab opens');
});

test('heads-up: "Join now" skips the wait', async () => {
  fake.state.sync.startDelaySec = 60;
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  await life.handleNotificationButton(meeting.id, 0);
  assert.equal(fake.state.tabs.size, 1);
  assert.equal((await get(meeting.id)).status, 'preparing');
});

test('heads-up: cancelling during the wait means no tab is ever opened', async () => {
  fake.state.sync.startDelaySec = 60;
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  await life.handleNotificationButton(meeting.id, 1);
  assert.equal((await get(meeting.id)).status, 'cancelled');
  assert.equal(fake.state.alarms.has(`open:${meeting.id}`), false);
  assert.equal(fake.state.notifications.size, 0);
  await life.openMeetingTab(meeting.id, { force: true });
  assert.equal(fake.state.tabs.size, 0);
});

test('heads-up: sound and notification can be switched off, and a zero wait opens immediately', async () => {
  fake.state.sync.soundOn = false;
  fake.state.sync.notifyOn = false;
  const { meeting } = await life.createMeeting(input());
  await patch(meeting.id, { joinAt: Date.now() - 1000 });
  await life.onJoinAlarm(meeting.id);
  assert.equal(fake.state.sounds, 0);
  assert.equal(fake.state.notifications.size, 0);
  assert.equal(fake.state.tabs.size, 1);
});
