# AutoMeet

A small Chrome extension that opens your scheduled **Google Meet** and **Zoom** meetings at the time you choose, with the camera and microphone off, and can leave at a time you choose. Everything lives in the popup. No server, no AutoMeet account.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
3. Pin AutoMeet from the puzzle-piece menu.

Requires Chrome 116 or newer. Chrome must be running at the join time (see Limitations).

## Use

1. Click the AutoMeet icon, then **Add meeting**.
2. Paste a Meet or Zoom link. The platform is detected and the link is validated.
3. Choose **Join at**. Optionally choose **Leave at**; leave it empty and AutoMeet never leaves for you.
4. For Meet, pick the Google account (or keep the default).
5. Save. The card shows its status; edit, cancel or delete it from the card.

**Statuses:** Scheduled, Preparing, Joining, Waiting for host, In meeting, Leaving, Completed, Failed, Cancelled. Failed cards say why.

### Heads-up before joining
When a meeting is due, AutoMeet plays a short chime and shows a notification, waits, then opens the meeting. During the wait the card shows a countdown, and both the card and the notification offer **Join now** and **Cancel**.
- **Wait before opening**: 0 to 120 seconds (default 10). At 0 the meeting opens immediately.
- The sound and the notification can each be turned off. **Play test sound** previews the chime.
- The countdown is backed by an alarm, so it still completes if Chrome stops the background worker. Notifications also need to be allowed by your operating system (Do Not Disturb hides them; the chime and the countdown on the card still work).

### Settings
- **Default Google Meet account** and the list of accounts offered in the form. The account signed in to Chrome is added automatically; add others by email. Accounts seen on Meet pages during a join are remembered too.
- **Camera / microphone**: both off by default. AutoMeet verifies the result and **won't join** if a device you asked to be off is still on.
- **Heads-up**: sound, notification and wait time (above).
- **Emergency stop**: cancels every upcoming join and aborts joins in progress. Meetings you're already in are untouched.

## How accounts work

Chrome gives extensions no list of the Google accounts signed in to the browser, and AutoMeet doesn't use OAuth. Instead it opens Meet with `?authuser=<email>`, which makes Google open the meeting as that account **if it is already signed in to Chrome**. If it isn't, Google shows a sign-in page and the meeting is marked Failed with a clear message. If Meet opens as a different account than chosen, AutoMeet stops before joining. No OAuth setup is needed. Zoom uses your existing Zoom session in the browser.

## What AutoMeet will not do

It never signs in, solves CAPTCHAs, enters a passcode it wasn't given, skips a waiting room, or joins as a guest. If a platform requires any of that, the meeting becomes **Failed** with the reason and the tab is left open for you. In a waiting room it waits (up to an hour) and shows **Waiting for host**.

## Leaving

At the leave time AutoMeet clicks the platform's Leave button (never Zoom's "End Meeting for All"). If it can't find the button, it closes the tab, which also leaves, and says so in the card. If you were never admitted, nothing is "left": the attempt is marked Failed and the pending tab is closed.

## Reliability design

- Meetings are in `chrome.storage.local`; preferences in `chrome.storage.sync`.
- Alarms (`chrome.alarms`) are **derived from storage** and rebuilt on every service-worker start, browser start and install. No JavaScript timers schedule anything.
- Every state change is a guarded transition inside a serialized storage transaction, so duplicate alarms, double clicks or late messages can't start two joins or two leaves.
- Missed joins: if Chrome wasn't running, a join up to 10 minutes late still happens; older ones become Failed ("Missed"). Missed leave alarms run on wake.
- Stalled joins fail after 4 minutes; closing the tab, browser restarts and cancelled meetings are all handled.
- Conflicts: an identical link at the same time is rejected; overlapping meetings show a warning and are both joined.
- Content scripts only act in tabs AutoMeet opened for a live run. A Meet or Zoom tab you open yourself is never touched.

```
manifest.json
src/lib/          constants, platform detection, validation, time, storage (no Chrome-specific scheduling)
src/background/   scheduler.js (alarms), lifecycle.js (state machine), service-worker.js
src/content/      common.js (shared engine), meet.js, zoom.js, google-signin.js (platform adapters)
popup/            popup.html/css/js, list, form and settings views
tests/            node:test suite
```

## Limitations (please read)

- **Chrome must be running.** Alarms can't start a closed browser. Alarm timing is about a minute-precise; schedule at least a minute ahead.
- **Meet and Zoom have no automation API.** The adapters read the page like a person would. They were written against the current pages but **could not be tested against live Meet/Zoom here**; if a platform changes its page, the result is a clear Failed status, never a fake success.
- **Meet's UI should be in English** for button text matching (camera/mic toggles are matched by language-independent attributes where possible).
- **Camera/mic permission:** if Chrome hasn't granted Meet access, AutoMeet picks "Continue without microphone and camera" (when both are meant to be off). Otherwise allow it once for meet.google.com.
- **Zoom** runs in the browser client (no app). It needs a saved display name (join once manually) and meetings that allow browser joining without sign-in, or that you're already signed in for.
- The meeting tab opens in front and should stay open; very long background throttling can slow detection.

## Tests

`npm test` (Node 20+) runs 41 tests: platform detection and URL building, validation, time helpers, page-text classification for both platforms, manifest integrity, and the full lifecycle against a fake `chrome.*` (alarms, duplicates, waiting room, leave and fallback, missed alarms, restart recovery, cancel/delete/emergency stop, tab closing).

### Manual test checklist (needs real Chrome and accounts)
1. Schedule a Meet 2 minutes ahead with a test account: confirm tab opens, mic/camera off, status reaches In meeting, and leave works at the leave time.
2. Use a Meet that needs admission: confirm Waiting for host, then In meeting after admission.
3. Pick an account that isn't signed in: confirm Failed with the sign-in message.
4. Same checks for a Zoom link with a passcode link, then without.
5. Close Chrome through a join time and reopen within 10 minutes: confirm a late join; after 10 minutes: confirm "Missed".
6. Click Emergency stop with two meetings scheduled.
