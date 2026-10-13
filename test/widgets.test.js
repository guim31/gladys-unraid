// -----------------------------------------------------------------------------
// The `unraid` widget: every content fits the core vocabulary and budget
// (validateWidgetContent: [] = rendered exactly as sent), in every language
// and state, and its buttons act on the container or VM of its settings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS } from '../src/widgets.js';
import { CONFIG, FakeUnraid, createWorld, deviceId } from './helpers/world.js';

async function world(t, options) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], JSON.stringify(ack.data.content));
  return ack.data.content;
}

const statusOf = (c) => c.components.find((component) => component.type === 'status').items;
const buttonsOf = (c) => c.components.filter((component) => component.type === 'button');

test('the overview fits the budget in every language', async (t) => {
  const w = await world(t);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const c = await content(w, {}, language);
    assert.equal(c.components[0].type, 'text');
    assert.equal(c.components.filter((x) => x.type === 'value').length, 3);
    assert.ok(statusOf(c).length <= 10);
  }
  const rows = statusOf(await content(w, {}, 'en'));
  // Problems first: the disk Unraid calls full, the unread warning.
  assert.deepEqual(rows[0], {
    label: 'Disk 2',
    icon: 'pie-chart',
    value: '99 % used',
    color: 'danger',
  });
  assert.deepEqual(rows[1], { label: 'Unread alerts', icon: 'bell', value: 1, color: 'warning' });
  assert.ok(rows.some((row) => row.label === 'Disks' && row.value === '6/6 OK · 1 asleep'));
  assert.deepEqual(
    buttonsOf(await content(w)).map((b) => b.action.key),
    [ACTIONS.REFRESH],
  );
});

test('a disk in trouble, a UPS on battery, a container that should run: shown first', async (t) => {
  const w = await world(t);
  w.unraid.disk('disk1').status = 'DISK_DSBL';
  w.unraid.data.upsDevices[0].status = 'ONBATT';
  w.unraid.setContainer('plex', 'EXITED');
  await w.hub.pollAll();
  const rows = statusOf(await content(w));
  const labels = rows.map((row) => row.label);
  assert.ok(labels.indexOf('Disk 1') < labels.indexOf('Array'));
  assert.ok(labels.indexOf('APC') < labels.indexOf('Array'));
  assert.ok(labels.indexOf('Stopped (autostart)') < labels.indexOf('Array'));
  assert.equal(rows.find((row) => row.label === 'Disk 1').value, 'Disabled');
  assert.match(rows.find((row) => row.label === 'APC').value, /^On battery · 100 % · 48 min$/);
});

test('the buttons of a container: start, stop and restart, with a confirmation', async (t) => {
  const w = await world(t);
  const settings = { device: deviceId(w.gladys, 'container', 'plex') };
  const buttons = buttonsOf(await content(w, settings));
  assert.deepEqual(
    buttons.map((b) => [b.action.key, b.action.confirm ?? false, b.icon]),
    [
      [ACTIONS.START, false, 'check-circle'],
      [ACTIONS.STOP, true, 'square'],
      [ACTIONS.RESTART, true, 'rotate-cw'],
    ],
  );
  const ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.RESTART, {}, { settings });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'plex : redémarrage demandé.');
  assert.deepEqual(
    w.unraid.commands.map((c) => c.command),
    ['restart'],
  );
});

test('the buttons of a VM, and of a Gladys container (start only)', async (t) => {
  const w = await world(t);
  const vm = buttonsOf(
    await content(w, { device: deviceId(w.gladys, 'vm', '8e2d4c6b-0a1f-4b3e-9d5c-7f6e5d4c3b2a') }),
  );
  assert.deepEqual(
    vm.map((b) => b.action.key),
    [ACTIONS.START, ACTIONS.STOP, ACTIONS.REFRESH],
  );
  const own = buttonsOf(await content(w, { device: deviceId(w.gladys, 'container', 'gladys') }));
  assert.deepEqual(
    own.map((b) => b.action.key),
    [ACTIONS.START, ACTIONS.REFRESH],
  );
  // A disk chosen in the settings: the overview, with Refresh.
  const disk = buttonsOf(await content(w, { device: deviceId(w.gladys, 'disk', 'disk1') }));
  assert.deepEqual(
    disk.map((b) => b.action.key),
    [ACTIONS.REFRESH],
  );
});

test('refresh reads Unraid again', async (t) => {
  const w = await world(t);
  const before = w.unraid.requests.length;
  const ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH, {}, { settings: {} });
  assert.equal(ack.success, true);
  assert.ok(w.unraid.requests.length > before);
});

test('no server, Unraid off: a message, never an empty card', async (t) => {
  const none = await world(t, { config: {} });
  const empty = await content(none);
  assert.match(empty.components[0].text, /Enter the address/);

  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  w.unraid.failure = 'down';
  await w.hub.pollAll();
  const off = await content(w, {}, 'fr');
  assert.equal(off.components[0].text, 'Tower : ne répond pas');
  assert.deepEqual(
    buttonsOf(off).map((b) => b.action.key),
    [ACTIONS.REFRESH],
  );
});

test('an older API (no metrics, no parity status): the tiles say "—"', async (t) => {
  const w = await world(t, {
    unraid: new FakeUnraid({ removed: { Query: ['metrics'], UnraidArray: ['parityCheckStatus'] } }),
  });
  const c = await content(w);
  const tiles = c.components.filter((x) => x.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.value),
    ['—', '—', 54],
  );
});
