// -----------------------------------------------------------------------------
// A complete test world: the fake main Deco, the SDK's fake Gladys and the
// integration, wired like index.js does, without timers (the tests drive the
// reads) and with a logger that records every line.
// -----------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { createDecoClient } from '../../src/deco/client.js';
import { PASSWORD, createDecoState, startFakeDeco } from './fakeDeco.js';

export function createRecordingLogger() {
  const lines = [];
  const at =
    (level) =>
    (...args) => {
      lines.push({
        level,
        text: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '),
      });
    };
  return {
    lines,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: () => createRecordingLogger(),
    /** The lines of a level and above. */
    at(level) {
      const order = ['debug', 'info', 'warn', 'error'];
      return lines.filter((l) => order.indexOf(l.level) >= order.indexOf(level));
    },
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.config] overrides of the integration config
 * @param {object[]} [options.devices] devices "created by the user" in Gladys
 * @param {ReturnType<typeof createDecoState>} [options.state]
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the refresh timer
 * @param {boolean} [options.connect] connect Gladys at once
 * @param {string} [options.dataDir] reuse a /data of a previous world (kept on close)
 */
export async function createWorld({
  config = {},
  devices = [],
  state,
  now,
  timers = false,
  connect = true,
  dataDir: givenDataDir,
} = {}) {
  const deco = await startFakeDeco({ state: state ?? createDecoState() });
  const dataDir = givenDataDir ?? (await mkdtemp(path.join(tmpdir(), 'deco-test-')));
  const fullConfig = { host: deco.url, password: PASSWORD, ...config };
  const gladys = createFakeGladys({ config: fullConfig, devices });
  const logger = createRecordingLogger();
  const createClient = (cfg) =>
    createDecoClient(cfg, { timeoutMs: 3000, debug: (line) => logger.debug(`deco: ${line}`) });
  const app = createApp({ gladys, dataDir, timers, logger, createClient, ...(now ? { now } : {}) });
  app.register();
  if (connect) {
    await gladys.connect();
  }

  return {
    deco,
    gladys,
    app,
    logger,
    dataDir,
    config: fullConfig,
    /** The devices of the Discovery tab, "added to Gladys" (all, or the filtered ones). */
    async addDevices(filter = () => true) {
      const chosen = gladys.fake.discoveredDevices.filter(filter);
      for (const device of chosen) {
        await gladys.fake.deviceCreated(structuredClone(device));
      }
      return chosen;
    },
    async close() {
      app.stop();
      await gladys.disconnect();
      await deco.close();
      if (!givenDataDir) {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  };
}
