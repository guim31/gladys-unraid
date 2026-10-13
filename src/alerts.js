// -----------------------------------------------------------------------------
// What the scene triggers compare with, read after read: the transitions of
// disks, parity, containers and notifications. Pure bookkeeping, no I/O: the
// hub (src/hub.js) feeds it every successful read and fires the events it
// returns. The tables live in /data (src/store.js) so a restart neither
// repeats an announcement nor misses one (a parity check that ended while
// the integration was stopped is announced at the next read).
//
//   - disk in error: a disk whose status leaves "normal" (disabled, missing,
//     emulated…), or whose read error count grows;
//   - disk too hot: the scene filters of Gladys only compare for equality,
//     so the trigger carries a `threshold` filter among fixed steps, and one
//     event is fired per step crossed. Confirmed on two reads in a row,
//     re-armed 3 °C below the step, not twice within 30 minutes. A sleeping
//     disk has no temperature: it is skipped, never woken;
//   - parity check finished: the parity was busy (check, rebuild, clear) and
//     no longer is, with its result;
//   - container stopped: seen running, then not running (or removed) on two
//     reads in a row (an update recreates it within seconds), and not
//     stopped by Gladys itself (no loop with a scene that stops it);
//   - notification: an unread notification of Unraid not seen before.
//
// The first time an item is seen, its state is recorded without any event:
// nothing has changed, and no scene could exist yet at the very first read.
// -----------------------------------------------------------------------------

export const DISK_TEMPERATURE_THRESHOLDS = Object.freeze([40, 45, 50, 55, 60, 65, 70]);
export const TEMPERATURE_REARM_DEGREES = 3;
export const TEMPERATURE_CONFIRM_READS = 2;
export const TEMPERATURE_COOLDOWN_MS = 30 * 60_000;

export const CONTAINER_CONFIRM_READS = 2;
// …and that long at least: an update recreates a container in up to a minute.
export const CONTAINER_CONFIRM_MS = 60_000;

// Reads a finished parity operation waits for its error count.
export const PARITY_WAIT_READS = 2;

// Notification ids remembered, beyond the ones still unread.
export const NOTIFICATIONS_REMEMBERED = 300;
// New notifications announced per read at most (a burst after a reboot).
export const NOTIFICATIONS_PER_READ = 10;

export const PARITY_RESULTS = Object.freeze({
  OK: 'ok',
  ERRORS: 'errors',
  ABORTED: 'aborted',
});

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numbers = (value) => (Array.isArray(value) ? value.filter(Number.isFinite) : []);
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

export class Watcher {
  constructor(saved = {}) {
    const tables = object(saved);
    this.saved = {
      disks: object(tables.disks),
      containers: object(tables.containers),
      parity: tables.parity && typeof tables.parity === 'object' ? tables.parity : null,
      notifications: {
        primed: object(tables.notifications).primed === true,
        seen: strings(object(tables.notifications).seen),
      },
    };
    /** A container seen not running: reads in a row and since when, by name. */
    this.misses = new Map();
    /** Reads in a row a disk was at or above a step, by `key|step`. */
    this.highs = new Map();
  }

  /**
   * @param {Array<object>} disks the disks of the snapshot (src/unraid/model.js)
   * @returns {{ failing: Array<{ disk: object, reason: 'status'|'errors' }>, hot: Array<{ disk: object, threshold: number }> }}
   */
  disks(disks, now) {
    const failing = [];
    const hot = [];
    for (const disk of disks) {
      const entry = this.saved.disks[disk.key];
      if (!entry) {
        this.saved.disks[disk.key] = {
          status: disk.status,
          errors: disk.errors,
          above:
            disk.temperature === null
              ? []
              : DISK_TEMPERATURE_THRESHOLDS.filter((step) => disk.temperature >= step),
          firedAt: {},
          seenAt: now,
        };
        continue;
      }
      if (!disk.ok && disk.status !== entry.status) {
        failing.push({ disk, reason: 'status' });
      } else if (disk.errors > (Number.isFinite(entry.errors) ? entry.errors : 0)) {
        failing.push({ disk, reason: 'errors' });
      }
      // The counter restarts from 0 at every boot: a lower count is recorded.
      const above = new Set(numbers(entry.above));
      const firedAt = object(entry.firedAt);
      for (const step of DISK_TEMPERATURE_THRESHOLDS) {
        const highKey = `${disk.key}|${step}`;
        if (disk.temperature === null) {
          this.highs.delete(highKey); // asleep: cool, and never woken to know
          continue;
        }
        if (disk.temperature >= step) {
          if (above.has(step)) {
            continue;
          }
          const reads = (this.highs.get(highKey) ?? 0) + 1;
          if (reads < TEMPERATURE_CONFIRM_READS) {
            this.highs.set(highKey, reads);
            continue;
          }
          this.highs.delete(highKey);
          above.add(step);
          // Within the cooldown, the step is taken silently: re-armed only
          // once the disk cooled down, like after an announcement.
          if (!(now - (firedAt[step] ?? -Infinity) < TEMPERATURE_COOLDOWN_MS)) {
            firedAt[step] = now;
            hot.push({ disk, threshold: step });
          }
        } else {
          this.highs.delete(highKey);
          if (disk.temperature < step - TEMPERATURE_REARM_DEGREES) {
            above.delete(step);
          }
        }
      }
      this.saved.disks[disk.key] = {
        status: disk.status,
        errors: disk.errors,
        above: [...above].sort((a, b) => a - b),
        firedAt,
        seenAt: now,
      };
    }
    return { failing, hot };
  }

  /**
   * @param {object|null} parity the parity of the snapshot
   * @returns {{ result: string, errors: number|null, operation: string, durationMinutes: number|null }|null}
   *   the operation that just ended
   */
  parity(parity, now) {
    if (!parity) {
      return null;
    }
    const previous = this.saved.parity;
    const aborted = parity.status === 'CANCELLED' || parity.status === 'FAILED';
    // Just ended, but the error count was not readable (the vars group
    // failed): wait a read or two rather than announce a wrong "no error".
    if (
      previous?.active &&
      !parity.active &&
      !aborted &&
      parity.errors === null &&
      (previous.waited ?? 0) < PARITY_WAIT_READS
    ) {
      this.saved.parity = { ...previous, waited: (previous.waited ?? 0) + 1 };
      return null;
    }
    this.saved.parity = {
      active: parity.active,
      operation: parity.active ? parity.operation : (previous?.operation ?? parity.operation),
      // Seen starting: now. Already running at first sight: unknown.
      startedAt: parity.active
        ? previous?.active
          ? previous.startedAt
          : previous
            ? now
            : null
        : null,
    };
    if (!previous || !previous.active || parity.active) {
      return null;
    }
    const errors = parity.errors;
    const result = aborted
      ? PARITY_RESULTS.ABORTED
      : errors > 0
        ? PARITY_RESULTS.ERRORS
        : PARITY_RESULTS.OK;
    return {
      result,
      errors,
      operation: previous.operation ?? parity.operation,
      // Unraid's own count (from the start of the operation) when it gives one.
      durationMinutes: Number.isFinite(parity.durationSeconds)
        ? Math.round(parity.durationSeconds / 60)
        : Number.isFinite(previous.startedAt)
          ? Math.round((now - previous.startedAt) / 60_000)
          : null,
    };
  }

  /**
   * @param {Array<{ name: string, state: string, running: boolean }>} containers
   *   every container Unraid lists (stopped ones included)
   * @param {(name: string) => boolean} [stoppedByGladys] a stop Gladys asked for
   * @returns {Array<{ name: string, state: string }>} the containers that stopped
   */
  containers(containers, now, stoppedByGladys = () => false) {
    const stopped = [];
    const listed = new Set();
    const notRunning = (name, state) => {
      const entry = this.saved.containers[name];
      if (!entry?.running) {
        return;
      }
      const miss = this.misses.get(name) ?? { reads: 0, since: now };
      miss.reads += 1;
      if (miss.reads < CONTAINER_CONFIRM_READS || now - miss.since < CONTAINER_CONFIRM_MS) {
        this.misses.set(name, miss);
        return;
      }
      this.misses.delete(name);
      this.saved.containers[name] = { ...entry, running: false, state, since: now };
      if (!stoppedByGladys(name)) {
        stopped.push({ name, state });
      }
    };

    for (const container of containers) {
      listed.add(container.name);
      const entry = this.saved.containers[container.name];
      if (container.running) {
        this.misses.delete(container.name);
        this.saved.containers[container.name] = {
          running: true,
          state: container.state,
          since: entry?.running ? entry.since : now,
          seenAt: now,
        };
      } else if (!entry) {
        this.saved.containers[container.name] = {
          running: false,
          state: container.state,
          since: now,
          seenAt: now,
        };
      } else {
        this.saved.containers[container.name] = { ...entry, seenAt: now };
        notRunning(container.name, container.state);
      }
    }
    for (const name of Object.keys(this.saved.containers)) {
      if (!listed.has(name)) {
        notRunning(name, 'absent');
      }
    }
    return stopped;
  }

  /**
   * @param {Array<{ id: string }>} unread the unread notifications Unraid lists
   * @returns {Array<object>} the ones not seen before, oldest first
   */
  notifications(unread) {
    const table = this.saved.notifications;
    const seen = new Set(table.seen);
    const fresh = unread.filter((notification) => !seen.has(notification.id));
    const primed = table.primed;
    // The ones still unread first, then the most recent of the others.
    const ids = unread.map((notification) => notification.id);
    const kept = new Set(ids);
    const older = table.seen.filter((id) => !kept.has(id));
    // `older` is most recent first: its head is what to keep.
    table.seen = [...ids, ...older.slice(0, Math.max(0, NOTIFICATIONS_REMEMBERED - ids.length))];
    table.primed = true;
    if (!primed) {
      return [];
    }
    const byTime = (a, b) =>
      (Date.parse(a.timestamp ?? '') || 0) - (Date.parse(b.timestamp ?? '') || 0);
    return [...fresh].sort(byTime).slice(-NOTIFICATIONS_PER_READ);
  }

  /** The containers seen running before and stopped since, by name. */
  stoppedContainers() {
    return Object.entries(this.saved.containers)
      .filter(([, entry]) => entry && !entry.running)
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Forget everything (the address now points at another machine). */
  forgetAll() {
    this.saved = {
      disks: {},
      containers: {},
      parity: null,
      notifications: { primed: false, seen: [] },
    };
    this.misses.clear();
    this.highs.clear();
  }

  /** Forget what the server no longer shows after `maxAgeMs` (a disk removed, a container deleted). */
  forgetStale(now, maxAgeMs) {
    for (const table of [this.saved.disks, this.saved.containers]) {
      for (const [id, entry] of Object.entries(table)) {
        if (!(entry?.seenAt >= now - maxAgeMs)) {
          delete table[id];
          this.misses.delete(id);
        }
      }
    }
  }
}
