// The heads-up before an automatic join: a system notification and a short chime.
// Both are best effort; a failure here must never stop a meeting from being joined.

import { MSG } from '../lib/constants.js';

const notificationId = (id) => `automeet:${id}`;
export const meetingIdFromNotification = (nid) => (nid.startsWith('automeet:') ? nid.slice(9) : null);

async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  try {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play a short chime when AutoMeet starts joining a meeting.',
    });
  } catch (err) {
    if (!/single offscreen/i.test(String(err?.message))) throw err; // already open is fine
  }
  return true;
}

export async function playChime() {
  try {
    if (await ensureOffscreen()) await chrome.runtime.sendMessage({ type: MSG.PLAY_SOUND, target: 'offscreen' });
  } catch {
    /* no sound is acceptable */
  }
}

export async function showNotification(meeting, delaySec) {
  if (!chrome.notifications) return;
  const countdown = delaySec > 0;
  try {
    await chrome.notifications.create(notificationId(meeting.id), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `Joining “${meeting.name}”`,
      message: countdown
        ? `AutoMeet opens it in ${delaySec} s, with camera and microphone off.`
        : 'AutoMeet is opening it now, with camera and microphone off.',
      buttons: countdown ? [{ title: 'Join now' }, { title: 'Cancel' }] : undefined,
      requireInteraction: countdown,
      silent: true, // AutoMeet plays its own chime
    });
  } catch {
    /* notifications may be blocked by the OS */
  }
}

export async function clearNotification(id) {
  try {
    if (chrome.notifications) await chrome.notifications.clear(notificationId(id));
  } catch {
    /* ignore */
  }
}

/** Notify and chime according to the user's settings. */
export async function announceJoin(meeting, settings) {
  await Promise.all([
    settings.notifyOn ? showNotification(meeting, settings.startDelaySec) : null,
    settings.soundOn ? playChime() : null,
  ]);
}
