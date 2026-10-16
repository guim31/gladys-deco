// -----------------------------------------------------------------------------
// The configuration: defaults, types, what "configured" means, and the
// read-only probe of scripts/probe.mjs against the fake Deco.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DEFAULT_CONFIG,
  isConfigured,
  normalizeConfig,
  pollIntervalMs,
  secretValues,
} from '../src/config.js';
import { PASSWORD, startFakeDeco } from './helpers/fakeDeco.js';

const probe = new URL('../scripts/probe.mjs', import.meta.url).pathname;

test('an empty config is the defaults, commands off', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(normalizeConfig().allow_guest_wifi, false);
  assert.equal(normalizeConfig().allow_reboot, false);
  assert.equal(normalizeConfig().language, 'fr');
});

test('types are forced, unknown values fall back to the defaults', () => {
  const config = normalizeConfig({
    host: ' 192.0.2.1 ',
    poll_interval: 120,
    away_delay: '7.6',
    language: 'it',
    discover_clients: 'false',
    allow_reboot: 'true',
  });
  assert.equal(config.host, '192.0.2.1');
  assert.equal(config.poll_interval, '120');
  assert.equal(pollIntervalMs(config), 120000);
  assert.equal(config.away_delay, 8);
  assert.equal(config.language, 'fr');
  assert.equal(config.discover_clients, false);
  assert.equal(config.allow_reboot, true);
  assert.equal(normalizeConfig({ away_delay: 999 }).away_delay, 120);
  assert.equal(normalizeConfig({ away_delay: -3 }).away_delay, 0);
  assert.equal(normalizeConfig({ poll_interval: '5' }).poll_interval, '60');
});

test('the password is kept as typed, spaces included, and listed as a secret', () => {
  assert.equal(normalizeConfig({ password: ' pass ' }).password, ' pass ');
  assert.deepEqual(secretValues(normalizeConfig({ password: 'abcd' })), ['abcd']);
});

test('configured: a usable address and a password', () => {
  assert.equal(isConfigured(normalizeConfig({ host: '192.0.2.1' })), false);
  assert.equal(isConfigured(normalizeConfig({ password: 'x' })), false);
  assert.equal(isConfigured(normalizeConfig({ host: '192.0.2.1', password: 'x' })), true);
  assert.equal(isConfigured(normalizeConfig({ host: 'https://192.0.2.1/', password: 'x' })), true);
  // An address with credentials in it, or another scheme, is not used.
  assert.equal(
    isConfigured(normalizeConfig({ host: 'http://a:b@192.0.2.1', password: 'x' })),
    false,
  );
  assert.equal(isConfigured(normalizeConfig({ host: 'ftp://192.0.2.1', password: 'x' })), false);
});

test('scripts/probe.mjs reads only, and the Deco refuses its invented password', async () => {
  const deco = await startFakeDeco();
  try {
    const { stdout } = await promisify(execFile)('node', [probe, deco.url]);
    assert.match(stdout, /OK {3}unauthenticated read \(form=keys\): HTTP 200, RSA key 1024 bits/);
    assert.match(stdout, /OK {3}unauthenticated read \(form=auth\): HTTP 200, RSA key 512 bits/);
    assert.match(
      stdout,
      /OK {3}the Deco refuses an invented password: error -5002, 9 attempts left/,
    );
    assert.deepEqual(deco.events, ['login-refused'], 'one refused login, nothing else');
    assert.ok(!deco.sessionOpen);
  } finally {
    await deco.close();
  }
});

test('scripts/probe.mjs with DECO_PASSWORD: one read-only session, nothing sensitive printed', async () => {
  const deco = await startFakeDeco();
  try {
    const { stdout } = await promisify(execFile)('node', [probe, deco.url], {
      env: { ...process.env, DECO_PASSWORD: PASSWORD },
    });
    assert.match(stdout, /OK {3}read-only session with DECO_PASSWORD/);
    assert.match(stdout, /main Deco: X50 hw 1.0, firmware 1.8.0 Build 25102213 Rel. 43970/);
    assert.match(stdout, /clients: 5 online \(5 in the per-Deco lists\), 1 on the guest network/);
    for (const secret of [PASSWORD, 'Salon', 'Camille', '192.0.2.', '02:00:5e', '02-00-5E']) {
      assert.ok(!stdout.includes(secret), `the probe printed "${secret}"`);
    }
    assert.equal(deco.state.reboots.length, 0);
    assert.ok(!deco.events.some((e) => e.includes('write')));
    assert.equal(deco.events.at(-1), 'logout');
  } finally {
    await deco.close();
  }
});
