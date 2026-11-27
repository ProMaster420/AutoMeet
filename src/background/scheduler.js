// Keeps chrome.alarms in step with the meetings in storage.
//
// Alarms can be dropped when Chrome restarts or the extension updates, so the alarm set is
// always *derived* from storage and re-created by syncAlarms(). It never holds state of its own.

import { ACTIVE, ALARM_PREFIX, RECONCILE_ALARM, STATUS } from '../lib/constants.js';

export const joinAlarmName = (id) => `${ALARM_PREFIX.JOIN}${id}`;
export const leaveAlarmName = (id) => `${ALARM_PREFIX.LEAVE}${id}`;
export const openAlarmName = (id) => `${ALARM_PREFIX.OPEN}${id}`;

/** 'join:abc' -> {kind:'join', id:'abc'}; 'reconcile' -> {kind:'reconcile'} */
export function parseAlarmName(name) {
  if (name === RECONCILE_ALARM) return { kind: 'reconcile' };
  if (name.startsWith(ALARM_PREFIX.JOIN)) return { kind: 'join', id: name.slice(ALARM_PREFIX.JOIN.length) };
  if (name.startsWith(ALARM_PREFIX.OPEN)) return { kind: 'open', id: name.slice(ALARM_PREFIX.OPEN.length) };
  if (name.startsWith(ALARM_PREFIX.LEAVE)) return { kind: 'leave', id: name.slice(ALARM_PREFIX.LEAVE.length) };
  return { kind: 'unknown' };
}

/** Which alarms should exist for these meetings? */
export function desiredAlarms(meetings) {
  const wanted = new Map(); // name -> epoch ms
  let needsReconcile = false;
  for (const m of meetings) {
    if (m.status === STATUS.SCHEDULED) {
      wanted.set(joinAlarmName(m.id), m.joinAt);
      if (m.leaveAt) wanted.set(leaveAlarmName(m.id), m.leaveAt);
    } else if (ACTIVE.has(m.status)) {
      needsReconcile = true;
      // Heads-up countdown running: the tab opens when it ends.
      if (m.status === STATUS.PREPARING && !m.openedAt && m.openAt) wanted.set(openAlarmName(m.id), m.openAt);
      if (m.leaveAt && m.status !== STATUS.LEAVING) wanted.set(leaveAlarmName(m.id), m.leaveAt);
    }
  }
  return { wanted, needsReconcile };
}

export async function syncAlarms(meetings, now = Date.now()) {
  const { wanted, needsReconcile } = desiredAlarms(meetings);
  const existing = await chrome.alarms.getAll();
  const byName = new Map(existing.map((a) => [a.name, a]));

  for (const alarm of existing) {
    if (alarm.name === RECONCILE_ALARM) {
      if (!needsReconcile) await chrome.alarms.clear(alarm.name);
    } else if (!wanted.has(alarm.name)) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  for (const [name, when] of wanted) {
    const current = byName.get(name);
    if (when <= now) {
      // Already due. reconcile() acts on it; only make sure *something* will wake us.
      if (!current) await chrome.alarms.create(name, { when: now + 1000 });
      continue;
    }
    if (!current || Math.abs(current.scheduledTime - when) > 1000) {
      await chrome.alarms.create(name, { when });
    }
  }

  // While a meeting is in progress, wake once a minute to catch stalls and missed leave alarms.
  if (needsReconcile && !byName.has(RECONCILE_ALARM)) {
    await chrome.alarms.create(RECONCILE_ALARM, { periodInMinutes: 1 });
  }
}
