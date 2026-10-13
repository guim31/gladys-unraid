// -----------------------------------------------------------------------------
// The logs the Gladys supervisor keeps: at the info level, only the life
// cycle. A normal reading cycle (reads, states, scene events) writes nothing;
// a failure that repeats at every read writes one line, then one when it
// heals. And the API key never appears, at any level.
// The SDK logger writes debug/info with console.log, warn/error with
// console.error, at the level of LOG_LEVEL read on every line.
// (Adapted from guim31/gladys-glances.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY, FakeUnraid, MYUNRAID_HOST } from './helpers/fakeUnraid.js';
import { CONFIG, createAll, createWorld } from './helpers/world.js';

/** The lines written at `level` from now on. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  for (const stream of ['log', 'error', 'warn', 'info', 'debug']) {
    t.mock.method(console, stream, (...args) =>
      lines.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')),
    );
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('a normal cycle writes nothing: reads, states, scene events', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  await createAll(world);
  for (let read = 0; read < 5; read += 1) {
    world.clock.advance(61_000);
    world.unraid.data.metrics.cpu.percentTotal = 10 + read * 7;
    world.unraid.disk('disk2').temp = 40 + read * 3;
    if (read === 1) {
      world.unraid.setContainer('radarr', 'RUNNING');
    }
    if (read === 2) {
      world.unraid.setContainer('radarr', 'EXITED'); // stopped two reads later
    }
    await world.hub.pollAll();
  }
  await world.hub.rediscover();
  assert.ok(world.fake.states.length > 50, 'states published');
  assert.ok(world.fake.sceneEvents.length >= 3, 'scene events fired');
  assert.deepEqual(lines, []);
});

test('Unraid off for several reads: one line, then one when it answers again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  world.unraid.failure = 'down';
  for (let read = 0; read < 4; read += 1) {
    await world.hub.pollAll();
  }
  world.unraid.failure = null;
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /ECONNREFUSED/);
  assert.match(lines[1], /answers again/);
});

test('Docker stopped on the server: one line, then one when it is back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  world.unraid.failing.docker = 'Docker is not running';
  await world.hub.pollAll();
  await world.hub.pollAll();
  delete world.unraid.failing.docker;
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /docker not readable/);
  assert.match(lines[1], /docker readable again/);
});

test('the API key never appears in the logs, even in debug and on errors', async (t) => {
  const lines = captureLogs(t, 'debug');
  const unraid = new FakeUnraid({ ssl: 'strict' });
  const world = await createWorld({ unraid, config: { ...CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  await createAll(world);
  unraid.dnsBlocked = true;
  await world.hub.pollAll();
  await world.hub.pollAll();
  unraid.dnsBlocked = false;
  unraid.readOnly = true;
  await world.fake.sceneAction('control_container', {
    container: world.gladys.externalIds('container', '1-plex').device,
    command: 'stop',
  });
  await world.fake.action('test_connection', {});
  const wrongKey = await createWorld({ unraid: new FakeUnraid({ apiKey: 'other' }) });
  await wrongKey.app.stop();
  assert.ok(lines.length > 0);
  const all = lines.join('\n');
  assert.ok(!all.includes(API_KEY), 'the API key is not logged');
  assert.ok(!all.includes(MYUNRAID_HOST.split('.')[1]), 'the myunraid.net hash is not logged');
  // Nor sent to Gladys.
  assert.ok(!JSON.stringify(world.fake.requests).includes(API_KEY));
});
