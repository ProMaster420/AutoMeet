// Date helpers. Everything is stored as epoch milliseconds; the UI works in local time.

const pad = (n) => String(n).padStart(2, '0');

/** epoch ms -> value for <input type="datetime-local"> (local time, minute precision). */
export function toInputValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value -> epoch ms. '' -> null, malformed -> NaN. */
export function fromInputValue(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(ms) {
  return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatFull(ms) {
  return new Date(ms).toLocaleString([], {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "in 12 min", "in 2 h 5 min", "in 3 days", "now". Only for future times. */
export function formatRelative(ms, now = Date.now()) {
  const diff = ms - now;
  if (diff <= 30 * 1000) return 'now';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'in under a minute';
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
  }
  const days = Math.round(diff / 86400000);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** A sensible default join time: at least 5 minutes ahead, rounded up to the next 5. */
export function defaultJoinTime(now = Date.now()) {
  const step = 5 * 60 * 1000;
  return Math.ceil((now + step) / step) * step;
}
