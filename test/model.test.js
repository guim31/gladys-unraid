// -----------------------------------------------------------------------------
// From the API answers to the snapshot: units, sleeping disks, empty slots,
// Gladys' own containers, a UPS on battery, an older API.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGladysContainer,
  itemKey,
  num,
  parseSnapshot,
  slotLabel,
  stripPrefix,
} from '../src/unraid/model.js';
import { TOWER } from './helpers/fakeUnraid.js';

const NOW = Date.parse('2026-10-13T10:00:00.000Z');

/** The groups of a read, from tower.json. */
function groupsOf(data = TOWER) {
  return {
    server: { data: { vars: data.vars, info: data.info } },
    metrics: { data: { metrics: data.metrics } },
    array: { data: { array: data.array } },
    docker: { data: { docker: data.docker } },
    vms: { data: { vms: data.vms } },
    ups: { data: { upsDevices: data.upsDevices } },
    notifications: { data: { notifications: data.notifications } },
  };
}

test('the server, the array and the parity', () => {
  const snapshot = parseSnapshot({ groups: groupsOf() }, NOW);
  assert.equal(snapshot.hostname, 'Tower');
  assert.equal(snapshot.version, '7.2.4');
  assert.equal(Math.round(snapshot.uptimeSeconds / 3600), 76);
  assert.equal(snapshot.cpu, 12.4);
  assert.equal(snapshot.memory, 37.5);
  assert.equal(snapshot.cpuTemperature, 44);
  assert.equal(snapshot.array.started, true);
  assert.equal(Math.round(snapshot.array.usedPercent * 10) / 10, 53.6);
  assert.deepEqual(snapshot.parity, {
    status: 'COMPLETED',
    active: false,
    paused: false,
    progress: 0,
    // `parityCheckStatus.errors` is null on the API: the vars counter.
    errors: 0,
    durationSeconds: 3197,
    operation: 'check',
  });
});

test('the slots: labels, a sleeping disk, a pool member without file system', () => {
  const { disks } = parseSnapshot({ groups: groupsOf() }, NOW);
  assert.deepEqual(
    disks.map((disk) => [disk.key, disk.label, disk.kind]),
    [
      ['parity', 'Parity', 'parity'],
      ['disk1', 'Disk 1', 'data'],
      ['disk2', 'Disk 2', 'data'],
      ['disk3', 'Disk 3', 'data'],
      ['cache', 'Cache', 'cache'],
      ['cache2', 'Cache 2', 'cache'],
    ],
  );
  const disk3 = disks.find((disk) => disk.key === 'disk3');
  assert.equal(disk3.temperature, null);
  assert.equal(disk3.spinning, false);
  const parity = disks.find((disk) => disk.key === 'parity');
  assert.equal(parity.usedPercent, null, 'a parity disk has no file system');
  const cache2 = disks.find((disk) => disk.key === 'cache2');
  assert.equal(cache2.freeKB, null);
  assert.equal(disks.find((disk) => disk.key === 'disk2').criticalPercent, 90);
});

test('empty slots, the flash and impossible temperatures are dropped', () => {
  const data = structuredClone(TOWER);
  data.array.disks.push(
    { name: 'disk4', status: 'DISK_NP', type: 'DATA' },
    { name: 'disk5', status: 'DISK_NP_MISSING', type: 'DATA', temp: 0, numErrors: '7' },
  );
  data.array.caches.push({ name: 'flash', status: 'DISK_OK', type: 'FLASH' });
  const { disks } = parseSnapshot({ groups: groupsOf(data) }, NOW);
  assert.ok(!disks.some((disk) => disk.key === 'disk4' || disk.key === 'flash'));
  const missing = disks.find((disk) => disk.key === 'disk5');
  assert.equal(missing.ok, false);
  assert.equal(missing.temperature, null);
  assert.equal(missing.errors, 7, 'a BigInt as a string');
});

test('containers by name, Gladys own ones protected, VMs by UUID', () => {
  const snapshot = parseSnapshot({ groups: groupsOf() }, NOW);
  assert.deepEqual(
    snapshot.containers.map((c) => [c.key, c.running, c.protected]),
    [
      ['plex', true, false],
      ['sonarr', true, false],
      ['radarr', false, false],
      ['mariadb', true, false],
      ['gladys', true, true],
      ['gladys-unraid-1a2b', true, true],
    ],
  );
  assert.deepEqual(
    snapshot.vms.map((vm) => [vm.key, vm.name, vm.running]),
    [
      ['5f3c7a9e-1b2d-4e6f-8a0b-1c2d3e4f5a6b', 'Windows 11', true],
      ['8e2d4c6b-0a1f-4b3e-9d5c-7f6e5d4c3b2a', 'Home Assistant OS', false],
    ],
  );
  assert.equal(isGladysContainer({ image: 'gladysassistant/gladys:v4.60.0' }), true);
  assert.equal(isGladysContainer({ image: 'docker.io/gladysassistant/gladys' }), true);
  assert.equal(isGladysContainer({ image: 'someone/gladys-backup:latest' }), false);
});

test('the UPS: on mains, then on battery', () => {
  const data = structuredClone(TOWER);
  const [mains] = parseSnapshot({ groups: groupsOf(data) }, NOW).ups;
  assert.equal(mains.onBattery, false);
  assert.equal(mains.runtimeMinutes, 48);
  assert.equal(mains.power, 155.7);
  data.upsDevices[0].status = 'On Battery';
  data.upsDevices[0].power.currentPower = null;
  const [battery] = parseSnapshot({ groups: groupsOf(data) }, NOW).ups;
  assert.equal(battery.onBattery, true);
  assert.equal(Math.round(battery.power), 156, 'from the nominal power and the load');
});

test('a group that failed is null, and named', () => {
  const groups = groupsOf();
  groups.docker = { error: { kind: 'graphql' } };
  delete groups.ups;
  const snapshot = parseSnapshot({ groups }, NOW);
  assert.equal(snapshot.containers, null);
  assert.equal(snapshot.ups, null);
  assert.deepEqual(snapshot.unavailable, { docker: 'graphql' });
});

test('a running check, a rebuild', () => {
  const data = structuredClone(TOWER);
  Object.assign(data.array.parityCheckStatus, { status: 'RUNNING', progress: 47 });
  data.vars.mdResyncAction = 'recon D5';
  const { parity } = parseSnapshot({ groups: groupsOf(data) }, NOW);
  assert.equal(parity.active, true);
  assert.equal(parity.progress, 47);
  assert.equal(parity.operation, 'rebuild');
});

test('helpers', () => {
  assert.equal(stripPrefix('4b2e9c1d7f3a:abc'), 'abc');
  assert.equal(stripPrefix('abc'), 'abc');
  assert.equal(itemKey('plex'), 'plex');
  assert.match(itemKey('Windows 11'), /^h[0-9a-f]{12}$/);
  assert.equal(slotLabel('parity2'), 'Parity 2');
  assert.equal(slotLabel('nvme_pool'), 'nvme_pool');
  assert.equal(num('12'), 12);
  assert.equal(num(''), null);
  assert.equal(num('NaN'), null);
});
