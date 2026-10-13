// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Unraid server. Its devices are keyed on slot 1 (src/devices.js), so a
// second server can be added later without changing any external id.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The configuration slot of the server: part of every external id.
export const SLOT = 1;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['15', '30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  name: '',
  allow_self_signed: false,
  poll_interval: '60',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, `tower.local:8080`), or the URL copied from the browser
 * (`https://192.0.2.10/Dashboard`). HTTP by default, the path dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  return url.origin;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {{
 *   server: { slot: number, url: string, apiKey: string, name: string|null }|null,
 *   invalidUrl: boolean,
 *   missingKey: boolean,
 *   allowSelfSigned: boolean,
 *   pollIntervalMs: number,
 *   language: string,
 * }}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const typed = text('url');
  const url = typed ? parseServerUrl(typed) : null;
  // An API key never contains spaces: the ones around it come from a copy.
  const apiKey = text('api_key');
  const server =
    url && apiKey
      ? { slot: SLOT, url, apiKey, name: text('name').slice(0, MAX_NAME_LENGTH) || null }
      : null;

  return {
    server,
    invalidUrl: Boolean(typed) && !url,
    missingKey: Boolean(url) && !apiKey,
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
