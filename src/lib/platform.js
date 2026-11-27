// Platform detection, URL validation and join-URL building. Pure functions, no Chrome APIs.

export const PLATFORM = Object.freeze({ MEET: 'meet', ZOOM: 'zoom' });
export const PLATFORM_LABEL = Object.freeze({ meet: 'Google Meet', zoom: 'Zoom' });

const MEET_HOST = 'meet.google.com';
const MEET_CODE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;
const MEET_LOOKUP = /^\/lookup\/[A-Za-z0-9_-]+$/;
const MEET_NICKNAME = /^\/[a-z0-9][a-z0-9_-]{2,}$/i;
const MEET_RESERVED = new Set(['landing', 'new', 'about', 'lookup', 'whoops', 'tel', 'calling', 'linkredirect']);

const ZOOM_HOST = /(^|\.)zoom\.us$/i;
const ZOOMGOV_HOST = /(^|\.)zoomgov\.com$/i;
const ZOOM_ID_PATHS = [/^\/j\/(\d{9,11})$/, /^\/wc\/(\d{9,11})\/join$/, /^\/wc\/join\/(\d{9,11})$/];
const ZOOM_PERSONAL = /^\/my\/[A-Za-z0-9._-]+$/;

function toUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u;
  } catch {
    return null;
  }
}

function stripSlash(p) {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/**
 * Validate and normalise a meeting link.
 * @returns {{ok:true, platform:string, url:string, id:string}|{ok:false, error:string}}
 */
export function parseMeetingUrl(raw) {
  if (!String(raw ?? '').trim()) return { ok: false, error: 'Paste a Google Meet or Zoom link.' };
  const u = toUrl(raw);
  if (!u) return { ok: false, error: 'That doesn’t look like a link.' };
  const host = u.hostname.toLowerCase();
  const path = stripSlash(u.pathname);

  if (host === MEET_HOST) {
    const first = path.split('/')[1]?.toLowerCase() ?? '';
    const valid =
      MEET_CODE.test(path) ||
      MEET_LOOKUP.test(path) ||
      (MEET_NICKNAME.test(path) && !MEET_RESERVED.has(first));
    if (!valid) {
      return { ok: false, error: 'Expected a Meet link like meet.google.com/abc-defg-hij.' };
    }
    return { ok: true, platform: PLATFORM.MEET, url: `https://${MEET_HOST}${path}`, id: path.slice(1) };
  }

  if (ZOOM_HOST.test(host) || ZOOMGOV_HOST.test(host)) {
    const pwd = u.searchParams.get('pwd');
    const query = pwd ? `?pwd=${encodeURIComponent(pwd)}` : '';
    for (const re of ZOOM_ID_PATHS) {
      const m = re.exec(path);
      if (m) {
        return { ok: true, platform: PLATFORM.ZOOM, url: `https://${host}/j/${m[1]}${query}`, id: m[1] };
      }
    }
    if (ZOOM_PERSONAL.test(path)) {
      return { ok: true, platform: PLATFORM.ZOOM, url: `https://${host}${path}${query}`, id: path.slice(4) };
    }
    return { ok: false, error: 'Expected a Zoom link like zoom.us/j/123456789.' };
  }

  return { ok: false, error: 'Only Google Meet and Zoom links are supported.' };
}

export function detectPlatform(raw) {
  const r = parseMeetingUrl(raw);
  return r.ok ? r.platform : null;
}

export function defaultMeetingName(platform, id) {
  return `${PLATFORM_LABEL[platform] ?? 'Meeting'} ${id}`;
}

/** The Google account that will be used for a Meet meeting ('' = whatever Chrome picks). */
export function resolveAccount(meeting, settings = {}) {
  if (meeting.platform !== PLATFORM.MEET) return '';
  return (meeting.account || settings.defaultAccount || '').trim();
}

/**
 * The URL AutoMeet actually opens.
 *  - Meet: adds ?authuser=<email> so Google opens the meeting as the chosen account.
 *  - Zoom: goes straight to the browser client so the "open Zoom app?" prompt is skipped.
 */
export function buildJoinUrl(meeting, settings = {}) {
  const u = new URL(meeting.url);
  if (meeting.platform === PLATFORM.MEET) {
    const account = resolveAccount(meeting, settings);
    if (account) u.searchParams.set('authuser', account);
    return u.toString();
  }
  const m = /^\/j\/(\d{9,11})$/.exec(stripSlash(u.pathname));
  if (!m) return u.toString(); // personal /my/ links: the content script clicks "Join from your browser"
  const host = ZOOMGOV_HOST.test(u.hostname) ? u.hostname : 'app.zoom.us';
  const pwd = u.searchParams.get('pwd');
  return `https://${host}/wc/${m[1]}/join${pwd ? `?pwd=${encodeURIComponent(pwd)}` : ''}`;
}
