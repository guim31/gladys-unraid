// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Unraid on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the server with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { API_KEY, FakeUnraid, createNetwork } from './fakeUnraid.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = '192.0.2.10';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 13, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = Object.freeze({ url: URL_1, api_key: API_KEY, language: 'en' });

/**
 * @param {object} [options]
 * @param {FakeUnraid} [options.unraid]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  unraid = new FakeUnraid(),
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-unraid-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(unraid);
  const gladys = createFakeGladys({ config: { ...config }, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, unraid, network, app, hub: app.hub, clock, dataDir };
}

/** External id of a device (`key` null for the server). */
export const deviceId = (gladys, type = 'server', key = null) =>
  gladys.externalIds(type, key === null ? '1' : `1-${key}`).device;
export const featureId = (gladys, type, key, feature) =>
  gladys.externalIds(type, key === null ? '1' : `1-${key}`).feature(feature);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeUnraid, API_KEY };
