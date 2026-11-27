# AutoMeet

A small Chrome extension that joins your scheduled Google Meet and Zoom meetings for you, with the camera and microphone off, and can leave at a time you choose.

Everything happens in a compact popup. There is no server, no AutoMeet account, and nothing leaves your browser.

## Features

- **Auto-join** Google Meet and Zoom at a set date and time.
- **Camera and microphone off** before joining, checked afterwards. If a device you asked to be off is still on, AutoMeet won't join.
- **Optional auto-leave.** Leave the time empty and AutoMeet never leaves for you.
- **Heads-up before joining:** a chime and a notification, then an adjustable wait (0 to 120 seconds) with **Join now** and **Cancel**.
- **Google account per meeting** for Meet, plus a default account.
- **Clear statuses:** Scheduled, Preparing, Joining, Waiting for host, In meeting, Leaving, Completed, Failed, Cancelled. Failures say why.
- **Emergency stop** for everything that's about to join.
- Handles waiting rooms, missed alarms, browser restarts, duplicate events and overlapping meetings.

## Install

AutoMeet isn't on the Chrome Web Store, so load it as an unpacked extension.

1. Clone or download this repository and keep the folder somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Pin AutoMeet from the puzzle-piece menu.

Requires Chrome 116 or newer. After pulling changes, click the refresh icon on AutoMeet's card in `chrome://extensions`.

## Use

1. Click the AutoMeet icon, then **Add meeting**.
2. Paste a Meet or Zoom link. The platform is detected and the link is validated.
3. Set **Join at**, and optionally **Leave at**.
4. For Meet, choose a Google account or keep the default.
5. Save. Edit, cancel or delete from the meeting's card.

### Settings

| Setting | What it does |
| --- | --- |
| Default Google Meet account | Used for Meet meetings that don't pick their own. |
| Camera / microphone | Both off by default. |
| Sound and notification | Each can be turned off. **Play test sound** previews the chime. |
| Wait before opening | 0 to 120 seconds (default 10). |
| Emergency stop | Cancels every upcoming join and any join in progress. Meetings you're already in are untouched. |

## How it works

- **Scheduling:** meetings live in `chrome.storage.local`, preferences in `chrome.storage.sync`. `chrome.alarms` are derived from storage and rebuilt whenever the background service worker starts, so a restart loses nothing. No JavaScript timers schedule joins.
- **State machine:** every status change is a guarded transition inside a serialized storage transaction. A duplicate alarm, a double click or a late message can't start two joins or two leaves.
- **Recovery:** a join missed by up to 10 minutes still happens; older ones become Failed ("Missed"). Stalled joins fail after 4 minutes. Closing the tab, restarting Chrome and cancelling are all handled.
- **Platform adapters:** Meet and Zoom each have their own content script. They only act in tabs AutoMeet opened for a live run, never in a Meet or Zoom tab you opened yourself.
- **Zoom:** AutoMeet opens Zoom's browser client directly, so there is no "open the Zoom app?" prompt. Personal `/my/` links use the "Join from your browser" link.
- **Meet accounts:** Meet is opened with `?authuser=<email>`, which works if that account is already signed in to Chrome. If it isn't, or Meet opens as a different account, AutoMeet stops before joining and says so.

```
manifest.json
src/lib/          constants, platform detection, validation, time, storage
src/background/   scheduler (alarms), lifecycle (state machine), alerts, service worker
src/content/      shared engine plus Meet, Zoom and Google sign-in adapters
src/offscreen/    plays the chime (service workers can't play audio)
popup/            popup UI: list, form and settings views
tests/            node:test suite
```

## What AutoMeet will not do

It never signs in for you, solves CAPTCHAs, enters a passcode it wasn't given, skips a waiting room, or joins as a guest. If a platform requires any of that, the meeting is marked **Failed** with the reason and the tab is left open for you. At a waiting room it waits up to an hour.

When leaving, it clicks the platform's Leave button (never Zoom's "End Meeting for All"). If it can't find the button, it closes the tab and says so on the card.

## Permissions

`alarms` (scheduling), `storage` (meetings and settings), `identity` and `identity.email` (suggest the account signed in to Chrome), `notifications` (the heads-up), `offscreen` (the chime). Content scripts run only on `meet.google.com`, `zoom.us`, `zoomgov.com` and `accounts.google.com`.

## Limitations

- **Chrome must be running** at the join time. Alarms can't start a closed browser, and timing is roughly minute-precise, so schedule at least a minute ahead.
- **Meet and Zoom have no automation API.** The adapters read the pages the way a person would. They have not been verified against the live sites, and if a page changes, the result is a clear Failed status rather than a false success. Please report anything that breaks.
- **Meet's interface should be in English**, because some buttons are matched by their text.
- **Camera and microphone permission:** if Chrome hasn't granted Meet access, AutoMeet picks "Continue without microphone and camera" when both are meant to be off. Otherwise, allow it once for `meet.google.com`.
- **Zoom** needs a saved display name (join once manually) and a meeting that allows joining from the browser.
- The meeting tab opens in the foreground and should stay open.

## Development

```bash
npm test
```

Runs 41 tests on Node 20 or newer: platform detection and URL building, validation, page-text classification for both platforms, manifest integrity, and the full lifecycle against a fake `chrome.*` API. There is no build step; the extension is plain HTML, CSS and JavaScript.

### Manual checklist (needs real Chrome and accounts)

1. Schedule a Meet two minutes ahead: the chime and notification fire, the tab opens, the camera and mic are off, the status reaches In meeting, and it leaves at the leave time.
2. Use a Meet that needs admission: Waiting for host, then In meeting once admitted.
3. Choose an account that isn't signed in: Failed with a sign-in message.
4. Repeat for Zoom, with a link that includes a passcode and one that doesn't.
5. Close Chrome through a join time and reopen within 10 minutes (late join), then after 10 minutes ("Missed").
6. Press **Cancel** during the countdown and confirm no tab opens. Try Emergency stop with two meetings scheduled.

## License

Add a license before publishing (MIT is a common choice for a project like this).