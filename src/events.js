// -----------------------------------------------------------------------------
// Scene triggers, from the difference between two successive reads.
//
// - new_unknown_client: a MAC address never seen on the mesh joins it (an
//   alert that has no device state to hang on: the client is unknown).
// - deco_offline: a Deco leaves the mesh. Unlike its "online" feature, it
//   covers every Deco without adding them all to Gladys, and carries the name
//   and model for the notification text.
//
// Only transitions fire: the first read after a (re)connection only sets the
// reference, so a restart of the container or of the Deco never fires.
// -----------------------------------------------------------------------------

import { CLIENT, DECO } from './devices.js';
import { macDisplay } from './deco/model.js';

export const TRIGGER = {
  NEW_CLIENT: 'new_unknown_client',
  DECO_OFFLINE: 'deco_offline',
};

/**
 * @param {object} gladys
 * @param {import('./deco/model.js').NetworkClient} client
 * @param {import('./deco/model.js').Snapshot} snapshot
 */
export function newClientEvent(gladys, client, snapshot) {
  const deco = snapshot.decos.find((d) => d.mac === client.decoMac);
  return {
    key: TRIGGER.NEW_CLIENT,
    data: {
      client: gladys.externalIds(CLIENT, client.mac).device,
      mac: macDisplay(client.mac),
      name: client.name,
      ip: client.ip,
      connection: client.wireless ? 'wireless' : 'wired',
      band: client.band,
      guest: client.guest ? 'yes' : 'no',
      deco_name: deco?.name ?? null,
    },
  };
}

/**
 * Events between two reads of the same mesh.
 * @param {object} gladys
 * @param {import('./deco/model.js').Snapshot | null} previous
 * @param {import('./deco/model.js').Snapshot} current
 * @returns {Array<{ key: string, data: Record<string, string|number|boolean|null> }>}
 */
export function transitionEvents(gladys, previous, current) {
  if (!previous || previous.meshId !== current.meshId) {
    return [];
  }
  const events = [];
  const before = new Map(previous.decos.map((deco) => [deco.mac, deco]));
  for (const deco of current.decos) {
    if (before.get(deco.mac)?.online === true && !deco.online) {
      events.push({
        key: TRIGGER.DECO_OFFLINE,
        data: {
          device: gladys.externalIds(DECO, deco.mac).device,
          device_name: deco.name,
          model: deco.model,
          role: deco.master ? 'main' : 'satellite',
          mac: macDisplay(deco.mac),
        },
      });
    }
  }
  return events;
}
