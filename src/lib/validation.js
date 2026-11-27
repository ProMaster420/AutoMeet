// Meeting form validation. Used by the popup (instant feedback) and again by the
// service worker (the authoritative check before anything is stored).

import { ACTIVE, FINAL } from './constants.js';
import { PLATFORM, parseMeetingUrl, defaultMeetingName } from './platform.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUPLICATE_WINDOW_MS = 60 * 1000;
const OVERLAP_PADDING_MS = 5 * 60 * 1000;

const hasValue = (v) => v !== null && v !== undefined && v !== '';

function windowOf(m) {
  return [m.joinAt, m.leaveAt ?? m.joinAt + OVERLAP_PADDING_MS];
}

/**
 * @param input    {name, url, joinAt:number|null, leaveAt:number|null, account:string}
 * @param opts     {now, others: Meeting[], existing: Meeting|null}
 * @returns {{ok:boolean, errors:Object, warnings:string[], value:Object|null}}
 */
export function validateMeetingInput(input, { now = Date.now(), others = [], existing = null } = {}) {
  const errors = {};
  const warnings = [];
  const editingActive = !!existing && ACTIVE.has(existing.status);

  // URL / platform
  let platform;
  let url;
  let id;
  if (editingActive) {
    ({ platform, url } = existing);
    id = existing.urlId ?? '';
  } else {
    const parsed = parseMeetingUrl(input.url);
    if (parsed.ok) ({ platform, url, id } = parsed);
    else errors.url = parsed.error;
  }

  // Join time
  let joinAt;
  if (editingActive) {
    joinAt = existing.joinAt;
  } else if (!hasValue(input.joinAt) || Number.isNaN(Number(input.joinAt))) {
    errors.joinAt = 'Choose when AutoMeet should join.';
  } else {
    joinAt = Number(input.joinAt);
    if (joinAt <= now) errors.joinAt = 'The join time must be in the future.';
  }

  // Leave time (optional)
  let leaveAt = null;
  if (hasValue(input.leaveAt)) {
    leaveAt = Number(input.leaveAt);
    if (Number.isNaN(leaveAt)) {
      errors.leaveAt = 'Enter a valid leave time.';
    } else if (Number.isFinite(joinAt) && leaveAt <= joinAt) {
      errors.leaveAt = 'The leave time must be after the join time.';
    } else if (leaveAt <= now) {
      errors.leaveAt = 'The leave time must be in the future.';
    }
  }

  // Google account (Meet only)
  let account = '';
  if (platform === PLATFORM.MEET && hasValue(input.account)) {
    account = String(input.account).trim();
    if (!EMAIL.test(account)) errors.account = 'Enter a valid email address.';
  }

  // Name
  let name = String(input.name ?? '').trim();
  if (name.length > 80) errors.name = 'Keep the name under 80 characters.';
  if (!name && platform) name = defaultMeetingName(platform, id);

  // Conflicts with other meetings
  const live = others.filter((o) => (!existing || o.id !== existing.id) && !FINAL.has(o.status));
  if (!errors.url && !errors.joinAt && !editingActive) {
    const dup = live.find(
      (o) => o.url.toLowerCase() === url.toLowerCase() && Math.abs(o.joinAt - joinAt) < DUPLICATE_WINDOW_MS,
    );
    if (dup) errors.url = 'This meeting is already scheduled for that time.';
  }
  if (!errors.joinAt && Number.isFinite(joinAt)) {
    const mine = [joinAt, leaveAt ?? joinAt + OVERLAP_PADDING_MS];
    for (const o of live) {
      const [s, e] = windowOf(o);
      if (mine[0] < e && s < mine[1]) {
        warnings.push(`Overlaps with “${o.name}”. AutoMeet will join both.`);
        if (warnings.length === 2) break;
      }
    }
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    warnings,
    value: ok ? { name, url, platform, urlId: id, joinAt, leaveAt, account } : null,
  };
}
