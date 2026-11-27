# AutoMeet

### Your meetings, right on time.

Never worry about forgetting to join an online class, missing a lecture, or staying in a meeting longer than you intended.

**AutoMeet** is a lightweight Chrome extension that automatically joins your scheduled Google Meet and Zoom meetings, with your camera and microphone turned off by default. Set when you want to join, optionally choose when to leave, and let AutoMeet handle the rest.

Whether you're a student attending online classes, a teacher managing virtual lessons, or someone who spends their day in online meetings, AutoMeet helps make your schedule a little easier to manage.

---

## Why AutoMeet?

Life gets busy. Between classes, assignments, work and everything else, remembering every meeting can become another thing to worry about.

AutoMeet takes care of the little things so you can focus on what matters.

- **Never miss a meeting.** Schedule your meetings ahead of time and let AutoMeet open them when it's time to join.
- **Your privacy comes first.** Meetings are prepared with your camera and microphone turned off by default.
- **Leave on your own schedule.** Set an optional leave time and AutoMeet will handle leaving when the time comes.
- **Keep things simple.** Everything is managed from a small, straightforward Chrome popup.
- **No extra accounts needed.** Your meetings and settings are stored locally in your browser.

## Features

### Automatic meeting scheduling

Add your Google Meet or Zoom meeting link, choose a date and time, and AutoMeet takes care of opening the meeting when it's due.

### Optional automatic leaving

Choose a leave time when scheduling your meeting. Don't need one? Simply leave it empty. AutoMeet will let you stay in the meeting until you leave manually.

### Google account selection

Have multiple Google accounts? Choose which account AutoMeet should use when opening a Google Meet meeting.

### Camera and microphone protection

AutoMeet attempts to disable your camera and microphone before joining. It verifies their state and won't proceed if a device configured to be off is still enabled.

### Meeting status tracking

Keep track of what's happening with your scheduled meetings:

- Scheduled
- Preparing
- Joining
- Waiting for host
- In meeting
- Leaving
- Completed
- Failed
- Cancelled

### Join notifications and countdown

Get a notification and a short chime before a scheduled meeting opens. A countdown gives you time to prepare, with options to join immediately or cancel the scheduled join.

### Emergency stop

Need to stop everything? Emergency Stop cancels upcoming automatic joins and aborts joins in progress without affecting meetings you're already attending.

---

## Getting Started

### Requirements

- Google Chrome 116 or newer.
- An active internet connection.
- A signed-in Google account for Google Meet, or an appropriate Zoom browser session.
- Chrome running when a scheduled meeting is due.

### Installation

AutoMeet currently supports manual installation through Chrome's Developer Mode.

1. Download or clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the AutoMeet project folder containing `manifest.json`.
6. Pin AutoMeet to your Chrome toolbar for easy access.

That's it! AutoMeet is ready to use.

### Scheduling your first meeting

1. Click the AutoMeet icon in your Chrome toolbar.
2. Select **Add meeting**.
3. Give your meeting a name and paste its Google Meet or Zoom link.
4. Choose your preferred join date and time.
5. Optionally configure a leave date and time.
6. If you're scheduling a Google Meet, select the Google account you want to use.
7. Save your meeting.

Your meeting will now appear in the scheduled meeting list.

You can edit, cancel or delete scheduled meetings whenever you need to.

---

## How It Works

AutoMeet uses Chrome's built-in extension capabilities to manage meeting schedules and browser interactions.

- Meeting information is stored locally using Chrome Storage.
- Scheduled actions are managed through Chrome Alarms.
- Separate integrations handle Google Meet and Zoom.
- Meeting states are tracked to prevent duplicate joining or leaving actions.
- Scheduled alarms are reconstructed when the extension's background service worker restarts.

**No AutoMeet account, external backend or cloud database is required.**

## Privacy

Your meetings are personal, and your scheduling information should stay that way.

AutoMeet is designed to work locally within your browser.

- Meeting details are stored in Chrome's local storage.
- Preferences are stored using Chrome's sync storage.
- No AutoMeet registration is required.
- No meeting recordings, transcripts or conversation data are collected.
- Google account selection does not require AutoMeet OAuth authentication.

For Google Meet, AutoMeet uses the selected account's existing Chrome sign-in session. It does not obtain or store your Google password.

---

## Important Limitations

AutoMeet automates interactions with the existing Google Meet and Zoom web interfaces. There are a few things worth knowing before using it.

- **Chrome must be running.** AutoMeet cannot open meetings while Chrome is completely closed. Meetings missed by up to 10 minutes may still be attempted when Chrome starts again.
- **Meeting admission is not guaranteed.** Waiting rooms, host approval, authentication and other platform restrictions still apply.
- **Google accounts must already be signed in.** AutoMeet cannot sign you into an account automatically.
- **Zoom browser requirements apply.** Zoom meetings must support browser joining, and a saved display name may be required.
- **Platform interfaces can change.** Automated interactions depend on the current Google Meet and Zoom web interfaces.
- **Real meeting integration requires testing.** The integrations have not yet been verified against live Google Meet and Zoom sessions in the development environment.

AutoMeet does not bypass authentication, CAPTCHAs, waiting rooms, host admission or platform security restrictions.

If an automated action cannot be completed, AutoMeet reports the failure rather than pretending the meeting was successfully joined.

---

## Running Tests

AutoMeet includes a Node.js test suite covering scheduling, validation, platform detection and meeting lifecycle behaviour.

Requirements: Node.js 20 or newer.

Run:

```bash
npm test
```

The test suite currently contains 41 tests.

---

## Built With

- JavaScript
- HTML5
- CSS3
- Chrome Extension Manifest V3
- Chrome Extension APIs
- Node.js test runner

---

## A Little More About AutoMeet

AutoMeet was built around a simple idea: managing online meetings shouldn't be another thing you have to remember.

Whether it's your morning lecture, an afternoon tutorial, a virtual classroom or another meeting on your calendar, sometimes you just need something to make sure you're there on time.

**Set your schedule. Let AutoMeet handle the rest.**
