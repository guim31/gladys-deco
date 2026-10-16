// -----------------------------------------------------------------------------
// The Deco web API client, against the fake Deco and its real encryption:
// one session per use (always logged out), sessions queued, the errors sorted
// by what the user can do, and the parsing of the answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {
  aesDecrypt,
  aesEncrypt,
  md5Hex,
  randomDigits,
  rsaEncrypt,
  rsaKey,
} from '../src/deco/crypto.js';
import { createDecoClient } from '../src/deco/client.js';
import { ERROR_KINDS } from '../src/deco/errors.js';
import { normalizeBaseUrl } from '../src/deco/http.js';
import {
  decodeName,
  normalizeMac,
  parseClient,
  parseDeco,
  parseGuestWifi,
} from '../src/deco/model.js';
import { PASSWORD, startFakeDeco } from './helpers/fakeDeco.js';

const client = (deco, password = PASSWORD) =>
  createDecoClient({ host: deco.url, password }, { timeoutMs: 3000 });

test('AES-128-CBC with 16-digit keys, and RSA in blocks like the Deco web UI', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.match(randomDigits(), /^[1-9]\d{15}$/);
  }
  const key = randomDigits();
  const iv = randomDigits();
  const text = JSON.stringify({ operation: 'read', é: 'ü' });
  assert.equal(aesDecrypt(key, iv, aesEncrypt(key, iv, text)), text);
  assert.equal(md5Hex('adminpassword'), 'e3274be5c857fb42ab72d786e281b4b8');
  // A 512-bit key holds 53 bytes per block: a longer text takes two blocks.
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 512 });
  const n = Buffer.from(publicKey.export({ format: 'jwk' }).n, 'base64url').toString('hex');
  const rsa = rsaKey(n, '10001');
  assert.equal(rsa.size, 64);
  assert.equal(rsaEncrypt(rsa, 'x'.repeat(53)).length, 128);
  assert.equal(rsaEncrypt(rsa, 'x'.repeat(54)).length, 256);
  assert.throws(() => rsaKey('not hex', '10001'), /hexadecimal/);
});

test('MAC addresses, names and addresses are normalized', () => {
  assert.equal(normalizeMac('AA-BB-CC-DD-EE-0F'), 'aabbccddee0f');
  assert.equal(normalizeMac('aa:bb:cc:dd:ee:0f'), 'aabbccddee0f');
  assert.equal(normalizeMac(''), null);
  assert.equal(normalizeMac('00:00:00:00:00:00'), null);
  assert.equal(normalizeMac('aa:bb'), null);
  assert.equal(
    decodeName(Buffer.from('Téléphone de Camille').toString('base64')),
    'Téléphone de Camille',
  );
  assert.equal(decodeName('<Error Decoding Kids>'), 'Kids');
  assert.equal(decodeName('Kitchen speaker'), 'Kitchen speaker');
  assert.equal(decodeName(null), '');
  assert.equal(normalizeBaseUrl('192.0.2.1'), 'http://192.0.2.1');
  assert.equal(normalizeBaseUrl(' https://192.0.2.1/webpages/index.html '), 'https://192.0.2.1');
  assert.equal(normalizeBaseUrl('http://admin:secret@192.0.2.1'), '');
  assert.equal(normalizeBaseUrl(''), '');
});

test('a Deco entry: name, role, firmware and the backhaul rate of a satellite', () => {
  const main = parseDeco({
    mac: '02-00-5E-10-00-01',
    role: 'master',
    nickname: 'living_room',
    group_status: 'connected',
    inet_status: 'online',
    device_model: 'X50',
    software_ver: '1.8.0',
    device_ip: '192.0.2.1',
  });
  assert.equal(main.name, 'Living Room');
  assert.equal(main.master, true);
  assert.equal(main.linkRate, null, 'the main Deco has no backhaul');
  assert.equal(main.internet, true);
  const wireless = parseDeco({
    mac: '02-00-5E-10-00-02',
    role: 'slave',
    custom_nickname: Buffer.from('Bureau').toString('base64'),
    group_status: 'connected',
    rx_rate_list: { band2_4: '412', band5: 960 },
    tx_rate_list: { band5: 1297 },
  });
  assert.equal(wireless.name, 'Bureau');
  assert.equal(wireless.linkRate, 1297);
  const wired = parseDeco({ mac: '02:00:5e:10:00:03', role: 'slave', backhual_speed: '1000' });
  assert.equal(wired.linkRate, 1000);
  assert.equal(wired.online, false);
  assert.equal(wired.name, 'Deco 0003');
  assert.equal(parseDeco({ mac: '' }), null);
});

test('a client entry: offline and MAC-less entries are skipped, the band and guest read', () => {
  const name = Buffer.from('Phone').toString('base64');
  const phone = parseClient(
    {
      mac: '02:00:5e:20:00:01',
      name,
      wire_type: 'wireless',
      connection_type: 'band5',
      interface: 'guest',
      ip: '192.0.2.10',
      online: true,
    },
    'deco',
  );
  assert.deepEqual(phone, {
    mac: '02005e200001',
    name: 'Phone',
    ip: '192.0.2.10',
    wireless: true,
    band: '5 GHz',
    guest: true,
    decoMac: 'deco',
  });
  const wired = parseClient({ mac: '02:00:5e:20:00:02', wire_type: 'wired', ip: 'UNKNOWN' }, null);
  assert.equal(wired.wireless, false);
  assert.equal(wired.band, null);
  assert.equal(wired.ip, null);
  assert.equal(wired.name, '02:00:5E:20:00:02');
  assert.equal(parseClient({ mac: '', name }, null), null);
  assert.equal(parseClient({ mac: '02:00:5e:20:00:03', online: false }, null), null);
});

test('the guest network: on when one band broadcasts it, absent when none has one', () => {
  assert.deepEqual(
    parseGuestWifi({
      band2_4: { guest: { enable: false } },
      band5_1: { guest: { enable: true } },
      is_eg: false,
    }),
    { enabled: true, bands: ['band2_4', 'band5_1'] },
  );
  assert.deepEqual(parseGuestWifi({ band2_4: { host: { enable: true } } }), {
    enabled: null,
    bands: [],
  });
});

test('a read is one session: login, the lists, logout — and nothing stays open', async () => {
  const deco = await startFakeDeco();
  try {
    const snapshot = await client(deco).snapshot();
    assert.equal(snapshot.meshId, '02005e100001');
    assert.equal(snapshot.decos.length, 3);
    assert.equal(snapshot.clients.length, 5);
    assert.equal(snapshot.guestWifi, null, 'the guest network is read only when asked');
    assert.deepEqual(deco.events, [
      'login',
      'admin/device?form=device_list',
      'admin/client?form=client_list',
      'admin/client?form=client_list',
      'admin/client?form=client_list',
      'admin/system?form=logout',
      'logout',
    ]);
    assert.equal(deco.sessionOpen, false);
    // The per-Deco lists are asked with the MAC as the Deco wrote it.
    const asked = deco.requests.filter((r) => r.form === 'client_list');
    assert.equal(asked.length, 3);
  } finally {
    await deco.close();
  }
});

test('sessions are queued, never interleaved: the Deco allows one at a time', async () => {
  const deco = await startFakeDeco();
  try {
    const api = client(deco);
    await Promise.all([api.snapshot(), api.snapshot({ guestWifi: true }), api.check()]);
    const sessions = deco.events.filter((e) => e === 'login' || e === 'logout');
    assert.deepEqual(sessions, ['login', 'logout', 'login', 'logout', 'login', 'logout']);
  } finally {
    await deco.close();
  }
});

test('a failing read still logs out', async () => {
  const deco = await startFakeDeco();
  try {
    deco.state.failingClientLists = new Set(['02-00-5E-10-00-02', 'default']);
    await assert.rejects(client(deco).snapshot(), /client list: error -1/);
    assert.equal(deco.events.at(-1), 'logout');
  } finally {
    await deco.close();
  }
});

test('one client list refused: the global list keeps everyone home, that count is unknown', async () => {
  const deco = await startFakeDeco();
  try {
    deco.state.failingClientLists = new Set(['02-00-5E-10-00-02']);
    const snapshot = await client(deco).snapshot();
    assert.equal(snapshot.clients.length, 5);
    assert.equal(snapshot.counts.has('02005e100002'), false);
    assert.equal(snapshot.counts.get('02005e100001').total, 3);
    assert.equal(snapshot.clients.find((c) => c.name === 'Salon TV').decoMac, null);
  } finally {
    await deco.close();
  }
});

test('a session taken over by another login is reported as such', async () => {
  const deco = await startFakeDeco();
  try {
    const api = createDecoClient(
      { host: deco.url, password: PASSWORD },
      {
        post: async (options) => {
          const { post } = await import('../src/deco/http.js');
          // The web page of the Deco logs in right after our login.
          const res = await post(options);
          if (options.url.endsWith('form=login')) deco.kickSession();
          return res;
        },
      },
    );
    await assert.rejects(api.snapshot(), (err) => err.kind === ERROR_KINDS.SESSION);
  } finally {
    await deco.close();
  }
});

test('the errors are sorted by what the user can do', async () => {
  const deco = await startFakeDeco();
  try {
    await assert.rejects(client(deco, 'wrong-password').check(), (err) => {
      assert.equal(err.kind, ERROR_KINDS.AUTH);
      assert.equal(err.attemptsLeft, 9);
      return true;
    });
    deco.state.forbidLogin = true;
    await assert.rejects(client(deco).check(), (err) => err.kind === ERROR_KINDS.FORBIDDEN);
  } finally {
    await deco.close();
  }

  // Something else answers at this address.
  const other = http.createServer((req, res) => {
    const legacy = req.url.includes('form=keys') && req.headers['x-legacy'];
    res.writeHead(legacy ? 401 : 200, { 'Content-Type': 'text/html' });
    res.end('<html>router</html>');
  });
  await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${other.address().port}`;
  try {
    await assert.rejects(
      createDecoClient({ host: url, password: 'x' }).check(),
      (err) => err.kind === ERROR_KINDS.NOT_DECO,
    );
  } finally {
    await new Promise((resolve) => other.close(resolve));
  }

  // Nobody answers: the message never carries the address.
  await assert.rejects(
    createDecoClient({ host: url, password: 'x' }, { timeoutMs: 500 }).check(),
    (err) => {
      assert.equal(err.kind, ERROR_KINDS.NETWORK);
      assert.ok(!err.message.includes('127.0.0.1'), err.message);
      return true;
    },
  );
});

test('the legacy login of some firmwares (HTTP 401 on the keys) is reported as unsupported', async () => {
  const api = createDecoClient(
    { host: '192.0.2.1', password: 'x' },
    { post: async () => ({ status: 401, headers: {}, text: '' }) },
  );
  await assert.rejects(api.check(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.NOT_DECO);
    assert.match(err.message, /does not support/);
    return true;
  });
});

test('a redirect to https on the same host switches the address once', async () => {
  const deco = await startFakeDeco();
  try {
    const { post } = await import('../src/deco/http.js');
    const seen = [];
    const api = createDecoClient(
      { host: 'http://deco.test', password: PASSWORD },
      {
        post: async (options) => {
          seen.push(options.url.split('/cgi-bin')[0]);
          if (options.url.startsWith('http://deco.test')) {
            return { status: 307, headers: { location: 'https://deco.test/' }, text: '' };
          }
          return post({ ...options, url: options.url.replace('https://deco.test', deco.url) });
        },
      },
    );
    assert.equal((await api.snapshot()).decos.length, 3);
    assert.equal(api.baseUrl, 'https://deco.test');
    assert.equal(seen.filter((u) => u === 'http://deco.test').length, 1, 'one redirect only');
  } finally {
    await deco.close();
  }
});

test('the guest network is switched band by band, a restart targets one Deco', async () => {
  const deco = await startFakeDeco();
  try {
    const api = client(deco);
    assert.equal(await api.setGuestWifi(true), 2);
    assert.equal(deco.state.wlan.band2_4.guest.enable, true);
    assert.equal(deco.state.wlan.band5_1.guest.enable, true);
    assert.equal((await api.snapshot({ guestWifi: true })).guestWifi, true);
    await api.setGuestWifi(false);
    assert.equal((await api.snapshot({ guestWifi: true })).guestWifi, false);

    const restarted = await api.reboot('02005e100003');
    assert.equal(restarted.name, 'Chambre des enfants');
    assert.deepEqual(deco.state.reboots, ['02:00:5e:10:00:03'], 'the MAC as the Deco wrote it');
    await assert.rejects(api.reboot('02005e1000ff'), /not in the mesh/);
    assert.equal(deco.sessionOpen, false);
  } finally {
    await deco.close();
  }
});
