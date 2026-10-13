// -----------------------------------------------------------------------------
// The Unraid client against the fake Unraid: the three "Use SSL/TLS" modes
// (and the redirects it refuses to follow with the key), every error kind,
// the capabilities, the groups that fail alone, the commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_KINDS,
  UnraidClient,
  classifyGraphqlErrors,
  hostForLog,
} from '../src/unraid/client.js';
import { API_KEY, FakeUnraid, MYUNRAID_HOST, createNetwork } from './helpers/fakeUnraid.js';

const URL = 'http://192.0.2.10';

function setup(options = {}, clientOptions = {}) {
  const unraid = new FakeUnraid(options);
  const network = createNetwork(unraid);
  const client = new UnraidClient({
    url: URL,
    apiKey: API_KEY,
    request: network.request,
    ...clientOptions,
  });
  return { unraid, client };
}

const rejects = (promise, kind) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind, err.message);
    return true;
  });

test('"Use SSL/TLS: No": HTTP, every group read', async () => {
  const { client, unraid } = setup();
  const { groups, caps } = await client.read();
  assert.equal(caps.permissive, false);
  assert.deepEqual(Object.keys(groups).sort(), [
    'array',
    'docker',
    'metrics',
    'notifications',
    'server',
    'ups',
    'vars',
    'vms',
  ]);
  assert.ok(Object.values(groups).every((group) => group.data && !group.error));
  assert.equal(groups.array.data.array.state, 'STARTED');
  // Every request carries the key, in the header only.
  assert.ok(unraid.requests.every((request) => request.key === API_KEY));
  assert.ok(unraid.requests.every((request) => !request.url.includes(API_KEY)));
});

test('"Use SSL/TLS: Yes": the redirect to HTTPS on the same host is followed, with the certificate option', async () => {
  const refused = setup({ ssl: 'yes' });
  await rejects(refused.client.read(), ERROR_KINDS.TLS);

  const { client, unraid } = setup({ ssl: 'yes' }, { insecure: true });
  await client.read();
  assert.equal(client.base, 'https://192.0.2.10');
  assert.ok(unraid.requests.every((request) => request.url.startsWith('https://192.0.2.10/')));
});

test('"Use SSL/TLS: Strict": the redirect to myunraid.net is followed', async () => {
  const { client, unraid } = setup({ ssl: 'strict' });
  await client.read();
  assert.equal(client.base, `https://${MYUNRAID_HOST}`);
  assert.ok(unraid.requests.length > 0);
});

test('a DNS that blocks myunraid.net is told apart, and the typed address is tried again', async () => {
  const { client, unraid } = setup({ ssl: 'strict' });
  unraid.dnsBlocked = true;
  await rejects(client.read(), ERROR_KINDS.DNS);
  assert.equal(client.base, URL);
  unraid.dnsBlocked = false;
  await client.read();
});

test('a redirect elsewhere is never followed: the key stays home', async () => {
  const calls = [];
  const client = new UnraidClient({
    url: URL,
    apiKey: API_KEY,
    request: async (url, options) => {
      calls.push({ url, key: options.headers['x-api-key'] });
      return { status: 302, headers: { location: 'https://login.example.com/graphql' }, body: '' };
    },
  });
  await rejects(client.read(), ERROR_KINDS.REDIRECT);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['http://192.0.2.10/graphql'],
  );
  // Neither to plain HTTP on another port of the same host.
  const downgrade = new UnraidClient({
    url: 'https://192.0.2.10',
    apiKey: API_KEY,
    request: async () => ({
      status: 301,
      headers: { location: 'http://192.0.2.10:8080/graphql' },
      body: '',
    }),
  });
  await rejects(downgrade.read(), ERROR_KINDS.REDIRECT);
});

test('nginx "plain HTTP sent to the HTTPS port": the client switches to HTTPS', async () => {
  const urls = [];
  const unraid = new FakeUnraid();
  const client = new UnraidClient({
    url: 'http://192.0.2.10:8443',
    apiKey: API_KEY,
    request: async (url, options) => {
      urls.push(url);
      if (url.startsWith('http:')) {
        return {
          status: 400,
          headers: {},
          body: '<html><center>The plain HTTP request was sent to HTTPS port</center></html>',
        };
      }
      return unraid.handle(url.replace('https://192.0.2.10:8443', 'http://192.0.2.10'), options);
    },
  });
  await client.read();
  assert.equal(client.base, 'https://192.0.2.10:8443');
  assert.equal(urls.filter((url) => url.startsWith('http:')).length, 1);
});

test('every failure has its kind', async () => {
  const wrongKey = setup({ apiKey: 'another-key' });
  await rejects(wrongKey.client.read(), ERROR_KINDS.AUTH);

  const down = setup();
  down.unraid.failure = 'down';
  await rejects(down.client.read(), ERROR_KINDS.UNREACHABLE);

  const apiDown = setup();
  apiDown.unraid.failure = 'api_down';
  await rejects(apiDown.client.read(), ERROR_KINDS.API_DOWN);

  const html = setup();
  html.unraid.failure = 'html';
  await rejects(html.client.read(), ERROR_KINDS.NOT_UNRAID);

  const unknownHost = new UnraidClient({
    url: 'http://198.51.100.99',
    apiKey: API_KEY,
    request: createNetwork(new FakeUnraid()).request,
  });
  await rejects(unknownHost.read(), ERROR_KINDS.UNREACHABLE);

  const notFound = new UnraidClient({
    url: URL,
    apiKey: API_KEY,
    request: async () => ({ status: 404, headers: {}, body: 'Not Found' }),
  });
  await rejects(notFound.read(), ERROR_KINDS.NOT_UNRAID);

  const status401 = new UnraidClient({
    url: URL,
    apiKey: API_KEY,
    request: async () => ({ status: 401, headers: {}, body: '' }),
  });
  await rejects(status401.read(), ERROR_KINDS.AUTH);
});

test('the error messages never carry the key, and shorten the myunraid.net name', async () => {
  const { client, unraid } = setup({ ssl: 'strict' });
  unraid.dnsBlocked = true;
  const err = await client.read().catch((error) => error);
  assert.ok(!err.message.includes(API_KEY));
  assert.equal(hostForLog(`https://${MYUNRAID_HOST}/graphql`), '…myunraid.net');
  assert.equal(hostForLog('http://192.0.2.10:8080'), '192.0.2.10:8080');
});

test('Docker or the VM manager stopped: the other groups are still read', async () => {
  const { client, unraid } = setup();
  unraid.failing.docker = 'Docker is not running';
  unraid.failing.vms = 'Failed to connect to libvirt';
  const { groups } = await client.read();
  assert.equal(groups.docker.error.kind, ERROR_KINDS.GRAPHQL);
  assert.equal(groups.vms.error.kind, ERROR_KINDS.GRAPHQL);
  assert.ok(groups.array.data);
  assert.ok(groups.server.data);
});

test('the array not readable: the server is not readable', async () => {
  const { client, unraid } = setup();
  unraid.failing.array = 'emhttp not ready';
  await rejects(client.read(), ERROR_KINDS.GRAPHQL);
});

test('type lookups refused: the client assumes the current API', async () => {
  const unraid = new FakeUnraid();
  const network = createNetwork(unraid);
  const client = new UnraidClient({
    url: URL,
    apiKey: API_KEY,
    request: async (url, options) => {
      if (options.body.includes('__type')) {
        return {
          status: 400,
          headers: {},
          body: JSON.stringify({
            errors: [{ message: 'introspection is not allowed', extensions: { code: 'X' } }],
          }),
        };
      }
      return network.request(url, options);
    },
  });
  const { caps, groups } = await client.read();
  assert.equal(caps.permissive, true);
  assert.ok(groups.metrics.data);
});

test('an API changed under our feet: the capabilities are read again', async () => {
  const { client, unraid } = setup();
  await client.read();
  // An older API now (a downgrade): the array query names fields it lacks.
  const older = new FakeUnraid({
    removed: { ArrayDisk: ['isSpinning'], UnraidArray: ['parityCheckStatus'] },
  });
  unraid.schema = older.schema;
  unraid.wire();
  const { groups } = await client.read();
  assert.ok(groups.array.data.array);
  assert.equal(groups.array.data.array.parityCheckStatus, undefined);
});

test('commands: start, stop, restart a container, start and shut down a VM', async () => {
  const { client, unraid } = setup();
  const plex = unraid.container('plex');
  assert.deepEqual(await client.containerCommand(plex.id, 'stop'), {
    id: plex.id,
    state: 'EXITED',
  });
  await client.containerCommand(plex.id, 'start');
  await client.containerCommand(plex.id, 'restart');
  const vm = unraid.data.vms.domains[1];
  assert.equal(await client.vmCommand(vm.id, 'start'), true);
  assert.equal(await client.vmCommand(vm.id, 'stop'), true);
  assert.deepEqual(
    unraid.commands.map(({ kind, command }) => `${kind}:${command}`),
    ['container:stop', 'container:start', 'container:restart', 'vm:start', 'vm:stop'],
  );
});

test('a read-only key: the command is refused with "forbidden"', async () => {
  const { client, unraid } = setup();
  unraid.readOnly = true;
  await rejects(
    client.containerCommand(unraid.container('plex').id, 'stop'),
    ERROR_KINDS.FORBIDDEN,
  );
  assert.deepEqual(unraid.commands, []);
});

test('no restart on an older API: a stop, then a start', async () => {
  const { client, unraid } = setup({ removed: { DockerMutations: ['restart'] } });
  await client.containerCommand(unraid.container('plex').id, 'restart');
  assert.deepEqual(
    unraid.commands.map(({ command }) => command),
    ['stop', 'start'],
  );
});

test('the GraphQL errors are classified by code, then by message', () => {
  const kind = (errors) => classifyGraphqlErrors(errors);
  assert.equal(kind([{ message: 'x', extensions: { code: 'UNAUTHENTICATED' } }]), ERROR_KINDS.AUTH);
  assert.equal(kind([{ message: 'Invalid API key' }]), ERROR_KINDS.AUTH);
  assert.equal(kind([{ message: 'Forbidden resource' }]), ERROR_KINDS.FORBIDDEN);
  assert.equal(kind([{ message: 'Cannot query field "x" on type "Y".' }]), ERROR_KINDS.SCHEMA);
  assert.equal(kind([{ message: 'Docker is not running' }]), ERROR_KINDS.GRAPHQL);
});
