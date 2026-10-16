// -----------------------------------------------------------------------------
// The Gladys devices built from a snapshot of the mesh.
//
// - One device per Deco, keyed on its MAC: online, Internet, connected
//   clients, guest clients, role (main Deco / satellite), firmware version,
//   the backhaul link rate of a satellite, and — on the main Deco, only when
//   the option is on — the guest Wi-Fi switch.
// - One device per network client, keyed on its MAC: a presence sensor. The
//   user adds the ones to follow from the Discovery tab.
//
// External ids are forever: `ext:<selector>:deco:<mac>` and
// `ext:<selector>:client:<mac>`, MAC in 12 lowercase hex digits. A feature
// never moves from one device to another (CLAUDE.md, the UniFi lesson).
//
// The restart of a Deco is an action, on purpose never a switch: a voice
// assistant or a misclick would cut the network for minutes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES, ROLES, pick } from './i18n.js';
import { macDisplay } from './deco/model.js';

export const DECO = 'deco';
export const CLIENT = 'client';

export const FEATURE = {
  ONLINE: 'online',
  INTERNET: 'internet',
  CLIENTS: 'clients',
  GUEST_CLIENTS: 'guest_clients',
  ROLE: 'role',
  LINK_RATE: 'link_rate',
  FIRMWARE: 'firmware',
  GUEST_WIFI: 'guest_wifi',
  PRESENCE: 'presence',
};

// Gladys schedules the fallback onPoll once a minute; the container's own
// timer does the work (src/app.js).
const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

const sensor = (externalId, name, category, type, { unit, min = 0, max } = {}) => ({
  name,
  external_id: externalId,
  category,
  type,
  ...(unit ? { unit } : {}),
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

const binary = (id, name) =>
  sensor(id, name, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, { max: 1 });

const counter = (id, name) =>
  sensor(id, name, DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, {
    max: 1000,
  });

// min/max are NOT NULL in Gladys, text features included (0/0 like Zigbee2MQTT).
const text = (id, name) => ({
  ...sensor(id, name, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, { max: 0 }),
  keep_history: false,
});

const names = (config) => NAMES[config.language] ?? NAMES.en;

/**
 * @param {object} gladys GladysIntegration
 * @param {import('./deco/model.js').Deco} deco
 * @param {object} config normalized config
 */
export function buildDecoDevice(gladys, deco, config) {
  const ids = gladys.externalIds(DECO, deco.mac);
  const n = names(config);
  const features = [
    binary(ids.feature(FEATURE.ONLINE), n.online),
    binary(ids.feature(FEATURE.INTERNET), n.internet),
    counter(ids.feature(FEATURE.CLIENTS), n.clients),
    counter(ids.feature(FEATURE.GUEST_CLIENTS), n.guestClients),
    text(ids.feature(FEATURE.ROLE), n.role),
    text(ids.feature(FEATURE.FIRMWARE), n.firmware),
  ];
  if (!deco.master) {
    features.push(
      sensor(
        ids.feature(FEATURE.LINK_RATE),
        n.linkRate,
        DEVICE_FEATURE_CATEGORIES.DATARATE,
        DEVICE_FEATURE_TYPES.DATARATE.RATE,
        { unit: DEVICE_FEATURE_UNITS.MEGABITS_PER_SECOND, max: 100000 },
      ),
    );
  }
  if (deco.master && config.allow_guest_wifi) {
    features.push({
      name: n.guestWifi,
      external_id: ids.feature(FEATURE.GUEST_WIFI),
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      // The state is the one read back from the Deco, not the one sent.
      has_feedback: true,
      keep_history: true,
    });
  }
  const params = [{ name: 'MAC_ADDRESS', value: macDisplay(deco.mac) }];
  if (deco.ip) {
    params.push({ name: 'IP_ADDRESS', value: deco.ip });
  }
  return {
    name: deco.name,
    external_id: ids.device,
    model: ['Deco', deco.model, deco.hardware ? `v${deco.hardware}` : null]
      .filter(Boolean)
      .join(' '),
    ...POLLING,
    params,
    features,
  };
}

/**
 * @param {object} gladys
 * @param {{ mac: string, name: string }} client
 * @param {object} config
 */
export function buildClientDevice(gladys, client, config) {
  const ids = gladys.externalIds(CLIENT, client.mac);
  return {
    name: client.name,
    external_id: ids.device,
    model: 'Deco client',
    ...POLLING,
    params: [{ name: 'MAC_ADDRESS', value: macDisplay(client.mac) }],
    features: [
      sensor(
        ids.feature(FEATURE.PRESENCE),
        names(config).presence,
        DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { max: 1 },
      ),
    ],
  };
}

/**
 * Parse one of our device external ids.
 * @param {object} gladys
 * @param {string} externalId
 * @returns {{ kind: string, mac: string } | null}
 */
export function parseDeviceId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [kind, mac, ...rest] = externalId.slice(prefix.length).split(':');
  if (rest.length || (kind !== DECO && kind !== CLIENT) || !/^[0-9a-f]{12}$/.test(mac ?? '')) {
    return null;
  }
  return { kind, mac };
}

/**
 * The devices of the Discovery tab: every Deco of the mesh, the clients
 * online now (when the option is on), and the clients already added to Gladys
 * even when they are away — the list replaces the previous one.
 * @param {object} gladys
 * @param {import('./deco/model.js').Snapshot} snapshot
 * @param {object} config
 */
export function buildDiscoveredDevices(gladys, snapshot, config) {
  const devices = snapshot.decos.map((deco) => buildDecoDevice(gladys, deco, config));
  const clients = new Map();
  for (const device of gladys.devices ?? []) {
    const parsed = parseDeviceId(gladys, device.external_id);
    if (parsed?.kind === CLIENT) {
      clients.set(parsed.mac, { mac: parsed.mac, name: device.name });
    }
  }
  if (config.discover_clients) {
    for (const client of snapshot.clients) {
      if (!clients.has(client.mac)) {
        clients.set(client.mac, client);
      }
    }
  }
  for (const client of clients.values()) {
    devices.push(buildClientDevice(gladys, client, config));
  }
  return devices;
}

/**
 * Every value the snapshot gives, by feature external id: a number, or
 * `{ text }` for a text feature. Values that are not known (the firmware of
 * an offline Deco) are absent, never invented.
 * @param {object} gladys
 * @param {import('./deco/model.js').Snapshot} snapshot
 * @param {object} config
 * @param {(mac: string) => number} presenceOf 1 present, 0 away
 * @param {Iterable<string>} clientMacs the client devices to report
 * @returns {Map<string, number | { text: string }>}
 */
export function featureValues(gladys, snapshot, config, presenceOf, clientMacs) {
  const values = new Map();
  for (const deco of snapshot.decos) {
    const ids = gladys.externalIds(DECO, deco.mac);
    const set = (key, value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        values.set(ids.feature(key), value);
      } else if (typeof value === 'string' && value) {
        values.set(ids.feature(key), { text: value });
      }
    };
    set(FEATURE.ONLINE, deco.online ? 1 : 0);
    set(FEATURE.ROLE, pick(deco.master ? ROLES.master : ROLES.satellite, config.language));
    if (!deco.online) {
      // Nobody is connected through a Deco that is off.
      set(FEATURE.CLIENTS, 0);
      set(FEATURE.GUEST_CLIENTS, 0);
      continue;
    }
    if (deco.internet !== null) set(FEATURE.INTERNET, deco.internet ? 1 : 0);
    const count = snapshot.counts.get(deco.mac);
    if (count) {
      set(FEATURE.CLIENTS, count.total);
      set(FEATURE.GUEST_CLIENTS, count.guest);
    }
    set(FEATURE.FIRMWARE, deco.firmware);
    if (!deco.master) set(FEATURE.LINK_RATE, deco.linkRate);
    if (deco.master && snapshot.guestWifi !== null) {
      set(FEATURE.GUEST_WIFI, snapshot.guestWifi ? 1 : 0);
    }
  }
  for (const mac of clientMacs) {
    values.set(gladys.externalIds(CLIENT, mac).feature(FEATURE.PRESENCE), presenceOf(mac));
  }
  return values;
}
