// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
//   - control_container: start, stop or restart a container. The switch of
//     a container device does start and stop; restarting is what it cannot
//     do (Plex stuck, a VPN to reconnect at night);
//   - control_vm: start a VM, or shut it down (the ACPI shutdown, never a
//     forced stop);
//   - get_server_status: the state of the server for the next actions, with
//     a ready-made summary to send ("Array: Started. 6 disk(s) OK…"). An
//     unreachable server is an answer, not a failure: `online` false.
//
// Nothing stops the array or the server from Gladys: too risky for a scene
// or a voice command, and Unraid's own interface does it better.
// -----------------------------------------------------------------------------

import { DEVICE_TYPES } from './devices.js';
import { diskProblem } from './unraid/model.js';
import { ACTION_TEXT, SUMMARY_TEXT, arrayStatusText, pick } from './texts.js';
import { CONTAINER_COMMANDS, VM_COMMANDS } from './unraid/queries.js';

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The state of the server in a few sentences, in the configured language. */
export function summarize(hub, language) {
  const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
  const record = hub.record;
  if (!record || record.error || !record.snapshot) {
    return text.offline;
  }
  const { snapshot } = record;
  const parts = [text.array(arrayStatusText(snapshot, language))];
  parts.push(text.disks(snapshot.disks.filter(diskProblem).length, snapshot.disks.length));
  if (snapshot.containers) {
    parts.push(
      text.containers(
        snapshot.containers.filter((c) => c.running).length,
        snapshot.containers.length,
      ),
    );
  }
  const unread = snapshot.notifications?.unread;
  if (unread && unread.alert + unread.warning > 0) {
    parts.push(text.alerts(unread.alert + unread.warning));
  }
  return parts.join(' ');
}

function checkCommand(command, allowed, language) {
  if (!allowed.includes(command)) {
    throw new Error(pick(ACTION_TEXT.unknownCommand, language));
  }
}

export const SCENE_ACTIONS = {
  async control_container(hub, { fields = {} }) {
    checkCommand(fields.command, CONTAINER_COMMANDS, hub.config?.language);
    const { name } = await hub.command(fields.container, fields.command, DEVICE_TYPES.CONTAINER);
    return { container_name: name };
  },

  async control_vm(hub, { fields = {} }) {
    checkCommand(fields.command, VM_COMMANDS, hub.config?.language);
    const { name } = await hub.command(fields.vm, fields.command, DEVICE_TYPES.VM);
    return { vm_name: name };
  },

  async get_server_status(hub) {
    if (!hub.record) {
      throw new Error(pick(ACTION_TEXT.noServer, hub.config?.language));
    }
    await hub.refreshIfStale();
    const language = hub.config.language;
    const record = hub.record;
    const online = Boolean(record && !record.error && record.snapshot);
    const outputs = { online, summary: summarize(hub, language) };
    if (!online) {
      return outputs;
    }
    const { snapshot } = record;
    outputs.array_state = arrayStatusText(snapshot, language);
    outputs.disk_problems = snapshot.disks.filter(diskProblem).length;
    if (snapshot.cpu !== null) {
      outputs.cpu = round(snapshot.cpu);
    }
    if (snapshot.memory !== null) {
      outputs.memory = round(snapshot.memory);
    }
    if (snapshot.containers) {
      outputs.containers_running = snapshot.containers.filter((c) => c.running).length;
    }
    const unread = snapshot.notifications?.unread;
    if (unread) {
      outputs.unread_alerts = unread.alert + unread.warning;
    }
    return outputs;
  },
};
