// Offscreen document: service workers can't play audio, so this plays AutoMeet's chime.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === 'offscreen' && msg.type === 'AM_PLAY_SOUND') {
    const audio = new Audio(chrome.runtime.getURL('sounds/chime.wav'));
    audio.volume = 0.7;
    audio.play().catch(() => {});
  }
});
