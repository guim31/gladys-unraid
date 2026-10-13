// -----------------------------------------------------------------------------
// A fake Unraid: a real GraphQL executor (graphql-js, the library of the
// Unraid API) on the subset of the official schema the integration reads
// (test/fixtures/unraid/schema.graphql), answering from realistic data
// (test/fixtures/unraid/tower.json). A query naming a field the schema does
// not have is refused like the API does (HTTP 400, GRAPHQL_VALIDATION_FAILED),
// so the tests catch a query the real server would refuse.
//
// Faults on demand: the server off, the API behind nginx down (502), a group
// failing (Docker or the VM manager stopped), a refused or read-only API key,
// an older API (fields removed from the schema), and Unraid's "Use SSL/TLS"
// modes: "no" (HTTP), "yes" (redirect to HTTPS, self-signed), "strict"
// (redirect to <ip>.<hash>.myunraid.net).
//
// `serve()` puts it behind a real HTTP server, for the checks in Docker.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { buildSchema, graphql } from 'graphql';

export const SCHEMA_SDL = readFileSync(
  new URL('../fixtures/unraid/schema.graphql', import.meta.url),
  'utf8',
);
export const TOWER = JSON.parse(
  readFileSync(new URL('../fixtures/unraid/tower.json', import.meta.url), 'utf8'),
);

export const API_KEY = 'unraid-test-key-0123456789abcdef';
export const MYUNRAID_HOST = '192-0-2-10.0123456789abcdef0123456789abcdef01234567.myunraid.net';

/** The SDL without some fields: an older API. */
export function withoutFields(sdl, removed) {
  let type = null;
  return sdl
    .split('\n')
    .filter((line) => {
      const open = /^(?:type|input) (\w+)/.exec(line);
      if (open) {
        type = open[1];
        return true;
      }
      if (line.startsWith('}')) {
        type = null;
        return true;
      }
      const field = /^ {2}(\w+)/.exec(line);
      return !(type && field && removed[type]?.includes(field[1]));
    })
    .join('\n');
}

const strip = (id) =>
  typeof id === 'string' && id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;

export class FakeUnraid {
  /**
   * @param {object} [options]
   * @param {string} [options.host] the address of the server
   * @param {'no'|'yes'|'strict'} [options.ssl] Unraid's "Use SSL/TLS"
   * @param {Record<string, string[]>} [options.removed] fields an older API lacks
   * @param {string} [options.apiKey]
   * @param {object} [options.data] the server state (a copy of tower.json by default)
   */
  constructor({
    host = '192.0.2.10',
    ssl = 'no',
    removed = {},
    apiKey = API_KEY,
    data = structuredClone(TOWER),
  } = {}) {
    this.host = host;
    this.ssl = ssl;
    this.apiKey = apiKey;
    this.data = data;
    this.schema = buildSchema(withoutFields(SCHEMA_SDL, removed));
    this.wire();
    /** 'down' (no answer), 'api_down' (502), 'html' (another service), null */
    this.failure = null;
    /** Root fields that fail, by name: { docker: 'Docker is not running' }. */
    this.failing = {};
    /** The key may read, not command. */
    this.readOnly = false;
    /** The myunraid.net name does not resolve (DNS rebinding protection). */
    this.dnsBlocked = false;
    /** Every request received: { url, query, variables, key }. */
    this.requests = [];
    /** Every command received: { kind, command, id }. */
    this.commands = [];
  }

  /** Resolvers: the data for the queries, the commands for the mutations. */
  wire() {
    const query = this.schema.getQueryType().getFields();
    const fail = (name) => {
      if (this.failing[name]) {
        throw new Error(this.failing[name]);
      }
    };
    for (const name of ['array', 'info', 'metrics', 'vars', 'docker', 'vms', 'upsDevices']) {
      if (query[name]) {
        query[name].resolve = () => {
          fail(name);
          return this.data[name];
        };
      }
    }
    if (query.notifications) {
      query.notifications.resolve = () => {
        fail('notifications');
        const { overview, list } = this.data.notifications;
        return {
          overview,
          list: ({ filter }) =>
            list
              .filter((n) => n.type === filter.type)
              .filter((n) => !filter.importance || n.importance === filter.importance)
              .slice(filter.offset, filter.offset + filter.limit),
        };
      };
    }
    const mutation = this.schema.getMutationType()?.getFields() ?? {};
    const forbid = () => {
      if (this.readOnly) {
        const error = new Error('Forbidden resource');
        error.extensions = { code: 'FORBIDDEN' };
        throw error;
      }
    };
    const container = (id) => {
      const found = this.data.docker.containers.find((c) => strip(c.id) === strip(id));
      if (!found) {
        throw new Error(`Container ${strip(id)} not found`);
      }
      return found;
    };
    const vm = (id) => {
      const found = this.data.vms.domains.find((d) => strip(d.id) === strip(id));
      if (!found) {
        throw new Error(`VM ${strip(id)} not found`);
      }
      return found;
    };
    const containerCommand =
      (command, state) =>
      ({ id }) => {
        forbid();
        const target = container(id);
        this.commands.push({ kind: 'container', command, id: strip(id) });
        target.state = state;
        return target;
      };
    const vmCommand =
      (command, state) =>
      ({ id }) => {
        forbid();
        const target = vm(id);
        this.commands.push({ kind: 'vm', command, id: strip(id) });
        target.state = state;
        return true;
      };
    if (mutation.docker) {
      mutation.docker.resolve = () => ({
        start: containerCommand('start', 'RUNNING'),
        stop: containerCommand('stop', 'EXITED'),
        restart: containerCommand('restart', 'RUNNING'),
      });
    }
    if (mutation.vm) {
      mutation.vm.resolve = () => ({
        start: vmCommand('start', 'RUNNING'),
        stop: vmCommand('stop', 'SHUTOFF'),
      });
    }
  }

  /** The host names this server answers on. */
  get hosts() {
    return this.ssl === 'strict' ? [this.host, MYUNRAID_HOST] : [this.host];
  }

  /**
   * One HTTP request, as src/unraid/http.js would make it.
   * @returns {Promise<{ status: number, headers: object, body: string }>}
   */
  async handle(url, { method = 'POST', headers = {}, body = '', insecure = false } = {}) {
    const target = new URL(url);
    if (this.failure === 'down') {
      throw Object.assign(new Error(`connect ECONNREFUSED ${target.host}`), {
        code: 'ECONNREFUSED',
      });
    }
    // nginx in front of the API, according to "Use SSL/TLS".
    if (this.ssl === 'yes' && target.protocol === 'http:') {
      return { status: 302, headers: { location: `https://${this.host}/graphql` }, body: '' };
    }
    if (this.ssl === 'yes' && !insecure) {
      throw Object.assign(new Error('self-signed certificate'), {
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      });
    }
    if (this.ssl === 'strict' && target.hostname !== MYUNRAID_HOST) {
      return { status: 302, headers: { location: `https://${MYUNRAID_HOST}/graphql` }, body: '' };
    }
    if (this.ssl === 'strict' && this.dnsBlocked) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${target.hostname}`), {
        code: 'ENOTFOUND',
      });
    }
    if (this.failure === 'api_down') {
      return { status: 502, headers: { 'content-type': 'text/html' }, body: '<html>502</html>' };
    }
    if (this.failure === 'html' || target.pathname !== '/graphql') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>Login</html>' };
    }
    if (method !== 'POST') {
      return { status: 400, headers: {}, body: 'POST only' };
    }
    const payload = JSON.parse(body);
    const key = headers['x-api-key'];
    this.requests.push({ url, query: payload.query, variables: payload.variables, key });
    const json = (status, value) => ({
      status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (key !== this.apiKey) {
      return json(200, {
        errors: [{ message: 'API key validation failed', extensions: { code: 'UNAUTHENTICATED' } }],
        data: null,
      });
    }
    // The API refuses the full introspection outside its sandbox.
    if (/\{\s*__schema\s*[{(]/.test(payload.query)) {
      return json(400, {
        errors: [
          {
            message:
              'GraphQL introspection is not allowed, but the current request is for introspection.',
            extensions: { code: 'INTROSPECTION_DISABLED' },
          },
        ],
      });
    }
    const result = await graphql({
      schema: this.schema,
      source: payload.query,
      variableValues: payload.variables,
    });
    const errors = (result.errors ?? []).map((error) => ({
      message: error.message,
      extensions: {
        code:
          error.originalError?.extensions?.code ??
          (result.data === undefined ? 'GRAPHQL_VALIDATION_FAILED' : 'INTERNAL_SERVER_ERROR'),
      },
    }));
    // Apollo answers 400 to a document it cannot validate.
    if (result.data === undefined) {
      return json(400, { errors });
    }
    return json(200, errors.length ? { errors, data: result.data } : { data: result.data });
  }

  // --- State changes, as Unraid would make them ---------------------------------

  container(name) {
    return this.data.docker.containers.find((c) => c.names[0] === `/${name}`);
  }

  setContainer(name, state) {
    if (state === null) {
      this.data.docker.containers = this.data.docker.containers.filter(
        (c) => c.names[0] !== `/${name}`,
      );
    } else {
      this.container(name).state = state;
    }
  }

  disk(name) {
    const { array } = this.data;
    return [...array.parities, ...array.disks, ...array.caches].find((d) => d.name === name);
  }

  setParity(status) {
    Object.assign(this.data.array.parityCheckStatus, status);
  }

  addNotification(notification) {
    this.data.notifications.list.unshift({ type: 'UNREAD', ...notification });
    const { unread } = this.data.notifications.overview;
    unread[notification.importance.toLowerCase()] += 1;
    unread.total += 1;
  }
}

/**
 * A fake network: the request function of src/unraid/http.js, routed to the
 * fake servers by host name.
 */
export function createNetwork(servers) {
  const list = Array.isArray(servers) ? servers : [servers];
  return {
    async request(url, options) {
      const { hostname } = new URL(url);
      const server = list.find((candidate) => candidate.hosts.includes(hostname));
      if (!server) {
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      }
      return server.handle(url, options);
    },
  };
}

/** Serve a fake Unraid over real HTTP (the checks in Docker). */
export function serve(fake, port = 80) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const answer = await fake.handle(`http://${fake.host}${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          insecure: true,
        });
        res.writeHead(answer.status, answer.headers);
        res.end(answer.body);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err.message));
      }
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
