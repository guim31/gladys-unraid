// -----------------------------------------------------------------------------
// The Gladys devices of an Unraid server, proposed in the Discovery tab: the
// user adds the ones to follow, nothing is created on their behalf.
//
//   - the server itself: online, CPU, memory, CPU temperature, uptime, array
//     (started, state, space), parity (progress, errors), disks needing
//     attention, unread alerts, container updates, Unraid version;
//   - one device per array slot (parity, data disks, pool disks), per Docker
//     container, per VM and per UPS: the user picks the ones that matter.
//
// Identity: the configuration slot (1), and for the other devices the name
// Unraid gives them: the slot name of a disk (`disk3`: the device follows
// the slot when a disk is replaced, like Unraid itself), the name of a
// container (its id changes at every update, the name stays), the UUID of a
// VM, the id of a UPS.
//
// A feature marked `optional` exists once it has had a value (what the
// server can tell: metrics, CPU temperature, parity, file system of a pool
// member…). The features seen are remembered in /data (src/hub.js), so a
// group that fails once does not change the structure of a device.
//
// Category/type couples come from the core table (see
// test/gladys-rules.test.js). The core has no generic "percent" category:
// usage percentages are `level-sensor/liquid-level-percent` (bounds 0-100,
// the couple Glances, OctoPrint and Brother use). Container and VM switches
// are `switch/binary`; a container of Gladys itself is read only
// (`input/binary`): Gladys never stops itself from here.
//
// Published with should_poll: false: the integration reads Unraid on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { diskProblem } from './unraid/model.js';
import { arrayStatusText, diskStatusText, vmStateText } from './texts.js';

export const DEVICE_TYPES = Object.freeze({
  SERVER: 'server',
  DISK: 'disk',
  CONTAINER: 'container',
  VM: 'vm',
  UPS: 'ups',
});

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  CPU: 'cpu',
  MEMORY: 'memory',
  CPU_TEMPERATURE: 'cpu_temperature',
  UPTIME: 'uptime',
  ARRAY_STARTED: 'array_started',
  ARRAY_STATUS: 'array_status',
  ARRAY_USED: 'array_used',
  ARRAY_FREE: 'array_free',
  PARITY_PROGRESS: 'parity_progress',
  PARITY_ERRORS: 'parity_errors',
  DISK_PROBLEMS: 'disk_problems',
  NOTIFICATIONS: 'notifications',
  CONTAINER_UPDATES: 'container_updates',
  VERSION: 'version',
  TEMPERATURE: 'temperature',
  STANDBY: 'standby',
  USED: 'used',
  FREE: 'free',
  ERRORS: 'errors',
  STATUS: 'status',
  RUNNING: 'running',
  UPDATE_AVAILABLE: 'update_available',
  STATE: 'state',
  BATTERY: 'battery',
  RUNTIME: 'runtime',
  LOAD: 'load',
  ON_BATTERY: 'on_battery',
  POWER: 'power',
  INPUT_VOLTAGE: 'input_voltage',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'CPU',
    [K.MEMORY]: 'Memory',
    [K.CPU_TEMPERATURE]: 'CPU temperature',
    [K.UPTIME]: 'Uptime',
    [K.ARRAY_STARTED]: 'Array started',
    [K.ARRAY_STATUS]: 'Array state',
    [K.ARRAY_USED]: 'Array space used',
    [K.ARRAY_FREE]: 'Array free space',
    [K.PARITY_PROGRESS]: 'Parity check progress',
    [K.PARITY_ERRORS]: 'Parity errors',
    [K.DISK_PROBLEMS]: 'Disks needing attention',
    [K.NOTIFICATIONS]: 'Unread alerts',
    [K.CONTAINER_UPDATES]: 'Container updates',
    [K.VERSION]: 'Unraid version',
    [K.TEMPERATURE]: 'Temperature',
    [K.STANDBY]: 'Standby',
    [K.USED]: 'Space used',
    [K.FREE]: 'Free space',
    [K.ERRORS]: 'Errors',
    [K.STATUS]: 'Status',
    [K.RUNNING]: 'Running',
    [K.UPDATE_AVAILABLE]: 'Update available',
    [K.STATE]: 'State',
    [K.BATTERY]: 'Battery',
    [K.RUNTIME]: 'Runtime left',
    [K.LOAD]: 'Load',
    [K.ON_BATTERY]: 'On battery',
    [K.POWER]: 'Power',
    [K.INPUT_VOLTAGE]: 'Input voltage',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.CPU]: 'Processeur',
    [K.MEMORY]: 'Mémoire',
    [K.CPU_TEMPERATURE]: 'Température du processeur',
    [K.UPTIME]: 'Durée de fonctionnement',
    [K.ARRAY_STARTED]: 'Matrice démarrée',
    [K.ARRAY_STATUS]: 'État de la matrice',
    [K.ARRAY_USED]: 'Espace utilisé de la matrice',
    [K.ARRAY_FREE]: 'Espace libre de la matrice',
    [K.PARITY_PROGRESS]: 'Progression du contrôle de parité',
    [K.PARITY_ERRORS]: 'Erreurs de parité',
    [K.DISK_PROBLEMS]: 'Disques à surveiller',
    [K.NOTIFICATIONS]: 'Alertes non lues',
    [K.CONTAINER_UPDATES]: 'Mises à jour de conteneurs',
    [K.VERSION]: "Version d'Unraid",
    [K.TEMPERATURE]: 'Température',
    [K.STANDBY]: 'En veille',
    [K.USED]: 'Espace utilisé',
    [K.FREE]: 'Espace libre',
    [K.ERRORS]: 'Erreurs',
    [K.STATUS]: 'État',
    [K.RUNNING]: 'En marche',
    [K.UPDATE_AVAILABLE]: 'Mise à jour disponible',
    [K.STATE]: 'État',
    [K.BATTERY]: 'Batterie',
    [K.RUNTIME]: 'Autonomie restante',
    [K.LOAD]: 'Charge',
    [K.ON_BATTERY]: 'Sur batterie',
    [K.POWER]: 'Puissance',
    [K.INPUT_VOLTAGE]: "Tension d'entrée",
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'Prozessor',
    [K.MEMORY]: 'Arbeitsspeicher',
    [K.CPU_TEMPERATURE]: 'Prozessortemperatur',
    [K.UPTIME]: 'Laufzeit',
    [K.ARRAY_STARTED]: 'Array gestartet',
    [K.ARRAY_STATUS]: 'Array-Status',
    [K.ARRAY_USED]: 'Belegter Array-Speicher',
    [K.ARRAY_FREE]: 'Freier Array-Speicher',
    [K.PARITY_PROGRESS]: 'Fortschritt der Paritätsprüfung',
    [K.PARITY_ERRORS]: 'Paritätsfehler',
    [K.DISK_PROBLEMS]: 'Auffällige Festplatten',
    [K.NOTIFICATIONS]: 'Ungelesene Warnungen',
    [K.CONTAINER_UPDATES]: 'Container-Updates',
    [K.VERSION]: 'Unraid-Version',
    [K.TEMPERATURE]: 'Temperatur',
    [K.STANDBY]: 'Im Standby',
    [K.USED]: 'Belegter Speicher',
    [K.FREE]: 'Freier Speicher',
    [K.ERRORS]: 'Fehler',
    [K.STATUS]: 'Status',
    [K.RUNNING]: 'Läuft',
    [K.UPDATE_AVAILABLE]: 'Update verfügbar',
    [K.STATE]: 'Zustand',
    [K.BATTERY]: 'Akku',
    [K.RUNTIME]: 'Restlaufzeit',
    [K.LOAD]: 'Last',
    [K.ON_BATTERY]: 'Im Akkubetrieb',
    [K.POWER]: 'Leistung',
    [K.INPUT_VOLTAGE]: 'Eingangsspannung',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.CPU]: 'Procesador',
    [K.MEMORY]: 'Memoria',
    [K.CPU_TEMPERATURE]: 'Temperatura del procesador',
    [K.UPTIME]: 'Tiempo en marcha',
    [K.ARRAY_STARTED]: 'Array iniciado',
    [K.ARRAY_STATUS]: 'Estado del array',
    [K.ARRAY_USED]: 'Espacio usado del array',
    [K.ARRAY_FREE]: 'Espacio libre del array',
    [K.PARITY_PROGRESS]: 'Progreso de la comprobación de paridad',
    [K.PARITY_ERRORS]: 'Errores de paridad',
    [K.DISK_PROBLEMS]: 'Discos que requieren atención',
    [K.NOTIFICATIONS]: 'Alertas sin leer',
    [K.CONTAINER_UPDATES]: 'Actualizaciones de contenedores',
    [K.VERSION]: 'Versión de Unraid',
    [K.TEMPERATURE]: 'Temperatura',
    [K.STANDBY]: 'En reposo',
    [K.USED]: 'Espacio usado',
    [K.FREE]: 'Espacio libre',
    [K.ERRORS]: 'Errores',
    [K.STATUS]: 'Estado',
    [K.RUNNING]: 'En marcha',
    [K.UPDATE_AVAILABLE]: 'Actualización disponible',
    [K.STATE]: 'Estado',
    [K.BATTERY]: 'Batería',
    [K.RUNTIME]: 'Autonomía restante',
    [K.LOAD]: 'Carga',
    [K.ON_BATTERY]: 'Con batería',
    [K.POWER]: 'Potencia',
    [K.INPUT_VOLTAGE]: 'Tensión de entrada',
  },
};

export const MODEL = 'Unraid';

const KB_PER_GB = 1e6;
const KB_PER_TB = 1e9;

// Display bounds (the core never applies them on write). Fixed: a bound that
// moves changes the device structure.
export const BOUNDS = Object.freeze({
  TEMPERATURE: [0, 120],
  UPTIME_MAX_DAYS: 36500,
  ARRAY_FREE_MAX_TB: 10000,
  DISK_FREE_MAX_GB: 100000,
  COUNT_MAX: 1000,
  ERRORS_MAX: 1_000_000_000,
  RUNTIME_MAX_MINUTES: 10000,
  POWER_MAX_W: 100000,
  VOLTAGE_MAX: 500,
});

/** External ids of a device of a server slot (`key` null for the server). */
export function deviceIds(gladys, type, slot, key = null) {
  return gladys.externalIds(type, key === null ? `${slot}` : `${slot}-${key}`);
}

/**
 * The type, slot and item key of a device external id, null when not ours.
 * @returns {{ type: string, slot: number, key: string|null }|null}
 */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (!externalId.startsWith(prefix)) {
      continue;
    }
    const rest = externalId.slice(prefix.length);
    const match =
      type === DEVICE_TYPES.SERVER
        ? rest.match(/^(\d+)$/)
        : rest.match(/^(\d+)-([A-Za-z0-9_.-]{1,64})$/);
    return match ? { type, slot: Number(match[1]), key: match[2] ?? null } : null;
  }
  return null;
}

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const binaryOf = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

// Feature shapes. `noisy`: moves at every read, published at most once a
// minute (src/hub.js) to stay far below the 300 states per minute of Gladys.
// `text`: a text/text feature, published as `{ text }`.
const percent = (digits = 1) => ({
  definition: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  digits,
});
const binary = () => ({
  definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
  digits: 0,
});
const temperature = () => ({
  definition: {
    category: CATEGORY.DEVICE_TEMPERATURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.CELSIUS,
    min: BOUNDS.TEMPERATURE[0],
    max: BOUNDS.TEMPERATURE[1],
  },
  digits: 1,
});
const counter = (max = BOUNDS.COUNT_MAX) => ({
  definition: { category: CATEGORY.COUNTER_SENSOR, type: TYPE.SENSOR.INTEGER, min: 0, max },
  digits: 0,
});
// min/max are NOT NULL in Gladys, text features included.
const textFeature = () => ({
  definition: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
  text: true,
});
// A container or VM switch; read only for the containers of Gladys itself.
const runningSwitch = (readOnly) => ({
  definition: readOnly
    ? { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 }
    : { category: CATEGORY.SWITCH, type: TYPE.SWITCH.BINARY, min: 0, max: 1 },
  digits: 0,
  readOnly,
});

/** The number of a list's items matching, null when the list is unknown. */
const count = (items, test) => (items ? items.filter(test).length : null);

/**
 * The features of each device type: their shape and their value. `item` is
 * what the device stands for (the snapshot for the server, a disk, a
 * container, a VM, a UPS); `ctx` carries what the server knows beyond it
 * ({ online, language }).
 */
const BLUEPRINTS = {
  [DEVICE_TYPES.SERVER]: [
    // Known without a read: offline is what a failed read says.
    { key: K.ONLINE, ...binary(), withoutItem: true, value: (_, ctx) => (ctx.online ? 1 : 0) },
    { key: K.CPU, ...percent(), noisy: true, optional: true, value: (s) => s.cpu },
    { key: K.MEMORY, ...percent(), noisy: true, optional: true, value: (s) => s.memory },
    {
      key: K.CPU_TEMPERATURE,
      ...temperature(),
      noisy: true,
      optional: true,
      value: (s) => s.cpuTemperature,
    },
    {
      key: K.UPTIME,
      definition: {
        category: CATEGORY.DURATION,
        type: TYPE.DURATION.DECIMAL,
        unit: UNIT.DAYS,
        min: 0,
        max: BOUNDS.UPTIME_MAX_DAYS,
      },
      digits: 2,
      optional: true,
      value: (s) => (s.uptimeSeconds === null ? null : s.uptimeSeconds / 86400),
    },
    {
      key: K.ARRAY_STARTED,
      ...binary(),
      value: (s) => (s.array.state ? binaryOf(s.array.started) : null),
    },
    {
      key: K.ARRAY_STATUS,
      ...textFeature(),
      value: (s, ctx) => (s.array.state ? arrayStatusText(s, ctx.language) : null),
    },
    { key: K.ARRAY_USED, ...percent(), optional: true, value: (s) => s.array.usedPercent },
    {
      key: K.ARRAY_FREE,
      definition: {
        category: CATEGORY.DATA,
        type: TYPE.DATA.SIZE,
        unit: UNIT.TERABYTE,
        min: 0,
        max: BOUNDS.ARRAY_FREE_MAX_TB,
      },
      digits: 2,
      optional: true,
      value: (s) => (s.array.freeKB === null ? null : s.array.freeKB / KB_PER_TB),
    },
    {
      key: K.PARITY_PROGRESS,
      ...percent(0),
      optional: true,
      value: (s) => (s.parity ? s.parity.progress : null),
    },
    {
      key: K.PARITY_ERRORS,
      ...counter(BOUNDS.ERRORS_MAX),
      optional: true,
      value: (s) => s.parity?.errors ?? null,
    },
    { key: K.DISK_PROBLEMS, ...counter(), value: (s) => count(s.disks, diskProblem) },
    {
      key: K.NOTIFICATIONS,
      ...counter(),
      optional: true,
      value: (s) => {
        const unread = s.notifications?.unread;
        return unread ? unread.alert + unread.warning : null;
      },
    },
    {
      key: K.CONTAINER_UPDATES,
      ...counter(),
      optional: true,
      value: (s) =>
        s.containers?.some((c) => c.updateAvailable !== null)
          ? count(s.containers, (c) => c.updateAvailable === true)
          : null,
    },
    { key: K.VERSION, ...textFeature(), optional: true, value: (s) => s.version },
  ],
  [DEVICE_TYPES.DISK]: [
    // Known while the disk spins; nothing is published while it sleeps.
    { key: K.TEMPERATURE, ...temperature(), value: (d) => d.temperature },
    {
      key: K.STANDBY,
      ...binary(),
      optional: true,
      // A solid-state disk never sleeps.
      value: (d) => (d.rotational === false || d.spinning === null ? null : d.spinning ? 0 : 1),
    },
    { key: K.USED, ...percent(), optional: true, value: (d) => d.usedPercent },
    {
      key: K.FREE,
      definition: {
        category: CATEGORY.DATA,
        type: TYPE.DATA.SIZE,
        unit: UNIT.GIGABYTE,
        min: 0,
        max: BOUNDS.DISK_FREE_MAX_GB,
      },
      digits: 1,
      optional: true,
      value: (d) => (d.freeKB === null ? null : d.freeKB / KB_PER_GB),
    },
    { key: K.ERRORS, ...counter(BOUNDS.ERRORS_MAX), value: (d) => d.errors },
    { key: K.STATUS, ...textFeature(), value: (d, ctx) => diskStatusText(d.status, ctx.language) },
  ],
  [DEVICE_TYPES.CONTAINER]: [
    { key: K.RUNNING, ...runningSwitch(false), value: (c) => binaryOf(c.running) },
    {
      key: K.UPDATE_AVAILABLE,
      ...binary(),
      optional: true,
      value: (c) => binaryOf(c.updateAvailable),
    },
  ],
  [DEVICE_TYPES.VM]: [
    { key: K.RUNNING, ...runningSwitch(false), value: (vm) => binaryOf(vm.running) },
    { key: K.STATE, ...textFeature(), value: (vm, ctx) => vmStateText(vm.state, ctx.language) },
  ],
  [DEVICE_TYPES.UPS]: [
    {
      key: K.BATTERY,
      definition: {
        category: CATEGORY.BATTERY,
        type: TYPE.BATTERY.INTEGER,
        unit: UNIT.PERCENT,
        min: 0,
        max: 100,
      },
      digits: 0,
      value: (u) => u.battery,
    },
    {
      key: K.RUNTIME,
      definition: {
        category: CATEGORY.DURATION,
        type: TYPE.DURATION.INTEGER,
        unit: UNIT.MINUTES,
        min: 0,
        max: BOUNDS.RUNTIME_MAX_MINUTES,
      },
      digits: 0,
      value: (u) => u.runtimeMinutes,
    },
    { key: K.LOAD, ...percent(0), noisy: true, value: (u) => u.load },
    { key: K.ON_BATTERY, ...binary(), value: (u) => binaryOf(u.onBattery) },
    {
      key: K.POWER,
      definition: {
        category: CATEGORY.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.POWER,
        unit: UNIT.WATT,
        min: 0,
        max: BOUNDS.POWER_MAX_W,
      },
      digits: 0,
      noisy: true,
      optional: true,
      value: (u) => u.power,
    },
    {
      key: K.INPUT_VOLTAGE,
      definition: {
        category: CATEGORY.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.VOLTAGE,
        unit: UNIT.VOLT,
        min: 0,
        max: BOUNDS.VOLTAGE_MAX,
      },
      digits: 0,
      noisy: true,
      optional: true,
      value: (u) => u.inputVoltage,
    },
    { key: K.STATUS, ...textFeature(), optional: true, value: (u) => u.status },
  ],
};

/** The features of a device type with a value for this item. */
export function valuedKeys(type, item, ctx) {
  return BLUEPRINTS[type]
    .filter((feature) => {
      const value = feature.value(item, ctx);
      return value !== null && value !== undefined && value !== '';
    })
    .map((feature) => feature.key);
}

/** Whether a feature exists: always, or once it had a value (`seen`). */
const present = (feature, seen) => !feature.optional || seen.has(feature.key);

/**
 * The discovery payload of a device.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {string} options.type one of DEVICE_TYPES
 * @param {number} options.slot server slot
 * @param {string|null} options.key item key (null for the server)
 * @param {string} options.name device name
 * @param {Set<string>} options.seen the optional features this device ever had
 * @param {boolean} [options.readOnly] a container of Gladys itself
 * @param {string} [options.language] feature names language
 * @param {Array<{name: string, value: string}>} [options.params]
 */
export function buildDevice(
  gladys,
  { type, slot, key = null, name, seen, readOnly = false, language = 'en', params = [] },
) {
  const ids = deviceIds(gladys, type, slot, key);
  const names = NAMES[language] ?? NAMES.en;
  const features = BLUEPRINTS[type]
    .filter((feature) => present(feature, seen))
    .map((feature) => {
      const shape = feature.readOnly === false && readOnly ? runningSwitch(true) : feature;
      const writable = shape.readOnly === false;
      return {
        name: names[feature.key],
        external_id: ids.feature(feature.key),
        ...shape.definition,
        read_only: !writable,
        has_feedback: writable,
        keep_history: !feature.text,
      };
    });
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: params.map((param) => ({ name: param.name, value: String(param.value).slice(0, 255) })),
    features,
  };
}

/**
 * The value of every feature of a device (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|null, text: boolean, noisy: boolean }>}
 */
export function featureValues(gladys, { type, slot, key = null, item, ctx, seen }) {
  const ids = deviceIds(gladys, type, slot, key);
  return BLUEPRINTS[type]
    .filter((feature) => present(feature, seen))
    .map((feature) => {
      const raw = item === null && !feature.withoutItem ? null : feature.value(item, ctx);
      return {
        key: feature.key,
        externalId: ids.feature(feature.key),
        value: feature.text
          ? typeof raw === 'string' && raw.trim()
            ? raw.trim().slice(0, 255)
            : null
          : round(raw, feature.digits),
        text: Boolean(feature.text),
        noisy: Boolean(feature.noisy),
      };
    });
}

/** The feature of a device the user can switch, null when none. */
export function switchKey(type) {
  return type === DEVICE_TYPES.CONTAINER || type === DEVICE_TYPES.VM ? K.RUNNING : null;
}
