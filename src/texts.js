// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the state
// texts of the devices, scene variables and action errors. Four languages,
// the four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './unraid/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

/** A number the way the language writes it ("45,5" in French). */
export const formatNumber = (value, language, digits = 0) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Unraid server and an API key in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Unraid et une clé d'API dans la configuration.",
    de: 'Gib die Adresse deines Unraid-Servers und einen API-Schlüssel in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Unraid y una clave de API en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.10',
    fr: 'Adresse incomprise, ex. http://192.168.1.10',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10',
    es: 'Dirección no válida, p. ej. http://192.168.1.10',
  },
  missingKey: {
    en: 'Enter an API key: Unraid, Settings, Management Access, API Keys.',
    fr: "Saisissez une clé d'API : Unraid, Settings, Management Access, API Keys.",
    de: 'Gib einen API-Schlüssel ein: Unraid, Settings, Management Access, API Keys.',
    es: 'Introduzca una clave de API: Unraid, Settings, Management Access, API Keys.',
  },
};

// One short explanation per error kind (src/unraid/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.API_DOWN]: {
    en: 'the Unraid API does not answer (starting, or stopped)',
    fr: "l'API d'Unraid ne répond pas (démarrage en cours, ou arrêtée)",
    de: 'die Unraid-API antwortet nicht (startet gerade oder ist gestoppt)',
    es: 'la API de Unraid no responde (iniciándose o detenida)',
  },
  [ERROR_KINDS.DNS]: {
    en: 'your DNS blocks myunraid.net: enter https:// and the IP, and accept self-signed certificates',
    fr: "votre DNS bloque myunraid.net : saisissez https:// et l'IP, et acceptez les certificats auto-signés",
    de: 'dein DNS blockiert myunraid.net: Gib https:// und die IP ein und akzeptiere selbstsignierte Zertifikate',
    es: 'su DNS bloquea myunraid.net: introduzca https:// y la IP, y acepte certificados autofirmados',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused',
    fr: "clé d'API refusée",
    de: 'API-Schlüssel abgelehnt',
    es: 'clave de API rechazada',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'the API key lacks this permission',
    fr: "la clé d'API n'a pas cette autorisation",
    de: 'dem API-Schlüssel fehlt diese Berechtigung',
    es: 'la clave de API no tiene este permiso',
  },
  [ERROR_KINDS.NOT_UNRAID]: {
    en: 'no Unraid API at this address (Unraid 7.2 or later needed)',
    fr: 'aucune API Unraid à cette adresse (Unraid 7.2 ou plus récent requis)',
    de: 'keine Unraid-API unter dieser Adresse (Unraid 7.2 oder neuer nötig)',
    es: 'no hay API de Unraid en esta dirección (se necesita Unraid 7.2 o posterior)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects elsewhere: enter the address of the Unraid web interface',
    fr: "l'adresse redirige ailleurs : saisissez l'adresse de l'interface web d'Unraid",
    de: 'die Adresse leitet woandershin um: Gib die Adresse der Unraid-Weboberfläche ein',
    es: 'la dirección redirige a otro sitio: introduzca la dirección de la interfaz web de Unraid',
  },
  [ERROR_KINDS.SCHEMA]: {
    en: 'this Unraid API version is not supported, see the logs',
    fr: "cette version de l'API Unraid n'est pas prise en charge, voir les logs",
    de: 'diese Version der Unraid-API wird nicht unterstützt, sieh in den Protokollen nach',
    es: 'esta versión de la API de Unraid no es compatible, consulte los registros',
  },
  [ERROR_KINDS.GRAPHQL]: {
    en: 'the Unraid API reports an error, see the logs',
    fr: "l'API Unraid signale une erreur, voir les logs",
    de: 'die Unraid-API meldet einen Fehler, sieh in den Protokollen nach',
    es: 'la API de Unraid informa de un error, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of the array (`ArrayState` of the API).
export const ARRAY_STATE_TEXT = {
  STARTED: { en: 'Started', fr: 'Démarrée', de: 'Gestartet', es: 'Iniciado' },
  STOPPED: { en: 'Stopped', fr: 'Arrêtée', de: 'Gestoppt', es: 'Detenido' },
  NEW_ARRAY: {
    en: 'New array, not started',
    fr: 'Nouvelle matrice, non démarrée',
    de: 'Neues Array, nicht gestartet',
    es: 'Array nuevo, no iniciado',
  },
  RECON_DISK: {
    en: 'Disk to rebuild',
    fr: 'Disque à reconstruire',
    de: 'Festplatte neu aufbauen',
    es: 'Disco por reconstruir',
  },
  DISABLE_DISK: {
    en: 'Disk disabled',
    fr: 'Disque désactivé',
    de: 'Festplatte deaktiviert',
    es: 'Disco desactivado',
  },
  other: {
    en: 'Configuration to check',
    fr: 'Configuration à vérifier',
    de: 'Konfiguration prüfen',
    es: 'Configuración por revisar',
  },
};

// What the parity is doing, with its progress.
export const PARITY_TEXT = {
  en: {
    check: (p) => `parity check ${p} %`,
    rebuild: (p) => `rebuilding ${p} %`,
    clear: (p) => `clearing ${p} %`,
    paused: 'paused',
  },
  fr: {
    check: (p) => `contrôle de parité ${p} %`,
    rebuild: (p) => `reconstruction ${p} %`,
    clear: (p) => `effacement ${p} %`,
    paused: 'en pause',
  },
  de: {
    check: (p) => `Paritätsprüfung ${p} %`,
    rebuild: (p) => `Wiederaufbau ${p} %`,
    clear: (p) => `Löschen ${p} %`,
    paused: 'pausiert',
  },
  es: {
    check: (p) => `comprobación de paridad ${p} %`,
    rebuild: (p) => `reconstrucción ${p} %`,
    clear: (p) => `borrado ${p} %`,
    paused: 'en pausa',
  },
};

/** "Started · parity check 45 %": the array state and what the parity does. */
export function arrayStatusText(snapshot, language) {
  const { state } = snapshot.array;
  const base = pick(ARRAY_STATE_TEXT[state] ?? ARRAY_STATE_TEXT.other, language);
  const parity = snapshot.parity;
  if (!parity?.active) {
    return base;
  }
  const text = PARITY_TEXT[language] ?? PARITY_TEXT.en;
  const activity = text[parity.operation](Math.round(parity.progress));
  return `${base} · ${activity}${parity.paused ? ` (${text.paused})` : ''}`;
}

// The status of an array slot (`ArrayDiskStatus` of the API).
export const DISK_STATUS_TEXT = {
  DISK_OK: { en: 'Normal', fr: 'Normal', de: 'Normal', es: 'Normal' },
  DISK_DSBL: { en: 'Disabled', fr: 'Désactivé', de: 'Deaktiviert', es: 'Desactivado' },
  DISK_NP_DSBL: { en: 'Emulated', fr: 'Émulé', de: 'Emuliert', es: 'Emulado' },
  DISK_NP_MISSING: { en: 'Missing', fr: 'Manquant', de: 'Fehlt', es: 'Ausente' },
  DISK_INVALID: { en: 'Invalid', fr: 'Invalide', de: 'Ungültig', es: 'No válido' },
  DISK_WRONG: {
    en: 'Wrong disk',
    fr: 'Mauvais disque',
    de: 'Falsche Festplatte',
    es: 'Disco erróneo',
  },
  DISK_DSBL_NEW: {
    en: 'New, to rebuild',
    fr: 'Nouveau, à reconstruire',
    de: 'Neu, aufzubauen',
    es: 'Nuevo, por reconstruir',
  },
  DISK_NEW: { en: 'New', fr: 'Nouveau', de: 'Neu', es: 'Nuevo' },
  other: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

export const diskStatusText = (status, language) =>
  pick(DISK_STATUS_TEXT[status] ?? DISK_STATUS_TEXT.other, language);

// The state of a VM (`VmState` of the API, libvirt's).
export const VM_STATE_TEXT = {
  RUNNING: { en: 'Running', fr: 'En marche', de: 'Läuft', es: 'En marcha' },
  IDLE: {
    en: 'Running (idle)',
    fr: 'En marche (inactive)',
    de: 'Läuft (inaktiv)',
    es: 'En marcha (inactiva)',
  },
  PAUSED: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  SHUTDOWN: {
    en: 'Shutting down',
    fr: "En cours d'arrêt",
    de: 'Wird heruntergefahren',
    es: 'Apagándose',
  },
  SHUTOFF: { en: 'Stopped', fr: 'Arrêtée', de: 'Gestoppt', es: 'Detenida' },
  CRASHED: { en: 'Crashed', fr: 'Plantée', de: 'Abgestürzt', es: 'Bloqueada' },
  PMSUSPENDED: { en: 'Suspended', fr: 'Suspendue', de: 'Ruhezustand', es: 'Suspendida' },
  other: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

export const vmStateText = (state, language) =>
  pick(VM_STATE_TEXT[state] ?? VM_STATE_TEXT.other, language);

// The state of a container (`ContainerState` of the API), for the widget
// and the "Container stopped" trigger.
export const CONTAINER_STATE_TEXT = {
  RUNNING: { en: 'Running', fr: 'En marche', de: 'Läuft', es: 'En marcha' },
  PAUSED: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  EXITED: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenido' },
  absent: { en: 'Removed', fr: 'Supprimé', de: 'Entfernt', es: 'Eliminado' },
  other: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

export const containerStateText = (state, language) =>
  pick(CONTAINER_STATE_TEXT[state] ?? CONTAINER_STATE_TEXT.other, language);

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    disks: (n) => `${n} disk(s)`,
    containers: (running, total) => `${running}/${total} container(s) running`,
    vms: (running, total) => `${running}/${total} VM(s) running`,
    ups: (n) => `${n} UPS`,
  },
  fr: {
    ok: 'OK',
    disks: (n) => `${n} disque(s)`,
    containers: (running, total) => `${running}/${total} conteneur(s) en marche`,
    vms: (running, total) => `${running}/${total} VM en marche`,
    ups: (n) => `${n} onduleur(s)`,
  },
  de: {
    ok: 'OK',
    disks: (n) => `${n} Festplatte(n)`,
    containers: (running, total) => `${running}/${total} Container laufen`,
    vms: (running, total) => `${running}/${total} VM(s) laufen`,
    ups: (n) => `${n} USV`,
  },
  es: {
    ok: 'OK',
    disks: (n) => `${n} disco(s)`,
    containers: (running, total) => `${running}/${total} contenedor(es) en marcha`,
    vms: (running, total) => `${running}/${total} VM en marcha`,
    ups: (n) => `${n} SAI`,
  },
};

// The summary of the "Unraid server status" scene action (a message text).
export const SUMMARY_TEXT = {
  en: {
    offline: 'Unraid does not answer.',
    array: (state) => `Array: ${state}.`,
    disks: (problems, total) =>
      problems ? `${problems} of ${total} disk(s) need attention.` : `${total} disk(s) OK.`,
    containers: (running, total) => `${running}/${total} container(s) running.`,
    alerts: (n) => `${n} unread alert(s).`,
  },
  fr: {
    offline: 'Unraid ne répond pas.',
    array: (state) => `Matrice : ${state}.`,
    disks: (problems, total) =>
      problems ? `${problems} disque(s) sur ${total} à surveiller.` : `${total} disque(s) OK.`,
    containers: (running, total) => `${running}/${total} conteneur(s) en marche.`,
    alerts: (n) => `${n} alerte(s) non lue(s).`,
  },
  de: {
    offline: 'Unraid antwortet nicht.',
    array: (state) => `Array: ${state}.`,
    disks: (problems, total) =>
      problems ? `${problems} von ${total} Festplatte(n) auffällig.` : `${total} Festplatte(n) OK.`,
    containers: (running, total) => `${running}/${total} Container laufen.`,
    alerts: (n) => `${n} ungelesene Warnung(en).`,
  },
  es: {
    offline: 'Unraid no responde.',
    array: (state) => `Array: ${state}.`,
    disks: (problems, total) =>
      problems
        ? `${problems} de ${total} disco(s) requieren atención.`
        : `${total} disco(s) correctos.`,
    containers: (running, total) => `${running}/${total} contenedor(es) en marcha.`,
    alerts: (n) => `${n} alerta(s) sin leer.`,
  },
};

// Errors of the scene actions, the switches and the widget buttons.
export const ACTION_TEXT = {
  noServer: {
    en: 'No Unraid server is configured.',
    fr: "Aucun serveur Unraid n'est configuré.",
    de: 'Kein Unraid-Server ist konfiguriert.',
    es: 'No hay ningún servidor Unraid configurado.',
  },
  unreadable: {
    en: 'Unraid does not answer: see the Configuration screen of the integration.',
    fr: "Unraid ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'Unraid antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'Unraid no responde: consulte la pantalla de configuración de la integración.',
  },
  notContainer: {
    en: 'Choose a container device of the Unraid integration.',
    fr: "Choisissez un appareil conteneur de l'intégration Unraid.",
    de: 'Wähle ein Container-Gerät der Unraid-Integration.',
    es: 'Elija un dispositivo contenedor de la integración Unraid.',
  },
  notVm: {
    en: 'Choose a VM device of the Unraid integration.',
    fr: "Choisissez un appareil VM de l'intégration Unraid.",
    de: 'Wähle ein VM-Gerät der Unraid-Integration.',
    es: 'Elija un dispositivo VM de la integración Unraid.',
  },
  gone: {
    en: 'This container or VM no longer exists on the Unraid server.',
    fr: "Ce conteneur ou cette VM n'existe plus sur le serveur Unraid.",
    de: 'Dieser Container oder diese VM existiert nicht mehr auf dem Unraid-Server.',
    es: 'Este contenedor o esta VM ya no existe en el servidor Unraid.',
  },
  protected: {
    en: 'Gladys does not stop or restart its own containers.',
    fr: 'Gladys ne stoppe ni ne redémarre ses propres conteneurs.',
    de: 'Gladys stoppt und startet ihre eigenen Container nicht neu.',
    es: 'Gladys no detiene ni reinicia sus propios contenedores.',
  },
  unknownCommand: {
    en: 'Unknown command.',
    fr: 'Commande inconnue.',
    de: 'Unbekannter Befehl.',
    es: 'Orden desconocida.',
  },
  forbidden: {
    en: 'The API key cannot control containers and VMs: give it the Docker and VMs permissions.',
    fr: "La clé d'API ne peut pas piloter conteneurs et VM : donnez-lui les droits Docker et VMs.",
    de: 'Der API-Schlüssel darf Container und VMs nicht steuern: Gib ihm die Rechte Docker und VMs.',
    es: 'La clave de API no puede controlar contenedores y VM: concédale los permisos Docker y VMs.',
  },
  failed: {
    en: 'Unraid refused the command, see the logs.',
    fr: 'Unraid a refusé la commande, voir les logs.',
    de: 'Unraid hat den Befehl abgelehnt, sieh in den Protokollen nach.',
    es: 'Unraid ha rechazado la orden, consulte los registros.',
  },
};

// Toasts of the widget buttons (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    start: (name) => `${name}: start requested.`,
    stop: (name) => `${name}: stop requested.`,
    restart: (name) => `${name}: restart requested.`,
    refreshed: 'Unraid read again.',
  },
  fr: {
    start: (name) => `${name} : démarrage demandé.`,
    stop: (name) => `${name} : arrêt demandé.`,
    restart: (name) => `${name} : redémarrage demandé.`,
    refreshed: 'Unraid relu.',
  },
  de: {
    start: (name) => `${name}: Start angefordert.`,
    stop: (name) => `${name}: Stopp angefordert.`,
    restart: (name) => `${name}: Neustart angefordert.`,
    refreshed: 'Unraid neu gelesen.',
  },
  es: {
    start: (name) => `${name}: inicio solicitado.`,
    stop: (name) => `${name}: parada solicitada.`,
    restart: (name) => `${name}: reinicio solicitado.`,
    refreshed: 'Unraid leído de nuevo.',
  },
};
