// -----------------------------------------------------------------------------
// The hub with the fake Gladys and the fake Unraid: what the user sees in
// Gladys (devices, states, badges, connection status), the scene events, the
// commands, and what survives a restart (/data).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { TRIGGERS } from '../src/hub.js';
import {
  API_KEY,
  CONFIG,
  FakeUnraid,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const state = (w, type, key, feature) => w.fake.lastState(featureId(w.gladys, type, key, feature));

test('the devices are proposed in Discovery, their states sent once added', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices.length, 16);
  assert.equal(w.fake.states.length, 0, 'nothing sent before a device is added');
  await createAll(w);
  assert.equal(state(w, 'server', null, 'online'), 1);
  assert.equal(state(w, 'server', null, 'cpu'), 12.4);
  assert.equal(state(w, 'server', null, 'array_started'), 1);
  assert.equal(state(w, 'server', null, 'array_used'), 53.6);
  assert.equal(state(w, 'server', null, 'array_free'), 19.5);
  assert.equal(state(w, 'server', null, 'disk_problems'), 0);
  assert.equal(state(w, 'server', null, 'notifications'), 1);
  assert.equal(state(w, 'server', null, 'container_updates'), 1);
  assert.equal(state(w, 'disk', 'disk1', 'temperature'), 30);
  assert.equal(state(w, 'disk', 'disk1', 'free'), 13882.7);
  assert.equal(state(w, 'disk', 'disk3', 'standby'), 1);
  assert.equal(state(w, 'disk', 'disk3', 'temperature'), undefined, 'a sleeping disk: none');
  assert.equal(state(w, 'container', 'plex', 'running'), 1);
  assert.equal(state(w, 'container', 'radarr', 'running'), 0);
  assert.equal(state(w, 'vm', '5f3c7a9e-1b2d-4e6f-8a0b-1c2d3e4f5a6b', 'running'), 1);
  assert.equal(state(w, 'ups', 'Back-UPS_Pro_1500', 'battery'), undefined);
  const texts = w.fake.states.filter((s) => typeof s.text === 'string');
  assert.ok(texts.some((s) => s.text === 'Started'));
  assert.ok(texts.some((s) => s.text === '7.2.4'));
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.ok(w.fake.transports.length > 0);
});

test('a UPS whose id is not a plain name keeps a stable hashed key', async (t) => {
  const w = await world(t);
  const ups = w.fake.discoveredDevices.find((d) => d.name === 'Tower APC');
  assert.match(ups.external_id, /:ups:1-h[0-9a-f]{12}$/);
});

test('only what changed is sent again, and the noisy values once a minute', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  w.clock.advance(20_000);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed');
  w.unraid.data.metrics.cpu.percentTotal = 55;
  w.clock.advance(20_000);
  await w.hub.pollAll();
  assert.equal(state(w, 'server', null, 'cpu'), 12.4, 'noisy: not within a minute');
  w.clock.advance(21_000);
  await w.hub.pollAll();
  assert.equal(state(w, 'server', null, 'cpu'), 55);
});

test('Unraid off: offline after two failures, badges unreachable, back when it answers', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.unraid.failure = 'down';
  await w.hub.pollAll();
  assert.equal(state(w, 'server', null, 'online'), 1, 'one failure is a blip');
  await w.hub.pollAll();
  assert.equal(state(w, 'server', null, 'online'), 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /ne répond pas/);
  assert.ok(w.fake.transports.some((entry) => entry.transport === 'unreachable'));
  w.unraid.failure = null;
  await w.hub.pollAll();
  assert.equal(state(w, 'server', null, 'online'), 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a refused key is a configuration problem, not an offline server', async (t) => {
  const w = await world(t, { unraid: new FakeUnraid({ apiKey: 'another' }) });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /API key refused/);
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.hub.record.down, false);
});

test('no address, a bad address, no key: the configuration says what is missing', async (t) => {
  const empty = await world(t, { config: {} });
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);
  const bad = await world(t, { config: { url: 'ftp://x', api_key: API_KEY } });
  assert.match(bad.fake.connectionStatus.message.en, /Address not understood/);
  const noKey = await world(t, { config: { url: '192.0.2.10' } });
  assert.match(noKey.fake.connectionStatus.message.en, /Enter an API key/);
  assert.deepEqual(empty.fake.discoveredDevices, []);
});

test('disk in error: a disk disabled, then read errors growing', async (t) => {
  const w = await world(t);
  w.unraid.disk('disk2').status = 'DISK_DSBL';
  await w.hub.pollAll();
  w.unraid.disk('disk1').numErrors = 3;
  await w.hub.pollAll();
  await w.hub.pollAll(); // nothing new
  const fired = events(w, TRIGGERS.DISK_ERROR).map((event) => event.data);
  assert.deepEqual(fired, [
    {
      disk: deviceId(w.gladys, 'disk', 'disk2'),
      server_name: 'Tower',
      disk_name: 'Disk 2',
      status: 'Disabled',
      errors: 0,
    },
    {
      disk: deviceId(w.gladys, 'disk', 'disk1'),
      server_name: 'Tower',
      disk_name: 'Disk 1',
      status: 'Normal',
      errors: 3,
    },
  ]);
});

test('disk too hot: one event per step, confirmed on two reads, never for a sleeping disk', async (t) => {
  const w = await world(t);
  w.unraid.disk('disk2').temp = 52;
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.DISK_HOT).length, 0, 'one read is not enough');
  await w.hub.pollAll();
  const fired = events(w, TRIGGERS.DISK_HOT).map((event) => event.data);
  assert.deepEqual(
    fired.map((data) => [data.disk_name, data.threshold, data.temperature]),
    [
      ['Disk 2', 40, 52],
      ['Disk 2', 45, 52],
      ['Disk 2', 50, 52],
    ],
  );
  // disk3 sleeps: no temperature, nothing asked, nothing fired.
  assert.ok(fired.every((data) => data.disk_name !== 'Disk 3'));
});

test('parity check finished: with errors, and across a restart of the integration', async (t) => {
  const clock = createClock();
  const unraid = new FakeUnraid();
  const first = await world(t, { clock, unraid });
  unraid.setParity({ status: 'RUNNING', progress: 40, running: true });
  unraid.data.vars.sbSyncErrs = 0;
  await first.hub.pollAll();
  assert.equal(
    first.fake.states.length,
    0,
    'nothing added: no state, but the watcher records the check',
  );
  await first.app.stop();

  // The check ends while the integration is stopped.
  unraid.setParity({
    status: 'COMPLETED',
    progress: 0,
    running: null,
    errors: null,
    duration: 18_000,
  });
  unraid.data.vars.sbSyncErrs = 12;
  clock.advance(5 * 3600_000);
  const second = await world(t, { clock, unraid, dataDir: first.dataDir });
  const fired = events(second, TRIGGERS.PARITY).map((event) => event.data);
  assert.deepEqual(fired, [
    {
      result: 'errors',
      server_name: 'Tower',
      operation: 'check',
      errors: 12,
      duration_minutes: 300,
    },
  ]);
});

test('parity check cancelled: "aborted"', async (t) => {
  const w = await world(t);
  w.unraid.setParity({ status: 'PAUSED', progress: 70, paused: true });
  await w.hub.pollAll();
  w.unraid.setParity({ status: 'CANCELLED', progress: 0, paused: null });
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.PARITY)[0].data.result, 'aborted');
});

test('the array state text follows the parity', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  await createAll(w);
  w.unraid.setParity({ status: 'RUNNING', progress: 45, running: true });
  await w.hub.pollAll();
  assert.ok(w.fake.states.some((s) => s.text === 'Démarrée · contrôle de parité 45 %'));
  assert.equal(state(w, 'server', null, 'parity_progress'), 45);
});

test('container stopped: on the second read, outside Gladys only', async (t) => {
  const w = await world(t);
  w.unraid.setContainer('plex', 'EXITED');
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.CONTAINER).length, 0, 'one read: being updated?');
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.CONTAINER).map((event) => event.data),
    [
      {
        container: deviceId(w.gladys, 'container', 'plex'),
        server_name: 'Tower',
        container_name: 'plex',
        state: 'Stopped',
      },
    ],
  );
  // Recreated by an update: missing on one read only, no event.
  w.unraid.setContainer('plex', 'RUNNING');
  await w.hub.pollAll();
  const sonarr = w.unraid.container('sonarr');
  w.unraid.setContainer('sonarr', null);
  await w.hub.pollAll();
  w.unraid.data.docker.containers.push(sonarr);
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.CONTAINER).length, 1);

  // Stopped from Gladys: no event (a scene stopping it would loop).
  await w.fake.sceneAction('control_container', {
    container: deviceId(w.gladys, 'container', 'mariadb'),
    command: 'stop',
  });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.CONTAINER).length, 1);
});

test('a new Unraid notification fires once, the ones present at the first read never', async (t) => {
  const w = await world(t);
  assert.equal(events(w, TRIGGERS.NOTIFICATION).length, 0);
  w.unraid.addNotification({
    id: '4b2e9c1d7f3a:Unraid_Status_1760340000.notify',
    title: 'Unraid Disk 2 temperature',
    subject: 'Alert [TOWER] - Disk 2 overheated (56 C)',
    description: 'WDC_WD120EDAZ-11F3RA0_5PJ00003 (sdd)',
    importance: 'ALERT',
    timestamp: '2026-10-13T10:00:00.000Z',
  });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.NOTIFICATION).map((event) => event.data),
    [
      {
        importance: 'alert',
        server_name: 'Tower',
        title: 'Unraid Disk 2 temperature',
        subject: 'Alert [TOWER] - Disk 2 overheated (56 C)',
        description: 'WDC_WD120EDAZ-11F3RA0_5PJ00003 (sdd)',
      },
    ],
  );
});

test('the switch of a container and of a VM: start and stop', async (t) => {
  const w = await world(t);
  await createAll(w);
  const plex = w.fake.discoveredDevices.find((d) => d.name === 'Tower plex');
  const ack = await w.fake.setValue(plex, plex.features[0], 0);
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.unraid.container('plex').state, 'EXITED');
  assert.equal(state(w, 'container', 'plex', 'running'), 0, 'the new state at once');
  const vm = w.fake.discoveredDevices.find((d) => d.name === 'Tower Home Assistant OS');
  assert.equal((await w.fake.setValue(vm, vm.features[0], 1)).success, true);
  assert.equal(w.unraid.data.vms.domains[1].state, 'RUNNING');
  assert.deepEqual(
    w.unraid.commands.map(({ kind, command }) => `${kind}:${command}`),
    ['container:stop', 'vm:start'],
  );
});

test('Gladys never stops its own containers', async (t) => {
  const w = await world(t);
  const gladysContainer = w.fake.discoveredDevices.find((d) => d.name === 'Tower gladys');
  assert.equal(gladysContainer.features[0].read_only, true);
  const ack = await w.fake.sceneAction('control_container', {
    container: deviceId(w.gladys, 'container', 'gladys'),
    command: 'restart',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /does not stop or restart its own containers/);
  const integration = await w.fake.sceneAction('control_container', {
    container: deviceId(w.gladys, 'container', 'gladys-unraid-1a2b'),
    command: 'stop',
  });
  assert.equal(integration.success, false);
  assert.deepEqual(w.unraid.commands, []);
});

test('a read-only API key: the command fails with what to do', async (t) => {
  const w = await world(t);
  w.unraid.readOnly = true;
  const ack = await w.fake.sceneAction('control_vm', {
    vm: deviceId(w.gladys, 'vm', '5f3c7a9e-1b2d-4e6f-8a0b-1c2d3e4f5a6b'),
    command: 'stop',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Docker and VMs permissions/);
});

test('a command on a disk, an unknown device or a removed container is refused clearly', async (t) => {
  const w = await world(t);
  const onDisk = await w.fake.sceneAction('control_container', {
    container: deviceId(w.gladys, 'disk', 'disk1'),
    command: 'start',
  });
  assert.match(onDisk.error, /Choose a container device/);
  const vmAsContainer = await w.fake.sceneAction('control_vm', {
    vm: deviceId(w.gladys, 'container', 'plex'),
    command: 'start',
  });
  assert.match(vmAsContainer.error, /Choose a VM device/);
  const gone = await w.fake.sceneAction('control_container', {
    container: deviceId(w.gladys, 'container', 'deleted-long-ago'),
    command: 'start',
  });
  assert.match(gone.error, /no longer exists/);
  const bad = await w.fake.sceneAction('control_container', {
    container: deviceId(w.gladys, 'container', 'plex'),
    command: 'remove',
  });
  assert.match(bad.error, /Unknown command/);
  assert.deepEqual(w.unraid.commands, []);
});

test('the features a server had stay, even when a group fails once (no "Update" flapping)', async (t) => {
  const unraid = new FakeUnraid();
  const first = await world(t, { unraid });
  const before = JSON.stringify(first.fake.discoveredDevices);
  await first.app.stop();
  unraid.failing.metrics = 'systeminformation failed';
  const second = await world(t, { unraid, dataDir: first.dataDir });
  assert.equal(JSON.stringify(second.fake.discoveredDevices), before);
});

test('a new address forgets what was announced, without firing for the new machine', async (t) => {
  const w = await world(t);
  w.unraid.setContainer('plex', 'EXITED');
  await w.fake.configUpdated({ ...CONFIG, url: 'http://192.0.2.10:8080' });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.CONTAINER).length, 0);
});

test('Gladys refusing the states: logged once, sent again at the next read', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.unraid.data.metrics.memory.percentTotal = 80;
  w.clock.advance(61_000);
  t.mock.method(w.gladys, 'publishStates', async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'RATE_LIMIT_EXCEEDED');
  });
  await w.hub.pollAll();
  t.mock.restoreAll();
  w.clock.advance(61_000);
  await w.hub.pollAll();
  assert.equal(state(w, 'server', null, 'memory'), 80);
});

test('#3198: the integration reads Unraid on its own timer, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true, config: { ...CONFIG, poll_interval: '15' } });
  await createAll(w);
  w.unraid.data.metrics.memory.percentTotal = 66;
  w.clock.advance(61_000);
  t.mock.timers.tick(15_000);
  // Let the read started by the timer complete.
  for (let i = 0; i < 50 && state(w, 'server', null, 'memory') !== 66; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(state(w, 'server', null, 'memory'), 66);
});
