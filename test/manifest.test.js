// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// (Adapted from guim31/gladys-glances.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS } from '../src/config.js';
import { DISK_TEMPERATURE_THRESHOLDS, PARITY_RESULTS } from '../src/alerts.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { CONTAINER_COMMANDS, VM_COMMANDS } from '../src/unraid/queries.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const trigger = (key) => manifest.scene_triggers.find((entry) => entry.key === key);
const field = (item, key) => item.fields.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, local transport, network category', () => {
  assert.equal(manifest.name, 'Unraid');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-unraid:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-unraid/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['network']);
  assert.equal(pkg.name, 'gladys-unraid');
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.actions) {
    const ack = await world.fake.action(action.key, {});
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.actions), ['test_connection']);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((key) => manifest[key] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
  // No widget form (fields behind a button): those need 5.2.0.
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fields = {
    control_container: {
      container: deviceId(world.gladys, 'container', 'radarr'),
      command: 'start',
    },
    control_vm: {
      vm: deviceId(world.gladys, 'vm', '8e2d4c6b-0a1f-4b3e-9d5c-7f6e5d4c3b2a'),
      command: 'start',
    },
    get_server_status: {},
  };
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, fields[action.key]);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
    for (const output of action.outputs) {
      assert.equal(typeof ack.data.outputs[output.key], output.type, `${action.key}.${output.key}`);
    }
  }
});

test('the command options are the commands the client knows', () => {
  const options = (key) =>
    field(
      manifest.scene_actions.find((action) => action.key === key),
      'command',
    ).options.map((o) => o.value);
  assert.deepEqual(options('control_container'), [...CONTAINER_COMMANDS]);
  assert.deepEqual(options('control_vm'), [...VM_COMMANDS]);
});

test('the scene triggers are the ones the hub fires, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { unraid, hub } = world;
  // Every trigger once.
  unraid.setParity({ status: 'RUNNING', progress: 10, running: true });
  await hub.pollAll();
  unraid.disk('disk1').status = 'DISK_DSBL';
  unraid.disk('disk2').temp = 47;
  unraid.setContainer('plex', 'EXITED');
  unraid.setParity({ status: 'COMPLETED', progress: 0, running: null });
  unraid.addNotification({
    id: 'x:new.notify',
    title: 'Unraid Status',
    subject: 'Alert [TOWER] - Disk 1 in error state (disk dsbl)',
    description: 'ST18000NM000J-2TV103_ZR5A0002 (sdf)',
    importance: 'ALERT',
    timestamp: '2026-10-13T10:00:00.000Z',
  });
  await hub.pollAll();
  await hub.pollAll();
  const fired = new Map(world.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const entry of manifest.scene_triggers) {
    const data = fired.get(entry.key);
    assert.ok(data, `${entry.key} was fired`);
    // Filters match keys of `data`, variables read keys of `data`.
    for (const key of [...keysOf(entry.fields), ...keysOf(entry.variables)]) {
      assert.ok(key in data, `${entry.key}: "${key}" is in the event data`);
    }
    for (const [key, value] of Object.entries(data)) {
      const variable = entry.variables.find((v) => v.key === key);
      assert.ok(variable || keysOf(entry.fields).includes(key), `${entry.key}: "${key}"`);
      if (variable && value !== null) {
        assert.equal(typeof value, variable.type, `${entry.key}.${key}`);
      }
    }
  }
});

test('the filters offer exactly the values the hub sends', () => {
  const threshold = field(trigger(TRIGGERS.DISK_HOT), 'threshold');
  assert.deepEqual(
    threshold.options.map((o) => o.value),
    DISK_TEMPERATURE_THRESHOLDS.map(String),
  );
  assert.equal(threshold.required, true, 'a threshold is never a wildcard');
  assert.ok(threshold.options.some((o) => o.value === threshold.default));
  assert.deepEqual(
    field(trigger(TRIGGERS.PARITY), 'result').options.map((o) => o.value),
    Object.values(PARITY_RESULTS),
  );
  assert.deepEqual(
    field(trigger(TRIGGERS.NOTIFICATION), 'importance').options.map((o) => o.value),
    ['alert', 'warning', 'info'],
  );
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[entry.key],
        entry.default,
        `DEFAULT_CONFIG.${entry.key} must match the manifest default`,
      );
    }
  }
  const options = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('language'), LANGUAGES);
  assert.deepEqual(options('poll_interval'), POLL_INTERVALS);
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  const key = manifest.config_schema.find((f) => f.key === 'api_key');
  assert.equal(key.type, 'secret', 'the API key is a secret field');
  assert.equal(key.default, undefined, 'a secret field takes no default');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source, no static options and no default', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const entry of dynamicSelects) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined);
    assert.equal(entry.default, undefined, 'a default is refused with a source');
  }
});

test('trigger filters are never boolean (no "any" state)', () => {
  for (const entry of manifest.scene_triggers) {
    for (const filter of entry.fields ?? []) {
      assert.notEqual(filter.type, 'boolean');
    }
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `field "${entry.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret');
      assert.notEqual(entry.required, true);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});
