// Shared constants. Imported by the service worker and the popup.

export const STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  PREPARING: 'preparing',
  JOINING: 'joining',
  WAITING: 'waiting_for_host',
  IN_MEETING: 'in_meeting',
  LEAVING: 'leaving',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const STATUS_LABEL = Object.freeze({
  scheduled: 'Scheduled',
  preparing: 'Preparing',
  joining: 'Joining',
  waiting_for_host: 'Waiting for host',
  in_meeting: 'In meeting',
  leaving: 'Leaving',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
});

/** Statuses where a browser tab is (or should be) driving a meeting. */
export const ACTIVE = new Set([
  STATUS.PREPARING,
  STATUS.JOINING,
  STATUS.WAITING,
  STATUS.IN_MEETING,
  STATUS.LEAVING,
]);

/** Joining has started but the meeting has not been entered yet. */
export const IN_FLIGHT = new Set([STATUS.PREPARING, STATUS.JOINING, STATUS.WAITING]);

export const FINAL = new Set([STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED]);

/** Legal status transitions. Anything else is ignored, which makes duplicate events harmless. */
export const TRANSITIONS = Object.freeze({
  scheduled: ['preparing', 'cancelled', 'failed'],
  preparing: ['joining', 'waiting_for_host', 'in_meeting', 'failed', 'cancelled'],
  joining: ['waiting_for_host', 'in_meeting', 'failed', 'cancelled'],
  waiting_for_host: ['joining', 'in_meeting', 'failed', 'cancelled'],
  in_meeting: ['leaving', 'completed', 'failed'],
  leaving: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
});

export const LIMITS = Object.freeze({
  /** A join that was missed (browser closed, computer asleep) is still attempted if it is at most this late. */
  MISSED_JOIN_GRACE_MS: 10 * 60 * 1000,
  /** Preparing/Joining that makes no progress for this long is marked Failed. */
  PREJOIN_STALE_MS: 4 * 60 * 1000,
  /** How long AutoMeet keeps waiting for a host to admit it. */
  WAIT_FOR_HOST_MAX_MS: 60 * 60 * 1000,
  /** How long the Leave button click may take before AutoMeet falls back to closing the tab. */
  LEAVE_ACK_MS: 15 * 1000,
  /** A "Leaving" status older than this is finished by closing the tab. */
  LEAVING_STALE_MS: 2 * 60 * 1000,
  /** Alarms that fire this much earlier than planned are re-armed instead of acted on. */
  EARLY_ALARM_TOLERANCE_MS: 30 * 1000,
  /** The heads-up countdown is short, so its tolerance is tight. */
  OPEN_EARLY_MS: 2 * 1000,
});

export const ALARM_PREFIX = Object.freeze({ JOIN: 'join:', LEAVE: 'leave:', OPEN: 'open:' });
export const RECONCILE_ALARM = 'reconcile';

export const MSG = Object.freeze({
  // popup -> service worker
  CREATE: 'AM_CREATE',
  UPDATE: 'AM_UPDATE',
  DELETE: 'AM_DELETE',
  CANCEL: 'AM_CANCEL',
  EMERGENCY_STOP: 'AM_EMERGENCY_STOP',
  JOIN_NOW: 'AM_JOIN_NOW',
  // content script -> service worker
  CS_READY: 'AM_CS_READY',
  CS_STATUS: 'AM_CS_STATUS',
  CS_ACCOUNT: 'AM_CS_ACCOUNT',
  // service worker -> content script
  LEAVE: 'AM_LEAVE',
  ABORT: 'AM_ABORT',
  // service worker -> offscreen document
  PLAY_SOUND: 'AM_PLAY_SOUND',
});

export const DEFAULT_SETTINGS = Object.freeze({
  defaultAccount: '',
  accounts: [],
  micOff: true,
  cameraOff: true,
  soundOn: true,
  notifyOn: true,
  startDelaySec: 10,
});

export const MAX_START_DELAY_SEC = 120;
