// -----------------------------------------------------------------------------
// From the GraphQL answers of one read (src/unraid/client.js) to a plain
// snapshot of the server: numbers in known units, booleans, short strings.
// Nothing here talks to the network or to Gladys.
//
// Units of the API: array capacities and slot sizes in kilobytes (as
// strings in `capacity`), temperatures in °C, percentages 0-100, the uptime
// as the boot time (ISO string), UPS runtimes in seconds. `BigInt` values may
// come as numbers or as strings: both are read.
//
// A slot temperature is null while its disk sleeps (emhttp shows `*`): it is
// never asked from the disk itself (see src/unraid/queries.js).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/** A platform id part from a name Unraid gives: as is when safe, hashed otherwise. */
export function itemKey(name) {
  const text = String(name);
  if (/^[A-Za-z0-9_.-]{1,64}$/.test(text) && !/^h[0-9a-f]{12}$/.test(text)) {
    return text;
  }
  return `h${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}

/** The id of a resource without the `<server id>:` prefix of the API. */
export const stripPrefix = (id) =>
  typeof id === 'string' && id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;

export const num = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const bool = (value) => (typeof value === 'boolean' ? value : null);
const text = (value, max = 200) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const list = (value) =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];

// Labels the Gladys supervisor puts on the containers it runs: Gladys never
// stops itself, nor an integration it supervises, from here.
const GLADYS_LABELS = ['io.gladysassistant.external-integration', 'io.gladysassistant.container'];
const GLADYS_IMAGE = /(^|\/)gladysassistant\/gladys(:|@|$)/;

/** Whether a container is Gladys itself or one of its integrations. */
export function isGladysContainer({ image, labels }) {
  if (typeof image === 'string' && GLADYS_IMAGE.test(image)) {
    return true;
  }
  return Boolean(
    labels && typeof labels === 'object' && GLADYS_LABELS.some((label) => label in labels),
  );
}

/** "disk3" → "Disk 3", "parity2" → "Parity 2", "cache" → "Cache"; a pool keeps its name. */
export function slotLabel(name) {
  const match = /^(parity|disk|cache)(\d*)$/.exec(name);
  if (!match) {
    return name;
  }
  const base = match[1][0].toUpperCase() + match[1].slice(1);
  return match[2] ? `${base} ${match[2]}` : base;
}

// Unraid's default "critical" disk usage, when a disk has no setting of its own.
export const DEFAULT_CRITICAL_PERCENT = 90;

const KINDS = { PARITY: 'parity', DATA: 'data', CACHE: 'cache' };

function parseDisk(raw, kind) {
  const name = text(raw.name, 64);
  const status = text(raw.status, 32);
  // An empty slot of the array: nothing to watch.
  if (!name || status === 'DISK_NP') {
    return null;
  }
  const type = text(raw.type, 16);
  if (type === 'FLASH' || type === 'BOOT') {
    return null;
  }
  const temperature = num(raw.temp);
  const fsSize = num(raw.fsSize);
  const fsUsed = num(raw.fsUsed);
  const fsFree = num(raw.fsFree);
  const hasFs = kind !== KINDS.PARITY && fsSize !== null && fsSize > 0;
  return {
    key: itemKey(name),
    name,
    label: slotLabel(name),
    kind,
    status,
    ok: status === 'DISK_OK',
    // Outside 0-120 °C, a reading is a placeholder, not a temperature.
    temperature: temperature !== null && temperature > 0 && temperature < 120 ? temperature : null,
    spinning: bool(raw.isSpinning),
    rotational: bool(raw.rotational),
    errors: num(raw.numErrors) ?? 0,
    sizeKB: num(raw.size),
    hasFs,
    usedPercent:
      hasFs && fsUsed !== null ? Math.min(100, Math.max(0, (100 * fsUsed) / fsSize)) : null,
    freeKB: hasFs ? (fsFree ?? (fsUsed !== null ? fsSize - fsUsed : null)) : null,
    // The usage Unraid itself calls critical for this disk (Settings, Disk Settings).
    criticalPercent: num(raw.critical) || DEFAULT_CRITICAL_PERCENT,
  };
}

/** What the parity is doing: from `parityCheckStatus` and the `vars` counters. */
function parseParity(status, vars) {
  if (!status || typeof status !== 'object') {
    return null;
  }
  const state = text(status.status, 16);
  const paused = status.paused === true || state === 'PAUSED';
  const active = status.running === true || state === 'RUNNING' || paused;
  const action = text(vars?.mdResyncAction, 32) ?? '';
  return {
    status: state,
    active,
    paused,
    progress: active ? Math.min(100, Math.max(0, num(status.progress) ?? 0)) : 0,
    errors: num(status.errors) ?? num(vars?.sbSyncErrs),
    // Seconds from the start of the last operation to its end (or now).
    durationSeconds: num(status.duration),
    operation: /^recon/i.test(action) ? 'rebuild' : /^clear/i.test(action) ? 'clear' : 'check',
  };
}

function parseContainer(raw) {
  const names = Array.isArray(raw.names) ? raw.names : [];
  const name = text(String(names[0] ?? '').replace(/^\//, ''), 128);
  if (!name) {
    return null;
  }
  const state = text(raw.state, 16) ?? 'UNKNOWN';
  const image = text(raw.image, 256);
  return {
    key: itemKey(name),
    name,
    id: text(raw.id, 256),
    image,
    state,
    running: state === 'RUNNING',
    autoStart: bool(raw.autoStart),
    updateAvailable: bool(raw.isUpdateAvailable),
    protected: isGladysContainer({ image, labels: raw.labels }),
  };
}

// libvirt states that mean "the VM is on".
const VM_RUNNING = new Set(['RUNNING', 'IDLE']);

function parseVm(raw) {
  const id = text(raw.id, 256);
  const uuid = stripPrefix(id);
  const name = text(raw.name, 128);
  if (!uuid && !name) {
    return null;
  }
  const state = text(raw.state, 16) ?? 'NOSTATE';
  return {
    key: itemKey(uuid ?? name),
    id,
    name: name ?? uuid,
    state,
    running: VM_RUNNING.has(state),
  };
}

function parseUps(raw) {
  const id = text(raw.id, 128);
  const name = text(raw.name, 64) ?? text(raw.model, 64);
  if (!id && !name) {
    return null;
  }
  const status = text(raw.status, 40);
  const load = num(raw.power?.loadPercentage);
  const nominal = num(raw.power?.nominalPower);
  const runtime = num(raw.battery?.estimatedRuntime);
  return {
    key: itemKey(id ?? name),
    name: name ?? id,
    model: text(raw.model, 64),
    status,
    // apcupsd says ONBATT, the API "On Battery".
    onBattery: status ? /onbatt|on battery/i.test(status) : null,
    battery: num(raw.battery?.chargeLevel),
    runtimeMinutes: runtime === null ? null : runtime / 60,
    load,
    power:
      num(raw.power?.currentPower) ?? (nominal && load !== null ? (nominal * load) / 100 : null),
    inputVoltage: num(raw.power?.inputVoltage),
  };
}

const IMPORTANCE = { ALERT: 'alert', WARNING: 'warning', INFO: 'info' };

function parseNotification(raw) {
  const id = text(raw.id, 512);
  if (!id) {
    return null;
  }
  return {
    id,
    title: text(raw.title, 200) ?? '',
    subject: text(raw.subject, 300) ?? '',
    description: text(raw.description, 900) ?? '',
    importance: IMPORTANCE[raw.importance] ?? 'info',
    timestamp: text(raw.timestamp, 40),
  };
}

/**
 * @param {{ groups: Record<string, { data?: object, error?: Error }> }} read
 * @param {number} now ms since the epoch
 */
export function parseSnapshot({ groups }, now) {
  const data = (name) => groups[name]?.data ?? null;
  const server = data('server') ?? {};
  const vars = server.vars ?? {};
  const info = server.info ?? {};
  const metrics = data('metrics')?.metrics ?? {};
  const array = data('array')?.array ?? {};

  const boot = Date.parse(info.os?.uptime ?? '');
  // One temperature per CPU package: the hottest one.
  const temps = (Array.isArray(info.cpu?.packages?.temp) ? info.cpu.packages.temp : [])
    .map(num)
    .filter((value) => value !== null && value > 0 && value < 150);

  const memory = metrics.memory ?? {};
  const memoryTotal = num(memory.total);
  const memoryAvailable = num(memory.available);
  const memoryPercent =
    num(memory.percentTotal) ??
    (memoryTotal && memoryAvailable !== null
      ? (100 * (memoryTotal - memoryAvailable)) / memoryTotal
      : null);

  const capacity = array.capacity?.kilobytes ?? {};
  const totalKB = num(capacity.total);
  const usedKB = num(capacity.used);
  const freeKB = num(capacity.free);
  const state = text(array.state, 32);

  const disks = [
    ...list(array.parities).map((raw) => parseDisk(raw, KINDS.PARITY)),
    ...list(array.disks).map((raw) => parseDisk(raw, KINDS.DATA)),
    ...list(array.caches).map((raw) => parseDisk(raw, KINDS.CACHE)),
  ].filter(Boolean);
  // Two slots with the same name would be one device: the first one wins.
  const seen = new Set();
  const uniqueDisks = disks.filter((disk) => !seen.has(disk.key) && seen.add(disk.key));

  const unique = (items) => {
    const keys = new Set();
    return items.filter((item) => item && !keys.has(item.key) && keys.add(item.key));
  };

  const docker = data('docker')?.docker;
  const vms = data('vms')?.vms;
  const ups = data('ups');
  const notifications = data('notifications')?.notifications;
  const unread = notifications?.overview?.unread;

  return {
    hostname: text(vars.name, 64) ?? text(info.os?.hostname, 64),
    version:
      text(vars.version, 32) ??
      text(info.versions?.core?.unraid, 32) ??
      text(info.versions?.unraid, 32),
    uptimeSeconds: Number.isFinite(boot) && boot <= now ? (now - boot) / 1000 : null,
    cpu: num(metrics.cpu?.percentTotal),
    memory: memoryPercent === null ? null : Math.min(100, Math.max(0, memoryPercent)),
    cpuTemperature: temps.length ? Math.max(...temps) : null,
    array: {
      state,
      started: state === 'STARTED',
      totalKB,
      freeKB: freeKB ?? (totalKB !== null && usedKB !== null ? totalKB - usedKB : null),
      usedPercent:
        totalKB && usedKB !== null ? Math.min(100, Math.max(0, (100 * usedKB) / totalKB)) : null,
    },
    parity: parseParity(array.parityCheckStatus, vars),
    disks: uniqueDisks,
    // null: the group is not readable (Docker or the VM manager stopped, no field).
    containers: docker ? unique(list(docker.containers).map(parseContainer)) : null,
    vms: vms ? unique(list(vms.domains ?? vms.domain).map(parseVm)) : null,
    ups: ups ? unique(list(ups.upsDevices).map(parseUps)) : null,
    notifications: notifications
      ? {
          unread: unread
            ? {
                info: num(unread.info) ?? 0,
                warning: num(unread.warning) ?? 0,
                alert: num(unread.alert) ?? 0,
                total: num(unread.total) ?? 0,
              }
            : null,
          list: list(notifications.list).map(parseNotification).filter(Boolean),
        }
      : null,
    // The groups that failed, by name: their kind of error.
    unavailable: Object.fromEntries(
      Object.entries(groups)
        .filter(([, group]) => group.error)
        .map(([name, group]) => [name, group.error.kind ?? 'error']),
    ),
  };
}

/** A disk that needs attention: not OK, or read errors. */
export const diskProblem = (disk) => !disk.ok || disk.errors > 0;
