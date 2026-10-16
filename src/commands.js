// -----------------------------------------------------------------------------
// Commands: guest Wi-Fi on/off, restart of a Deco.
//
// Each one is off by default (its own option in the configuration). The
// restart is an action — a button of the Configuration screen or a scene
// action — never a device switch: it cuts the network for minutes. The guest
// Wi-Fi is a switch of the main Deco, offered only once its option is on.
// One info line per command, never a secret.
// -----------------------------------------------------------------------------

import { TEXT, localized, pick, reasonOf } from './i18n.js';
import { DECO, parseDeviceId } from './devices.js';

/** Thrown for a refused command: `message` in the configured language. */
export class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {() => object} options.getConfig
 * @param {() => object | null} options.getClient the Deco client, null when not configured
 * @param {() => object | null} options.getSnapshot the latest read
 * @param {() => void} options.refresh read the Deco again soon
 * @param {{ info: Function }} options.logger
 */
export function createCommands({ gladys, getConfig, getClient, getSnapshot, refresh, logger }) {
  const fail = (entry, vars) => {
    throw new CommandError(pick(entry, getConfig().language, vars));
  };

  function ready(option, disabledText) {
    if (!getConfig()[option]) {
      fail(disabledText);
    }
    const client = getClient();
    if (!client) {
      fail(TEXT.notConfigured);
    }
    const snapshot = getSnapshot();
    if (!snapshot) {
      fail(TEXT.notReady);
    }
    return { client, snapshot };
  }

  async function run(work) {
    try {
      return await work();
    } catch (err) {
      if (err instanceof CommandError) throw err;
      const reason = pick(reasonOf(err), getConfig().language);
      throw new CommandError(pick(TEXT.commandFailed, getConfig().language, { reason }));
    }
  }

  return {
    /** @param {{ device: string }} fields */
    async reboot(fields) {
      const { client, snapshot } = ready('allow_reboot', TEXT.rebootDisabled);
      const parsed = parseDeviceId(gladys, fields?.device);
      if (!parsed || parsed.kind !== DECO) {
        fail(TEXT.notDeco);
      }
      const deco = snapshot.decos.find((d) => d.mac === parsed.mac);
      if (!deco) {
        fail(TEXT.unknownDevice);
      }
      if (!deco.online) {
        fail(TEXT.offline, { device: deco.name });
      }
      await run(() => client.reboot(deco.mac));
      logger.info(`Command: restart of ${deco.name}`);
      refresh();
      return localized(TEXT.rebootDone, { device: deco.name });
    },

    /** @param {number|boolean} value 1/true on, 0/false off */
    async setGuestWifi(value) {
      const { client } = ready('allow_guest_wifi', TEXT.guestDisabled);
      const on = value === true || Number(value) === 1;
      const bands = await run(() => client.setGuestWifi(on));
      if (bands === 0) {
        fail(TEXT.noGuestNetwork);
      }
      logger.info(`Command: guest Wi-Fi ${on ? 'on' : 'off'} (${bands} band(s))`);
      refresh();
      return localized(on ? TEXT.guestOn : TEXT.guestOff);
    },
  };
}
