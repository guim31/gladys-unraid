// -----------------------------------------------------------------------------
// The bookkeeping of the scene triggers, alone: steps, re-arming, cooldown,
// the first sight that announces nothing, the notifications remembered.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATIONS_PER_READ,
  NOTIFICATIONS_REMEMBERED,
  TEMPERATURE_COOLDOWN_MS,
  Watcher,
} from '../src/alerts.js';

const disk = (temperature, extra = {}) => ({
  key: 'disk1',
  label: 'Disk 1',
  status: 'DISK_OK',
  ok: true,
  errors: 0,
  temperature,
  ...extra,
});

test('a hot disk: confirmed, re-armed 3 °C below, not twice within the cooldown', () => {
  const watcher = new Watcher();
  let now = 0;
  const read = (temperature) => {
    now += 60_000;
    return watcher.disks([disk(temperature)], now).hot.map((entry) => entry.threshold);
  };
  assert.deepEqual(read(30), [], 'first sight');
  assert.deepEqual(read(51), []);
  assert.deepEqual(read(51), [40, 45, 50]);
  assert.deepEqual(read(52), []);
  assert.deepEqual(read(48), [], 'not 3 °C below 50 yet');
  assert.deepEqual(read(46), [], 're-armed at 50');
  assert.deepEqual(read(50), []);
  assert.deepEqual(read(50), [], 'within the cooldown: taken silently');
  now += TEMPERATURE_COOLDOWN_MS;
  assert.deepEqual(read(40), [], 're-arms 45 too');
  assert.deepEqual(read(51), []);
  assert.deepEqual(read(51), [45, 50]);
});

test('a sleeping disk is skipped, and its pending reads forgotten', () => {
  const watcher = new Watcher();
  watcher.disks([disk(30)], 0);
  watcher.disks([disk(56)], 1);
  watcher.disks([disk(null)], 2);
  assert.deepEqual(watcher.disks([disk(56)], 3).hot, [], 'one read again after the sleep');
  assert.equal(watcher.disks([disk(56)], 4).hot.length, 4);
});

test('a disk in error: status and growing errors, once each; a reboot resets the counter', () => {
  const watcher = new Watcher();
  assert.deepEqual(watcher.disks([disk(30, { status: 'DISK_DSBL', ok: false })], 0).failing, []);
  const read = (extra) => watcher.disks([disk(30, extra)], 1).failing.map((f) => f.reason);
  assert.deepEqual(read({ status: 'DISK_DSBL', ok: false }), [], 'already known at first sight');
  assert.deepEqual(read({}), []);
  assert.deepEqual(read({ status: 'DISK_NP_DSBL', ok: false }), ['status']);
  assert.deepEqual(read({ status: 'DISK_NP_DSBL', ok: false }), []);
  assert.deepEqual(read({ errors: 2 }), ['errors']);
  assert.deepEqual(read({ errors: 0 }), [], 'rebooted');
  assert.deepEqual(read({ errors: 1 }), ['errors']);
});

test('the parity: nothing at first sight, the result once it ends', () => {
  const watcher = new Watcher();
  const parity = (status, extra = {}) => ({
    status,
    active: status === 'RUNNING' || status === 'PAUSED',
    paused: status === 'PAUSED',
    progress: 0,
    errors: 0,
    operation: 'check',
    ...extra,
  });
  // Running at first sight: its start is unknown, so is its duration.
  assert.equal(watcher.parity(parity('RUNNING'), 0), null);
  assert.equal(watcher.parity(parity('PAUSED'), 60_000), null);
  assert.deepEqual(watcher.parity(parity('COMPLETED'), 3 * 60_000), {
    result: 'ok',
    errors: 0,
    operation: 'check',
    durationMinutes: null,
  });
  assert.equal(watcher.parity(parity('COMPLETED'), 4 * 60_000), null);
  watcher.parity(parity('RUNNING', { operation: 'rebuild' }), 5 * 60_000);
  assert.deepEqual(watcher.parity(parity('FAILED', { errors: 3 }), 65 * 60_000), {
    result: 'aborted',
    errors: 3,
    operation: 'rebuild',
    durationMinutes: 60,
  });
  // The duration Unraid gives wins over the one seen.
  watcher.parity(parity('RUNNING'), 70 * 60_000);
  assert.equal(
    watcher.parity(parity('COMPLETED', { durationSeconds: 69_123 }), 80 * 60_000).durationMinutes,
    1152,
  );
  assert.equal(watcher.parity(null, 0), null, 'no parity status on this API');
});

test('the notifications: none at first sight, the new ones oldest first, a burst capped', () => {
  const watcher = new Watcher();
  const note = (id, minute) => ({ id, timestamp: new Date(minute * 60_000).toISOString() });
  assert.deepEqual(watcher.notifications([note('a', 1)]), []);
  assert.deepEqual(
    watcher.notifications([note('c', 3), note('b', 2), note('a', 1)]).map((n) => n.id),
    ['b', 'c'],
  );
  assert.deepEqual(watcher.notifications([note('c', 3)]), [], 'read or archived: nothing');
  const burst = Array.from({ length: 25 }, (_, i) => note(`n${i}`, 10 + i));
  const fired = watcher.notifications(burst);
  assert.equal(fired.length, NOTIFICATIONS_PER_READ);
  assert.equal(fired.at(-1).id, 'n24', 'the most recent ones');
  // Remembered within bounds, even after many.
  for (let i = 0; i < 40; i += 1) {
    watcher.notifications(Array.from({ length: 20 }, (_, j) => note(`m${i}-${j}`, 100 + i)));
  }
  assert.ok(watcher.saved.notifications.seen.length <= NOTIFICATIONS_REMEMBERED);
});

test('a container stopped on two reads; one removed; one stopped by Gladys', () => {
  const watcher = new Watcher();
  const list = (states) =>
    Object.entries(states).map(([name, state]) => ({ name, state, running: state === 'RUNNING' }));
  watcher.containers(list({ plex: 'RUNNING', db: 'RUNNING', web: 'RUNNING' }), 0);
  assert.deepEqual(
    watcher.containers(list({ plex: 'EXITED', web: 'EXITED' }), 60_000, (n) => n === 'web'),
    [],
  );
  // Two reads, but within a minute of the first miss (an update at 15 s).
  assert.deepEqual(
    watcher.containers(list({ plex: 'EXITED', web: 'EXITED' }), 75_000, (n) => n === 'web'),
    [],
  );
  assert.deepEqual(
    watcher.containers(list({ plex: 'EXITED', web: 'EXITED' }), 121_000, (n) => n === 'web'),
    [
      { name: 'plex', state: 'EXITED' },
      { name: 'db', state: 'absent' },
    ],
  );
  assert.deepEqual(
    watcher.stoppedContainers().map((c) => c.name),
    ['db', 'plex', 'web'],
  );
});

test('the tables survive a restart (they are what /data keeps)', () => {
  const watcher = new Watcher();
  watcher.disks([disk(30)], 0);
  watcher.notifications([{ id: 'a' }]);
  const restored = new Watcher(JSON.parse(JSON.stringify(watcher.saved)));
  assert.deepEqual(
    restored.notifications([{ id: 'a' }, { id: 'b' }]).map((n) => n.id),
    ['b'],
  );
  assert.ok(restored.saved.disks.disk1);
  restored.forgetStale(8 * 24 * 3600_000, 7 * 24 * 3600_000);
  assert.equal(restored.saved.disks.disk1, undefined);
  // Garbage in /data is ignored.
  assert.doesNotThrow(() => new Watcher({ disks: 3, notifications: 'x', parity: 'y' }));
});

test('the notifications kept are the most recent ones', () => {
  const watcher = new Watcher();
  watcher.notifications([]);
  // 40 unread, the API lists 20 of them; then 300 others came and went.
  const unread = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}` }));
  watcher.notifications(unread.slice(0, 20));
  watcher.notifications(unread.slice(20, 40));
  for (let i = 0; i < 14; i += 1) {
    watcher.notifications(Array.from({ length: 20 }, (_, j) => ({ id: `old${i}-${j}` })));
  }
  // The newest are archived: older unread ones come back in the list.
  assert.deepEqual(watcher.notifications(unread.slice(20, 40)), [], 'already announced');
});

test('a parity check that ended without a readable error count waits for it', () => {
  const watcher = new Watcher();
  const parity = (status, errors) => ({
    status,
    active: status === 'RUNNING',
    paused: false,
    progress: 0,
    errors,
    operation: 'check',
  });
  watcher.parity(parity('RUNNING', 0), 0);
  watcher.parity(parity('RUNNING', 0), 1);
  assert.equal(watcher.parity(parity('COMPLETED', null), 2), null, 'waits');
  assert.equal(watcher.parity(parity('COMPLETED', 4), 3).result, 'errors');
  // Never readable: announced after two reads, errors unknown.
  watcher.parity(parity('RUNNING', 0), 4);
  assert.equal(watcher.parity(parity('COMPLETED', null), 5), null);
  assert.equal(watcher.parity(parity('COMPLETED', null), 6), null);
  assert.equal(watcher.parity(parity('COMPLETED', null), 7).errors, null);
});
