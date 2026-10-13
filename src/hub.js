// -----------------------------------------------------------------------------
// The Unraid hub: the configured server, read on a timer of the container
// (the interval chosen in the configuration); the states of the devices the
// user added published to Gladys when they change, the scene events fired on
// transitions (src/alerts.js), the container and VM commands, and the views
// the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core
// scheduler, and the scene events must fire for every disk and container,
// added to Gladys or not.
//
// The 300 states per minute of Gladys: only the devices added are published,
// only what changed (rounded), the values that move at every read at most
// once a minute, and a budget of 240 states per minute on top. Every value
// is sent again after 6 hours unchanged, before the core marks it outdated
// (48 hours).
// (Adapted from guim31/gladys-glances.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Watcher } from './alerts.js';
import { hostOf } from './config.js';
import {
  DEVICE_TYPES,
  buildDevice,
  deviceIds,
  featureValues,
  parseDeviceId,
  switchKey,
  valuedKeys,
} from './devices.js';
import { createIssueLog } from './logs.js';
import { DOWN_KINDS, ERROR_KINDS, UnraidClient, hostForLog } from './unraid/client.js';
import { diskProblem, parseSnapshot } from './unraid/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  containerStateText,
  diskStatusText,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'unraid-hub' });

export const WIDGET_KEY = 'unraid';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  DISK_ERROR: 'disk_error',
  DISK_HOT: 'disk_hot',
  PARITY: 'parity_check_finished',
  CONTAINER: 'container_stopped',
  NOTIFICATION: 'notification',
});

export const HUB_TIMINGS = {
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the server counts as offline.
  downAfterFailures: 2,
  // The values that move at every read (CPU, memory…): at most this often.
  noisyEveryMs: 60_000,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
  // A scene action or a command reads Unraid again when the last read is older.
  freshMs: 15_000,
  // Read again this long after a command (a VM shuts down in its own time).
  followUpMs: 20_000,
  // A container stopped by Gladys within this long fires no "stopped" event.
  ownStopMs: 3 * 60_000,
  // A disk or container not seen for a week is forgotten.
  forgetAfterMs: 7 * 24 * 3600_000,
  // States sent per minute at most, below the 300 of Gladys.
  statesPerMinute: 240,
};

const MAX_STATES_PER_REQUEST = 100;
const MAX_TRANSPORTS_PER_REQUEST = 100;

const signature = (server, config) =>
  JSON.stringify([server.url, server.apiKey, config.allowSelfSigned]);

const seenKey = (type, key) => `${type}|${key ?? ''}`;

export class UnraidHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/unraid/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** The configured server, null when none. */
    this.record = null;
    this.watcher = new Watcher();
    /** The optional features each device already had, by `type|key`. */
    this.seen = new Map();
    /** The address the watcher tables belong to. */
    this.watchedUrl = null;
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    /** When the states of the last minute were sent (budget). */
    this.sentTimes = [];
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.followUpTimer = null;
    /** Containers stopped by Gladys, by name: until when their stop is ours. */
    this.ownStops = new Map();
    this.stopped = false;
    // Failures that repeat at every read: one line, then one when they heal.
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.watcher = new Watcher(saved.watcher);
    this.watchedUrl = typeof saved.url === 'string' ? saved.url : null;
    this.seen = new Map(
      Object.entries(saved.seen && typeof saved.seen === 'object' ? saved.seen : {})
        .filter(([, keys]) => Array.isArray(keys))
        .map(([key, keys]) => [key, new Set(keys.filter((k) => typeof k === 'string'))]),
    );
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    const { server } = config;
    if (this.record && (!server || this.record.signature !== signature(server, config))) {
      this.dropRecord(this.record);
      this.record = null;
    }
    if (server && this.watchedUrl !== server.url) {
      // Another address may be another machine: what was announced for the
      // old one must not fire for the new one (recorded again, silently).
      if (this.watchedUrl !== null) {
        this.watcher.forgetAll();
      }
      this.watchedUrl = server.url;
      this.saveState();
    }
    if (server && this.record) {
      this.record.server = server; // a new name only
    } else if (server) {
      this.record = this.newRecord(server, config);
    }
    if (languageChanged) {
      this.discovered = null;
    }
    await this.pollAll({ publish: true });
    this.schedulePoll();
  }

  newRecord(server, config) {
    return {
      server,
      signature: signature(server, config),
      client: new UnraidClient({
        url: server.url,
        apiKey: server.apiKey,
        insecure: config.allowSelfSigned,
        request: this.request,
        now: this.now,
      }),
      /** @type {object|null} the last snapshot read (src/unraid/model.js) */
      snapshot: null,
      /** Items of the snapshot by `type|key`. */
      index: null,
      caps: null,
      readAt: 0,
      error: null,
      failures: 0,
      down: false,
      polling: null,
      retryTimer: null,
      widgetDigest: null,
      dropped: false,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.followUpTimer);
    if (this.record) {
      clearTimeout(this.record.retryTimer);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.record) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  saveState() {
    this.store.save({
      url: this.watchedUrl,
      watcher: this.watcher.saved,
      seen: Object.fromEntries([...this.seen].map(([key, keys]) => [key, [...keys].sort()])),
    });
  }

  // --- Names and identities ------------------------------------------------------

  /** The server name: the one configured, the host name Unraid gives, or the address. */
  serverName(record = this.record) {
    if (!record) {
      return 'Unraid';
    }
    return record.server.name ?? record.snapshot?.hostname ?? hostOf(record.server.url);
  }

  serverId() {
    return deviceIds(this.gladys, DEVICE_TYPES.SERVER, this.record?.server.slot ?? 1).device;
  }

  childId(type, key) {
    return deviceIds(this.gladys, type, this.record?.server.slot ?? 1, key).device;
  }

  /** The devices of the server the user added, with their parsed identity. */
  createdDevices(slot) {
    const devices = [];
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseDeviceId(this.gladys, device.external_id);
      if (parsed?.slot === slot) {
        devices.push({ device, ...parsed });
      }
    }
    return devices;
  }

  context(record) {
    return {
      online: !record.down && record.error === null && record.snapshot !== null,
      language: this.config?.language ?? 'en',
    };
  }

  /** Every device a snapshot proposes: the server, its disks, containers, VMs, UPS. */
  items(record) {
    const { snapshot } = record;
    if (!snapshot) {
      return [];
    }
    const server = this.serverName(record);
    const child = (type, item, label) => ({
      type,
      key: item.key,
      name: `${server} ${label}`,
      item,
    });
    return [
      {
        type: DEVICE_TYPES.SERVER,
        key: null,
        name: server,
        item: snapshot,
        params: [{ name: 'UNRAID_URL', value: record.server.url }],
      },
      ...snapshot.disks.map((disk) => child(DEVICE_TYPES.DISK, disk, disk.label)),
      ...(snapshot.containers ?? []).map((c) => ({
        ...child(DEVICE_TYPES.CONTAINER, c, c.name),
        readOnly: c.protected,
      })),
      ...(snapshot.vms ?? []).map((vm) => child(DEVICE_TYPES.VM, vm, vm.name)),
      ...(snapshot.ups ?? []).map((ups) => child(DEVICE_TYPES.UPS, ups, ups.name)),
    ];
  }

  indexOf(record) {
    const index = new Map();
    for (const entry of this.items(record)) {
      index.set(seenKey(entry.type, entry.key), entry);
    }
    return index;
  }

  /** The entry a device stands for in the last snapshot, null when absent. */
  entryFor(record, type, key) {
    return record.index?.get(seenKey(type, key)) ?? null;
  }

  seenOf(type, key) {
    return this.seen.get(seenKey(type, key)) ?? new Set();
  }

  /** Remember the optional features each device has had a value for. */
  rememberFeatures(record) {
    const ctx = this.context(record);
    let changed = false;
    for (const entry of this.items(record)) {
      const id = seenKey(entry.type, entry.key);
      const seen = this.seen.get(id) ?? new Set();
      for (const key of valuedKeys(entry.type, entry.item, ctx)) {
        if (!seen.has(key)) {
          seen.add(key);
          changed = true;
        }
      }
      this.seen.set(id, seen);
    }
    return changed;
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    const record = this.record;
    if (!record) {
      return [];
    }
    return this.items(record).map((entry) =>
      buildDevice(this.gladys, {
        ...entry,
        slot: record.server.slot,
        seen: this.seenOf(entry.type, entry.key),
        language: this.config.language,
      }),
    );
  }

  /** Publish the Discovery list when it changed (a container created, a disk added…). */
  async publishDevices({ force = false } = {}) {
    // Nothing read yet: keep the list Gladys has (a restart while Unraid is down).
    if (this.record && !this.record.snapshot && !force) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the server, publish the list again. */
  async rediscover() {
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added (or updated) a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const found = this.find(device.external_id);
    if (!found) {
      return;
    }
    // A device deleted then added again is a new row in Gladys: no badge yet.
    this.transports.delete(device.external_id);
    await this.publishRecordStates(found.record, { force: true, only: device.external_id });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The user deleted a device: forget what was sent for it. */
  onDeviceDeleted(device) {
    const id = device?.external_id;
    if (typeof id !== 'string') {
      return;
    }
    this.transports.delete(id);
    for (const map of [this.published, this.publishedAt]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${id}:`)) {
          map.delete(key);
        }
      }
    }
  }

  // --- Reading the server ---------------------------------------------------------

  async pollAll({ publish = false } = {}) {
    const changed = this.record ? await this.poll(this.record) : false;
    await this.afterChanges(changed, { publish });
  }

  /** Gladys asks for a refresh (onPoll): read the server now. */
  async pollDevice(device) {
    const found = this.find(device.external_id);
    if (found) {
      await this.afterChanges(await this.poll(found.record));
    }
  }

  /** Read again when the last read is older than `freshMs` (scene actions, commands). */
  async refreshIfStale() {
    const { record } = this;
    if (record && this.now() - record.readAt >= this.timings.freshMs) {
      await this.afterChanges(await this.poll(record));
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    try {
      return await this.applySuccess(record, await record.client.read());
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  async applySuccess(record, read) {
    if (record.dropped) {
      return false;
    }
    const now = this.now();
    const snapshot = parseSnapshot(read, now);
    if (record.error) {
      logger.info(`${this.serverName(record)} answers again`);
    }
    if (!record.snapshot || record.snapshot.version !== snapshot.version) {
      logger.info(
        `Connected to ${snapshot.hostname ?? hostForLog(record.server.url)}: Unraid ${
          snapshot.version ?? '?'
        }${read.caps.permissive ? ' (API fields not readable: assuming the current API)' : ''}`,
      );
    }
    for (const [group, kind] of Object.entries(snapshot.unavailable)) {
      this.issues.fail(`group:${group}`, 'warn', `Unraid ${group} not readable (${kind})`);
    }
    for (const group of Object.keys(read.groups)) {
      if (!snapshot.unavailable[group]) {
        this.issues.ok(`group:${group}`, `Unraid ${group} readable again`);
      }
    }
    record.snapshot = snapshot;
    record.caps = read.caps;
    record.index = this.indexOf(record);
    record.failures = 0;
    record.down = false;
    record.error = null;
    record.readAt = now;

    if (this.rememberFeatures(record)) {
      this.saveState();
    }
    await this.fireTransitions(record, snapshot, now);
    this.watcher.forgetStale(now, this.timings.forgetAfterMs);
    for (const [name, until] of this.ownStops) {
      if (until <= now) {
        this.ownStops.delete(name);
      }
    }
    this.saveState();

    await this.publishRecordStates(record);
    const digest = JSON.stringify(this.widgetDigest(record));
    const widgetChanged = digest !== record.widgetDigest;
    record.widgetDigest = digest;
    return widgetChanged;
  }

  /** What the widget shows, coarsely: a change refreshes it at once. */
  widgetDigest(record) {
    const { snapshot } = record;
    if (!snapshot) {
      return null;
    }
    return [
      record.error?.kind ?? null,
      snapshot.array.state,
      snapshot.parity?.active ?? null,
      snapshot.parity ? Math.floor(snapshot.parity.progress / 10) : null,
      snapshot.disks.filter(diskProblem).map((disk) => disk.key),
      snapshot.containers?.filter((c) => c.running).map((c) => c.key) ?? null,
      snapshot.vms?.filter((vm) => vm.running).map((vm) => vm.key) ?? null,
      snapshot.ups?.map((ups) => ups.onBattery) ?? null,
      snapshot.notifications?.unread ?? null,
    ];
  }

  async fireTransitions(record, snapshot, now) {
    const server = this.serverName(record);
    const language = this.config.language;

    const { failing, hot } = this.watcher.disks(snapshot.disks, now);
    for (const { disk, reason } of failing) {
      logger.warn(`${server} ${disk.label}: ${disk.status}, ${disk.errors} error(s) (${reason})`);
      await this.fireEvent(TRIGGERS.DISK_ERROR, {
        disk: this.childId(DEVICE_TYPES.DISK, disk.key),
        server_name: server,
        disk_name: disk.label,
        status: diskStatusText(disk.status, language),
        errors: disk.errors,
      });
    }
    for (const { disk, threshold } of hot) {
      logger.debug(`${server} ${disk.label}: ${disk.temperature} °C (step ${threshold} °C)`);
      await this.fireEvent(TRIGGERS.DISK_HOT, {
        disk: this.childId(DEVICE_TYPES.DISK, disk.key),
        threshold,
        server_name: server,
        disk_name: disk.label,
        temperature: disk.temperature,
      });
    }

    const finished = this.watcher.parity(snapshot.parity, now);
    if (finished) {
      logger.info(
        `${server}: parity ${finished.operation} finished (${finished.result}, ${
          finished.errors ?? '?'
        } error(s))`,
      );
      await this.fireEvent(TRIGGERS.PARITY, {
        result: finished.result,
        server_name: server,
        operation: finished.operation,
        errors: finished.errors,
        duration_minutes: finished.durationMinutes,
      });
    }

    if (snapshot.containers) {
      const ownStop = (name) => (this.ownStops.get(name) ?? 0) > now;
      for (const { name, state } of this.watcher.containers(snapshot.containers, now, ownStop)) {
        logger.debug(`${server}: container ${name} stopped (${state})`);
        const container = snapshot.containers.find((c) => c.name === name);
        await this.fireEvent(TRIGGERS.CONTAINER, {
          container: container ? this.childId(DEVICE_TYPES.CONTAINER, container.key) : null,
          server_name: server,
          container_name: name,
          state: containerStateText(state, language),
        });
      }
    }

    if (snapshot.notifications) {
      for (const notification of this.watcher.notifications(snapshot.notifications.list)) {
        logger.debug(`${server}: notification ${notification.importance}: ${notification.subject}`);
        await this.fireEvent(TRIGGERS.NOTIFICATION, {
          importance: notification.importance,
          server_name: server,
          title: notification.title,
          subject: notification.subject,
          description: notification.description,
        });
      }
    }
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`${this.serverName(record)}: ${err.message}`);
    } else {
      // The same failure at every read: logged once, "answers again" when it heals.
      logger.debug(`${this.serverName(record)}: ${err.message}`);
    }
    // Only silence counts as offline: a refused key is a configuration
    // problem, reported by the connection status.
    if (!DOWN_KINDS.has(err.kind)) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.publishRecordStates(record);
      return true;
    }
    if (record.down) {
      // Offline again after a resync or past the heartbeat (deduplicated).
      await this.publishRecordStates(record);
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  /** Read again a little after a command: a VM shuts down in its own time. */
  scheduleFollowUp() {
    clearTimeout(this.followUpTimer);
    if (!this.timersEnabled || this.stopped || !this.record) {
      return;
    }
    const record = this.record;
    this.followUpTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .catch((err) => this.issues.fail('follow-up', 'error', 'Follow-up read failed', err));
    }, this.timings.followUpMs);
    this.followUpTimer.unref?.();
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /**
   * The states of the devices the user added.
   * @param {object} record
   * @param {object} [options]
   * @param {boolean} [options.force] send even unchanged values (a device just added)
   * @param {string} [options.only] the external id of the one device to send
   */
  async publishRecordStates(record, { force = false, only = null } = {}) {
    const { slot } = record.server;
    const ctx = this.context(record);
    const values = [];
    for (const { device, type, key } of this.createdDevices(slot)) {
      if (only && device.external_id !== only) {
        continue;
      }
      const seen = this.seenOf(type, key);
      if (record.error) {
        // Nothing read: only say the server is offline once it is.
        if (type === DEVICE_TYPES.SERVER && record.down) {
          values.push(
            ...featureValues(this.gladys, { type, slot, key, item: null, ctx, seen }).filter(
              (entry) => entry.value !== null,
            ),
          );
        }
        continue;
      }
      const entry = this.entryFor(record, type, key);
      if (!entry) {
        // Gone from this read (a container being recreated), or its group
        // not readable: nothing known.
        continue;
      }
      values.push(...featureValues(this.gladys, { type, slot, key, item: entry.item, ctx, seen }));
    }
    await this.sendStates(values, { force });
  }

  /** Keep what must be sent now: changed, not too soon, within the budget. */
  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const due = [];
    for (const entry of values) {
      const { externalId, value, noisy } = entry;
      if (value === null) {
        continue;
      }
      const last = this.published.get(externalId);
      const at = this.publishedAt.get(externalId);
      if (!force) {
        if (last === value && at !== undefined && now - at < this.timings.heartbeatMs) {
          continue;
        }
        if (last !== value && noisy && at !== undefined && now - at < this.timings.noisyEveryMs) {
          continue;
        }
      }
      due.push(entry);
    }
    this.sentTimes = this.sentTimes.filter((time) => now - time < 60_000);
    let states = due;
    if (!force) {
      const allowed = Math.max(0, this.timings.statesPerMinute - this.sentTimes.length);
      if (due.length > allowed) {
        // The quiet values first (a disk, a container state); the rest waits.
        states = [...due.filter((s) => !s.noisy), ...due.filter((s) => s.noisy)].slice(0, allowed);
      }
    }
    // Reserved before any request: a command and a read may publish at the same time.
    for (let i = 0; i < states.length; i += 1) {
      this.sentTimes.push(now);
    }
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(
          batch.map(({ externalId, value, text }) =>
            text
              ? { device_feature_external_id: externalId, text: value }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        for (const { externalId, value } of batch) {
          this.published.set(externalId, value);
          this.publishedAt.set(externalId, now);
        }
        this.issues.ok('states', 'States accepted again');
      } catch (err) {
        this.issues.fail('states', 'warn', `States refused: ${err.message}`);
        for (let i = 0; i < batch.length; i += 1) {
          const index = this.sentTimes.lastIndexOf(now);
          if (index >= 0) {
            this.sentTimes.splice(index, 1);
          }
        }
      }
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable" with the server. */
  async publishTransports() {
    const { record } = this;
    if (!record || record.readAt === 0) {
      return;
    }
    const transport =
      record.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    for (const { device } of this.createdDevices(record.server.slot)) {
      if (this.transports.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.issues.ok('transports', 'Transports accepted again');
      } catch (err) {
        this.issues.fail('transports', 'warn', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const config = this.config;
    if (!config || !config.server) {
      return {
        connected: false,
        message: config?.invalidUrl
          ? CONNECTION_TEXT.invalidUrl
          : config?.missingKey
            ? CONNECTION_TEXT.missingKey
            : CONNECTION_TEXT.noServer,
      };
    }
    const { record } = this;
    if (!record?.error) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      message[language] = labelled(
        this.serverName(record),
        pick(ERROR_TEXT[record.error.kind], language),
        language,
      ).slice(0, 200);
    }
    return { connected: false, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands ---------------------------------------------------------------------

  /**
   * The server of a device external id.
   * @returns {{ record: object, type: string, key: string|null }|null}
   */
  find(externalId) {
    const parsed = parseDeviceId(this.gladys, externalId);
    const record = parsed && this.record?.server.slot === parsed.slot ? this.record : null;
    return record ? { record, type: parsed.type, key: parsed.key } : null;
  }

  /** Throws the reason the server cannot take a command or answer an action. */
  assertReadable() {
    if (!this.record) {
      throw new Error(pick(ACTION_TEXT.noServer, this.config?.language));
    }
    if (this.record.error || !this.record.snapshot) {
      throw new Error(pick(ACTION_TEXT.unreadable, this.config.language));
    }
  }

  /** The error a refused command shows in Gladys. */
  commandError(err) {
    const language = this.config?.language;
    if (!err.kind) {
      return err;
    }
    if (err.kind === ERROR_KINDS.FORBIDDEN) {
      return new Error(pick(ACTION_TEXT.forbidden, language));
    }
    if (err.kind === ERROR_KINDS.GRAPHQL) {
      return new Error(pick(ACTION_TEXT.failed, language));
    }
    return new Error(labelled(this.serverName(), pick(ERROR_TEXT[err.kind], language), language));
  }

  /**
   * Start, stop or restart a container, or start or stop a VM.
   * @param {string} deviceExternalId a container or VM device of this integration
   * @param {'start'|'stop'|'restart'} command
   * @param {'container'|'vm'|null} [expected] the type the caller expects
   * @returns {Promise<{ name: string, type: string }>}
   */
  async command(deviceExternalId, command, expected = null) {
    const language = this.config?.language;
    const found = this.find(deviceExternalId);
    const wrongType = (type) =>
      new Error(
        pick(type === DEVICE_TYPES.VM ? ACTION_TEXT.notVm : ACTION_TEXT.notContainer, language),
      );
    if (!found || !switchKey(found.type) || (expected && found.type !== expected)) {
      if (!this.record) {
        throw new Error(pick(ACTION_TEXT.noServer, language));
      }
      throw wrongType(expected ?? DEVICE_TYPES.CONTAINER);
    }
    const { record, type, key } = found;
    if (type === DEVICE_TYPES.VM && command === 'restart') {
      throw new Error(pick(ACTION_TEXT.unknownCommand, language));
    }
    await this.refreshIfStale();
    this.assertReadable();
    const entry = this.entryFor(record, type, key);
    if (!entry || !entry.item.id) {
      throw new Error(pick(ACTION_TEXT.gone, language));
    }
    const { item } = entry;
    if (type === DEVICE_TYPES.CONTAINER && item.protected && command !== 'start') {
      throw new Error(pick(ACTION_TEXT.protected, language));
    }
    if (type === DEVICE_TYPES.CONTAINER && command !== 'start') {
      // Its stop is Gladys' own: no "Container stopped" event for it.
      this.ownStops.set(item.name, this.now() + this.timings.ownStopMs);
    }
    try {
      if (type === DEVICE_TYPES.CONTAINER) {
        await record.client.containerCommand(item.id, command);
      } else {
        await record.client.vmCommand(item.id, command);
      }
    } catch (err) {
      if (type === DEVICE_TYPES.CONTAINER) {
        this.ownStops.delete(item.name);
      }
      logger.warn(`${type} ${item.name}: ${command} refused: ${err.message}`);
      throw this.commandError(err);
    }
    logger.info(`${type} ${item.name}: ${command} requested`);
    // The new state, now and a little later.
    await this.afterChanges(await this.poll(record));
    this.scheduleFollowUp();
    return { name: item.name, type };
  }

  /** The switch of a container or a VM device. */
  async setValue(device, feature, value) {
    const found = this.find(device.external_id);
    const key = found ? switchKey(found.type) : null;
    if (
      !key ||
      feature.external_id !==
        deviceIds(this.gladys, found.type, found.record.server.slot, found.key).feature(key)
    ) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    await this.command(device.external_id, Number(value) === 1 ? 'start' : 'stop');
  }

  // --- Reports -------------------------------------------------------------------------

  /** "Test the connection": read the server now, one line. */
  async testConnection() {
    await this.pollAll({ publish: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const { record } = this;
      if (!record) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      if (record.error) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const { snapshot } = record;
      const parts = [
        text.ok,
        `Unraid ${snapshot.version ?? '?'}`,
        text.disks(snapshot.disks.length),
      ];
      if (snapshot.containers) {
        parts.push(
          text.containers(
            snapshot.containers.filter((c) => c.running).length,
            snapshot.containers.length,
          ),
        );
      }
      if (snapshot.vms) {
        parts.push(text.vms(snapshot.vms.filter((vm) => vm.running).length, snapshot.vms.length));
      }
      if (snapshot.ups?.length) {
        parts.push(text.ups(snapshot.ups.length));
      }
      message[language] = labelled(this.serverName(record), parts.join(', '), language);
    }
    return message;
  }
}
