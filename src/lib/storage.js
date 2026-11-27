// Storage access. Meetings live in chrome.storage.local, preferences in chrome.storage.sync.
//
// All meeting writes go through transact(), which serialises read-modify-write cycles so two
// events (e.g. an alarm and a content-script message) can never overwrite each other.

import { DEFAULT_SETTINGS, MAX_START_DELAY_SEC } from './constants.js';

const MEETINGS_KEY = 'meetings';

let chain = Promise.resolve();

/** Run fn after every previously queued fn has finished. */
export function withLock(fn) {
  const result = chain.then(fn);
  chain = result.catch(() => {});
  return result;
}

export async function readMeetings() {
  const data = await chrome.storage.local.get(MEETINGS_KEY);
  return Array.isArray(data[MEETINGS_KEY]) ? data[MEETINGS_KEY] : [];
}

/**
 * Load the meetings, let fn mutate the array in place, then save it.
 * If fn throws, nothing is saved. Returns whatever fn returns.
 */
export function transact(fn) {
  return withLock(async () => {
    const list = await readMeetings();
    const result = await fn(list);
    await chrome.storage.local.set({ [MEETINGS_KEY]: list });
    return result;
  });
}

function clampDelay(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.startDelaySec;
  return Math.min(MAX_START_DELAY_SEC, Math.max(0, n));
}

export async function readSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const accounts = Array.isArray(stored.accounts)
    ? [...new Set(stored.accounts.filter((a) => typeof a === 'string' && a.includes('@')))]
    : [];
  return {
    defaultAccount: typeof stored.defaultAccount === 'string' ? stored.defaultAccount : '',
    accounts,
    micOff: stored.micOff !== false,
    cameraOff: stored.cameraOff !== false,
    soundOn: stored.soundOn !== false,
    notifyOn: stored.notifyOn !== false,
    startDelaySec: clampDelay(stored.startDelaySec),
  };
}

export async function writeSettings(patch) {
  await chrome.storage.sync.set(patch);
}

/** Add an email to the known accounts list if it is not there yet. */
export async function rememberAccount(email) {
  const clean = String(email ?? '').trim();
  if (!clean.includes('@')) return;
  const settings = await readSettings();
  if (settings.accounts.some((a) => a.toLowerCase() === clean.toLowerCase())) return;
  await writeSettings({ accounts: [...settings.accounts, clean] });
}
