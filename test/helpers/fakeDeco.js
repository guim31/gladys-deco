// -----------------------------------------------------------------------------
// A fake main Deco on 127.0.0.1, with the real encryption of the web API:
// RSA keys of its own (/login?form=keys and form=auth), the signed and
// AES-encrypted bodies, the sysauth cookie and the stok of the session.
//
// Like a real Deco it allows ONE session: a login ends the previous one, and
// a request with an ended session gets an empty answer. It counts the failed
// passwords (attemptsAllowed). Its state is mutable (a Deco goes offline, a
// client joins, the guest network changes) and every request is recorded, so
// the tests drive scenarios end to end without network nor hardware.
//
// The answers come from test/fixtures/deco (anonymized shapes, see _source).
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/deco/${name}.json`, import.meta.url), 'utf8'));

export const PASSWORD = 'test-password-0123';

export function createDecoState() {
  const { device_list: decos } = fixture('device-list');
  const { _source: _ignored, ...clients } = fixture('client-lists');
  const { result: wlan } = fixture('wlan');
  return {
    password: PASSWORD,
    decos,
    clients,
    wlan,
    attemptsLeft: 10,
    /** Deco MACs (as listed) whose client_list answers an error. */
    failingClientLists: new Set(),
    /** Answer 403 to the login (a lockout). */
    forbidLogin: false,
    reboots: [],
  };
}

const bigOf = (b64url) => BigInt(`0x${Buffer.from(b64url, 'base64url').toString('hex')}`);

function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * An RSA key pair, with a PKCS #1 v1.5 decryption done by hand: Node refuses
 * that padding in privateDecrypt since the Marvin attack fix.
 */
function rsaPair(bits) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
  const jwk = privateKey.export({ format: 'jwk' });
  const n = bigOf(jwk.n);
  const d = bigOf(jwk.d);
  const size = Buffer.from(jwk.n, 'base64url').length;
  return {
    public: [n.toString(16), bigOf(jwk.e).toString(16)],
    decrypt(hex) {
      let out = '';
      for (let at = 0; at < hex.length; at += size * 2) {
        const block = modPow(BigInt(`0x${hex.slice(at, at + size * 2)}`), d, n)
          .toString(16)
          .padStart(size * 2, '0');
        const bytes = Buffer.from(block, 'hex');
        if (bytes[0] !== 0 || bytes[1] !== 2) throw new Error('bad RSA padding');
        out += bytes.subarray(bytes.indexOf(0, 2) + 1).toString('utf8');
      }
      return out;
    },
  };
}

const aes = (key, iv) => ({
  encrypt: (text) => {
    const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
    return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
  },
  decrypt: (b64) => {
    const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
    return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  },
});

const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

/**
 * @param {{ state?: ReturnType<typeof createDecoState> }} [options]
 */
export async function startFakeDeco({ state = createDecoState() } = {}) {
  const passwordKey = rsaPair(1024);
  const signKey = rsaPair(512);
  let seq = 1000 + Math.floor(Math.random() * 1000);
  /** @type {{ stok: string, cookie: string, key: string, iv: string } | null} */
  let session = null;
  const requests = [];
  const events = [];

  /** Check the signature of a body; resolve its decrypted payload. */
  function open(body) {
    const params = new URLSearchParams(body);
    const sign = params.get('sign');
    const data = params.get('data');
    if (!sign || !data) throw new Error('unsigned body');
    const fields = Object.fromEntries(new URLSearchParams(signKey.decrypt(sign)));
    if (Number(fields.s) !== seq + data.length) throw new Error('bad sequence');
    if (!/^\d{16}$/.test(fields.k) || !/^\d{16}$/.test(fields.i)) throw new Error('bad AES key');
    const cipher = aes(fields.k, fields.i);
    return { payload: JSON.parse(cipher.decrypt(data)), cipher, fields };
  }

  function reply(res, status, json, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(json));
  }

  function login(res, body) {
    if (state.forbidLogin) {
      reply(res, 403, { error_code: 403 });
      return;
    }
    const { payload, cipher, fields } = open(body);
    const password = passwordKey.decrypt(payload.params.password);
    if (password !== state.password || state.attemptsLeft <= 0) {
      state.attemptsLeft = Math.max(0, state.attemptsLeft - 1);
      events.push('login-refused');
      reply(res, 200, {
        error_code: 0,
        data: cipher.encrypt(
          JSON.stringify({ error_code: -5002, result: { attemptsAllowed: state.attemptsLeft } }),
        ),
      });
      return;
    }
    // One session at a time: this login ends the previous one.
    session = { stok: hex(16), cookie: hex(16), key: fields.k, iv: fields.i };
    events.push('login');
    reply(
      res,
      200,
      {
        error_code: 0,
        data: cipher.encrypt(JSON.stringify({ error_code: 0, result: { stok: session.stok } })),
      },
      { 'Set-Cookie': `sysauth=${session.cookie}; path=/cgi-bin/luci/` },
    );
  }

  function admin(res, path, form, body, cookie) {
    const stok = /;stok=([^/]*)\//.exec(path)?.[1];
    if (!session || stok !== session.stok || cookie !== `sysauth=${session.cookie}`) {
      // What an ended session gets from a Deco.
      reply(res, 200, { error_code: 0, data: '' });
      return;
    }
    const { payload, cipher, fields } = open(body);
    if (fields.h !== md5(`admin${state.password}`)) throw new Error('bad signature hash');
    const answer = (result, errorCode = 0) =>
      reply(res, 200, {
        error_code: 0,
        data: cipher.encrypt(JSON.stringify({ error_code: errorCode, result })),
      });
    const route = `${path.replace(/^.*;stok=[^/]*\//, '')}?form=${form}`;
    events.push(route);
    switch (route) {
      case 'admin/device?form=device_list':
        return answer({ device_list: structuredClone(state.decos) });
      case 'admin/client?form=client_list': {
        const mac = payload.params?.device_mac;
        if (state.failingClientLists.has(mac)) return answer({}, -1);
        const list =
          mac === 'default' ? Object.values(state.clients).flat() : (state.clients[mac] ?? []);
        return answer({ client_list: structuredClone(list) });
      }
      case 'admin/wireless?form=wlan':
        if (payload.operation === 'write') {
          for (const [band, value] of Object.entries(payload.params ?? {})) {
            if (state.wlan[band]?.guest && typeof value?.guest?.enable === 'boolean') {
              state.wlan[band].guest.enable = value.guest.enable;
            }
          }
          return answer({});
        }
        return answer(structuredClone(state.wlan));
      case 'admin/device?form=system':
        if (payload.operation === 'reboot') {
          state.reboots.push(...payload.params.mac_list.map((m) => m.mac));
          return answer({});
        }
        return answer({}, -1);
      case 'admin/system?form=logout':
        session = null;
        events.push('logout');
        return answer({});
      default:
        return answer({}, -40401);
    }
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://deco');
      const path = decodeURIComponent(url.pathname);
      const form = url.searchParams.get('form');
      requests.push({ path, form, body, cookie: req.headers.cookie ?? null });
      try {
        if (req.method !== 'POST' || !path.startsWith('/cgi-bin/luci/;stok=')) {
          reply(res, 404, { error_code: -1 });
        } else if (path === '/cgi-bin/luci/;stok=/login' && form === 'keys') {
          reply(res, 200, {
            error_code: 0,
            result: { username: '', password: passwordKey.public },
          });
        } else if (path === '/cgi-bin/luci/;stok=/login' && form === 'auth') {
          seq += 7;
          reply(res, 200, { error_code: 0, result: { key: signKey.public, seq } });
        } else if (path === '/cgi-bin/luci/;stok=/login' && form === 'login') {
          login(res, body);
        } else {
          admin(res, path, form, body, req.headers.cookie);
        }
      } catch (err) {
        reply(res, 400, { error_code: -1, message: err.message });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    state,
    requests,
    /** 'login', 'logout', 'login-refused' and the admin routes, in order. */
    events,
    url: `http://127.0.0.1:${server.address().port}`,
    get sessionOpen() {
      return session !== null;
    },
    /** Someone logs in on the web page of the Deco: our session ends. */
    kickSession() {
      session = { stok: hex(16), cookie: hex(16), key: '0', iv: '0' };
    },
    /** A Deco of the list goes offline (or back). */
    setOnline(mac, online) {
      const deco = state.decos.find((d) => d.mac === mac);
      deco.group_status = online ? 'connected' : 'disconnected';
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
