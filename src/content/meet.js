// Google Meet adapter. Runs only on meet.google.com, and only acts on tabs AutoMeet opened.
//
// Meet has no public automation API, so this reads the page the way a person would. Where
// possible it uses language-independent attributes (data-is-muted); otherwise English labels.
// If Google changes the page, the worst case is a clear "Failed" status, never a silent success.
(() => {
  const C = globalThis.AutoMeetCS;
  if (!C) return;

  const RX = {
    denied: /someone in the meeting denied your request|denied your request to join|your request to join was denied/i,
    noResponse: /no one responded to your request/i,
    cantJoin: /you can.?t join this (video )?call|you cannot join this (video )?call/i,
    invalid: /check your meeting code|invalid video call name|meeting code is invalid/i,
    removed: /you('ve| have| were) (been )?removed from the (meeting|call)/i,
    left: /you left the (meeting|call)|you've left the (meeting|call)/i,
    ended: /this (video )?(call|meeting) has ended|the meeting has ended/i,
    waiting: /asking to be let in|let you in soon|waiting for (the host|someone)|when someone lets you in/i,
  };

  /** Pure text classification (unit-tested). Returns null when the text says nothing decisive. */
  function classifyText(text) {
    const t = text || '';
    if (RX.denied.test(t) || RX.noResponse.test(t)) return { state: 'blocked', reason: 'The host didn’t let AutoMeet in.' };
    if (RX.cantJoin.test(t)) return { state: 'blocked', reason: 'Meet says this call can’t be joined.' };
    if (RX.invalid.test(t)) return { state: 'blocked', reason: 'Meet doesn’t recognise this meeting code.' };
    if (RX.removed.test(t)) return { state: 'ended', reason: 'You were removed from the meeting.' };
    if (RX.left.test(t)) return { state: 'ended', reason: 'You left the meeting.' };
    if (RX.ended.test(t)) return { state: 'ended', reason: 'The meeting has ended.' };
    if (RX.waiting.test(t)) return { state: 'waiting' };
    return null;
  }

  const JOIN_TEXT = /^(join now|ask to join)$/i;

  function leaveButton() {
    const found = document.querySelectorAll('button[aria-label*="Leave call" i], [jsname="CQylAd"]');
    for (const el of found) if (C.isVisible(el)) return el;
    return null;
  }

  function joinButton() {
    return C.findClickable(JOIN_TEXT);
  }

  function nameField() {
    const input = document.querySelector('input[aria-label*="your name" i], input[placeholder*="your name" i]');
    return input && C.isVisible(input) ? input : null;
  }

  function detectState() {
    if (leaveButton()) return { state: 'in_meeting' };
    const verdict = classifyText(C.pageText());
    if (verdict && verdict.state !== 'waiting') return verdict;
    if (nameField()) {
      return { state: 'blocked', reason: 'Meet is asking for a name, so you’re not signed in to Google. Sign in, then reschedule.' };
    }
    if (joinButton()) return { state: 'prejoin' };
    if (verdict) return verdict; // waiting
    return { state: 'unknown' };
  }

  function detectAccount() {
    for (const el of document.querySelectorAll('[aria-label*="Google Account" i]')) {
      const m = (el.getAttribute('aria-label') || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (m) return m[0];
    }
    return null;
  }

  /** The microphone and camera toggle buttons (same markup before and during the call). */
  function deviceButtons() {
    const all = [...document.querySelectorAll('[data-is-muted]')].filter(C.isVisible);
    let mic = all.find((el) => /microphone|\bmic\b/i.test(C.labelOf(el)));
    let cam = all.find((el) => /camera|video/i.test(C.labelOf(el)));
    if (!mic && !cam && all.length === 2) [mic, cam] = all; // non-English UI: mic first, camera second
    return { mic, cam };
  }

  const isOff = (el) => el.getAttribute('data-is-muted') === 'true';
  const read = (el) => (el ? (isOff(el) ? 'off' : 'on') : 'unknown');

  async function turnOff(el) {
    if (!el) return 'unknown';
    for (let i = 0; i < 3; i += 1) {
      if (isOff(el)) return 'off';
      el.click();
      await C.sleep(500);
    }
    return read(el);
  }

  async function applyDevices(settings, assumeOffWhenMissing) {
    const { mic, cam } = deviceButtons();
    const out = {
      mic: settings.micOff ? await turnOff(mic) : read(mic),
      camera: settings.cameraOff ? await turnOff(cam) : read(cam),
    };
    if (assumeOffWhenMissing) {
      if (out.mic === 'unknown') out.mic = 'off';
      if (out.camera === 'unknown') out.camera = 'off';
    }
    return out;
  }

  async function dismissDialogs() {
    const gotIt = C.findClickable(/^got it$/i);
    if (gotIt) gotIt.click();
  }

  async function prepareDevices(settings) {
    // When Chrome hasn't granted camera/mic access, Meet asks. Joining without devices is
    // exactly what we want when both are meant to be off.
    let skippedDevices = false;
    if (settings.micOff && settings.cameraOff) {
      const skip = C.findClickable(/^continue without (microphone and camera|mic and camera)/i);
      if (skip) {
        skip.click();
        skippedDevices = true;
        await C.sleep(700);
      }
    }
    return applyDevices(settings, skippedDevices);
  }

  async function clickJoin() {
    const btn = joinButton();
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  }

  const ensureDevices = (settings) => applyDevices(settings, false);

  async function leave() {
    const btn = leaveButton();
    if (!btn) return false;
    btn.click();
    return !!(await C.waitFor(() => {
      const t = C.pageText();
      if (RX.left.test(t) || C.findClickable(/^rejoin$/i)) return true;
      const confirm = C.findClickable(/^leave( call| meeting)?$/i); // confirmation dialogs
      if (confirm) confirm.click();
      return false;
    }, 10000, 400));
  }

  C.registry.meet = { classifyText };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    C.start({
      platform: 'meet',
      detectState,
      detectAccount,
      dismissDialogs,
      prepareDevices,
      clickJoin,
      ensureDevices,
      leave,
      stallReason: () => 'AutoMeet couldn’t find the Join button. If Meet isn’t in English, switch it to English and try again.',
    });
  }
})();
