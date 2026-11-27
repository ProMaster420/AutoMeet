// The meeting lifecycle: create / edit / cancel / delete, joining, leaving and recovery.
//
// Design rules
//  * Storage is the single source of truth. Alarms are derived from it (see scheduler.js).
//  * Every state change happens inside transact() and only along TRANSITIONS, so a duplicate
//    alarm, a late message or a double click can never start a second join or a second leave.
//  * Nothing here relies on in-memory timers; the service worker may be stopped at any moment.
//  * Platform specifics (clicking buttons, reading the page) live in the content scripts.

import {
  ACTIVE,
  FINAL,
  IN_FLIGHT,
  LIMITS,
  MSG,
  STATUS,
  TRANSITIONS,
} from '../lib/constants.js';
import { buildJoinUrl, resolveAccount } from '../lib/platform.js';
import { readMeetings, readSettings, rememberAccount, transact, withLock } from '../lib/storage.js';
import { formatTime } from '../lib/time.js';
import { validateMeetingInput } from '../lib/validation.js';
import { announceJoin, clearNotification } from './alerts.js';
import { parseAlarmName, syncAlarms } from './scheduler.js';

const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------------------------
// State helpers (always called inside transact)
// ---------------------------------------------------------------------------------------------

/** Move a meeting to `to` if that is a legal step. Repeating the current status only updates the detail. */
function transition(m, to, detail = '') {
  if (m.status === to) {
    m.statusDetail = detail;
    m.updatedAt = now();
    return true;
  }
  if (!TRANSITIONS[m.status]?.includes(to)) return false;
  m.status = to;
  m.statusDetail = detail;
  m.statusSince = now();
  m.updatedAt = now();
  if (FINAL.has(to)) m.tabId = null;
  return true;
}

const fail = (m, detail) => transition(m, STATUS.FAILED, detail);

function resetForReschedule(m) {
  m.status = STATUS.SCHEDULED;
  m.statusDetail = '';
  m.statusSince = now();
  m.tabId = null;
  m.runId = null;
  m.devices = null;
  m.joinedAt = null;
  m.openAt = null;
  m.openedAt = null;
  m.delayMs = 0;
}

export function refreshAlarms() {
  return withLock(async () => syncAlarms(await readMeetings()));
}

// ---------------------------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------------------------

async function openTab(url) {
  try {
    return await chrome.tabs.create({ url, active: true });
  } catch {
    // No browser window is open (Chrome running in the background): open one.
    const win = await chrome.windows.create({ url, focused: true });
    return win.tabs[0];
  }
}

async function closeTab(tabId) {
  if (tabId == null) return false;
  try {
    await chrome.tabs.remove(tabId);
    return true;
  } catch {
    return false;
  }
}

async function tellTab(tabId, message) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Popup-facing operations
// ---------------------------------------------------------------------------------------------

export async function createMeeting(input) {
  const result = await transact((list) => {
    const v = validateMeetingInput(input, { now: now(), others: list });
    if (!v.ok) return { ok: false, errors: v.errors };
    const t = now();
    const meeting = {
      id: crypto.randomUUID(),
      ...v.value,
      status: STATUS.SCHEDULED,
      statusDetail: '',
      statusSince: t,
      tabId: null,
      runId: null,
      devices: null,
      joinedAt: null,
      attempts: 0,
      createdAt: t,
      updatedAt: t,
    };
    list.push(meeting);
    return { ok: true, meeting, warnings: v.warnings };
  });
  if (result.ok) await refreshAlarms();
  return result;
}

export async function updateMeeting(id, input) {
  const result = await transact((list) => {
    const m = list.find((x) => x.id === id);
    if (!m) return { ok: false, error: 'That meeting no longer exists.' };
    const v = validateMeetingInput(input, { now: now(), others: list, existing: m });
    if (!v.ok) return { ok: false, errors: v.errors };

    if (ACTIVE.has(m.status)) {
      // Meeting in progress: only the name and the leave time can change.
      m.name = v.value.name;
      m.leaveAt = v.value.leaveAt;
    } else {
      Object.assign(m, v.value);
      resetForReschedule(m); // editing a finished meeting reschedules it
    }
    m.updatedAt = now();
    return { ok: true, meeting: { ...m }, warnings: v.warnings };
  });
  if (result.ok) await refreshAlarms();
  return result;
}

export async function deleteMeeting(id) {
  const removed = await transact((list) => {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  });
  await refreshAlarms();
  return { ok: removed };
}

/** Cancel a meeting that has not been entered yet. The tab, if any, is left open for the user. */
export async function cancelMeeting(id) {
  const outcome = await transact((list) => {
    const m = list.find((x) => x.id === id);
    if (!m) return null;
    if (m.status !== STATUS.SCHEDULED && !IN_FLIGHT.has(m.status)) return { ok: false };
    const info = { ok: true, tabId: m.tabId, runId: m.runId, inFlight: IN_FLIGHT.has(m.status) };
    transition(m, STATUS.CANCELLED, 'Cancelled by you');
    return info;
  });
  if (!outcome) return { ok: false, error: 'That meeting no longer exists.' };
  if (outcome.ok && outcome.inFlight) await tellTab(outcome.tabId, { type: MSG.ABORT, runId: outcome.runId });
  await clearNotification(id);
  await refreshAlarms();
  return outcome.ok ? { ok: true } : { ok: false, error: 'This meeting can’t be cancelled right now.' };
}

/**
 * Emergency stop: cancel every upcoming join and abort any join attempt that is still in progress.
 * Meetings you are already in are not touched (their leave time still applies).
 */
export async function emergencyStop() {
  const aborted = [];
  const stoppedIds = [];
  const cancelled = await transact((list) => {
    let count = 0;
    for (const m of list) {
      if (m.status === STATUS.SCHEDULED || IN_FLIGHT.has(m.status)) {
        stoppedIds.push(m.id);
        if (IN_FLIGHT.has(m.status)) aborted.push({ tabId: m.tabId, runId: m.runId });
        transition(m, STATUS.CANCELLED, 'Stopped by emergency stop');
        count += 1;
      }
    }
    return count;
  });
  await Promise.all(aborted.map((a) => tellTab(a.tabId, { type: MSG.ABORT, runId: a.runId })));
  await Promise.all(stoppedIds.map(clearNotification));
  await refreshAlarms();
  return { ok: true, cancelled };
}

// ---------------------------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------------------------

/**
 * Step 1 of joining. Claim a Scheduled meeting (Scheduled -> Preparing), tell the user with a
 * notification and a chime, then open the tab once the heads-up wait is over. Safe to call any
 * number of times: only the call that makes the Scheduled -> Preparing step does any work.
 */
export async function startJoin(id) {
  const settings = await readSettings();
  const delayMs = settings.startDelaySec * 1000;
  const claimed = await transact((list) => {
    const m = list.find((x) => x.id === id);
    if (!m || m.status !== STATUS.SCHEDULED) return null;
    m.runId = crypto.randomUUID();
    m.attempts = (m.attempts ?? 0) + 1;
    m.devices = null;
    m.joinedAt = null;
    m.delayMs = delayMs;
    m.openAt = now() + delayMs;
    m.openedAt = null;
    transition(m, STATUS.PREPARING, delayMs ? `Opening in ${settings.startDelaySec} s` : 'Opening the meeting');
    return { ...m };
  });
  if (!claimed) return false;

  await announceJoin(claimed, settings);

  if (delayMs === 0) {
    await openMeetingTab(id);
  } else {
    // The alarm is the reliable trigger (it survives the worker stopping); the timer makes the
    // short countdown precise while the worker happens to be alive. openMeetingTab() is idempotent.
    await refreshAlarms();
    setTimeout(() => openMeetingTab(id).catch(() => {}), delayMs);
  }
  return true;
}

/**
 * Step 2: the heads-up wait is over (or "Join now" was pressed). Open the meeting tab.
 * Only the first caller for a given run opens a tab.
 */
export async function openMeetingTab(id, { force = false } = {}) {
  const claimed = await transact((list) => {
    const m = list.find((x) => x.id === id);
    if (!m || m.status !== STATUS.PREPARING || m.openedAt) return null;
    if (!force && m.openAt - now() > LIMITS.OPEN_EARLY_MS) return null;
    m.openedAt = now();
    m.statusSince = now();
    m.statusDetail = 'Opening the meeting';
    m.updatedAt = now();
    return { ...m };
  });
  if (!claimed) return false;
  await clearNotification(id);

  try {
    const settings = await readSettings();
    const tab = await openTab(buildJoinUrl(claimed, settings));
    await transact((list) => {
      const m = list.find((x) => x.id === id);
      if (m && m.runId === claimed.runId && ACTIVE.has(m.status)) m.tabId = tab.id;
    });
  } catch (err) {
    await transact((list) => {
      const m = list.find((x) => x.id === id);
      if (m && m.runId === claimed.runId) fail(m, `Couldn’t open the meeting (${err?.message ?? 'unknown error'}).`);
    });
  }
  await refreshAlarms();
  return true;
}

/** "Join now": skip the rest of the heads-up wait. */
export async function joinNow(id) {
  return { ok: await openMeetingTab(id, { force: true }) };
}

export async function onJoinAlarm(id) {
  const m = (await readMeetings()).find((x) => x.id === id);
  if (!m || m.status !== STATUS.SCHEDULED) return;
  if (m.joinAt - now() > LIMITS.EARLY_ALARM_TOLERANCE_MS) return refreshAlarms(); // fired early: re-arm
  await startJoin(id);
}

export async function onOpenAlarm(id) {
  await openMeetingTab(id);
}

/** Notification buttons: 0 = Join now, 1 = Cancel. */
export async function handleNotificationButton(meetingId, index) {
  if (index === 0) return joinNow(meetingId);
  return cancelMeeting(meetingId);
}

// ---------------------------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------------------------

export async function onLeaveAlarm(id) {
  const m = (await readMeetings()).find((x) => x.id === id);
  if (!m || FINAL.has(m.status)) return;
  if (m.leaveAt && m.leaveAt - now() > LIMITS.EARLY_ALARM_TOLERANCE_MS) return refreshAlarms();
  await runLeave(id);
}

/**
 * Leave a meeting at its leave time.
 *  - In meeting: ask the page to click Leave; if that does not work, close the tab.
 *  - Never entered (still preparing/joining/waiting): there is nothing to leave. The attempt is
 *    abandoned and marked Failed, and the pending tab is closed so it can't be admitted later.
 */
export async function runLeave(id) {
  const claim = await transact((list) => {
    const m = list.find((x) => x.id === id);
    if (!m) return null;
    if (m.status === STATUS.IN_MEETING) {
      transition(m, STATUS.LEAVING, 'Leaving the meeting');
      return { action: 'leave', tabId: m.tabId, runId: m.runId };
    }
    if (IN_FLIGHT.has(m.status)) {
      const info = { action: 'abandon', tabId: m.tabId, runId: m.runId };
      fail(m, 'The leave time came before the meeting was joined.');
      return info;
    }
    if (m.status === STATUS.SCHEDULED) {
      fail(m, 'Missed: the leave time passed before AutoMeet could join.');
    }
    return null; // already leaving or finished: duplicate event
  });
  if (!claim) return refreshAlarms();

  if (claim.action === 'abandon') {
    await tellTab(claim.tabId, { type: MSG.ABORT, runId: claim.runId });
    await closeTab(claim.tabId);
    return refreshAlarms();
  }

  let clicked = false;
  try {
    const reply = await withTimeout(
      chrome.tabs.sendMessage(claim.tabId, { type: MSG.LEAVE, runId: claim.runId }),
      LIMITS.LEAVE_ACK_MS,
    );
    clicked = !!reply?.ok;
  } catch {
    clicked = false;
  }

  const detail = clicked
    ? `Left at ${formatTime(now())}`
    : 'Left by closing the tab (the Leave button wasn’t found).';
  await transact((list) => {
    const m = list.find((x) => x.id === id);
    if (m && m.runId === claim.runId && (m.status === STATUS.LEAVING || m.status === STATUS.IN_MEETING)) {
      transition(m, STATUS.COMPLETED, detail);
    }
  });
  if (!clicked) await closeTab(claim.tabId);
  await refreshAlarms();
}

// ---------------------------------------------------------------------------------------------
// Content-script protocol
// ---------------------------------------------------------------------------------------------

async function findByTab(tabId) {
  return (await readMeetings()).find((m) => m.tabId === tabId && ACTIVE.has(m.status)) ?? null;
}

/**
 * A meeting page has loaded and asks: "should I automate this tab?".
 * Only tabs that AutoMeet opened for a live run are automated; a Meet or Zoom tab you open
 * yourself is never touched.
 */
export async function handleContentReady(sender) {
  const tabId = sender?.tab?.id;
  if (tabId == null) return { start: false };
  let m = await findByTab(tabId);
  if (!m) {
    await sleep(600); // the tab id may not be stored yet if the page loaded very quickly
    m = await findByTab(tabId);
  }
  if (!m) return { start: false };
  const settings = await readSettings();
  return {
    start: true,
    meetingId: m.id,
    runId: m.runId,
    status: m.status,
    platform: m.platform,
    account: resolveAccount(m, settings),
    settings: { micOff: settings.micOff, cameraOff: settings.cameraOff },
  };
}

const CONTENT_STATUS = Object.freeze({
  joining: STATUS.JOINING,
  waiting: STATUS.WAITING,
  in_meeting: STATUS.IN_MEETING,
});

export async function handleContentStatus(msg, sender) {
  const tabId = sender?.tab?.id;
  const changed = await transact((list) => {
    const m = list.find((x) => x.id === msg.meetingId);
    if (!m || m.runId !== msg.runId || !ACTIVE.has(m.status)) return false;
    if (m.tabId != null && m.tabId !== tabId) return false;
    if (m.tabId == null) m.tabId = tabId;

    if (msg.devices) m.devices = { ...(m.devices ?? {}), ...msg.devices };

    switch (msg.status) {
      case 'joining':
        transition(m, STATUS.JOINING, 'Joining the meeting');
        break;
      case 'waiting':
        transition(m, STATUS.WAITING, 'Waiting for the host to let you in');
        break;
      case 'in_meeting':
        if (transition(m, STATUS.IN_MEETING, '') && !m.joinedAt) m.joinedAt = now();
        break;
      case 'failed':
        if (IN_FLIGHT.has(m.status)) fail(m, msg.detail || 'Couldn’t join the meeting.');
        break;
      case 'ended':
        if (m.status === STATUS.IN_MEETING || m.status === STATUS.LEAVING) {
          transition(m, STATUS.COMPLETED, msg.detail || 'The meeting ended.');
        } else if (IN_FLIGHT.has(m.status)) {
          fail(m, msg.detail || 'The meeting ended before AutoMeet could join.');
        }
        break;
      default:
        break; // 'devices' (handled above) and unknown values change nothing else
    }
    return true;
  });
  if (changed) await refreshAlarms();
  return { ok: !!changed };
}

/** The Meet page showed which Google account is signed in: remember it for the account pickers. */
export async function handleAccountDetected(msg, sender) {
  const tabId = sender?.tab?.id;
  const m = (await readMeetings()).find((x) => x.id === msg.meetingId);
  if (!m || m.runId !== msg.runId || m.tabId !== tabId) return { ok: false };
  await rememberAccount(msg.email);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Tabs and browser restarts
// ---------------------------------------------------------------------------------------------

export async function handleTabRemoved(tabId) {
  const changed = await transact((list) => {
    const m = list.find((x) => x.tabId === tabId && ACTIVE.has(x.status));
    if (!m) return false;
    if (m.status === STATUS.IN_MEETING || m.status === STATUS.LEAVING) {
      transition(m, STATUS.COMPLETED, 'You closed the meeting tab.');
    } else {
      transition(m, STATUS.CANCELLED, 'The tab was closed before joining.');
    }
    return true;
  });
  if (changed) await refreshAlarms();
}

/** Tab ids do not survive a browser restart, so anything still "active" from before is over. */
export async function handleBrowserStartup() {
  await transact((list) => {
    for (const m of list) {
      if (m.status === STATUS.IN_MEETING || m.status === STATUS.LEAVING) {
        transition(m, STATUS.COMPLETED, 'Chrome was restarted.');
      } else if (IN_FLIGHT.has(m.status)) {
        fail(m, 'Chrome was restarted before the meeting was joined.');
      }
    }
  });
  await reconcile();
}

// ---------------------------------------------------------------------------------------------
// Reconcile: the recovery path
// ---------------------------------------------------------------------------------------------

/**
 * Bring everything back in line with the clock. Runs whenever the service worker starts, on
 * install/startup, and once a minute while a meeting is active. It
 *   - starts joins whose alarm was missed (within a grace period) and fails the rest,
 *   - runs leaves whose alarm was missed,
 *   - fails joins that stalled, and finishes leaves that never confirmed,
 *   - notices tabs that disappeared,
 *   - and finally re-creates any alarm that is missing.
 */
export async function reconcile() {
  // 1. Tabs that vanished while the service worker was asleep.
  for (const m of await readMeetings()) {
    if (ACTIVE.has(m.status) && m.tabId != null) {
      try {
        await chrome.tabs.get(m.tabId);
      } catch {
        await handleTabRemoved(m.tabId);
      }
    }
  }

  // 2. Decide what is due.
  const t = now();
  const plan = await transact((list) => {
    const toStart = [];
    const toOpen = [];
    const toLeave = [];
    const toForceFinish = [];
    for (const m of list) {
      switch (m.status) {
        case STATUS.SCHEDULED:
          if (m.joinAt > t) break;
          if ((m.leaveAt && t >= m.leaveAt) || t - m.joinAt > LIMITS.MISSED_JOIN_GRACE_MS) {
            fail(m, 'Missed: Chrome wasn’t running at the join time.');
          } else {
            toStart.push(m.id);
          }
          break;
        case STATUS.PREPARING:
        case STATUS.JOINING:
          if (m.leaveAt && t >= m.leaveAt) {
            toLeave.push(m.id);
          } else if (m.status === STATUS.PREPARING && !m.openedAt) {
            if (t >= m.openAt) toOpen.push(m.id); // heads-up wait is over (alarm missed)
          } else if (t - m.statusSince > LIMITS.PREJOIN_STALE_MS) {
            fail(m, 'Timed out while joining. Open the tab to join yourself.');
          }
          break;
        case STATUS.WAITING:
          if (t - m.statusSince > LIMITS.WAIT_FOR_HOST_MAX_MS) {
            fail(m, 'The host didn’t let AutoMeet in within an hour.');
          } else if (m.leaveAt && t >= m.leaveAt) {
            toLeave.push(m.id);
          }
          break;
        case STATUS.IN_MEETING:
          if (m.leaveAt && t >= m.leaveAt) toLeave.push(m.id);
          break;
        case STATUS.LEAVING:
          if (t - m.statusSince > LIMITS.LEAVING_STALE_MS) toForceFinish.push({ id: m.id, tabId: m.tabId });
          break;
        default:
          break;
      }
    }
    return { toStart, toOpen, toLeave, toForceFinish };
  });

  // 3. Act on it. Each call re-checks state, so overlapping runs cannot double-act.
  for (const id of plan.toStart) await startJoin(id);
  for (const id of plan.toOpen) await openMeetingTab(id);
  for (const id of plan.toLeave) await runLeave(id);
  for (const { id, tabId } of plan.toForceFinish) {
    await transact((list) => {
      const m = list.find((x) => x.id === id);
      if (m && m.status === STATUS.LEAVING) transition(m, STATUS.COMPLETED, 'Left by closing the tab.');
    });
    await closeTab(tabId);
  }

  // 4. Make sure every future alarm exists.
  await refreshAlarms();
}

// ---------------------------------------------------------------------------------------------
// Alarm entry point
// ---------------------------------------------------------------------------------------------

export async function handleAlarm(alarm) {
  const parsed = parseAlarmName(alarm.name);
  if (parsed.kind === 'join') return onJoinAlarm(parsed.id);
  if (parsed.kind === 'open') return onOpenAlarm(parsed.id);
  if (parsed.kind === 'leave') return onLeaveAlarm(parsed.id);
  if (parsed.kind === 'reconcile') return reconcile();
  return undefined;
}
