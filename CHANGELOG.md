# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.1] - 2026-10-13

### Changed

- Documentation: the integration has now been tested on a real Unraid server,
  where everything works.

## [1.0.0] - 2026-10-13

### Added

- First version: an Unraid 7.2+ server in Gladys through the official Unraid
  API (an API key, the "Use SSL/TLS" modes of Unraid, the fields of older APIs
  detected).
- A server device: online, CPU, memory, CPU temperature, uptime, array started
  and state with the parity check progress, array space used and free, parity
  errors, disks needing attention, unread alerts, container updates, Unraid
  version.
- One device per array slot (parity, data, pool): temperature, standby, space
  used and free, errors, status. A sleeping disk is never woken to read it.
- One device per Docker container (a start / stop switch, update available)
  and per virtual machine (a start / clean shutdown switch, state); the
  containers of Gladys itself are read only.
- One device per UPS managed by Unraid: battery, runtime left, load, on
  battery, power, input voltage, status.
- Scene triggers: Unraid disk in error, Unraid disk too hot, Unraid parity
  check finished, Unraid container stopped, Unraid notification.
- Scene actions: control an Unraid container (start, stop, restart), control
  an Unraid VM (start, shut down), Unraid server status with a ready-made
  summary.
- An "Unraid" dashboard widget, with start, stop and restart buttons for a
  chosen container or VM.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-unraid/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-unraid/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-unraid/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-unraid/releases/tag/v1.0.0
