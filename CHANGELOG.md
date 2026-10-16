# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-16

### Added

- TP-Link Deco mesh Wi-Fi, locally, through the web API of the main Deco (the password of the
  owner account of the Deco app). One web session per read, closed at once: the Deco allows one
  administrator session at a time.
- Presence: the network clients chosen in the Discovery tab become presence sensors, with a
  departure delay (5 minutes by default).
- One device per Deco: online, Internet, connected clients, guest clients, role (main Deco or
  satellite), firmware version, and the link rate of a satellite.
- Scene triggers "Unknown device connected" (filters: connection, guest network) and "Deco offline".
- Commands, off by default: a guest Wi-Fi switch on the main Deco, and "Restart a Deco" as an action
  and a scene action.
- The "Deco network" dashboard widget: clients, guests, the state of each Deco and who is home.
- Refresh by the integration's own timer (30 seconds to 5 minutes), and the reads paused after a
  refused password so the Deco never locks the account.
- Names and messages in English, French, German and Spanish, and the documentation in the four
  languages.

[Unreleased]: https://github.com/guim31/gladys-deco/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-deco/releases/tag/v1.0.1
