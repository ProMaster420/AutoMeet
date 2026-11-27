// Add / edit meeting form.

import { ACTIVE, FINAL } from '../src/lib/constants.js';
import { PLATFORM, PLATFORM_LABEL, parseMeetingUrl } from '../src/lib/platform.js';
import { readMeetings, readSettings, rememberAccount } from '../src/lib/storage.js';
import { defaultJoinTime, fromInputValue, toInputValue } from '../src/lib/time.js';
import { validateMeetingInput } from '../src/lib/validation.js';
import { createMeeting, updateMeeting } from './api.js';
import { backHeader, field } from './components.js';
import { h } from './dom.js';
import { icon } from './icons.js';

const NEW_ACCOUNT = '__new';

export async function createFormView({ meeting = null, onClose }) {
  const [settings, meetings] = await Promise.all([readSettings(), readMeetings()]);
  const inProgress = !!meeting && ACTIVE.has(meeting.status);
  const rescheduling = !!meeting && FINAL.has(meeting.status);
  let submitted = false;
  let urlTouched = false;

  // -- inputs ---------------------------------------------------------------------------
  const nameInput = h('input', { type: 'text', maxlength: 80, placeholder: 'Weekly sync', value: meeting?.name ?? '', autocomplete: 'off' });
  const urlInput = h('input', { type: 'text', placeholder: 'meet.google.com/abc-defg-hij or zoom.us/j/…', value: meeting?.url ?? '', autocomplete: 'off', spellcheck: false, disabled: inProgress });
  const joinInput = h('input', {
    type: 'datetime-local',
    value: toInputValue(meeting && !rescheduling ? meeting.joinAt : defaultJoinTime()),
    disabled: inProgress,
  });
  const leaveInput = h('input', { type: 'datetime-local', value: meeting?.leaveAt ? toInputValue(meeting.leaveAt) : '' });

  // Account picker: default, each known account, or a new one.
  const accountSelect = h('select', { disabled: inProgress });
  const newAccountInput = h('input', { type: 'email', placeholder: 'name@gmail.com', hidden: true, autocomplete: 'off' });
  const known = [...settings.accounts];
  if (meeting?.account && !known.some((a) => a.toLowerCase() === meeting.account.toLowerCase())) known.push(meeting.account);
  accountSelect.append(
    h('option', { value: '' }, settings.defaultAccount ? `Default (${settings.defaultAccount})` : 'Default (Chrome’s account)'),
    ...known.map((a) => h('option', { value: a }, a)),
    h('option', { value: NEW_ACCOUNT }, 'Another account…'),
  );
  accountSelect.value = meeting?.account || '';

  // -- fields ---------------------------------------------------------------------------
  const platformChip = h('p', { class: 'platform-line', hidden: true });
  const nameField = field({ label: 'Meeting name', input: nameInput });
  const urlField = field({ label: 'Meeting link', input: urlInput, extra: platformChip });
  const joinField = field({ label: 'Join at', input: joinInput });
  const clearLeave = h('button', { class: 'link-btn', type: 'button', onClick: () => { leaveInput.value = ''; update(); } }, 'Clear');
  const leaveField = field({
    label: 'Leave at (optional)',
    input: leaveInput,
    hint: 'Leave this empty to stay in the meeting until you leave yourself.',
    extra: h('div', { class: 'inline-action' }, clearLeave),
  });
  const accountExtra = h('div', {}, newAccountInput);
  const accountField = field({
    label: 'Google account',
    input: accountSelect,
    hint: 'Meet opens as this account. It must already be signed in to Chrome.',
    extra: accountExtra,
  });

  const warningBox = h('div', { class: 'warnings', hidden: true });
  const formError = h('p', { class: 'field-error form-error', hidden: true, role: 'alert' });
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, meeting ? (rescheduling ? 'Reschedule' : 'Save changes') : 'Save meeting');
  const cancelBtn = h('button', { class: 'btn', type: 'button', onClick: onClose }, 'Cancel');

  const progressNote = inProgress
    ? h('p', { class: 'note' }, 'This meeting is in progress. You can rename it or change when it ends.')
    : null;

  const form = h(
    'form',
    { class: 'form scroll', novalidate: true },
    progressNote,
    nameField.el,
    urlField.el,
    h('div', { class: 'row' }, joinField.el, leaveField.el),
    accountField.el,
    warningBox,
    formError,
    h('div', { class: 'form-actions' }, cancelBtn, saveBtn),
  );

  // -- behaviour ------------------------------------------------------------------------
  function selectedAccount() {
    return accountSelect.value === NEW_ACCOUNT ? newAccountInput.value.trim() : accountSelect.value;
  }

  function collect() {
    return {
      name: nameInput.value,
      url: urlInput.value,
      joinAt: fromInputValue(joinInput.value),
      leaveAt: fromInputValue(leaveInput.value),
      account: selectedAccount(),
    };
  }

  const platformNow = () => (inProgress ? meeting.platform : (parseMeetingUrl(urlInput.value).platform ?? null));

  function update() {
    const parsed = inProgress ? { ok: true, platform: meeting.platform } : parseMeetingUrl(urlInput.value);
    platformChip.hidden = !parsed.ok;
    if (parsed.ok) {
      platformChip.innerHTML = `${icon('check', 14)}<span>${PLATFORM_LABEL[parsed.platform]}</span>`;
    }
    // Zoom uses your browser's Zoom session; the account picker only applies to Meet.
    const showAccount = !parsed.ok || parsed.platform === PLATFORM.MEET;
    accountField.el.hidden = !showAccount;
    newAccountInput.hidden = accountSelect.value !== NEW_ACCOUNT;

    const result = validateMeetingInput(collect(), { now: Date.now(), others: meetings, existing: meeting });
    const errors = result.errors;
    nameField.setError(submitted ? errors.name : '');
    urlField.setError(submitted || (urlTouched && urlInput.value) ? errors.url : '');
    joinField.setError(submitted ? errors.joinAt : '');
    leaveField.setError(submitted || leaveInput.value ? errors.leaveAt : '');
    accountField.setError(submitted ? errors.account : '');

    warningBox.replaceChildren(...result.warnings.map((w) => h('p', {}, h('span', { html: icon('alert', 14) }), w)));
    warningBox.hidden = !result.warnings.length;
    return result;
  }

  for (const input of [nameInput, urlInput, joinInput, leaveInput, accountSelect, newAccountInput]) {
    input.addEventListener('input', update);
    input.addEventListener('change', update);
  }
  urlInput.addEventListener('blur', () => {
    urlTouched = true;
    update();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitted = true;
    formError.hidden = true;
    const result = update();
    if (!result.ok) return;

    saveBtn.disabled = true;
    const input = collect();
    const reply = meeting ? await updateMeeting(meeting.id, input) : await createMeeting(input);
    if (reply.ok) {
      if (platformNow() === PLATFORM.MEET && accountSelect.value === NEW_ACCOUNT) await rememberAccount(input.account);
      onClose();
      return;
    }
    saveBtn.disabled = false;
    if (reply.errors) {
      submitted = true;
      const e = reply.errors;
      nameField.setError(e.name);
      urlField.setError(e.url);
      joinField.setError(e.joinAt);
      leaveField.setError(e.leaveAt);
      accountField.setError(e.account);
    } else {
      formError.textContent = reply.error || 'Couldn’t save the meeting. Try again.';
      formError.hidden = false;
    }
  });

  update();

  const el = h('section', { class: 'view' }, backHeader({ title: meeting ? (rescheduling ? 'Reschedule meeting' : 'Edit meeting') : 'New meeting', onBack: onClose }), form);
  // preventScroll: the screen is still sliding in, and focusing must not scroll the stage.
  queueMicrotask(() => (meeting ? nameInput : urlInput).focus({ preventScroll: true }));
  return { el };
}
