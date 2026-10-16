# TP-Link Deco for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings a **TP-Link
Deco** mesh Wi-Fi (X20, X50, X55, X60, M4, M5, BE65…) into Gladys, **locally**, through the web API of
the main Deco:

- **Presence**: the phones you choose become presence sensors, with a departure delay.
- **One device per Deco**: online, Internet, connected clients, guest clients, role (main Deco or
  satellite), firmware version, link rate of a satellite.
- **Scene triggers**: an unknown device connects to the network, a Deco goes offline.
- **Commands, off by default**: guest Wi-Fi on/off (a switch of the main Deco), restart of a Deco (an
  action and a scene action, never a switch).
- **Dashboard widget**: clients, guests, the state of each Deco and who is home.

Not affiliated with TP-Link. **Developed without the hardware: feedback welcome.** The integration is
tested end to end against a fake Deco that speaks the real encrypted protocol (RSA login, signed
AES-128-CBC requests, one session at a time), built from published answers of real Decos.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## Requirements

- Gladys Assistant **5.1** or later.
- A Deco mesh set up with the Deco app, the **IP address of the main Deco**, and the **password of
  the owner TP-Link ID** (the local web API accepts the owner account only, username `admin`).
- Gladys must reach the main Deco on the local network. No cloud, no TP-Link account call.

## Installation

In Gladys: **Integrations → Install from GitHub**, with `https://github.com/guim31/gladys-deco`. Then
fill in the address of the main Deco and the password, run **Test the connection**, and add the Decos
and the phones to follow from the **Discovery** tab.

## How it works

- The container reads the Deco by itself at the chosen interval (30 s to 5 min, 1 min by default): one
  read is one web session — keys, login, the Deco list, one client list per Deco, the guest network
  when its control is allowed, **logout**. The Deco allows one administrator session at a time, so the
  integration never keeps one open; the web page of the Deco and the integration interrupt each other
  only while one of them reads.
- A refused password **pauses the reads** until the configuration changes: the Deco counts wrong
  passwords and locks the login.
- Only the changed states are published (SDK deduplication), with a heartbeat every 6 hours. The
  clients already seen are kept in `/data/known-clients.json` (MAC addresses only), for the "unknown
  device" trigger.
- Logs are quiet: nothing at info for a normal read (`LOG_LEVEL=debug` shows them), one line when a
  failure starts and one when it ends, never the password nor the session token.

## Limits

- Developed and tested without the hardware: please report what differs on your model.
- The older "outer session" login of a few firmwares (Deco S7: HTTP 401 on the keys) is not
  supported.
- The loss of the main Deco shows as "main Deco unreachable", not as a "Deco offline" trigger.
- The guest Wi-Fi command writes each band in turn; restarting the main Deco cuts the whole network.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
node scripts/probe.mjs <address-of-the-main-Deco>          # read-only probe of a real Deco
DECO_PASSWORD=... node scripts/probe.mjs <address>           # plus one read-only session
```

`scripts/probe.mjs` runs the real connection path up to the refusal of an invented password (one
attempt of the Deco's counter), and with `DECO_PASSWORD` one read-only session; it prints models,
firmware versions and counts only — no name, MAC, address or secret.

Architecture: see [CLAUDE.md](CLAUDE.md).

## Credits

- The Deco web API protocol (RSA and AES encryption, request signing, endpoints, answer shapes) follows
  [amosyuen/ha-tplink-deco](https://github.com/amosyuen/ha-tplink-deco) (MIT), the Home Assistant
  integration `tplink_deco`, by amosyuen and its contributors.
- The logout, guest network and restart requests, and the shapes of the X50 answers, were read in
  [AlexandrErohin/TP-Link-Archer-C6U](https://github.com/AlexandrErohin/TP-Link-Archer-C6U)
  (`tplinkrouterc6u`, GPL-3.0) to understand the protocol; no code was copied from it.
- The structure follows the other integrations of guim31, from the official
  [JavaScript template](https://github.com/GladysAssistant/integration-template-js).

## License

[Apache-2.0](LICENSE).
