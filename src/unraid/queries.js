// -----------------------------------------------------------------------------
// The GraphQL documents sent to the Unraid API, built from what the server
// declares (its capabilities): the API ships with Unraid 7.2 and later, and
// with the Unraid Connect plugin before, and gains fields at almost every
// release. A query naming a field the server does not know is refused whole,
// so each document only asks for the fields the server has.
//
// The capabilities come from `__type` lookups (allowed by the API, unlike the
// `__schema` introspection it refuses outside its sandbox). When they cannot
// be read, the client is permissive: it assumes the fields of the current API.
//
// Never asked, on purpose:
//   - `disks` (and `metrics.temperature`): their temperatures come from
//     smartctl, which wakes a disk in standby. The array slots (`array`) carry
//     the temperature emhttp already read, and nothing when the disk sleeps;
//   - `dockerContainerStats` (CPU and memory per container): a subscription
//     only, over a WebSocket kept open, for every container at once.
// test/queries.test.js validates every document against the subset of the
// official schema in test/fixtures/unraid/schema.graphql.
// -----------------------------------------------------------------------------

// The types whose fields decide what is asked.
export const CAPABILITY_TYPES = Object.freeze([
  'Query',
  'Mutation',
  'Vars',
  'Info',
  'InfoOs',
  'InfoCpu',
  'InfoVersions',
  'Metrics',
  'MemoryUtilization',
  'UnraidArray',
  'ArrayDisk',
  'ParityCheck',
  'Docker',
  'DockerContainer',
  'DockerMutations',
  'Vms',
  'VmMutations',
  'Notifications',
]);

/** One aliased `__type` lookup per type: allowed without the API sandbox. */
export const CAPABILITIES_QUERY = `query UnraidCapabilities {
${CAPABILITY_TYPES.map((type) => `  ${type}: __type(name: "${type}") { fields { name } }`).join('\n')}
}`;

export class Capabilities {
  /**
   * @param {Record<string, Set<string>>|null} fields by type; null: permissive
   */
  constructor(fields) {
    this.fields = fields;
  }

  /** Assume every field: the capabilities could not be read. */
  static permissive() {
    return new Capabilities(null);
  }

  /** From the answer of CAPABILITIES_QUERY (`data`). */
  static fromIntrospection(data) {
    const fields = {};
    for (const type of CAPABILITY_TYPES) {
      const entry = data?.[type];
      if (entry && Array.isArray(entry.fields)) {
        fields[type] = new Set(
          entry.fields.map((field) => field?.name).filter((name) => typeof name === 'string'),
        );
      }
    }
    return new Capabilities(fields);
  }

  get permissive() {
    return this.fields === null;
  }

  has(type, field) {
    return this.fields === null || Boolean(this.fields[type]?.has(field));
  }

  /** The fields of `wanted` the server has, in order. */
  pick(type, wanted) {
    return wanted.filter((field) => this.has(type, field));
  }
}

const block = (name, body) => (body ? `${name} { ${body} }` : '');
const join = (parts) => parts.filter(Boolean).join(' ');

// The fields of an array slot: never `numReads`/`numWrites` (they move all
// the time and say nothing to a home), never anything that needs the disk.
const DISK_FIELDS = [
  'id',
  'idx',
  'name',
  'device',
  'status',
  'type',
  'temp',
  'numErrors',
  'size',
  'fsSize',
  'fsFree',
  'fsUsed',
  'isSpinning',
  'rotational',
  'critical',
];

/**
 * The documents of one read, by group. A group the server cannot answer
 * (no field for it) is absent.
 * @param {Capabilities} caps
 * @returns {Record<string, string>}
 */
export function readQueries(caps) {
  const queries = {};

  // The server: name, version, uptime, CPU temperature, and the parity
  // counters `parityCheckStatus` lacks (errors, operation).
  const vars = caps.has('Query', 'vars')
    ? block(
        'vars',
        join(
          caps.pick('Vars', ['name', 'version', 'sbSyncErrs', 'mdResyncAction', 'mdResyncCorr']),
        ),
      )
    : '';
  let info = '';
  if (caps.has('Query', 'info')) {
    const os = caps.has('Info', 'os')
      ? block('os', join(caps.pick('InfoOs', ['hostname', 'uptime'])))
      : '';
    const cpu =
      caps.has('Info', 'cpu') && caps.has('InfoCpu', 'packages')
        ? block('cpu', 'packages { temp }')
        : '';
    let versions = '';
    if (caps.has('Info', 'versions')) {
      // `core { unraid }` since API 4.x; a flat `unraid` before.
      versions = caps.has('InfoVersions', 'core')
        ? 'versions { core { unraid } }'
        : caps.has('InfoVersions', 'unraid')
          ? 'versions { unraid }'
          : '';
    }
    info = block('info', join([os, cpu, versions]));
  }
  const server = join([vars, info]);
  if (server) {
    queries.server = `query UnraidServer { ${server} }`;
  }

  if (caps.has('Query', 'metrics')) {
    const cpu = caps.has('Metrics', 'cpu') ? 'cpu { percentTotal }' : '';
    const memory = caps.has('Metrics', 'memory')
      ? block(
          'memory',
          join(caps.pick('MemoryUtilization', ['percentTotal', 'total', 'available'])),
        )
      : '';
    const metrics = join([cpu, memory]);
    if (metrics) {
      queries.metrics = `query UnraidMetrics { metrics { ${metrics} } }`;
    }
  }

  // The array: always (the API exists since it has one).
  const disk = join(caps.pick('ArrayDisk', DISK_FIELDS));
  const parity = caps.has('UnraidArray', 'parityCheckStatus')
    ? block(
        'parityCheckStatus',
        join(
          caps.pick('ParityCheck', [
            'status',
            'progress',
            'errors',
            'running',
            'paused',
            'duration',
          ]),
        ),
      )
    : '';
  const slots = ['parities', 'disks', 'caches']
    .filter((list) => caps.has('UnraidArray', list))
    .map((list) => block(list, disk));
  queries.array = `query UnraidArray { array { ${join([
    'state',
    caps.has('UnraidArray', 'capacity') ? 'capacity { kilobytes { free used total } }' : '',
    parity,
    ...slots,
  ])} } }`;

  if (caps.has('Query', 'docker') && caps.has('Docker', 'containers')) {
    const fields = caps.pick('DockerContainer', [
      'id',
      'names',
      'image',
      'state',
      'status',
      'autoStart',
      'isUpdateAvailable',
      'labels',
    ]);
    queries.docker = `query UnraidDocker { docker { containers { ${join(fields)} } } }`;
  }

  if (caps.has('Query', 'vms')) {
    // `domains` today, `domain` on the first API versions.
    const list = caps.has('Vms', 'domains') ? 'domains' : caps.has('Vms', 'domain') ? 'domain' : '';
    if (list) {
      queries.vms = `query UnraidVms { vms { ${list} { id name state } } }`;
    }
  }

  if (caps.has('Query', 'upsDevices')) {
    queries.ups =
      'query UnraidUps { upsDevices { id name model status ' +
      'battery { chargeLevel estimatedRuntime } ' +
      'power { inputVoltage loadPercentage nominalPower currentPower } } }';
  }

  if (caps.has('Query', 'notifications')) {
    const overview = caps.has('Notifications', 'overview')
      ? 'overview { unread { info warning alert total } }'
      : '';
    const list = caps.has('Notifications', 'list')
      ? 'list(filter: { type: UNREAD, offset: 0, limit: 20 }) ' +
        '{ id title subject description importance timestamp }'
      : '';
    const body = join([overview, list]);
    if (body) {
      queries.notifications = `query UnraidNotifications { notifications { ${body} } }`;
    }
  }

  return queries;
}

// The commands: never one on the array, the parity or the server itself.
export const CONTAINER_COMMANDS = Object.freeze(['start', 'stop', 'restart']);
export const VM_COMMANDS = Object.freeze(['start', 'stop']);

/**
 * The mutation of a container command, null when the server lacks it (the
 * client then restarts by a stop and a start).
 * @param {Capabilities} caps
 * @param {'start'|'stop'|'restart'} command
 */
export function containerMutation(caps, command) {
  if (!CONTAINER_COMMANDS.includes(command) || !caps.has('Mutation', 'docker')) {
    return null;
  }
  if (!caps.has('DockerMutations', command)) {
    return null;
  }
  return `mutation UnraidContainer($id: PrefixedID!) { docker { ${command}(id: $id) { id state } } }`;
}

/**
 * The mutation of a VM command (`stop` is the ACPI shutdown, never a forced
 * stop), null when the server lacks it.
 * @param {Capabilities} caps
 * @param {'start'|'stop'} command
 */
export function vmMutation(caps, command) {
  if (!VM_COMMANDS.includes(command) || !caps.has('Mutation', 'vm')) {
    return null;
  }
  if (!caps.has('VmMutations', command)) {
    return null;
  }
  return `mutation UnraidVm($id: PrefixedID!) { vm { ${command}(id: $id) } }`;
}
