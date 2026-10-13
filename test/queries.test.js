// -----------------------------------------------------------------------------
// The GraphQL documents against the official schema (the subset in
// test/fixtures/unraid/schema.graphql): every document the client can send
// is valid for today's API, assumed when the capabilities are unknown, and
// shrinks with an older API instead of naming a field it lacks. And nothing
// ever asks what wakes a sleeping disk.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchema, parse, validate } from 'graphql';
import {
  CAPABILITIES_QUERY,
  CAPABILITY_TYPES,
  Capabilities,
  CONTAINER_COMMANDS,
  VM_COMMANDS,
  containerMutation,
  readQueries,
  vmMutation,
} from '../src/unraid/queries.js';
import { SCHEMA_SDL, withoutFields } from './helpers/fakeUnraid.js';

const schema = buildSchema(SCHEMA_SDL);

/** The capabilities a server with this schema reports. */
function capsOf(target) {
  const fields = {};
  for (const type of CAPABILITY_TYPES) {
    const found = target.getType(type);
    if (found?.getFields) {
      fields[type] = new Set(Object.keys(found.getFields()));
    }
  }
  return new Capabilities(fields);
}

const errorsOf = (target, document) => validate(target, parse(document)).map((e) => e.message);

const allDocuments = (caps) => [
  ...Object.values(readQueries(caps)),
  ...CONTAINER_COMMANDS.map((command) => containerMutation(caps, command)),
  ...VM_COMMANDS.map((command) => vmMutation(caps, command)),
];

test('every document is valid for the current API', () => {
  const caps = capsOf(schema);
  const queries = readQueries(caps);
  assert.deepEqual(Object.keys(queries), [
    'server',
    'metrics',
    'array',
    'docker',
    'vms',
    'ups',
    'notifications',
  ]);
  for (const document of [CAPABILITIES_QUERY, ...allDocuments(caps)]) {
    assert.ok(document, 'a document exists');
    assert.deepEqual(errorsOf(schema, document), [], document);
  }
});

test('without capabilities, the documents assume the current API', () => {
  const permissive = Capabilities.permissive();
  assert.deepEqual(readQueries(permissive), readQueries(capsOf(schema)));
  for (const document of allDocuments(permissive)) {
    assert.deepEqual(errorsOf(schema, document), [], document);
  }
});

test('an older API gets documents without the fields it lacks', () => {
  const old = buildSchema(
    withoutFields(SCHEMA_SDL, {
      Query: ['metrics', 'upsDevices', 'notifications'],
      InfoCpu: ['packages'],
      InfoOs: ['uptime'],
      ArrayDisk: ['isSpinning', 'rotational', 'critical'],
      UnraidArray: ['parityCheckStatus', 'caches'],
      DockerContainer: ['isUpdateAvailable', 'labels', 'autoStart'],
      DockerMutations: ['restart'],
    }),
  );
  const caps = capsOf(old);
  const queries = readQueries(caps);
  assert.deepEqual(Object.keys(queries), ['server', 'array', 'docker', 'vms']);
  for (const document of Object.values(queries)) {
    assert.deepEqual(errorsOf(old, document), [], document);
  }
  // No restart on that API: the client stops, then starts.
  assert.equal(containerMutation(caps, 'restart'), null);
  assert.ok(containerMutation(caps, 'stop'));
});

test('nothing asks what wakes a sleeping disk, nor reads the array, the parity or the server for a command', () => {
  const documents = allDocuments(capsOf(schema)).join('\n');
  // `disks` (smartctl) and `metrics.temperature` read the disks themselves.
  assert.doesNotMatch(documents, /\bdisks\s*\(|^\s*disks\s*\{/m);
  assert.doesNotMatch(documents, /query UnraidServer \{[^}]*\bdisks\b/);
  assert.doesNotMatch(documents, /temperature\s*\{/);
  assert.match(readQueries(capsOf(schema)).array, /\barray \{/);
  // Commands: containers and VMs only, and a VM stop is never forced.
  assert.doesNotMatch(
    documents,
    /\b(setState|forceStop|parityCheck|reboot|reset|removeContainer|updateContainer)\s*[({]/,
  );
  assert.equal(containerMutation(capsOf(schema), 'remove'), null);
  assert.equal(vmMutation(capsOf(schema), 'forceStop'), null);
  assert.equal(vmMutation(capsOf(schema), 'restart'), null);
});

test('the capabilities query is a type lookup, which the API allows outside its sandbox', () => {
  // The API refuses `__schema` and an operation named IntrospectionQuery.
  assert.doesNotMatch(CAPABILITIES_QUERY, /__schema|IntrospectionQuery/);
  const caps = Capabilities.fromIntrospection({
    Query: { fields: [{ name: 'array' }, { name: 'docker' }] },
    Metrics: null,
  });
  assert.equal(caps.has('Query', 'array'), true);
  assert.equal(caps.has('Query', 'metrics'), false);
  assert.equal(caps.has('Metrics', 'cpu'), false);
  assert.equal(Capabilities.permissive().has('Anything', 'at all'), true);
});
