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

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secret**: the password of the owner TP-Link ID of the Deco app, stored by Gladys in the
  integration configuration. It is only sent to the main Deco, RSA-encrypted as the Deco web page does
  it, and never written to the logs nor to `/data`.
- **Session**: the session token and cookie of the Deco live in memory for one read and are closed by
  a logout right after; they are never logged.
- **`/data`**: `known-clients.json`, the MAC addresses already seen on the mesh (no name, no address),
  for the "unknown device connected" trigger.
- **Network**: HTTP or HTTPS to the address of the main Deco only, on the local network. The Deco's
  self-signed certificate is accepted (it cannot be verified); the payloads are encrypted by the Deco
  protocol itself. No cloud service is contacted.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), the Deco firmware and
the TP-Link services.
