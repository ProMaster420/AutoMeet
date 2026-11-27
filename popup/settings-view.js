// Settings: default Google account, camera/mic preferences, emergency stop.

import { FINAL, IN_FLIGHT, STATUS } from '../src/lib/constants.js';
import { readMeetings, readSettings, rememberAccount, writeSettings } from '../src/lib/storage.js';
import { detectChromeAccount, emergencyStop } from './api.js';
import { backHeader } from './components.js';
import { h } from './dom.js';
import { icon } from './icons.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toggleRow({ label, hint, checked, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, onChange: () => onChange(input.checked) });
  return h('label', { class: 'switch-row' }, h('span', { class: 'switch-text' }, h('span', {}, label), hint ? h('span', { class: 'hint' }, hint) : null), input, h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

export async function createSettingsView({ onClose }) {
  // Offer the account Chrome itself is signed in with as a starting point.
  const chromeAccount = await detectChromeAccount();
  if (chromeAccount) await rememberAccount(chromeAccount);

  let settings = await readSettings();
  const body = h('div', { class: 'scroll settings' });
  const el = h('section', { class: 'view' }, backHeader({ title: 'Settings', onBack: onClose }), body);

  async function save(patch) {
    await writeSettings(patch);
    settings = await readSettings();
  }

  async function render() {
    const meetings = await readMeetings();
    const upcoming = meetings.filter((m) => m.status === STATUS.SCHEDULED || IN_FLIGHT.has(m.status)).length;

    // Default account
    const defaultSelect = h('select', { 'aria-label': 'Default Google Meet account' });
    defaultSelect.append(
      h('option', { value: '' }, 'Chrome’s account'),
      ...settings.accounts.map((a) => h('option', { value: a }, a)),
    );
    defaultSelect.value = settings.defaultAccount;
    defaultSelect.addEventListener('change', () => save({ defaultAccount: defaultSelect.value }));

    // Account list
    const accountList = h(
      'ul',
      { class: 'accounts' },
      settings.accounts.length
        ? settings.accounts.map((a) =>
            h(
              'li',
              {},
              h('span', { class: 'acct' }, h('span', { html: icon('user', 14) }), a),
              h('button', {
                class: 'icon-btn',
                type: 'button',
                title: `Remove ${a}`,
                'aria-label': `Remove ${a}`,
                html: icon('x', 14),
                onClick: async () => {
                  await save({
                    accounts: settings.accounts.filter((x) => x !== a),
                    defaultAccount: settings.defaultAccount === a ? '' : settings.defaultAccount,
                  });
                  render();
                },
              }),
            ),
          )
        : h('li', { class: 'muted' }, 'No accounts added yet.'),
    );

    const addInput = h('input', { type: 'email', placeholder: 'Add an account, e.g. name@gmail.com', autocomplete: 'off', 'aria-label': 'Google account email' });
    const addError = h('p', { class: 'field-error', hidden: true, role: 'alert' });
    const addForm = h(
      'form',
      {
        class: 'add-account',
        novalidate: true,
        onSubmit: async (e) => {
          e.preventDefault();
          const email = addInput.value.trim();
          if (!EMAIL.test(email)) {
            addError.textContent = 'Enter a valid email address.';
            addError.hidden = false;
            return;
          }
          await rememberAccount(email);
          settings = await readSettings();
          render();
        },
      },
      addInput,
      h('button', { class: 'btn', type: 'submit' }, 'Add'),
    );

    // Emergency stop (two-step)
    const result = h('p', { class: 'hint', role: 'status' });
    let armed = false;
    const stop = h('button', { class: 'btn danger block', type: 'button', disabled: upcoming === 0 }, 'Stop all upcoming joins');
    stop.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        stop.textContent = `Click again to cancel ${upcoming} ${upcoming === 1 ? 'meeting' : 'meetings'}`;
        setTimeout(() => {
          if (armed) {
            armed = false;
            stop.textContent = 'Stop all upcoming joins';
          }
        }, 4000);
        return;
      }
      armed = false;
      const reply = await emergencyStop();
      result.textContent = reply.ok ? `Cancelled ${reply.cancelled} ${reply.cancelled === 1 ? 'meeting' : 'meetings'}. Meetings you’re already in are untouched.` : reply.error;
      render();
    });

    // Heads-up before joining
    const delayLabel = (n) => (n === 0 ? 'No wait' : `${n} s`);
    const value = h('output', { class: 'range-value' }, delayLabel(settings.startDelaySec));
    const range = h('input', { type: 'range', min: 0, max: 120, step: 5, value: settings.startDelaySec, 'aria-label': 'Wait before opening the meeting' });
    const paint = () => range.style.setProperty('--pct', `${(range.value / 120) * 100}%`);
    paint();
    range.addEventListener('input', () => {
      value.textContent = delayLabel(Number(range.value));
      paint();
    });
    range.addEventListener('change', () => save({ startDelaySec: Number(range.value) }));
    const testSound = h('button', {
      class: 'btn',
      type: 'button',
      onClick: () => new Audio(chrome.runtime.getURL('sounds/chime.wav')).play().catch(() => {}),
    }, 'Play test sound');

    body.replaceChildren(
      h(
        'section',
        { class: 'group' },
        h('h2', { class: 'group-title' }, 'Google Meet account'),
        h('label', { class: 'stack' }, h('span', { class: 'field-label' }, 'Default account'), defaultSelect),
        h('p', { class: 'hint' }, 'Used for Meet meetings that don’t pick their own. Accounts must already be signed in to Chrome.'),
        accountList,
        addForm,
        addError,
      ),
      h(
        'section',
        { class: 'group' },
        h('h2', { class: 'group-title' }, 'Camera and microphone'),
        toggleRow({ label: 'Turn the camera off before joining', checked: settings.cameraOff, onChange: (v) => save({ cameraOff: v }) }),
        toggleRow({ label: 'Turn the microphone off before joining', checked: settings.micOff, onChange: (v) => save({ micOff: v }) }),
        h('p', { class: 'hint' }, 'AutoMeet checks the result and won’t join if it can’t confirm a device you asked to be off.'),
      ),
      h(
        'section',
        { class: 'group' },
        h('h2', { class: 'group-title' }, 'Heads-up before joining'),
        toggleRow({ label: 'Play a sound', checked: settings.soundOn, onChange: (v) => save({ soundOn: v }) }),
        toggleRow({ label: 'Show a notification', checked: settings.notifyOn, onChange: (v) => save({ notifyOn: v }) }),
        h('div', { class: 'stack' }, h('div', { class: 'range-head' }, h('span', { class: 'field-label' }, 'Wait before opening the meeting'), value), range),
        h('p', { class: 'hint' }, 'When a meeting is due, AutoMeet alerts you, waits this long, then opens it. You can press Join now or Cancel during the wait.'),
        h('div', {}, testSound),
      ),
      h(
        'section',
        { class: 'group' },
        h('h2', { class: 'group-title' }, 'Emergency stop'),
        h('p', { class: 'hint' }, upcoming ? `${upcoming} ${upcoming === 1 ? 'meeting is' : 'meetings are'} waiting to join.` : 'Nothing is waiting to join.'),
        stop,
        result,
      ),
    );
  }

  await render();
  return { el, refresh: () => {} };
}
