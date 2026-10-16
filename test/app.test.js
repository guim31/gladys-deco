// -----------------------------------------------------------------------------
// End to end: the integration between the SDK's fake Gladys and the fake Deco.
// Refresh by the container's own timer (no onPoll), one session per read,
// presence with its departure delay, scene events on transitions only,
// commands behind their options, the widget, and quiet logs that never show
// a secret.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createWorld } from './helpers/world.js';
import { PASSWORD } from './helpers/fakeDeco.js';
import { HEARTBEAT_MS } from '../src/app.js';
import { LANGUAGES } from '../src/config.js';

const SEL = 'ext:test-integration';
const MAIN = `${SEL}:deco:02005e100001`;
const OFFICE = `${SEL}:deco:02005e100002`;
const BEDROOM = `${SEL}:deco:02005e100003`;
const PHONE = `${SEL}:client:02005e200001`;
const TV = `${SEL}:client:02005e200004`;

/** A clock the tests move by hand. */
function createClock(start = Date.UTC(2026, 9, 15, 8, 0, 0)) {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    },
  };
}

/** Wait until `condition()` holds, letting the real I/O of the fake Deco run. */
async function until(condition, what) {
  for (let i = 0; i < 2000; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** Remove a client from the lists of the fake Deco. */
function unplug(world, mac) {
  for (const list of Object.values(world.deco.state.clients)) {
    const index = list.findIndex((c) => c.mac === mac);
    if (index >= 0) list.splice(index, 1);
  }
}

test('the container refreshes the states by its own timer, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const world = await createWorld({ timers: true, now: clock.now });
  try {
    await world.addDevices();
    assert.equal(world.gladys.fake.lastState(`${OFFICE}:online`), 1);

    world.deco.setOnline('02-00-5E-10-00-02', false);
    clock.advance(60000);
    t.mock.timers.tick(60000);
    t.mock.timers.reset();
    await until(() => world.gladys.fake.lastState(`${OFFICE}:online`) === 0, 'the offline state');
    // Gladys never polled: the timer did the work.
    assert.ok(!world.gladys.fake.wsMessages.some((m) => m.type === 'device.poll'));
  } finally {
    await world.close();
  }
});

test('onPoll is a fallback: it reads only when the timer has not for 90 % of a period', async () => {
  const clock = createClock();
  const world = await createWorld({ now: clock.now });
  try {
    const [device] = await world.addDevices((d) => d.external_id === MAIN);
    const logins = () => world.deco.events.filter((e) => e === 'login').length;
    const before = logins();
    assert.deepEqual(await world.gladys.fake.poll(device), { success: true });
    assert.equal(logins(), before, 'just read: skipped');
    clock.advance(55000);
    await world.gladys.fake.poll(device);
    assert.equal(logins(), before + 1, 'the timer stalled: the fallback reads');
  } finally {
    await world.close();
  }
});

test('every read logs out: the web page of the Deco stays usable between reads', async () => {
  const world = await createWorld();
  try {
    for (let i = 0; i < 3; i += 1) await world.app.readNow();
    const sessions = world.deco.events.filter((e) => e === 'login' || e === 'logout');
    assert.ok(sessions.length >= 8);
    for (let i = 0; i < sessions.length; i += 2) {
      assert.deepEqual(sessions.slice(i, i + 2), ['login', 'logout']);
    }
    assert.equal(world.deco.sessionOpen, false);
  } finally {
    await world.close();
  }
});

test('the Deco devices: online, Internet, clients, role, firmware, link rate', async () => {
  const world = await createWorld();
  try {
    await world.addDevices();
    const last = (id) => world.gladys.fake.lastState(id);
    const text = (id) =>
      world.gladys.fake.states.findLast((s) => s.device_feature_external_id === id)?.text;
    assert.equal(last(`${MAIN}:online`), 1);
    assert.equal(last(`${MAIN}:internet`), 1);
    assert.equal(last(`${MAIN}:clients`), 3);
    assert.equal(last(`${MAIN}:guest_clients`), 1);
    assert.equal(text(`${MAIN}:role`), 'Deco principal');
    assert.equal(text(`${MAIN}:firmware`), '1.8.0 Build 25102213 Rel. 43970');
    assert.equal(text(`${OFFICE}:role`), 'Satellite');
    assert.equal(last(`${OFFICE}:link_rate`), 1297);
    assert.equal(last(`${BEDROOM}:link_rate`), 1000);
    const devices = world.gladys.fake.discoveredDevices;
    const main = devices.find((d) => d.external_id === MAIN);
    assert.equal(main.name, 'Salon');
    assert.equal(main.model, 'Deco X50 v1.0');
    assert.ok(!main.features.some((f) => f.external_id.endsWith(':link_rate')));
    assert.ok(!main.features.some((f) => f.external_id.endsWith(':guest_wifi')), 'off by default');
    assert.equal(devices.find((d) => d.external_id === BEDROOM).name, 'Chambre des enfants');
  } finally {
    await world.close();
  }
});

test('a Deco offline: online 0, no client, no invented firmware; gone from the list too', async () => {
  const world = await createWorld();
  try {
    await world.addDevices();
    world.deco.setOnline('02-00-5E-10-00-02', false);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(`${OFFICE}:online`), 0);
    assert.equal(world.gladys.fake.lastState(`${OFFICE}:clients`), 0);
    world.deco.setOnline('02-00-5E-10-00-02', true);
    await world.app.readNow();
    // Unplugged for good: the Deco leaves the list but stays known, offline.
    world.deco.state.decos = world.deco.state.decos.filter((d) => d.mac !== '02:00:5e:10:00:03');
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(`${BEDROOM}:online`), 0);
    assert.ok(world.gladys.fake.discoveredDevices.some((d) => d.external_id === BEDROOM));
  } finally {
    await world.close();
  }
});

test('presence waits for the departure delay, and survives an outage of the Deco', async () => {
  const clock = createClock();
  const world = await createWorld({ now: clock.now, config: { away_delay: 5 } });
  try {
    await world.addDevices((d) => d.external_id === PHONE);
    assert.equal(world.gladys.fake.lastState(`${PHONE}:presence`), 1);

    unplug(world, '02:00:5e:20:00:01');
    clock.advance(60000);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(`${PHONE}:presence`), 1, 'within the delay');

    // The Deco does not answer: nobody leaves because of it.
    world.deco.state.forbidLogin = true;
    clock.advance(10 * 60000);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(`${PHONE}:presence`), 1);

    world.deco.state.forbidLogin = false;
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(`${PHONE}:presence`), 0, 'gone for longer');
  } finally {
    await world.close();
  }
});

test('a client Gladys knew as present keeps its delay after a restart', async () => {
  const clock = createClock();
  const world = await createWorld({ now: clock.now, connect: false });
  try {
    unplug(world, '02:00:5e:20:00:01');
    world.gladys.fake.devices = [
      {
        external_id: PHONE,
        name: 'Phone',
        features: [{ external_id: `${PHONE}:presence`, last_value: 1 }],
      },
    ];
    await world.gladys.connect();
    await world.gladys.fake.deviceCreated(world.gladys.fake.devices[0]);
    assert.equal(world.gladys.fake.lastState(`${PHONE}:presence`), 1);
  } finally {
    await world.close();
  }
});

test('scene events fire on transitions only, never at startup', async () => {
  const world = await createWorld();
  try {
    assert.deepEqual(world.gladys.fake.sceneEvents, [], 'the first read only learns');
    world.deco.setOnline('02-00-5E-10-00-02', false);
    world.deco.state.clients['02-00-5E-10-00-01'].push({
      mac: '02:00:5e:20:00:99',
      name: Buffer.from('Unknown laptop').toString('base64'),
      wire_type: 'wireless',
      connection_type: 'band2_4',
      interface: 'guest',
      ip: '192.0.2.199',
      online: true,
    });
    await world.app.readNow();
    await world.app.readNow();
    const events = world.gladys.fake.sceneEvents.map((e) => [e.key, e.data]);
    assert.deepEqual(events, [
      [
        'deco_offline',
        {
          device: OFFICE,
          device_name: 'Office',
          model: 'X50',
          role: 'satellite',
          mac: '02:00:5E:10:00:02',
        },
      ],
      [
        'new_unknown_client',
        {
          client: `${SEL}:client:02005e200099`,
          mac: '02:00:5E:20:00:99',
          name: 'Unknown laptop',
          ip: '192.0.2.199',
          connection: 'wireless',
          band: '2.4 GHz',
          guest: 'yes',
          deco_name: 'Salon',
        },
      ],
    ]);
  } finally {
    await world.close();
  }
});

test('the known clients are kept in /data: a restart fires nothing, a new MAC still does', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'deco-data-'));
  try {
    const first = await createWorld({ dataDir });
    await first.close();
    const stored = JSON.parse(await readFile(path.join(dataDir, 'known-clients.json'), 'utf8'));
    assert.deepEqual(Object.keys(stored.meshes), ['02005e100001']);
    assert.equal(stored.meshes['02005e100001'].length, 5);
    assert.ok(!JSON.stringify(stored).includes('Camille'), 'MAC addresses only');

    const second = await createWorld({ dataDir });
    try {
      assert.deepEqual(second.gladys.fake.sceneEvents, []);
      second.deco.state.clients['02:00:5e:10:00:03'].push({
        mac: '02:00:5e:20:00:77',
        name: 'Printer',
        wire_type: 'wired',
        online: true,
      });
      await second.app.readNow();
      assert.deepEqual(
        second.gladys.fake.sceneEvents.map((e) => [e.key, e.data.connection, e.data.guest]),
        [['new_unknown_client', 'wired', 'no']],
      );
    } finally {
      await second.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a device added to Gladys gets its states at once, and the widget a refresh', async () => {
  const world = await createWorld();
  try {
    const refreshes = world.gladys.fake.widgetRefreshes.length;
    await world.addDevices((d) => d.external_id === OFFICE);
    assert.equal(world.gladys.fake.lastState(`${OFFICE}:clients`), 1);
    assert.ok(world.gladys.fake.widgetRefreshes.length > refreshes);
    assert.ok(
      world.gladys.fake.states.every((s) => s.device_feature_external_id.startsWith(OFFICE)),
    );
  } finally {
    await world.close();
  }
});

test('only the changes are published, with a heartbeat under 12 hours', async (t) => {
  const world = await createWorld();
  try {
    const calls = [];
    const original = world.gladys.publishChangedStates.bind(world.gladys);
    t.mock.method(world.gladys, 'publishChangedStates', async (states, options) => {
      calls.push(options);
      return original(states, options);
    });
    await world.addDevices();
    const count = world.gladys.fake.states.length;
    await world.app.readNow();
    assert.equal(world.gladys.fake.states.length, count, 'nothing changed, nothing sent');
    assert.ok(calls.length > 0);
    for (const options of calls) {
      assert.ok(options.heartbeat > 0 && options.heartbeat <= 12 * 60 * 60 * 1000);
    }
    assert.equal(HEARTBEAT_MS, 6 * 60 * 60 * 1000);
  } finally {
    await world.close();
  }
});

test('the Discovery list follows the option: Decos only when the clients are not offered', async () => {
  const world = await createWorld({ config: { discover_clients: false } });
  try {
    const ids = world.gladys.fake.discoveredDevices.map((d) => d.external_id);
    assert.deepEqual(ids, [MAIN, OFFICE, BEDROOM]);
  } finally {
    await world.close();
  }
});

test('a refused password pauses the reads: the Deco would lock the account', async () => {
  const world = await createWorld({ config: { password: 'wrong-password-value' } });
  try {
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.fr, /Mot de passe refusé/);
    for (let i = 0; i < 5; i += 1) await world.app.readNow();
    assert.equal(world.deco.events.filter((e) => e === 'login-refused').length, 1, 'one try');
    assert.equal(world.deco.state.attemptsLeft, 9);

    // The connection test is one explicit try.
    const ack = await world.gladys.fake.action('test_connection', {});
    assert.equal(ack.success, false);
    assert.equal(world.deco.events.filter((e) => e === 'login-refused').length, 2);

    await world.gladys.fake.configUpdated({ ...world.config, password: PASSWORD });
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.close();
  }
});

test('connection status: not configured, unreachable, connected — sent on changes only', async () => {
  const world = await createWorld({ config: { host: '' } });
  try {
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.fr, /Renseignez l'adresse/);
    world.deco.state.forbidLogin = true;
    await world.gladys.fake.configUpdated({ ...world.config, host: world.deco.url });
    assert.match(world.gladys.fake.connectionStatus.message.de, /Haupt-Deco nicht erreichbar/);
    world.deco.state.forbidLogin = false;
    await world.app.readNow();
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    const sent = world.gladys.fake.connectionStatuses.length;
    await world.app.readNow();
    assert.equal(world.gladys.fake.connectionStatuses.length, sent);
  } finally {
    await world.close();
  }
});

test('quiet logs: a normal cycle writes nothing at info, a failure once, the recovery once', async () => {
  const world = await createWorld();
  try {
    await world.addDevices();
    const startup = world.logger.at('info').length;
    for (let i = 0; i < 3; i += 1) await world.app.readNow();
    assert.equal(world.logger.at('info').length, startup, 'a normal cycle is silent at info');

    world.deco.state.forbidLogin = true;
    for (let i = 0; i < 3; i += 1) await world.app.readNow();
    const warnings = world.logger.lines.filter((l) => l.level === 'warn');
    assert.equal(warnings.length, 1, 'one line for the first failure');
    world.deco.state.forbidLogin = false;
    await world.app.readNow();
    await world.app.readNow();
    const recoveries = world.logger.lines.filter((l) => /reachable again/.test(l.text));
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].level, 'info');
  } finally {
    await world.close();
  }
});

test('a Deco lost and back is one info line each, never one per read', async () => {
  const world = await createWorld();
  try {
    world.deco.setOnline('02-00-5E-10-00-02', false);
    await world.app.readNow();
    await world.app.readNow();
    world.deco.setOnline('02-00-5E-10-00-02', true);
    await world.app.readNow();
    await world.app.readNow();
    const lines = world.logger.lines.filter((l) => l.text.startsWith('Deco Office'));
    assert.deepEqual(
      lines.map((l) => [l.level, l.text]),
      [
        ['info', 'Deco Office is offline'],
        ['info', 'Deco Office is back online'],
      ],
    );
  } finally {
    await world.close();
  }
});

test('no secret of the configuration reaches the logs or Gladys', async () => {
  const world = await createWorld({ config: { allow_guest_wifi: true, allow_reboot: true } });
  try {
    await world.addDevices();
    await world.gladys.fake.action('test_connection', {});
    await world.gladys.fake.action('reboot_deco', { device: BEDROOM });
    const main = world.gladys.fake.discoveredDevices.find((d) => d.external_id === MAIN);
    const guest = main.features.find((f) => f.external_id.endsWith(':guest_wifi'));
    await world.gladys.fake.setValue(main, guest, 1);
    world.deco.state.forbidLogin = true;
    await world.app.readNow();
    await world.gladys.fake.configUpdated({ ...world.config, password: 'another-password-value' });
    const logs = world.logger.lines.map((l) => l.text).join('\n');
    const toGladys = JSON.stringify(world.gladys.fake.requests.map((r) => r.body));
    const acks = JSON.stringify(world.gladys.fake.wsMessages);
    for (const secret of [PASSWORD, 'another-password-value']) {
      assert.ok(!logs.includes(secret), 'a secret is in the logs');
      assert.ok(!toGladys.includes(secret), 'a secret was sent to Gladys');
      assert.ok(!acks.includes(secret), 'a secret is in an ack');
    }
    // Nor the session of the Deco, nor the Wi-Fi passwords it sends.
    for (const leak of ['stok=', 'sysauth', 'bm90LWEtcmVhbC1wYXNzd29yZA']) {
      assert.ok(!logs.includes(leak), `"${leak}" is in the logs`);
      assert.ok(!toGladys.includes(leak), `"${leak}" was sent to Gladys`);
    }
  } finally {
    await world.close();
  }
});

test('commands are off by default: no guest Wi-Fi switch, the restart refused', async () => {
  const world = await createWorld();
  try {
    const features = world.gladys.fake.discoveredDevices.flatMap((d) => d.features);
    assert.ok(
      features.every((f) => f.read_only),
      'no writable feature by default',
    );
    for (const [key, fields] of [['reboot_deco', { device: OFFICE }]]) {
      const ack = await world.gladys.fake.action(key, fields);
      assert.equal(ack.success, false);
      assert.match(ack.error, /Autoriser les redémarrages/);
      const scene = await world.gladys.fake.sceneAction(key, fields);
      assert.equal(scene.success, false);
    }
    assert.deepEqual(world.deco.state.reboots, []);
  } finally {
    await world.close();
  }
});

test('enabled commands reach the Deco, with one info line each', async () => {
  const world = await createWorld({ config: { allow_guest_wifi: true, allow_reboot: true } });
  try {
    await world.addDevices();
    const main = world.gladys.fake.discoveredDevices.find((d) => d.external_id === MAIN);
    const guest = main.features.find((f) => f.external_id.endsWith(':guest_wifi'));
    assert.equal(guest.category, 'switch');
    assert.equal(guest.read_only, false);
    assert.equal(world.gladys.fake.lastState(guest.external_id), 0);
    // Only the main Deco has it.
    const others = world.gladys.fake.discoveredDevices.filter((d) => d.external_id !== MAIN);
    assert.ok(others.every((d) => !d.features.some((f) => f.external_id.endsWith(':guest_wifi'))));

    assert.equal((await world.gladys.fake.setValue(main, guest, 1)).success, true);
    assert.equal(world.deco.state.wlan.band2_4.guest.enable, true);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(guest.external_id), 1);

    const ack = await world.gladys.fake.action('reboot_deco', { device: BEDROOM });
    assert.equal(ack.success, true);
    assert.match(ack.data.message.fr, /Chambre des enfants redémarre/);
    const scene = await world.gladys.fake.sceneAction('reboot_deco', { device: OFFICE });
    assert.equal(scene.success, true);
    assert.deepEqual(world.deco.state.reboots, ['02:00:5e:10:00:03', '02-00-5E-10-00-02']);
    const commands = world.logger.lines.filter((l) => l.text.startsWith('Command:'));
    assert.deepEqual(
      commands.map((l) => [l.level, l.text]),
      [
        ['info', 'Command: guest Wi-Fi on (2 band(s))'],
        ['info', 'Command: restart of Chambre des enfants'],
        ['info', 'Command: restart of Office'],
      ],
    );
    // A read-only feature refuses a value.
    const online = main.features.find((f) => f.external_id.endsWith(':online'));
    assert.equal((await world.gladys.fake.setValue(main, online, 0)).success, false);
  } finally {
    await world.close();
  }
});

test('commands refuse a wrong target with a clear message', async () => {
  const world = await createWorld({ config: { allow_reboot: true, language: 'en' } });
  try {
    const cases = [
      [{ device: TV }, /Choose a Deco, not a network client/],
      [{ device: 'ext:other:deco:02005e100001' }, /Choose a Deco/],
      [{ device: `${SEL}:deco:02005e1000ff` }, /not in the mesh any more/],
    ];
    for (const [fields, message] of cases) {
      const ack = await world.gladys.fake.action('reboot_deco', fields);
      assert.equal(ack.success, false);
      assert.match(ack.error, message);
    }
    world.deco.setOnline('02-00-5E-10-00-02', false);
    await world.app.readNow();
    const ack = await world.gladys.fake.action('reboot_deco', { device: OFFICE });
    assert.match(ack.error, /Office is offline/);
    assert.deepEqual(world.deco.state.reboots, []);
  } finally {
    await world.close();
  }
});

test('a guest Wi-Fi switch kept after its option is turned off refuses, with the reason', async () => {
  const world = await createWorld({ config: { allow_guest_wifi: true } });
  try {
    await world.addDevices();
    const main = world.gladys.fake.discoveredDevices.find((d) => d.external_id === MAIN);
    const guest = main.features.find((f) => f.external_id.endsWith(':guest_wifi'));
    await world.gladys.fake.configUpdated({ ...world.config, allow_guest_wifi: false });
    const ack = await world.gladys.fake.setValue(main, guest, 1);
    assert.equal(ack.success, false);
    assert.match(ack.error, /Wi-Fi invité est désactivé/);
    assert.equal(world.deco.state.wlan.band2_4.guest.enable, false);
  } finally {
    await world.close();
  }
});

test('the connection test reports what it found', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.action('test_connection', {});
    assert.equal(ack.success, true);
    assert.equal(
      ack.data.message.fr,
      'Connecté à Salon : 3 Deco, dont 3 en ligne, 5 clients connectés.',
    );
    assert.equal(
      ack.data.message.en,
      'Connected to Salon: 3 Deco(s), 3 online, 5 clients connected.',
    );
  } finally {
    await world.close();
  }
});

test('the widget content fits the core vocabulary in every language and state', async () => {
  const world = await createWorld();
  try {
    for (const language of LANGUAGES) {
      const ack = await world.gladys.fake.widgetGet('mesh', { language });
      assert.equal(ack.success, true);
      assert.deepEqual(validateWidgetContent(ack.data.content), [], language);
    }
    await world.addDevices((d) => d.external_id === PHONE || d.external_id === TV);
    unplug(world, '02:00:5e:20:00:04');
    world.deco.setOnline('02:00:5e:10:00:03', false);
    await world.gladys.fake.configUpdated({ ...world.config, away_delay: 0 });
    const { content } = (await world.gladys.fake.widgetGet('mesh', { language: 'fr' })).data;
    assert.deepEqual(validateWidgetContent(content), []);
    const tiles = content.components.filter((c) => c.type === 'value');
    assert.deepEqual(
      tiles.map((c) => [c.label, c.value]),
      [
        ['Clients', 3],
        ['Invités', 1],
        ['Deco en ligne', '2/3'],
      ],
    );
    const list = content.components.find((c) => c.type === 'card-list');
    assert.deepEqual(
      list.items.map((i) => [i.title, i.subtitle, i.badge.text]),
      [
        ['Téléphone de Camille', 'Salon', 'Présent'],
        ['Salon TV', undefined, 'Absent'],
      ],
    );
    const status = content.components.find((c) => c.type === 'status');
    assert.deepEqual(
      status.items.map((i) => [i.label, i.value]),
      [
        ['Salon', '3 clients'],
        ['Chambre des enfants', 'Hors ligne'],
        ['Office', '0 clients'],
      ],
    );

    world.deco.state.forbidLogin = true;
    await world.gladys.fake.configUpdated(world.config);
    const down = (await world.gladys.fake.widgetGet('mesh', { language: 'es' })).data.content;
    assert.deepEqual(validateWidgetContent(down), []);
    assert.match(down.components[0].text, /Deco principal inaccesible/);
  } finally {
    await world.close();
  }
});

test('the widget asks to be configured first, then to add clients', async () => {
  const world = await createWorld({ config: { host: '' } });
  try {
    const { content } = (await world.gladys.fake.widgetGet('mesh', { language: 'de' })).data;
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].text, 'Konfiguriere zuerst die Integration.');
    await world.gladys.fake.configUpdated({ ...world.config, host: world.deco.url });
    const ready = (await world.gladys.fake.widgetGet('mesh', { language: 'de' })).data.content;
    assert.deepEqual(validateWidgetContent(ready), []);
    assert.ok(ready.components.some((c) => c.type === 'text' && /Entdecken/.test(c.text)));
  } finally {
    await world.close();
  }
});
