// -----------------------------------------------------------------------------
// The "mesh" dashboard widget: the Decos and who is home, at a glance.
//
// - tiles: clients connected, guest clients, Decos online;
// - a status list: each Deco, with its clients or "Offline";
// - a list of the clients followed in Gladys (presence devices), home first.
//
// Built from the latest read of the Deco, never from a request of its own:
// opening a dashboard costs the Deco nothing (and no session). Pre-localized
// from the `language` of the request (the core caches per language).
// Budget of the core: 8 components, 6 tiles, 1 focal, 1 status list, 2 texts.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_TEXT, pick } from './i18n.js';

export const WIDGET = { MESH: 'mesh' };

const MAX_STATUS_ROWS = 10;
const MAX_CLIENT_ROWS = 8;

const tile = (label, value, icon) => ({ type: 'value', label, value, icon });

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @param {object} options
 * @param {import('./deco/model.js').Snapshot | null} options.snapshot
 * @param {string} options.language
 * @param {boolean} options.configured
 * @param {object | null} [options.error] the reason of the last failed read (multi-language)
 * @param {Array<{ name: string, present: boolean, deco: string | null }>} [options.tracked]
 *   the clients added to Gladys
 */
export function buildMeshContent({ snapshot, language, configured, error = null, tracked = [] }) {
  const t = (key, vars) => pick(WIDGET_TEXT[key], language, vars);
  if (!configured) {
    return { ttl_seconds: 60, components: [{ type: 'text', text: t('notConfigured') }] };
  }
  if (!snapshot) {
    if (error) {
      return { ttl_seconds: 30, components: [{ type: 'text', text: error[language] ?? error.en }] };
    }
    return {
      ttl_seconds: 30,
      components: [{ type: 'text', variant: 'caption', text: t('waiting') }],
    };
  }

  const online = snapshot.decos.filter((deco) => deco.online).length;
  const components = [
    tile(t('clients'), snapshot.clients.length, 'users'),
    tile(t('guests'), snapshot.clients.filter((client) => client.guest).length, 'user-plus'),
    tile(t('decos'), `${online}/${snapshot.decos.length}`, 'wifi'),
  ];
  if (error) {
    // The last read failed: the figures are the previous ones.
    components.unshift({
      type: 'text',
      variant: 'caption',
      text: cut(error[language] ?? error.en, 80),
    });
  }

  if (tracked.length > 0) {
    const rows = [...tracked]
      .sort((a, b) => Number(b.present) - Number(a.present) || a.name.localeCompare(b.name))
      .slice(0, MAX_CLIENT_ROWS);
    components.push({
      type: 'card-list',
      display: 'list',
      items: rows.map((client) => ({
        title: cut(client.name, 60),
        ...(client.present && client.deco ? { subtitle: cut(client.deco, 60) } : {}),
        badge: client.present
          ? { text: t('home'), color: WIDGET_COLORS.SUCCESS }
          : { text: t('away'), color: WIDGET_COLORS.NEUTRAL },
      })),
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: cut(t('noTracked'), 80) });
  }

  const items = [...snapshot.decos]
    .sort((a, b) => Number(b.master) - Number(a.master) || a.name.localeCompare(b.name))
    .slice(0, MAX_STATUS_ROWS)
    .map((deco) => {
      const count = snapshot.counts.get(deco.mac);
      if (!deco.online) {
        return {
          label: cut(deco.name, 40),
          value: t('offline'),
          color: WIDGET_COLORS.DANGER,
          icon: 'alert-triangle',
        };
      }
      if (deco.internet === false) {
        return {
          label: cut(deco.name, 40),
          value: t('noInternet'),
          color: WIDGET_COLORS.WARNING,
          icon: 'globe',
        };
      }
      return {
        label: cut(deco.name, 40),
        value: count ? t('clientsOn', { count: count.total }) : '-',
        color: WIDGET_COLORS.SUCCESS,
        icon: deco.master ? 'home' : 'wifi',
      };
    });
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  return { ttl_seconds: 60, components };
}
