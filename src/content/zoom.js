// Zoom adapter (Zoom's browser client, no app install). Runs on zoom.us / zoomgov.com pages,
// and only acts on tabs AutoMeet opened.
//
// AutoMeet never signs in, solves CAPTCHAs, enters passcodes it wasn't given, or skips the
// waiting room. If Zoom asks for any of that, the status becomes Failed with the reason.
(() => {
  const C = globalThis.AutoMeetCS;
  if (!C) return;

  const RX = {
    signIn: /sign in to join|only authenticated users|authorized attendees only|you need to sign in to join/i,
    captcha: /i.?m not a robot/i,
    invalid: /meeting id is not valid|invalid meeting id|meeting link is invalid|meeting does not exist|meeting not found/i,
    ended: /meeting has been ended by host|the host has ended this meeting|this meeting has ended|you have been removed|removed by the host/i,
    waiting:
      /host will let you in soon|waiting room|waiting for the host to start|host has not (yet )?joined|wait for the host to start this meeting/i,
  };

  /** Pure text classification (unit-tested). Returns null when the text says nothing decisive. */
  function classifyText(text) {
    const t = text || '';
    if (RX.ended.test(t)) return { state: 'ended', reason: 'The Zoom meeting has ended or you were removed.' };
    if (RX.invalid.test(t)) return { state: 'blocked', reason: 'Zoom says this meeting ID or link isn’t valid.' };
    if (RX.signIn.test(t)) return { state: 'blocked', reason: 'This Zoom meeting requires signing in. Sign in to Zoom in Chrome first.' };
    if (RX.captcha.test(t)) return { state: 'blocked', reason: 'Zoom is asking for a CAPTCHA check, which AutoMeet can’t do.' };
    if (RX.waiting.test(t)) return { state: 'waiting' };
    return null;
  }

  const q = (sel) => {
    const el = document.querySelector(sel);
    return el && C.isVisible(el) ? el : null;
  };

  const leaveButton = () => q('.footer__leave-btn') || q('button[aria-label="Leave" i]');
  const joinButton = () => q('#joinBtn') || q('button.preview-join-button') || C.findClickable(/^join$/i);

  function detectState() {
    if (leaveButton()) return { state: 'in_meeting' };
    if (/\/postattendee/.test(location.pathname)) return { state: 'ended', reason: 'The Zoom meeting has ended.' };
    const verdict = classifyText(C.pageText());
    if (verdict && verdict.state !== 'waiting') return verdict;
    if (q('iframe[src*="recaptcha"]')) {
      return { state: 'blocked', reason: 'Zoom is asking for a CAPTCHA check, which AutoMeet can’t do.' };
    }

    const pwd = q('#input-for-pwd');
    if (pwd && !pwd.value) {
      return { state: 'blocked', reason: 'This meeting needs a passcode. Use the full invite link that includes it.' };
    }
    const name = q('#input-for-name');
    if (name && !name.value) {
      return { state: 'blocked', reason: 'Zoom needs a display name. Join once in Chrome and enter it so Zoom remembers it.' };
    }
    if (joinButton()) return { state: 'prejoin' };
    if (verdict) return verdict; // waiting
    if (C.findClickable(/join from your browser/i)) return { state: 'landing' };
    return { state: 'unknown' };
  }

  async function advanceLanding() {
    const link = C.findClickable(/join from your browser/i);
    if (link) link.click();
  }

  async function dismissDialogs() {
    const agree = C.findClickable(/^i agree$/i);
    if (agree) agree.click();
  }

  // -- devices ---------------------------------------------------------------------------

  const byLabel = (regex) => {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (C.isVisible(el) && regex.test(C.norm(el.getAttribute('aria-label')))) return el;
    }
    return null;
  };

  const micButton = (preview) =>
    (preview && q('#preview-audio-control-button')) ||
    byLabel(preview ? /^(mute|unmute)\b/i : /^(mute|unmute)( my)?( microphone)?$/i);
  const videoButton = (preview) =>
    (preview && q('#preview-video-control-button')) || byLabel(/^(stop|start)( my)? video$/i);

  // Zoom words buttons by the action they perform: "Mute" means the mic is currently on.
  const micState = (el) => (el ? (/^unmute/i.test(C.norm(el.getAttribute('aria-label'))) ? 'off' : 'on') : 'unknown');
  const videoState = (el) => (el ? (/^start/i.test(C.norm(el.getAttribute('aria-label'))) ? 'off' : 'on') : 'unknown');

  async function turnOff(getButton, stateOf) {
    for (let i = 0; i < 3; i += 1) {
      const el = getButton();
      if (!el) return 'unknown';
      if (stateOf(el) === 'off') return 'off';
      el.click();
      await C.sleep(600);
    }
    const el = getButton();
    return el ? stateOf(el) : 'unknown';
  }

  async function applyDevices(settings, preview) {
    const mic = settings.micOff
      ? await turnOff(() => micButton(preview), micState)
      : micState(micButton(preview));
    const camera = settings.cameraOff
      ? await turnOff(() => videoButton(preview), videoState)
      : videoState(videoButton(preview));
    return { mic, camera };
  }

  const prepareDevices = (settings) => applyDevices(settings, true);

  async function ensureDevices(settings) {
    // Zoom asks how to join audio once you're in. Connect computer audio (so you can unmute later),
    // then make sure the mic is still off.
    const audio = C.findClickable(/^join audio by computer$/i);
    if (audio) {
      audio.click();
      await C.sleep(800);
    }
    return applyDevices(settings, false);
  }

  async function clickJoin() {
    const btn = joinButton();
    if (!btn || C.isDisabled(btn)) return { clicked: false };
    btn.click();
    return { clicked: true };
  }

  async function leave() {
    const btn = leaveButton();
    if (!btn) return false;
    btn.click();
    // Zoom shows a menu. Click "Leave Meeting" only; never "End Meeting for All".
    const confirm = await C.waitFor(() => C.findClickable(/^leave meeting$/i), 4000, 250);
    if (!confirm) return false;
    confirm.click();
    return !!(await C.waitFor(() => /\/postattendee/.test(location.pathname) || !leaveButton(), 10000, 400));
  }

  C.registry.zoom = { classifyText };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    C.start({
      platform: 'zoom',
      detectState,
      dismissDialogs,
      advanceLanding,
      prepareDevices,
      clickJoin,
      ensureDevices,
      leave,
      stallReason: () => 'AutoMeet couldn’t find Zoom’s Join button. Zoom may be asking you something first.',
    });
  }
})();
