// -----------------------------------------------------------------------------
// Unraid client: the official GraphQL API of Unraid (`unraid-api`, built in
// since Unraid 7.2, through the Unraid Connect plugin before), at
// `<server>/graphql`, authenticated by an API key (`x-api-key` header)
// created in Settings → Management Access → API Keys.
//
// The address the user types is the one of the web interface. Unraid
// redirects it according to its "Use SSL/TLS" setting: "No" answers on
// HTTP, "Yes" redirects to HTTPS on the same host (a self-signed
// certificate), "Strict" redirects to `https://<ip>.<hash>.myunraid.net`
// (a valid certificate, a DNS name that resolves to the LAN address). The
// client follows those two redirects only, since every request carries the
// key, and starts again from the typed address after a network failure.
//
// One read = one capability lookup when needed (src/unraid/queries.js), then
// one POST per group (server, metrics, array, docker, vms, ups,
// notifications): a group the server refuses (Docker or the VM manager
// disabled, no UPS) leaves the others readable. The array group decides
// whether the server answers at all.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import {
  CAPABILITIES_QUERY,
  Capabilities,
  containerMutation,
  readQueries,
  vmMutation,
} from './queries.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, firewall
  API_DOWN: 'api_down', // the web server answers, the API behind it does not (502/503/504)
  DNS: 'dns', // the myunraid.net name of "Strict" mode does not resolve (DNS rebinding protection)
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // API key refused
  FORBIDDEN: 'forbidden', // the key lacks the permission (a command with a read-only key)
  NOT_UNRAID: 'not_unraid', // something answers, not the Unraid API (Unraid 6, another service)
  REDIRECT: 'redirect', // a redirect elsewhere than Unraid's own HTTPS
  SCHEMA: 'schema', // the API refuses a field it does not have
  GRAPHQL: 'graphql', // any other error the API reports
  HTTP: 'http', // any other HTTP error
});

// The failures that mean the server cannot be watched right now.
export const DOWN_KINDS = new Set([ERROR_KINDS.UNREACHABLE, ERROR_KINDS.API_DOWN, ERROR_KINDS.DNS]);

export class UnraidError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'UnraidError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export const GROUPS = Object.freeze([
  'server',
  'vars',
  'metrics',
  'array',
  'docker',
  'vms',
  'ups',
  'notifications',
]);

// The capabilities are read again after this long: an API updated in place
// (a plugin update, an Unraid update) gains fields.
export const CAPABILITIES_TTL_MS = 6 * 3600_000;

const MAX_REDIRECTS = 3;

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const isMyUnraid = (hostname) => hostname === 'myunraid.net' || hostname.endsWith('.myunraid.net');

/** The host of a URL for the logs: the myunraid.net hash is shortened. */
export function hostForLog(url) {
  try {
    const { hostname, port } = new URL(url);
    const host = isMyUnraid(hostname) ? '…myunraid.net' : hostname;
    return port ? `${host}:${port}` : host;
  } catch {
    return '?';
  }
}

/** The kind of a GraphQL error list (`errors` of an answer). */
export function classifyGraphqlErrors(errors) {
  const codes = errors.map((error) => error?.extensions?.code).filter(Boolean);
  const text = errors.map((error) => String(error?.message ?? '')).join(' | ');
  if (
    codes.includes('UNAUTHENTICATED') ||
    /unauthori[sz]ed|api key|not authenticated/i.test(text)
  ) {
    return ERROR_KINDS.AUTH;
  }
  if (codes.includes('FORBIDDEN') || /forbidden|permission/i.test(text)) {
    return ERROR_KINDS.FORBIDDEN;
  }
  if (
    codes.includes('GRAPHQL_VALIDATION_FAILED') ||
    /cannot query field|unknown (type|argument)/i.test(text)
  ) {
    return ERROR_KINDS.SCHEMA;
  }
  return ERROR_KINDS.GRAPHQL;
}

/** The first error messages, short, for the logs. */
const summary = (errors) =>
  errors
    .slice(0, 2)
    .map((error) => String(error?.message ?? 'error').slice(0, 160))
    .join(' | ');

export class UnraidClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL typed by the user, `http(s)://host[:port]`
   * @param {string} options.apiKey
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   * @param {() => number} [options.now]
   */
  constructor({
    url,
    apiKey,
    insecure = false,
    request = httpRequest,
    timeoutMs = 15_000,
    now = () => Date.now(),
  }) {
    this.url = url;
    this.apiKey = apiKey;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.now = now;
    /** The origin the API answers on, once the redirects are followed. */
    this.base = url;
    /** @type {Capabilities|null} */
    this.caps = null;
    this.capsAt = 0;
  }

  /**
   * One GraphQL request. Resolves the `data` of the answer (possibly partial:
   * the errors of nullable fields are dropped). Throws an UnraidError.
   * @param {string} query
   * @param {object} [variables]
   */
  async post(query, variables) {
    const body = JSON.stringify(variables ? { query, variables } : { query });
    let response;
    for (let hop = 0; ; hop += 1) {
      const target = `${this.base}/graphql`;
      try {
        response = await this.request(target, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body,
          insecure: this.insecure,
          timeoutMs: this.timeoutMs,
        });
      } catch (err) {
        throw this.networkError(err);
      }
      const { status } = response;
      if (status >= 300 && status < 400) {
        if (hop >= MAX_REDIRECTS) {
          throw new UnraidError(ERROR_KINDS.REDIRECT, 'Too many redirects', { status });
        }
        this.follow(response.headers?.location, status);
        continue;
      }
      // nginx: plain HTTP sent to the HTTPS port (an https:// address typed as http://).
      if (status === 400 && /plain http request was sent to https port/i.test(response.body)) {
        if (hop >= MAX_REDIRECTS) {
          throw new UnraidError(ERROR_KINDS.REDIRECT, 'Too many redirects', { status });
        }
        this.base = this.base.replace(/^http:/, 'https:');
        continue;
      }
      break;
    }
    return this.parse(response);
  }

  /** Map a network failure; the next request starts again from the typed address. */
  networkError(err) {
    const failedBase = this.base;
    this.base = this.url;
    if (TLS_CODES.has(err.code)) {
      return new UnraidError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
    }
    if (err.code === 'ERESPONSETOOLARGE') {
      return new UnraidError(ERROR_KINDS.HTTP, 'Answer too large');
    }
    let hostname = '';
    try {
      hostname = new URL(failedBase).hostname;
    } catch {
      // keep ''
    }
    if (isMyUnraid(hostname) && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
      return new UnraidError(
        ERROR_KINDS.DNS,
        `The myunraid.net address does not resolve (${err.code})`,
      );
    }
    return new UnraidError(
      ERROR_KINDS.UNREACHABLE,
      `${hostForLog(failedBase)}: ${err.code ? err.code : err.message}`,
    );
  }

  /** Follow a redirect of Unraid's own: HTTPS on the same host, or myunraid.net. */
  follow(location, status) {
    let next;
    try {
      next = new URL(location, `${this.base}/graphql`);
    } catch {
      throw new UnraidError(
        ERROR_KINDS.REDIRECT,
        `Redirected without a valid location (HTTP ${status})`,
        {
          status,
        },
      );
    }
    const current = new URL(this.base);
    const trusted =
      next.protocol === 'https:' &&
      (next.hostname === current.hostname || isMyUnraid(next.hostname));
    if (!trusted) {
      // The key is never sent to another host.
      throw new UnraidError(
        ERROR_KINDS.REDIRECT,
        `Redirected to ${hostForLog(next.href)} (HTTP ${status}), not followed`,
        { status },
      );
    }
    this.base = next.origin;
  }

  parse(response) {
    const { status } = response;
    if (status === 401 || status === 403) {
      throw new UnraidError(ERROR_KINDS.AUTH, `API key refused (HTTP ${status})`, { status });
    }
    if (status === 502 || status === 503 || status === 504) {
      throw new UnraidError(
        ERROR_KINDS.API_DOWN,
        `The Unraid API does not answer (HTTP ${status})`,
        {
          status,
        },
      );
    }
    if (status === 404) {
      throw new UnraidError(ERROR_KINDS.NOT_UNRAID, 'No /graphql at this address (HTTP 404)', {
        status,
      });
    }
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch {
      throw status === 200
        ? new UnraidError(ERROR_KINDS.NOT_UNRAID, 'The answer is not JSON')
        : new UnraidError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    if (!payload || typeof payload !== 'object') {
      throw new UnraidError(ERROR_KINDS.NOT_UNRAID, 'The answer is not a GraphQL answer');
    }
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
    if (errors.length > 0) {
      const kind = classifyGraphqlErrors(errors);
      // A field the key may not read, or that failed, is null in a partial
      // answer: kept. A refused key, a refused document: no data at all.
      const usable = data && Object.values(data).some((value) => value !== null);
      if (!usable || kind === ERROR_KINDS.AUTH || kind === ERROR_KINDS.SCHEMA) {
        throw new UnraidError(kind, summary(errors), { status });
      }
    }
    if (status !== 200 && !data) {
      throw new UnraidError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    if (!data) {
      throw new UnraidError(ERROR_KINDS.NOT_UNRAID, 'A GraphQL answer without data');
    }
    return data;
  }

  /** The fields the server has: read at the first request, then every few hours. */
  async capabilities({ force = false } = {}) {
    if (!force && this.caps && this.now() - this.capsAt < CAPABILITIES_TTL_MS) {
      return this.caps;
    }
    try {
      const data = await this.post(CAPABILITIES_QUERY);
      const caps = Capabilities.fromIntrospection(data);
      // An answer without the root types is not a usable answer.
      this.caps = caps.fields.Query ? caps : Capabilities.permissive();
    } catch (err) {
      if (
        ![ERROR_KINDS.GRAPHQL, ERROR_KINDS.SCHEMA, ERROR_KINDS.FORBIDDEN].includes(err.kind) ||
        !err.kind
      ) {
        throw err;
      }
      // Type lookups refused: assume the fields of the current API.
      this.caps = Capabilities.permissive();
    }
    this.capsAt = this.now();
    return this.caps;
  }

  /**
   * Read every group the server has.
   * @returns {Promise<{ caps: Capabilities, groups: Record<string, { data?: object, error?: UnraidError }> }>}
   * @throws {UnraidError} when the array cannot be read: the server is not readable
   */
  async read({ retried = false } = {}) {
    const caps = await this.capabilities();
    const queries = readQueries(caps);
    const names = Object.keys(queries);
    const settled = await Promise.allSettled(names.map((name) => this.post(queries[name])));
    const groups = {};
    settled.forEach((result, index) => {
      groups[names[index]] =
        result.status === 'fulfilled' ? { data: result.value } : { error: result.reason };
    });
    for (const group of Object.values(groups)) {
      if (group.error && !group.error.kind) {
        throw group.error; // a bug, not an answer
      }
    }
    const array = groups.array;
    if (array.error) {
      if (array.error.kind === ERROR_KINDS.SCHEMA && !retried) {
        // The API changed under our feet: read its fields again, once.
        this.caps = null;
        return this.read({ retried: true });
      }
      throw array.error;
    }
    if (
      !retried &&
      Object.values(groups).some((group) => group.error?.kind === ERROR_KINDS.SCHEMA)
    ) {
      this.caps = null; // read again at the next read
    }
    return { caps, groups };
  }

  /**
   * Start, stop or restart a container. Its id is the one the API gives
   * (prefixed with the server id, accepted as is).
   * @returns {Promise<{ id: string, state: string }|null>}
   */
  async containerCommand(id, command) {
    const caps = await this.capabilities();
    const mutation = containerMutation(caps, command);
    if (!mutation && command === 'restart') {
      // No `restart` on this API: stop, then start.
      await this.containerCommand(id, 'stop');
      return this.containerCommand(id, 'start');
    }
    if (!mutation) {
      throw new UnraidError(ERROR_KINDS.SCHEMA, `This Unraid API cannot ${command} a container`);
    }
    const data = await this.post(mutation, { id });
    return data?.docker?.[command] ?? null;
  }

  /** Start a VM, or shut it down (ACPI, never forced). */
  async vmCommand(id, command) {
    const caps = await this.capabilities();
    const mutation = vmMutation(caps, command);
    if (!mutation) {
      throw new UnraidError(ERROR_KINDS.SCHEMA, `This Unraid API cannot ${command} a VM`);
    }
    const data = await this.post(mutation, { id });
    return data?.vm?.[command] === true;
  }
}
