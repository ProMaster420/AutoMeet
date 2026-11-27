// Popup -> service worker calls. All meeting changes go through the service worker so there is a
// single writer for meeting data and alarms.

import { MSG } from '../src/lib/constants.js';

async function send(type, payload = {}) {
  try {
    const reply = await chrome.runtime.sendMessage({ type, ...payload });
    return reply ?? { ok: false, error: 'AutoMeet didn’t respond. Try again.' };
  } catch {
    return { ok: false, error: 'AutoMeet’s background service isn’t responding. Reload the extension and try again.' };
  }
}

export const createMeeting = (input) => send(MSG.CREATE, { input });
export const updateMeeting = (id, input) => send(MSG.UPDATE, { id, input });
export const deleteMeeting = (id) => send(MSG.DELETE, { id });
export const cancelMeeting = (id) => send(MSG.CANCEL, { id });
export const emergencyStop = () => send(MSG.EMERGENCY_STOP);
export const joinNow = (id) => send(MSG.JOIN_NOW, { id });

/** The Google account signed in to Chrome itself (needs the identity.email permission). */
export async function detectChromeAccount() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    return info?.email || '';
  } catch {
    return '';
  }
}
