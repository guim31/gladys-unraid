// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `unraid`.
//
// The use case: a glance at the server from the wall tablet, "is everything
// fine?": the array, the parity, the disks that need attention, the
// containers that should run and do not, the UPS, the unread alerts. And,
// for the container or VM chosen in the widget settings, the buttons that
// start, stop or restart it (stop and restart ask for a confirmation).
//
// Budget (8 components, 2 texts, 6 tiles, 1 status, 4 buttons): a heading
// (server and version), three tiles (CPU, memory, array space), one status
// list (up to 10 rows, the problems first) and up to three buttons. The
// figures are sent as values, not bound to device features, so the widget
// works before any device is added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { diskProblem } from './unraid/model.js';
import {
  DONE_TEXT,
  ERROR_TEXT,
  arrayStatusText,
  diskStatusText,
  formatNumber,
  labelled,
  pick,
} from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  START: 'start',
  STOP: 'stop',
  RESTART: 'restart',
  REFRESH: 'refresh',
});

// A disk at or above this temperature shows in the list.
export const WARM_DISK_CELSIUS = 50;
const MAX_ROWS = 10;
const ACTIVE_ICON = 'check-circle';

export const TEXT = {
  pick: {
    en: 'Enter the address of your Unraid server and an API key in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur Unraid et une clé d'API dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Unraid-Servers und einen API-Schlüssel in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor Unraid y una clave de API en la configuración de la integración.',
  },
  waiting: {
    en: 'Reading the Unraid server…',
    fr: 'Lecture du serveur Unraid…',
    de: 'Der Unraid-Server wird gelesen …',
    es: 'Leyendo el servidor Unraid…',
  },
  cpu: { en: 'CPU', fr: 'Processeur', de: 'Prozessor', es: 'Procesador' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  arrayUsed: { en: 'Array used', fr: 'Matrice utilisée', de: 'Array belegt', es: 'Array usado' },
  array: { en: 'Array', fr: 'Matrice', de: 'Array', es: 'Array' },
  parity: {
    en: 'Last parity check',
    fr: 'Dernier contrôle de parité',
    de: 'Letzte Paritätsprüfung',
    es: 'Última comprobación',
  },
  noError: { en: 'No error', fr: 'Aucune erreur', de: 'Keine Fehler', es: 'Sin errores' },
  errors: { en: 'errors', fr: 'erreurs', de: 'Fehler', es: 'errores' },
  disks: { en: 'Disks', fr: 'Disques', de: 'Festplatten', es: 'Discos' },
  disksOk: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  asleep: { en: 'asleep', fr: 'en veille', de: 'im Standby', es: 'en reposo' },
  used: { en: 'used', fr: 'utilisé', de: 'belegt', es: 'usado' },
  cpuTemperature: {
    en: 'CPU temperature',
    fr: 'Température processeur',
    de: 'Prozessortemperatur',
    es: 'Temperatura del procesador',
  },
  containers: { en: 'Containers', fr: 'Conteneurs', de: 'Container', es: 'Contenedores' },
  stoppedAuto: {
    en: 'Stopped (autostart)',
    fr: 'Arrêtés (démarrage auto)',
    de: 'Gestoppt (Autostart)',
    es: 'Detenidos (inicio auto)',
  },
  running: { en: 'running', fr: 'en marche', de: 'laufen', es: 'en marcha' },
  vms: { en: 'VMs', fr: 'VM', de: 'VMs', es: 'VM' },
  onMains: { en: 'On mains', fr: 'Sur secteur', de: 'Am Netz', es: 'En red' },
  onBattery: { en: 'On battery', fr: 'Sur batterie', de: 'Im Akkubetrieb', es: 'Con batería' },
  alerts: {
    en: 'Unread alerts',
    fr: 'Alertes non lues',
    de: 'Ungelesene Warnungen',
    es: 'Alertas sin leer',
  },
  updates: {
    en: 'Container updates',
    fr: 'Mises à jour conteneurs',
    de: 'Container-Updates',
    es: 'Actualizaciones',
  },
  offline: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  start: { en: 'Start', fr: 'Démarrer', de: 'Starten', es: 'Iniciar' },
  stop: { en: 'Stop', fr: 'Arrêter', de: 'Stoppen', es: 'Detener' },
  restart: { en: 'Restart', fr: 'Redémarrer', de: 'Neu starten', es: 'Reiniciar' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: fit(t(text, language), 300) }],
  };
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

/** The status rows: the problems first, then the summary of each part. */
export function rows(snapshot, language) {
  const problems = [];
  const summary = [];
  const { array, parity, disks } = snapshot;

  summary.push({
    label: t(TEXT.array, language),
    icon: 'hard-drive',
    value: fit(arrayStatusText(snapshot, language), 40),
    color: parity?.active
      ? WIDGET_COLORS.INFO
      : array.started
        ? WIDGET_COLORS.SUCCESS
        : array.state === 'STOPPED'
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.DANGER,
  });
  if (parity && !parity.active && parity.errors !== null && parity.status !== 'NEVER_RUN') {
    summary.push({
      label: t(TEXT.parity, language),
      icon: 'shield',
      value:
        parity.errors > 0
          ? `${parity.errors} ${t(TEXT.errors, language)}`
          : t(TEXT.noError, language),
      color: parity.errors > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    });
  }

  for (const disk of disks.filter(diskProblem)) {
    problems.push({
      label: disk.label,
      icon: 'alert-triangle',
      value: fit(
        disk.ok
          ? `${disk.errors} ${t(TEXT.errors, language)}`
          : `${diskStatusText(disk.status, language)}${disk.errors ? ` · ${disk.errors} ${t(TEXT.errors, language)}` : ''}`,
        40,
      ),
      color: WIDGET_COLORS.DANGER,
    });
  }
  for (const disk of disks.filter(
    (d) => !diskProblem(d) && d.usedPercent !== null && d.usedPercent >= d.criticalPercent,
  )) {
    problems.push({
      label: disk.label,
      icon: 'pie-chart',
      value: `${formatNumber(disk.usedPercent, language)} % ${t(TEXT.used, language)}`,
      color: WIDGET_COLORS.DANGER,
    });
  }
  for (const disk of disks.filter((d) => !diskProblem(d) && d.temperature >= WARM_DISK_CELSIUS)) {
    problems.push({
      label: disk.label,
      icon: 'thermometer',
      value: `${formatNumber(disk.temperature, language)} °C`,
      color: WIDGET_COLORS.WARNING,
    });
  }
  const healthy = disks.filter((disk) => !diskProblem(disk)).length;
  const asleep = disks.filter((disk) => disk.spinning === false).length;
  summary.push({
    label: t(TEXT.disks, language),
    icon: 'database',
    value: `${healthy}/${disks.length} ${t(TEXT.disksOk, language)}${asleep ? ` · ${asleep} ${t(TEXT.asleep, language)}` : ''}`,
    color: healthy === disks.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  });

  if (snapshot.cpuTemperature !== null) {
    summary.push({
      label: t(TEXT.cpuTemperature, language),
      icon: 'cpu',
      value: `${formatNumber(snapshot.cpuTemperature, language)} °C`,
      color: snapshot.cpuTemperature >= 80 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }

  if (snapshot.containers) {
    const running = snapshot.containers.filter((c) => c.running).length;
    summary.push({
      label: t(TEXT.containers, language),
      icon: 'box',
      value: `${running}/${snapshot.containers.length} ${t(TEXT.running, language)}`,
      color: WIDGET_COLORS.NEUTRAL,
    });
    // A container set to start with the array and not running: worth a look.
    const down = snapshot.containers.filter((c) => c.autoStart && !c.running && array.started);
    if (down.length) {
      problems.push({
        label: t(TEXT.stoppedAuto, language),
        icon: 'box',
        value: fit(down.map((c) => c.name).join(', '), 40),
        color: WIDGET_COLORS.WARNING,
      });
    }
  }
  if (snapshot.vms?.length) {
    summary.push({
      label: t(TEXT.vms, language),
      icon: 'monitor',
      value: `${snapshot.vms.filter((vm) => vm.running).length}/${snapshot.vms.length} ${t(TEXT.running, language)}`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  for (const ups of snapshot.ups ?? []) {
    const parts = [t(ups.onBattery ? TEXT.onBattery : TEXT.onMains, language)];
    if (ups.battery !== null) {
      parts.push(`${formatNumber(ups.battery, language)} %`);
    }
    if (ups.onBattery && ups.runtimeMinutes !== null) {
      parts.push(`${formatNumber(ups.runtimeMinutes, language)} min`);
    }
    (ups.onBattery ? problems : summary).push({
      label: fit(ups.name, 40),
      icon: 'battery-charging',
      value: fit(parts.join(' · '), 40),
      color: ups.onBattery ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }
  const unread = snapshot.notifications?.unread;
  if (unread && unread.alert + unread.warning > 0) {
    problems.push({
      label: t(TEXT.alerts, language),
      icon: 'bell',
      value: unread.alert + unread.warning,
      color: unread.alert > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
    });
  }
  const updates = snapshot.containers?.filter((c) => c.updateAvailable === true).length ?? 0;
  if (updates > 0) {
    summary.push({
      label: t(TEXT.updates, language),
      icon: 'download',
      value: updates,
      color: WIDGET_COLORS.INFO,
    });
  }
  return [...problems, ...summary].slice(0, MAX_ROWS);
}

/** The buttons of the container or VM chosen in the settings, else Refresh. */
export function buttons(hub, deviceExternalId, language) {
  const found = deviceExternalId ? hub.find(deviceExternalId) : null;
  const entry =
    found && [DEVICE_TYPES.CONTAINER, DEVICE_TYPES.VM].includes(found.type)
      ? hub.entryFor(found.record, found.type, found.key)
      : null;
  if (!entry) {
    return [refreshButton(language)];
  }
  const { item } = entry;
  const isContainer = found.type === DEVICE_TYPES.CONTAINER;
  const list = [
    {
      type: 'button',
      label: t(TEXT.start, language),
      // Running: the check mark says so (never the style: `primary` is
      // invisible in dark mode).
      icon: item.running ? ACTIVE_ICON : 'play',
      style: 'secondary',
      action: { key: ACTIONS.START },
    },
  ];
  // Gladys never stops its own containers.
  if (!(isContainer && item.protected)) {
    list.push({
      type: 'button',
      label: t(TEXT.stop, language),
      icon: item.running ? 'square' : ACTIVE_ICON,
      style: 'secondary',
      action: { key: ACTIONS.STOP, confirm: true },
    });
    if (isContainer) {
      list.push({
        type: 'button',
        label: t(TEXT.restart, language),
        icon: 'rotate-cw',
        style: 'secondary',
        action: { key: ACTIONS.RESTART, confirm: true },
      });
    }
  }
  if (list.length < 3) {
    list.push(refreshButton(language));
  }
  return list;
}

async function get(hub, { settings, language = 'en' }) {
  const record = hub.record;
  if (!record) {
    return message(TEXT.pick, language);
  }
  if (record.error) {
    const reason = labelled(
      hub.serverName(),
      pick(ERROR_TEXT[record.error.kind], language),
      language,
    );
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'body', text: fit(reason, 300) },
        refreshButton(language),
      ],
    };
  }
  if (!record.snapshot) {
    return message(TEXT.waiting, language);
  }
  const { snapshot } = record;
  const percentTile = (value, label, icon) => ({
    type: 'value',
    value: value === null ? '—' : Math.round(value),
    ...(value === null ? {} : { unit: '%' }),
    label: t(label, language),
    icon,
  });
  const heading = [hub.serverName(), snapshot.version ? `Unraid ${snapshot.version}` : null]
    .filter(Boolean)
    .join(' · ');
  const components = [
    { type: 'text', variant: 'heading', text: fit(heading, 40) },
    percentTile(snapshot.cpu, TEXT.cpu, 'cpu'),
    percentTile(snapshot.memory, TEXT.memory, 'layers'),
    percentTile(snapshot.array.usedPercent, TEXT.arrayUsed, 'hard-drive'),
    { type: 'status', items: rows(snapshot, language) },
    ...buttons(hub, settings?.device, language),
  ];
  return { ttl_seconds: snapshot.parity?.active ? 30 : 60, components };
}

async function action(hub, { actionKey, settings }) {
  const done = (render) =>
    Object.fromEntries(Object.entries(DONE_TEXT).map(([lang, text]) => [lang, render(text)]));
  if (actionKey === ACTIONS.REFRESH) {
    await hub.pollAll();
    return { message: done((text) => text.refreshed) };
  }
  if (![ACTIONS.START, ACTIONS.STOP, ACTIONS.RESTART].includes(actionKey)) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const { name } = await hub.command(settings?.device, actionKey);
  return { message: done((text) => text[actionKey](name).slice(0, 200)) };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
