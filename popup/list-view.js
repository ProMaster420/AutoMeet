// The main view: every meeting as a compact card, plus the Add Meeting button.

import { ACTIVE, FINAL, IN_FLIGHT, STATUS, STATUS_LABEL } from '../src/lib/constants.js';
import { PLATFORM, PLATFORM_LABEL, resolveAccount } from '../src/lib/platform.js';
import { readMeetings, readSettings } from '../src/lib/storage.js';
import { formatDay, formatFull, formatRelative, formatTime, sameDay } from '../src/lib/time.js';
import { cancelMeeting, deleteMeeting, joinNow } from './api.js';
import { brandHeader, iconButton } from './components.js';
import { h } from './dom.js';
import { icon } from './icons.js';

const byJoinTime = (a, b) => a.joinAt - b.joinAt;

// Cards that have already been shown. Only genuinely new cards animate in.
const seen = new Set();

/** Collapse a card out of the list, then run `then`. */
function collapse(el, then) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !el.animate) return then();
  const height = el.offsetHeight;
  el.style.overflow = 'hidden';
  const anim = el.animate(
    [
      { height: `${height}px`, opacity: 1, transform: 'scale(1)', marginBottom: '0px' },
      { height: '0px', opacity: 0, transform: 'scale(0.96)', marginBottom: '-8px', paddingTop: '0px', paddingBottom: '0px', borderWidth: '0px' },
    ],
    { duration: 300, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' },
  );
  anim.onfinish = then;
  return undefined;
}

/** Refresh every visible countdown (cheap: touches only those elements). */
function tickCountdowns(root) {
  const now = Date.now();
  for (const el of root.querySelectorAll('.countdown')) {
    const openAt = Number(el.dataset.openAt);
    const total = Number(el.dataset.delay) || 1;
    const remaining = Math.max(0, openAt - now);
    el.querySelector('.count-text').textContent = remaining > 0 ? `Opening in ${Math.ceil(remaining / 1000)} s` : 'Opening now…';
    el.style.setProperty('--w', `${Math.min(100, (remaining / total) * 100)}%`);
  }
}

function statusChip(m) {
  return h('span', { class: `chip chip-${m.status}` }, STATUS_LABEL[m.status] ?? m.status);
}

function deviceNote(devices) {
  if (!devices) return null;
  const part = (name, state, offIcon) => {
    const text =
      state === 'off' ? `${name} off` : state === 'on' ? `${name} on` : `${name} not verified`;
    return h('span', { class: `dev dev-${state}` }, h('span', { html: icon(offIcon, 14) }), text);
  };
  return h('div', { class: 'devices' }, part('Mic', devices.mic ?? 'unknown', 'micOff'), part('Camera', devices.camera ?? 'unknown', 'videoOff'));
}

function leaveLabel(m) {
  if (!m.leaveAt) return h('span', { class: 'time muted' }, 'No auto-leave');
  const text = sameDay(m.joinAt, m.leaveAt) ? formatTime(m.leaveAt) : `${formatDay(m.leaveAt)} ${formatTime(m.leaveAt)}`;
  return h('span', { class: 'time' }, h('span', { class: 'time-key' }, 'Leave'), text);
}

function actions(m, { onEdit, rerender }) {
  const buttons = [];
  const cancellable = m.status === STATUS.SCHEDULED || IN_FLIGHT.has(m.status);

  buttons.push(iconButton({ name: 'edit', label: FINAL.has(m.status) ? 'Reschedule' : 'Edit', onClick: () => onEdit(m) }));

  if (cancellable) {
    buttons.push(
      iconButton({
        name: 'ban',
        label: 'Cancel this meeting',
        onClick: async () => {
          await cancelMeeting(m.id);
          rerender();
        },
      }),
    );
  }

  // Two-step delete: the first click arms the button, the second confirms.
  let armed = false;
  let timer;
  const del = h('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', 'aria-label': 'Delete', html: icon('trash') });
  del.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      del.classList.add('armed');
      del.textContent = 'Delete?';
      timer = setTimeout(() => {
        armed = false;
        del.classList.remove('armed');
        del.innerHTML = icon('trash');
      }, 3000);
      return;
    }
    clearTimeout(timer);
    collapse(del.closest('.card'), async () => {
      await deleteMeeting(m.id);
      rerender();
    });
  });
  buttons.push(del);

  return h('div', { class: 'card-actions' }, buttons);
}

function card(m, settings, handlers, index) {
  const now = Date.now();
  const account = m.platform === PLATFORM.MEET ? resolveAccount(m, settings) : '';
  const showRelative = m.status === STATUS.SCHEDULED && m.joinAt > now;

  const counting = m.status === STATUS.PREPARING && !m.openedAt && m.openAt > now;
  const countdown = counting
    ? h(
        'div',
        { class: 'countdown', 'data-open-at': m.openAt, 'data-delay': m.delayMs || 1 },
        h('div', { class: 'bar' }, h('span', {})),
        h('span', { class: 'count-text' }, ''),
        h('button', { class: 'link-btn', type: 'button', onClick: async () => { await joinNow(m.id); handlers.rerender(); } }, 'Join now'),
      )
    : null;

  const isNew = !seen.has(m.id);
  seen.add(m.id);

  const detail =
    !counting && m.statusDetail && m.status !== STATUS.SCHEDULED && m.status !== STATUS.IN_MEETING
      ? h('p', { class: `detail detail-${m.status}` }, m.statusDetail)
      : null;

  return h(
    'article',
    { class: `card card-${m.status}${isNew ? ' enter' : ''}`, 'data-id': m.id, style: `--i:${Math.min(index, 6)}` },
    h(
      'div',
      { class: 'card-head' },
      h('div', { class: 'card-title' }, h('h3', { title: m.name }, m.name), h('span', { class: `plat plat-${m.platform}` }, PLATFORM_LABEL[m.platform])),
      h('div', { class: 'card-status' }, statusChip(m), showRelative ? h('span', { class: 'rel' }, formatRelative(m.joinAt, now)) : null),
    ),
    h(
      'div',
      { class: 'card-times' },
      h('span', { class: 'time', title: formatFull(m.joinAt) }, h('span', { html: icon('calendar', 14) }), formatDay(m.joinAt)),
      h('span', { class: 'time' }, h('span', { class: 'time-key' }, 'Join'), formatTime(m.joinAt)),
      leaveLabel(m),
    ),
    m.status === STATUS.IN_MEETING || m.status === STATUS.LEAVING ? deviceNote(m.devices) : null,
    countdown,
    detail,
    h(
      'div',
      { class: 'card-foot' },
      m.platform === PLATFORM.MEET
        ? h('span', { class: 'acct', title: account ? `Opens as ${account}` : 'Uses the account Chrome picks for Meet' }, h('span', { html: icon('user', 14) }), account || 'Chrome’s default account')
        : h('span', { class: 'acct muted' }, 'Uses your Zoom session in Chrome'),
      actions(m, handlers),
    ),
  );
}

export function createListView({ onAdd, onEdit, onSettings }) {
  const list = h('div', { class: 'scroll' });
  const el = h(
    'section',
    { class: 'view' },
    brandHeader({ onSettings }),
    list,
    h('footer', { class: 'bottom' }, h('button', { class: 'btn primary block', type: 'button', onClick: onAdd, html: `${icon('plus')}<span>Add meeting</span>` })),
  );

  let destroyed = false;

  async function refresh() {
    if (destroyed) return;
    const [meetings, settings] = await Promise.all([readMeetings(), readSettings()]);
    if (destroyed) return;

    const upcoming = meetings.filter((m) => !FINAL.has(m.status));
    const earlier = meetings.filter((m) => FINAL.has(m.status));
    // Meetings in progress first, then by start time.
    upcoming.sort((a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status)) || byJoinTime(a, b));
    earlier.sort((a, b) => byJoinTime(b, a));

    const handlers = { onEdit, rerender: refresh };
    list.replaceChildren();

    if (!meetings.length) {
      list.append(
        h(
          'div',
          { class: 'empty' },
          h('p', { class: 'empty-title' }, 'No meetings yet'),
          h('p', { class: 'empty-text' }, 'Add a Google Meet or Zoom link and AutoMeet will join at the time you choose, with your camera and microphone off.'),
        ),
      );
      return;
    }

    if (upcoming.length) list.append(h('div', { class: 'cards' }, upcoming.map((m, i) => card(m, settings, handlers, i))));
    else list.append(h('p', { class: 'quiet' }, 'Nothing scheduled.'));
    if (earlier.length) {
      list.append(h('h2', { class: 'section-title' }, 'Earlier'), h('div', { class: 'cards' }, earlier.map((m, i) => card(m, settings, handlers, upcoming.length + i))));
    }
    tickCountdowns(list);
  }

  // Keep "in 12 min" fresh while the popup is open.
  const ticker = setInterval(refresh, 30000);
  const countdownTicker = setInterval(() => tickCountdowns(list), 1000);

  refresh();
  return {
    el,
    refresh,
    destroy() {
      destroyed = true;
      clearInterval(ticker);
      clearInterval(countdownTicker);
    },
  };
}
