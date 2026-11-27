// Runs on accounts.google.com. If a Meet tab opened by AutoMeet ends up on a Google sign-in or
// account-chooser page, the chosen account isn't signed in. AutoMeet never signs in for you, so
// it reports that clearly instead of waiting for a timeout.
(() => {
  const C = globalThis.AutoMeetCS;
  if (!C) return;
  const loadedAt = Date.now();

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    C.start({
      platform: 'google-accounts',
      // Google sometimes passes through this page for a moment on a normal sign-in, so wait a few seconds.
      detectState: () =>
        Date.now() - loadedAt < 6000
          ? { state: 'unknown' }
          : {
              state: 'blocked',
              reason: 'Google asked for a sign-in or account choice. Sign that account in to Chrome, then reschedule.',
            },
      stallReason: () => 'Google asked for a sign-in.',
    });
  }
})();
