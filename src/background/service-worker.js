// AutoMeet service worker (Manifest V3).
//
// It holds no state in memory. Every wake-up (alarm, popup message, content-script message,
// browser start) re-reads storage, so it behaves the same after Chrome stops and restarts it.

import { MSG } from '../lib/constants.js';
import { meetingIdFromNotification } from './alerts.js';
import * as life from './lifecycle.js';

chrome.alarms.onAlarm.addListener((alarm) => {
  life.handleAlarm(alarm).catch((e) => console.error('AutoMeet alarm failed', e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  life.handleTabRemoved(tabId).catch((e) => console.error('AutoMeet tab handler failed', e));
});

chrome.notifications?.onButtonClicked.addListener((nid, index) => {
  const id = meetingIdFromNotification(nid);
  if (id) life.handleNotificationButton(id, index).catch((e) => console.error('AutoMeet notification failed', e));
});

chrome.runtime.onStartup.addListener(() => {
  life.handleBrowserStartup().catch((e) => console.error('AutoMeet startup failed', e));
});

chrome.runtime.onInstalled.addListener(() => {
  life.reconcile().catch((e) => console.error('AutoMeet install handler failed', e));
});

// Messages from the popup. These must not come from a web page's tab.
const popupHandlers = {
  [MSG.CREATE]: (m) => life.createMeeting(m.input),
  [MSG.UPDATE]: (m) => life.updateMeeting(m.id, m.input),
  [MSG.DELETE]: (m) => life.deleteMeeting(m.id),
  [MSG.CANCEL]: (m) => life.cancelMeeting(m.id),
  [MSG.EMERGENCY_STOP]: () => life.emergencyStop(),
  [MSG.JOIN_NOW]: (m) => life.joinNow(m.id),
};

// Messages from content scripts running in meeting tabs.
const contentHandlers = {
  [MSG.CS_READY]: (_m, sender) => life.handleContentReady(sender),
  [MSG.CS_STATUS]: (m, sender) => life.handleContentStatus(m, sender),
  [MSG.CS_ACCOUNT]: (m, sender) => life.handleAccountDetected(m, sender),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromTab = !!sender.tab;
  const handler = fromTab ? contentHandlers[message?.type] : popupHandlers[message?.type];
  if (!handler) return false;
  handler(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('AutoMeet message failed', message?.type, err);
      sendResponse({ ok: false, error: 'Something went wrong. Please try again.' });
    });
  return true; // keep the channel open for the async response
});

// Every time the worker starts: catch up on anything missed and restore alarms.
life.reconcile().catch((e) => console.error('AutoMeet reconcile failed', e));
