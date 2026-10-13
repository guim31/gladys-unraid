// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/unraid/tower.json: parity, data and pool disks, a
// sleeping disk, containers of Gladys itself, VMs, a UPS), on today's API
// and on an older one (fields missing), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, FakeUnraid, createAll, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

// An Unraid with the API of the first 7.x releases: no metrics, no CPU
// temperature, no spinning state, no parity status, no container updates.
const OLD_API = {
  Query: ['metrics', 'upsDevices'],
  InfoCpu: ['packages'],
  ArrayDisk: ['isSpinning', 'rotational', 'critical'],
  UnraidArray: ['parityCheckStatus'],
  DockerContainer: ['isUpdateAvailable', 'labels'],
};

const scenarios = [
  { label: 'English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
  { label: 'an older API', language: 'fr', unraid: () => new FakeUnraid({ removed: OLD_API }) },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({
      config: { ...CONFIG, language: scenario.language },
      ...(scenario.unraid ? { unraid: scenario.unraid() } : {}),
    });
    try {
      await createAll(world);
      const devices = world.fake.discoveredDevices;
      // Server, 6 slots, 6 containers, 2 VMs (and a UPS on today's API).
      assert.equal(devices.length, scenario.unraid ? 15 : 16);
      const writable = new Set();

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} for ${feature.category}`,
              );
            }
          }
          if (!feature.read_only) {
            writable.add(`${device.name}/${feature.category}/${feature.type}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds; a
          // text is a non-empty text.
          const state = world.fake.states.findLast(
            (entry) => entry.device_feature_external_id === feature.external_id,
          );
          if (feature.category === 'text') {
            assert.equal(typeof state?.text, 'string', `${at}: no text published`);
            assert.ok(state.text.length > 0, `${at}: empty text`);
            continue;
          }
          // A sleeping disk has no temperature: nothing published, never woken.
          if (where === 'Tower Disk 3' && feature.external_id.endsWith(':temperature')) {
            assert.equal(state, undefined, `${at}: a sleeping disk publishes no temperature`);
            continue;
          }
          const value = state?.state;
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
      // Only the switches of the containers and VMs can be written, never
      // the ones of Gladys' own containers.
      for (const entry of writable) {
        assert.match(entry, /\/switch\/binary$/, entry);
      }
      assert.ok(writable.has('Tower plex/switch/binary'));
      assert.ok(writable.has('Tower Windows 11/switch/binary'));
      assert.ok(!writable.has('Tower gladys/switch/binary'));
      assert.ok(!writable.has('Tower gladys-unraid-1a2b/switch/binary') || scenario.unraid);
    } finally {
      await world.app.stop();
    }
  });
}
