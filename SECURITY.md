# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- the **Unraid API key**, kept by Gladys in the integration configuration
  (a secret field), sent only in the `x-api-key` header to the configured
  server, or to the HTTPS address Unraid itself redirects to (the same host,
  or `*.myunraid.net`), and never logged;
- the commands the integration can send: start, stop and restart a Docker
  container, start and shut down a virtual machine. Nothing on the array, the
  parity or the server itself. Giving the key the Viewer role only keeps
  Gladys read only;
- what is stored in `/data` (`unraid-state.json`): disk states and
  temperature steps already announced, container names seen running, the
  parity operation in progress, the ids of the Unraid notifications already
  announced, and the features each device had. No secret;
- the network: the integration only connects to the Unraid server of the
  configuration, on the local network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Unraid and the services it runs.
