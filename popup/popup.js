// Popup entry point: a tiny router between the list, the form and the settings.

import { createFormView } from './form-view.js';
import { createListView } from './list-view.js';
import { createSettingsView } from './settings-view.js';

const app = document.getElementById('app');
let current = null;

// Screens move like a navigation stack: going deeper slides the new screen in from the right while
// the old one drifts left; going back reverses it. Both screens are on stage at once inside a
// fixed-size popup, so nothing resizes or jumps.
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const DURATION = 420;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function show(view, direction = 'none') {
  const old = current;
  current = view;
  old?.destroy?.();

  // Drop anything left over from an interrupted transition.
  for (const el of [...app.children]) if (el !== old?.el) el.remove();

  if (!old || direction === 'none' || reducedMotion() || !view.el.animate) {
    app.replaceChildren(view.el);
    return;
  }

  const forward = direction === 'forward';
  const opts = { duration: DURATION, easing: EASE, fill: 'both' };
  const incoming = view.el;
  const outgoing = old.el;

  incoming.style.zIndex = forward ? '2' : '1';
  outgoing.style.zIndex = forward ? '1' : '2';
  if (forward) incoming.style.boxShadow = '-12px 0 28px rgba(0, 0, 0, 0.35)';
  else outgoing.style.boxShadow = '-12px 0 28px rgba(0, 0, 0, 0.35)';
  app.append(incoming);

  const animations = forward
    ? [
        incoming.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], opts),
        outgoing.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-28%)', opacity: 0.55 }], opts),
      ]
    : [
        incoming.animate([{ transform: 'translateX(-28%)', opacity: 0.55 }, { transform: 'translateX(0)', opacity: 1 }], opts),
        outgoing.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], opts),
      ];

  Promise.all(animations.map((a) => a.finished)).then(
    () => {
      outgoing.remove();
      incoming.style.zIndex = '';
      incoming.style.boxShadow = '';
      for (const a of animations) a.cancel();
    },
    () => {}, // interrupted by a newer transition, which cleans up after itself
  );
}

function showList(direction = 'back') {
  show(createListView({ onAdd: () => showForm(null), onEdit: (m) => showForm(m), onSettings: showSettings }), direction);
}

async function showForm(meeting) {
  show(await createFormView({ meeting, onClose: () => showList('back') }), 'forward');
}

async function showSettings() {
  show(await createSettingsView({ onClose: () => showList('back') }), 'forward');
}

// Keep the list live while the popup is open (statuses change in the background).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.meetings) current?.refresh?.();
});

showList('none');
