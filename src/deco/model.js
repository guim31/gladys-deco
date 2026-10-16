// -----------------------------------------------------------------------------
// From the raw answers of the Deco to the model the integration works on.
//
// Shapes as published by amosyuen/ha-tplink-deco (MIT) and observed by the
// tplinkrouterc6u tests (read for the protocol only): MAC addresses come as
// "aa:bb:cc:dd:ee:ff" or "AA-BB-CC-DD-EE-FF", names in base64 (some firmwares
// send them in clear), numbers sometimes as strings.
// -----------------------------------------------------------------------------

/**
 * @typedef {object} Deco
 * @property {string} mac 12 lowercase hex digits (the platform id)
 * @property {string} rawMac as the Deco sends it (commands send it back)
 * @property {string} name
 * @property {string|null} model
 * @property {boolean} master
 * @property {boolean} online
 * @property {boolean|null} internet
 * @property {string|null} firmware
 * @property {string|null} hardware
 * @property {string|null} ip
 * @property {number|null} linkRate Mbit/s of the backhaul, satellites only
 * @property {boolean|null} wiredBackhaul
 *
 * @typedef {object} NetworkClient
 * @property {string} mac
 * @property {string} name
 * @property {string|null} ip
 * @property {boolean} wireless
 * @property {string|null} band '2.4 GHz', '5 GHz', '6 GHz'
 * @property {boolean} guest
 * @property {string|null} decoMac the Deco it is connected to, when known
 *
 * @typedef {object} Snapshot
 * @property {string} meshId MAC of the main Deco
 * @property {Deco[]} decos
 * @property {NetworkClient[]} clients
 * @property {Map<string, { total: number, guest: number }>} counts per Deco MAC, the Decos read
 * @property {boolean|null} guestWifi null when not read
 * @property {number} at
 */

/**
 * "AA-BB-CC-DD-EE-FF" -> "aabbccddeeff"; null when it is not a MAC address.
 * @param {unknown} value
 */
export function normalizeMac(value) {
  const hex = String(value ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || hex === '000000000000' || hex === 'ffffffffffff') return null;
  return hex;
}

/** "aabbccddeeff" -> "AA:BB:CC:DD:EE:FF", for people. */
export const macDisplay = (mac) => mac.toUpperCase().match(/../g).join(':');

const LEGACY_ERROR = /^<Error Decoding (.*)>$/;

/**
 * A name the Deco may have base64-encoded: decoded when it decodes to
 * printable UTF-8, kept as is otherwise.
 * @param {unknown} value
 */
export function decodeName(value) {
  if (typeof value !== 'string' || value === '') return '';
  const legacy = value.match(LEGACY_ERROR);
  if (legacy) return legacy[1];
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    // eslint-disable-next-line no-control-regex
    if (decoded && !decoded.includes('�') && !/[\u0000-\u001f]/.test(decoded)) {
      return decoded.trim();
    }
  }
  return value.trim();
}

/** "living_room" -> "Living Room": the preset names of the Deco app. */
const titleCase = (value) =>
  String(value ?? '')
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isIp = (value) =>
  typeof value === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value !== '0.0.0.0';

function internetOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return ['online', 'connected', 'up'].includes(value.toLowerCase());
  return Boolean(value);
}

/** The best backhaul rate a satellite reports, in Mbit/s. */
function linkRateOf(raw) {
  const direct = toNumber(raw.backhual_speed ?? raw.backhaul_speed);
  if (direct !== null && direct > 0) return Math.round(direct);
  const rates = [raw.rx_rate_list, raw.tx_rate_list]
    .filter((list) => list && typeof list === 'object')
    .flatMap((list) => Object.values(list).map(toNumber))
    .filter((value) => value !== null && value > 0);
  return rates.length ? Math.round(Math.max(...rates)) : null;
}

/**
 * One entry of admin/device?form=device_list.
 * @param {Record<string, any>} raw
 * @returns {Deco | null}
 */
export function parseDeco(raw) {
  const mac = normalizeMac(raw?.mac);
  if (!mac) return null;
  const master = raw.role === 'master';
  const model = typeof raw.device_model === 'string' && raw.device_model ? raw.device_model : null;
  const custom = decodeName(raw.custom_nickname);
  const preset = titleCase(raw.nickname);
  const name = custom || preset || `Deco ${model ?? ''} ${mac.slice(-4).toUpperCase()}`;
  const connection = Array.isArray(raw.connection_type)
    ? raw.connection_type
    : raw.connection_type
      ? [raw.connection_type]
      : [];
  return {
    mac,
    rawMac: String(raw.mac),
    name: name.replace(/\s+/g, ' ').trim(),
    model,
    master,
    online: raw.group_status === 'connected',
    internet: internetOf(raw.inet_status),
    firmware: typeof raw.software_ver === 'string' && raw.software_ver ? raw.software_ver : null,
    hardware: typeof raw.hardware_ver === 'string' && raw.hardware_ver ? raw.hardware_ver : null,
    ip: isIp(raw.device_ip) ? raw.device_ip : null,
    linkRate: master ? null : linkRateOf(raw),
    wiredBackhaul: connection.length ? connection.includes('wired') : null,
  };
}

const BANDS = {
  band2_4: '2.4 GHz',
  band5: '5 GHz',
  band5_1: '5 GHz',
  band5_2: '5 GHz',
  band6: '6 GHz',
};

/**
 * One entry of admin/client?form=client_list.
 * @param {Record<string, any>} raw
 * @param {string|null} decoMac
 * @returns {NetworkClient | null}
 */
export function parseClient(raw, decoMac) {
  const mac = normalizeMac(raw?.mac);
  if (!mac || raw.online === false) return null;
  const wireless = raw.wire_type ? raw.wire_type !== 'wired' : raw.connection_type !== 'wired';
  return {
    mac,
    name: decodeName(raw.name) || macDisplay(mac),
    ip: isIp(raw.ip) ? raw.ip : null,
    wireless,
    band: wireless ? (BANDS[raw.connection_type] ?? null) : null,
    guest: raw.interface === 'guest',
    decoMac,
  };
}

/**
 * The guest network state from admin/wireless?form=wlan: on when one band
 * broadcasts it. Also the bands that have a guest network, for the command.
 * @param {Record<string, any>} result
 * @returns {{ enabled: boolean|null, bands: string[] }}
 */
export function parseGuestWifi(result) {
  const bands = Object.entries(result ?? {})
    .filter(([band, value]) => band.startsWith('band') && typeof value?.guest?.enable === 'boolean')
    .map(([band]) => band);
  if (bands.length === 0) return { enabled: null, bands };
  return { enabled: bands.some((band) => result[band].guest.enable), bands };
}
