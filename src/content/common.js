// Shared engine for the platform adapters (meet.js, zoom.js, google-signin.js).
// This is a classic script (content scripts cannot be ES modules), so it exposes one global.
//
// What it does:
//   1. Asks the service worker whether THIS tab was opened by AutoMeet for a live run.
//      If not (you opened Meet or Zoom yourself), it does nothing at all.
//   2. Drives the adapter: turn camera/mic off, verify, click Join, detect waiting rooms,
//      detect "in meeting", and keep watching until the meeting ends.
//   3. Reports every step to the service worker, which owns the meeting status.
(() => {
  if (globalThis.AutoMeetCS) return;

  const MSG = {
    READY: 'AM_CS_READY',
    STATUS: 'AM_CS_STATUS',
    ACCOUNT: 'AM_CS_ACCOUNT',
    LEAVE: 'AM_LEAVE',
    ABORT: 'AM_ABORT',
  };
  const PREJOIN_LIMIT_MS = 90 * 1000;
  const CLICKED_LIMIT_MS = 90 * 1000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  const labelOf = (el) => norm(el.getAttribute('aria-label') || el.textContent);
  const isDisabled = (el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true';

  /** First visible, enabled button/link whose text or aria-label matches `regex`. */
  function findClickable(regex, root = document) {
    for (const el of root.querySelectorAll('button, [role="button"], a[href]')) {
      if (!isVisible(el) || isDisabled(el)) continue;
      if (regex.test(norm(el.textContent)) || regex.test(norm(el.getAttribute('aria-label')))) return el;
    }
    return null;
  }

  const pageText = () => (document.body ? document.body.innerText || '' : '').slice(0, 30000);

  async function waitFor(fn, timeoutMs, intervalMs = 300) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = await fn();
      if (v) return v;
      await sleep(intervalMs);
    }
    return null;
  }

  function send(message) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);
    } catch {
      return Promise.resolve(null); // extension was reloaded; this page is orphaned
    }
  }

  async function report(ctx, status, extra = {}) {
    const key = JSON.stringify([status, extra]);
    if (ctx.lastReport[status] === key) return;
    ctx.lastReport[status] = key;
    await send({ type: MSG.STATUS, meetingId: ctx.meetingId, runId: ctx.runId, status, ...extra });
  }

  const describeDevices = (d, settings) => {
    const bad = [];
    if (settings.micOff && d.mic === 'on') bad.push('microphone');
    if (settings.cameraOff && d.camera === 'on') bad.push('camera');
    return bad;
  };

  async function checkDevices(adapter, ctx) {
    if (!adapter.ensureDevices || ctx.deviceChecks >= 6) return;
    ctx.deviceChecks += 1;
    try {
      const d = await adapter.ensureDevices(ctx.settings);
      await report(ctx, 'devices', { devices: d });
    } catch {
      /* best effort */
    }
  }

  async function doLeave(adapter, ctx) {
    ctx.leaving = true;
    let ok = false;
    try {
      ok = await adapter.leave();
    } catch {
      ok = false;
    }
    if (!ok) ctx.leaving = false;
    return ok;
  }

  async function run(adapter, ctx) {
    const startedAt = Date.now();
    ctx.joined = ctx.status === 'in_meeting' || ctx.status === 'leaving'; // page reloaded mid-meeting
    ctx.waiting = false;
    ctx.deviceChecks = ctx.joined ? 3 : 0;
    ctx.accountTries = 0;
    ctx.prepTries = 0;

    const fail = (detail) => report(ctx, 'failed', { detail });

    while (!ctx.aborted) {
      try {
        if (adapter.dismissDialogs) await adapter.dismissDialogs();
      } catch {
        /* ignore */
      }

      let st;
      try {
        st = adapter.detectState();
      } catch {
        st = { state: 'unknown' };
      }

      if (st.state === 'in_meeting') {
        if (!ctx.joined) {
          ctx.joined = true;
          await report(ctx, 'in_meeting');
        }
        await checkDevices(adapter, ctx);
      } else if (st.state === 'ended') {
        if (ctx.leaving) return; // our own Leave click: the service worker records it
        await report(ctx, ctx.joined ? 'ended' : 'failed', {
          detail: st.reason || (ctx.joined ? 'The meeting ended.' : 'The meeting ended before AutoMeet could join.'),
        });
        return;
      } else if (st.state === 'blocked') {
        if (!ctx.joined) {
          await fail(st.reason || 'The meeting page needs your attention.');
          return;
        }
      } else if (st.state === 'waiting') {
        if (!ctx.joined) {
          ctx.waiting = true;
          await report(ctx, 'waiting');
        }
      } else if (st.state === 'landing') {
        if (adapter.advanceLanding) await adapter.advanceLanding();
      } else if (st.state === 'prejoin') {
        if (ctx.joined) {
          // The meeting page went back to the lobby: the call is over for us.
          if (!ctx.leaving) await report(ctx, 'ended', { detail: 'You are no longer in the meeting.' });
          return;
        }

        // 1. Make sure the right Google account is in use (Meet only).
        if (adapter.detectAccount && !ctx.accountChecked) {
          const email = adapter.detectAccount();
          if (email) {
            ctx.accountChecked = true;
            await send({ type: MSG.ACCOUNT, meetingId: ctx.meetingId, runId: ctx.runId, email });
            if (ctx.account && email.toLowerCase() !== ctx.account.toLowerCase()) {
              await fail(`Meet opened as ${email}, not ${ctx.account}. Sign that account in to Chrome, or pick another one.`);
              return;
            }
          } else if (++ctx.accountTries < 4) {
            await sleep(700);
            continue;
          }
        }

        // 2. Camera and microphone off, and verified, before joining.
        if (!ctx.devicesReady) {
          const d = await adapter.prepareDevices(ctx.settings);
          await report(ctx, 'devices', { devices: d });
          const bad = describeDevices(d, ctx.settings);
          if (bad.length) {
            if (++ctx.prepTries >= 3) {
              await fail(`Couldn’t turn the ${bad.join(' and ')} off, so AutoMeet didn’t join. Join manually.`);
              return;
            }
            await sleep(800);
            continue;
          }
          ctx.devicesReady = true;
        }

        // 3. Join.
        if (!ctx.joinClickedAt) {
          const r = await adapter.clickJoin();
          if (r && r.clicked) {
            ctx.joinClickedAt = Date.now();
            await report(ctx, 'joining');
          }
        }
      }

      // Give up if the page never gets anywhere.
      if (!ctx.joined && !ctx.waiting) {
        const deadline = ctx.joinClickedAt ? ctx.joinClickedAt + CLICKED_LIMIT_MS : startedAt + PREJOIN_LIMIT_MS;
        if (Date.now() > deadline) {
          await fail(
            ctx.joinClickedAt
              ? 'AutoMeet clicked Join but the meeting didn’t open.'
              : (adapter.stallReason && adapter.stallReason()) || 'AutoMeet couldn’t find the Join button on this page.',
          );
          return;
        }
      }

      await sleep(ctx.joined ? 2000 : 1000);
    }
  }

  async function start(adapter) {
    const ready = await send({ type: MSG.READY, url: location.href, platform: adapter.platform });
    if (!ready || !ready.start) return; // not an AutoMeet tab: leave the page alone

    const ctx = {
      ...ready,
      aborted: false,
      leaving: false,
      lastReport: {},
    };

    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (!msg || msg.runId !== ctx.runId) return undefined;
      if (msg.type === MSG.LEAVE) {
        doLeave(adapter, ctx).then((ok) => respond({ ok }));
        return true;
      }
      if (msg.type === MSG.ABORT) {
        ctx.aborted = true;
        respond({ ok: true });
      }
      return undefined;
    });

    await run(adapter, ctx);
  }

  const api = { sleep, norm, isVisible, labelOf, isDisabled, findClickable, pageText, waitFor, start, registry: {} };
  globalThis.AutoMeetCS = api;
})();
