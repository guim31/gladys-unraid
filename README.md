# Unraid for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Unraid](https://unraid.net/): the server, its array, parity, disks, Docker
containers, virtual machines and UPS in Gladys, through the official Unraid
API. Scenes react to a disk in error or too hot, a parity check that ends, a
container that stops and Unraid's own notifications; they start, stop and
restart containers and VMs. A dashboard widget sums the server up.

**Tested on a real Unraid server** by the author, on top of the automated tests
against a simulated server running the official API schema. Feedback welcome in
the [issues](https://github.com/guim31/gladys-unraid/issues).

## Features

- **Server**: online, CPU, memory, CPU temperature, uptime, array started and
  state (with the parity check progress), array space used and free, parity
  errors, disks needing attention, unread alerts, container updates, Unraid
  version.
- **Disks**, one device per array slot (parity, data, pool): temperature,
  standby, space used and free, errors, status. **A sleeping disk is never
  woken**: temperatures come from what Unraid already read (`array`), never
  from `smartctl`.
- **Docker containers**: running (a switch: start / stop), update available.
  The containers of Gladys itself are read only.
- **Virtual machines**: running (a switch: start / clean shutdown), state.
- **UPS**: battery, runtime left, load, on battery, power, input voltage,
  status.
- **Scene triggers**: Unraid disk in error, Unraid disk too hot (threshold
  steps), Unraid parity check finished (no error / errors / stopped), Unraid
  container stopped, Unraid notification (alert / warning / information).
- **Scene actions**: control an Unraid container (start, stop, restart),
  control an Unraid VM (start, shut down), Unraid server status (with a
  ready-made summary).
- **Dashboard widget** "Unraid": CPU, memory, array space, then what needs
  attention, the array, the parity, the disks, the containers, the VMs, the
  UPS; buttons for the container or VM chosen in its settings (stop and
  restart ask for a confirmation).
- Feature names, texts and documentation in English, French, German and
  Spanish.

Nothing stops the array or the server from Gladys: too risky for a scene or a
voice command.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Unraid 7.2 or later (the API is built in). Unraid 6.x is not supported;
  Unraid 7.0 and 7.1 with the Unraid Connect plugin may work, untested.
- An Unraid API key (Settings → Management Access → API Keys): role
  **Viewer** to watch; add the **Docker** and **VMs** permissions (update) to
  control containers and VMs.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-unraid`
   (or install **Unraid** from the catalog once it is listed).
2. In **Configuration**, enter the address of the Unraid web interface
   (`192.168.1.10`, `tower.local`, `https://192.168.1.10`…) and the API key.
   Save, then click **Test the connection**.
3. Open the **Discover** tab and add the server, then the disks, containers,
   VMs and UPS to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration talks to the GraphQL API of Unraid (`/graphql`, header
`x-api-key`). It follows Unraid's own "Use SSL/TLS" redirects only (HTTPS on
the same host, or `*.myunraid.net`): the key is never sent anywhere else. It
first looks up which fields the server's API has (`__type` lookups, allowed
outside the API sandbox), then reads the server, metrics, array, Docker, VMs,
UPS and notifications in separate requests, so that a stopped Docker or VM
manager leaves the rest readable. It reads on its own timer (15 seconds to
5 minutes): the devices are published with `should_poll: false`.

Only the changes are sent to Gladys, the values that move at every read at
most once a minute. `/data` keeps what the scene triggers compare with (disk
states, containers seen running, the parity operation in progress, the
notifications already announced) and the features each device had.

## Checked, and what was not

- A real Unraid server: **checked** by the author on their own server, where
  everything works. The integration was built from the
  official API schema (`unraid/api`, API 4.37.5) and from the emhttp state
  files of that repository, and tested against a fake Unraid executing the
  schema subset it reads (`test/helpers/fakeUnraid.js`), in the Gladys sandbox
  (read-only root file system, no capabilities, 256 MB) through a real HTTP
  server.
- Not checked specifically: the exact HTTP answer of the API to a refused key or a
  missing permission (both an HTTP status and a GraphQL error are handled),
  the `myunraid.net` redirect on a real network, the UPS fields on a real UPS,
  a real Gladys instance (widget rendering, scene editor).

## Limitations

- One Unraid server per installation.
- No CPU and memory per container (the API gives them over a subscription
  only), no network traffic, no shares, no Unraid OS updates (not in the API).
- A VM is shut down like with the power button: a VM that ignores it keeps
  running. The array, the parity check and the server cannot be controlled.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a fake Unraid (`test/helpers/fakeUnraid.js`) executing, with `graphql-js`,
a subset of the official schema (`test/fixtures/unraid/schema.graphql`) on
realistic data (`test/fixtures/unraid/tower.json`). Every query the client can
send is validated against that schema. See [`CLAUDE.md`](CLAUDE.md) for the
project rules.

## Credits

- [Unraid API](https://github.com/unraid/api) by Lime Technology
  (GPL-2.0-or-later): the API read here. The test schema keeps only the type
  and field names of the subset read, for interoperability; the test data
  takes its slot sizes, temperatures and parity counters from the emhttp state
  files of its repository (`api/dev/states`). No code of it is included. The
  logo and the logotype on the cover are the official ones, from the same
  repository (`.github/unraid.svg`, `web/public/images/UN-logotype-gradient.svg`).
- [ha-unraid](https://github.com/ruaan-deysel/ha-unraid) by Ruaan Deysel,
  Domalab and contributors (Apache-2.0), the Home Assistant integration, and
  its client [unraid-api](https://github.com/ruaan-deysel/unraid-api) (MIT):
  the lessons reused here — never query `disks` or `metrics.temperature`
  (smartctl wakes sleeping disks), name containers by name (their id changes
  at every update), follow the `myunraid.net` redirect of "Strict" mode,
  detect the fields of older APIs.
- The architecture, the conformity and language tests follow
  [gladys-glances](https://github.com/guim31/gladys-glances) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Lime
Technology, Inc. Unraid is a trademark of Lime Technology, Inc.

## License

Apache-2.0
