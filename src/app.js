// -----------------------------------------------------------------------------
// The integration: reads the mesh from the main Deco at the configured pace,
// and turns each read into device states, scene events, the Discovery list
// and the widget content.
//
// Refresh: the container reads the Deco by itself, on its own timer. Gladys
// 5.2 does not reliably poll external devices (GladysAssistant/Gladys#3198,
// not fixed in 5.2.1), so the core's onPoll is only a fallback: it reads the
// mesh when the timer has not done it for 90 % of a period. One read covers
// every device, in one web session: keys, login, the lists, logout.
//
// A refused password pauses the reads until the configuration changes (or the
// connection test runs): the Deco counts the failed attempts and locks the
// account, one try a minute would get there.
//
// Logs: info is the lifecycle only (start, connection, a Deco lost and back,
// one line per command); a failure that repeats is written once, and once
// when it ends. The rest is debug (LOG_LEVEL=debug).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig, pollIntervalMs } from './config.js';
import { createDecoClient } from './deco/client.js';
import { ERROR_KINDS } from './deco/errors.js';
import {
  CLIENT,
  FEATURE,
  buildDiscoveredDevices,
  featureValues,
  parseDeviceId,
} from './devices.js';
import { createPresence } from './presence.js';
import { createKnownClients } from './known-clients.js';
import { newClientEvent, transitionEvents } from './events.js';
import { WIDGET, buildMeshContent } from './widgets.js';
import { CommandError, createCommands } from './commands.js';
import { createIssueLog } from './issues.js';
import { TEXT, localized, pick, reasonOf, withReason } from './i18n.js';

/** A value that does not change is published again at least this often. */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

/** Delay before the read that follows a command: the Deco applies it first. */
export const AFTER_COMMAND_MS = 5000;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration, or the SDK's fake Gladys
 * @param {string} [options.dataDir] the writable volume
 * @param {boolean} [options.timers] run the refresh timer (tests turn it off)
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 * @param {(config: object) => object} [options.createClient]
 */
export function createApp({
  gladys,
  dataDir = '/data',
  timers = true,
  now = () => Date.now(),
  logger = createLogger({ name: 'deco' }),
  createClient = (config) =>
    createDecoClient(config, { debug: (line) => logger.debug(`deco: ${line}`) }),
}) {
  const issues = createIssueLog(logger);
  const presence = createPresence();
  const known = createKnownClients({ dataDir, issues });

  let config = normalizeConfig();
  let client = null;
  let snapshot = null;
  let lastError = null;
  let authPaused = false;
  let connectedOnce = false;
  let lastReadAt = 0;
  let inFlight = null;
  let timer = null;
  let stopped = true;
  let statusKey = null;
  let discoveredFingerprint = null;
  let widgetFingerprint = null;
  let seeded = false;
  // Decos that were offline at the previous read, to log a return once.
  const offline = new Set();

  // --- Gladys side ----------------------------------------------------------

  async function setStatus(key, connected, message) {
    if (statusKey === key) return;
    statusKey = key;
    await gladys.setConnectionStatus(connected, message).catch((err) => {
      statusKey = null;
      logger.debug(`setConnectionStatus failed (${err.message})`);
    });
  }

  /** Our devices the user added to Gladys, with their parsed ids. */
  function createdDevices() {
    return (gladys.devices ?? [])
      .map((device) => ({ device, parsed: parseDeviceId(gladys, device.external_id) }))
      .filter(({ parsed }) => parsed);
  }

  /** Before the first read: the clients Gladys knows as present keep their delay. */
  function seedPresence() {
    if (seeded) return;
    seeded = true;
    for (const { device, parsed } of createdDevices()) {
      if (parsed.kind !== CLIENT) continue;
      const feature = (device.features ?? []).find((f) =>
        String(f.external_id).endsWith(`:${FEATURE.PRESENCE}`),
      );
      if (feature?.last_value === 1) {
        presence.seed(parsed.mac, now());
      }
    }
  }

  const presenceOf = (mac) => presence.presenceOf(mac, config.away_delay, now());

  /**
   * Publish the states of the devices added to Gladys, changed values only
   * (plus the heartbeat). `onlyDevice` limits it to one device.
   */
  async function publishStates(onlyDevice = null) {
    if (!snapshot) return;
    const created = createdDevices().filter(
      ({ device }) => !onlyDevice || device.external_id === onlyDevice,
    );
    if (created.length === 0) return;
    const clientMacs = created
      .filter(({ parsed }) => parsed.kind === CLIENT)
      .map((c) => c.parsed.mac);
    const values = featureValues(gladys, snapshot, config, presenceOf, clientMacs);
    const states = [];
    for (const { device } of created) {
      for (const feature of device.features ?? []) {
        const value = values.get(feature.external_id);
        if (typeof value === 'number') {
          states.push({ device_feature_external_id: feature.external_id, state: value });
        } else if (value) {
          states.push({ device_feature_external_id: feature.external_id, text: value.text });
        }
      }
    }
    if (states.length === 0) return;
    try {
      const { count } = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logger.debug(`${count} state(s) published`);
      issues.ok('states', 'States are accepted by Gladys again');
    } catch (err) {
      issues.fail('states', `Publishing the states failed (${err.message})`);
    }
  }

  async function publishDiscovered({ force = false } = {}) {
    if (!snapshot) return;
    const devices = buildDiscoveredDevices(gladys, snapshot, config);
    const fingerprint = JSON.stringify(devices);
    if (!force && fingerprint === discoveredFingerprint) return;
    try {
      await gladys.publishDiscoveredDevices(devices);
      discoveredFingerprint = fingerprint;
      issues.ok('discovery', 'Discovered devices accepted by Gladys again');
    } catch (err) {
      issues.fail('discovery', `Publishing the discovered devices failed (${err.message})`);
    }
  }

  /** The clients added to Gladys, for the widget. */
  function trackedClients() {
    const byMac = new Map((snapshot?.clients ?? []).map((c) => [c.mac, c]));
    const decoName = new Map((snapshot?.decos ?? []).map((d) => [d.mac, d.name]));
    return createdDevices()
      .filter(({ parsed }) => parsed.kind === CLIENT)
      .map(({ device, parsed }) => ({
        name: String(device.name ?? parsed.mac),
        present: snapshot ? presenceOf(parsed.mac) === 1 : false,
        deco: decoName.get(byMac.get(parsed.mac)?.decoMac) ?? null,
      }));
  }

  function widgetContent(language) {
    return buildMeshContent({
      snapshot,
      language,
      configured: isConfigured(config),
      error: lastError,
      tracked: trackedClients(),
    });
  }

  function refreshWidget({ force = false } = {}) {
    const fingerprint = JSON.stringify(widgetContent('en'));
    if (!force && fingerprint === widgetFingerprint) return;
    widgetFingerprint = fingerprint;
    Promise.resolve(gladys.requestWidgetRefresh(WIDGET.MESH)).catch(() => {});
  }

  async function fireEvents(previous) {
    const events = transitionEvents(gladys, previous, snapshot);
    const { fresh, learnt } = await known.observe(
      snapshot.meshId,
      snapshot.clients.map((c) => c.mac),
    );
    if (learnt > 0) {
      logger.debug(`${learnt} client(s) learnt without event`);
    }
    const byMac = new Map(snapshot.clients.map((c) => [c.mac, c]));
    for (const mac of fresh) {
      events.push(newClientEvent(gladys, byMac.get(mac), snapshot));
    }
    for (const event of events) {
      try {
        await gladys.publishSceneEvent(event.key, event.data);
        logger.debug(`Scene event ${event.key}`);
        issues.ok('scene-events', 'Scene events accepted by Gladys again');
      } catch (err) {
        issues.fail('scene-events', `Scene event ${event.key} refused (${err.message})`);
      }
    }
  }

  function logDecoChanges(previous) {
    for (const deco of snapshot.decos) {
      if (!deco.online && !offline.has(deco.mac)) {
        offline.add(deco.mac);
        // At the first read, an offline Deco is a state, not news.
        if (previous) logger.info(`Deco ${deco.name} is offline`);
      } else if (deco.online && offline.delete(deco.mac)) {
        logger.info(`Deco ${deco.name} is back online`);
      }
    }
  }

  /** A Deco gone from the list (unplugged) stays known, offline. */
  function withMissingDecos(fresh, previous) {
    if (!previous || previous.meshId !== fresh.meshId) return fresh.decos;
    const listed = new Set(fresh.decos.map((d) => d.mac));
    const created = new Set(
      createdDevices()
        .filter(({ parsed }) => parsed.kind !== CLIENT)
        .map(({ parsed }) => parsed.mac),
    );
    const missing = previous.decos
      .filter((d) => !listed.has(d.mac) && (created.has(d.mac) || d.online))
      .map((d) => ({ ...d, online: false }));
    return [...fresh.decos, ...missing];
  }

  // --- Deco side ------------------------------------------------------------

  function getClient() {
    if (!isConfigured(config)) return null;
    if (!client) client = createClient(config);
    return client;
  }

  /** One read of the mesh, and everything that follows from it. */
  async function read() {
    if (!isConfigured(config)) {
      await setStatus('not-configured', false, localized(TEXT.notConfigured));
      return;
    }
    if (authPaused) {
      logger.debug('Password refused earlier: read skipped until the configuration changes');
      return;
    }
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: read skipped');
      return;
    }
    seedPresence();
    lastReadAt = now();
    let fresh;
    try {
      fresh = await getClient().snapshot({ guestWifi: config.allow_guest_wifi });
    } catch (err) {
      lastError = withReason(TEXT.unreachable, err);
      if (err.kind === ERROR_KINDS.AUTH) {
        authPaused = true;
        lastError = localized(TEXT.authPaused);
        logger.warn(
          `Password refused by the Deco (${err.attemptsLeft ?? '?'} attempts left): reads paused`,
        );
        await setStatus('auth', false, lastError);
      } else {
        issues.fail('deco', `Main Deco unreachable: ${pick(reasonOf(err), 'en')}`);
        logger.debug(`Read failed: ${err.message}`);
        await setStatus(`error:${err.kind ?? err.name}`, false, lastError);
      }
      refreshWidget();
      return;
    }
    issues.ok('deco', 'Main Deco reachable again');
    lastError = null;
    await setStatus('ok', true);

    const previous = snapshot;
    // The app's clock dates the read: presence compares it with the same clock.
    snapshot = { ...fresh, decos: withMissingDecos(fresh, previous), at: now() };
    const main = snapshot.decos.find((d) => d.mac === snapshot.meshId);
    if (!connectedOnce) {
      connectedOnce = true;
      logger.info(
        `Connected to the main Deco ${main?.name ?? '?'} (${main?.model ?? 'unknown model'}, ` +
          `firmware ${main?.firmware ?? '?'}): ${snapshot.decos.length} Deco(s)`,
      );
    }
    presence.update(snapshot);
    logDecoChanges(previous);
    logger.debug(
      `Read: ${snapshot.decos.length} Decos, ${snapshot.clients.length} clients` +
        (snapshot.guestWifi === null ? '' : `, guest Wi-Fi ${snapshot.guestWifi ? 'on' : 'off'}`),
    );
    await publishDiscovered();
    await publishStates();
    await fireEvents(previous);
    refreshWidget();
  }

  /** Read now, or join the read in progress. */
  function readNow() {
    if (!inFlight) {
      inFlight = read()
        .catch((err) => logger.error(`Read cycle failed (${err.message})`))
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) return;
    timer = setTimeout(async () => {
      timer = null;
      // The core's onPoll may just have read the mesh: no second read.
      if (now() - lastReadAt >= pollIntervalMs(config) / 2) {
        await readNow();
      }
      schedule();
    }, pollIntervalMs(config));
    timer.unref?.();
  }

  /** A new config, a (re)connection to Gladys: start over. */
  async function restart(newConfig) {
    // A read in progress uses the previous config: let it end, then start over.
    if (inFlight) {
      await inFlight;
    }
    config = normalizeConfig(newConfig);
    client = null;
    authPaused = false;
    connectedOnce = false;
    snapshot = null;
    discoveredFingerprint = null;
    statusKey = null;
    stopped = false;
    schedule();
    await readNow();
  }

  const commands = createCommands({
    gladys,
    getConfig: () => config,
    getClient,
    getSnapshot: () => snapshot,
    refresh: () => {
      if (timers) setTimeout(() => readNow(), AFTER_COMMAND_MS).unref?.();
    },
    logger,
  });

  // --- Handlers -------------------------------------------------------------

  function register() {
    gladys.onScanRequest(async () => {
      logger.debug('Scan requested');
      await readNow();
      await publishDiscovered({ force: true });
    });

    gladys.onPoll(async (device) => {
      // Fallback of the timer: one read covers the whole mesh.
      if (now() - lastReadAt >= pollIntervalMs(config) * 0.9) {
        await readNow();
      } else {
        logger.debug(
          `onPoll skipped (read ${now() - lastReadAt} ms ago) for ${device.external_id}`,
        );
      }
    });

    gladys.onSetValue(async (device, feature, value) => {
      if (String(feature?.external_id).endsWith(`:${FEATURE.GUEST_WIFI}`)) {
        await commands.setGuestWifi(value);
        return;
      }
      throw new CommandError(`${feature?.external_id} is read-only`);
    });

    const onAdded = async (device) => {
      // The SDK forgot what it had published for this device: send it now.
      await publishStates(device.external_id);
      refreshWidget({ force: true });
    };
    gladys.onDeviceCreated(onAdded);
    gladys.onDeviceUpdated(onAdded);

    gladys.onConfigUpdated(async (newConfig) => {
      logger.info('Configuration updated');
      await restart(newConfig);
    });

    gladys.onAction('test_connection', async () => {
      logger.info('Action: connection test');
      if (inFlight) {
        await inFlight;
      }
      // An explicit test is allowed one try, even after a refused password.
      authPaused = false;
      client = null;
      await readNow();
      if (!snapshot || lastError) {
        throw new Error(
          lastError ? pick(lastError, config.language) : pick(TEXT.notConfigured, config.language),
        );
      }
      const main = snapshot.decos.find((d) => d.mac === snapshot.meshId);
      return localized(TEXT.testOk, {
        main: main?.name ?? 'Deco',
        decos: snapshot.decos.length,
        online: snapshot.decos.filter((d) => d.online).length,
        clients: snapshot.clients.length,
      });
    });
    gladys.onAction('reboot_deco', (fields) => commands.reboot(fields));

    gladys.onSceneAction('reboot_deco', async (fields) => {
      await commands.reboot(fields);
    });

    gladys.onWidgetGet(WIDGET.MESH, async ({ language }) => widgetContent(language));

    gladys.on('connected', async () => {
      try {
        await restart(await gladys.getConfig());
      } catch (err) {
        logger.error(`Post-connection initialization failed (${err.message})`);
        await gladys.setConnectionStatus(false, localized(TEXT.initFailed)).catch(() => {});
      }
    });
  }

  return {
    register,
    restart,
    readNow,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
    /** For the tests. */
    get snapshot() {
      return snapshot;
    },
    get config() {
      return config;
    },
  };
}
