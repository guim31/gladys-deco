// -----------------------------------------------------------------------------
// Client of the web API of the main Deco (/cgi-bin/luci), as used by its local
// administration page.
//
// The Deco allows ONE administrator session at a time: every use of the API
// is a session of its own — keys, login, the requests, logout — and the
// sessions are queued, never interleaved. A login elsewhere (the web page of
// the Deco) ends ours: the read fails with ERROR_KINDS.SESSION and the next
// one logs in again.
//
// Protocol: amosyuen/ha-tplink-deco (MIT), api.py; the logout, guest network
// and reboot requests as documented by the tplinkrouterc6u Deco client (read
// for the protocol only, nothing copied).
// -----------------------------------------------------------------------------

import { aesDecrypt, aesEncrypt, md5Hex, randomDigits, rsaEncrypt, rsaKey } from './crypto.js';
import { DecoError, ERROR_KINDS, LOGIN_INVALID } from './errors.js';
import { normalizeBaseUrl, post as httpPost } from './http.js';
import { normalizeMac, parseClient, parseDeco, parseGuestWifi } from './model.js';

/** The local administrator of a Deco is always "admin" (the owner's password). */
const USERNAME = 'admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

function parseJson(text, context) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object') return value;
  } catch {
    // below
  }
  throw new DecoError(`${context}: the answer is not the Deco API`, { kind: ERROR_KINDS.NOT_DECO });
}

/**
 * @param {object} options
 * @param {string} options.host address of the main Deco (IP or URL)
 * @param {string} options.password owner password (the Deco app account)
 * @param {object} [deps]
 * @param {typeof httpPost} [deps.post]
 * @param {number} [deps.timeoutMs]
 * @param {(line: string) => void} [deps.debug]
 */
export function createDecoClient({ host, password }, deps = {}) {
  const post = deps.post ?? httpPost;
  const timeoutMs = deps.timeoutMs ?? 15000;
  const debug = deps.debug ?? (() => {});
  let base = normalizeBaseUrl(host);
  let queue = Promise.resolve();

  /** POST, switching once to https when the Deco redirects there. */
  async function send(path, body, headers = JSON_HEADERS) {
    if (!base) {
      throw new DecoError('invalid address', { kind: ERROR_KINDS.NETWORK });
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await post({ url: `${base}${path}`, body, headers, timeoutMs });
      if (res.status >= 300 && res.status < 400 && attempt === 0) {
        const location = String(res.headers.location ?? '');
        const target = normalizeBaseUrl(location);
        if (target.startsWith('https://') && new URL(target).hostname === new URL(base).hostname) {
          debug('the Deco redirects to https: switching');
          base = target;
          continue;
        }
      }
      return res;
    }
    throw new DecoError('redirect loop', { kind: ERROR_KINDS.NOT_DECO });
  }

  /** The two unauthenticated reads: they must answer like a Deco. */
  async function readKeys() {
    const keysRes = await send('/cgi-bin/luci/;stok=/login?form=keys', '{"operation":"read"}');
    if (keysRes.status === 401) {
      // The legacy "outer session" firmwares (Deco S7 and a few others).
      throw new DecoError('this firmware uses a login the integration does not support', {
        kind: ERROR_KINDS.NOT_DECO,
        status: 401,
      });
    }
    if (keysRes.status !== 200) {
      throw new DecoError(`keys: HTTP ${keysRes.status}`, {
        kind: ERROR_KINDS.NOT_DECO,
        status: keysRes.status,
      });
    }
    const keys = parseJson(keysRes.text, 'keys');
    const pwd = keys?.result?.password;
    if (!Array.isArray(pwd) || pwd.length < 2) {
      throw new DecoError('keys: no password key', { kind: ERROR_KINDS.NOT_DECO });
    }
    const authRes = await send('/cgi-bin/luci/;stok=/login?form=auth', '{"operation":"read"}');
    if (authRes.status !== 200) {
      throw new DecoError(`auth: HTTP ${authRes.status}`, {
        kind: ERROR_KINDS.NOT_DECO,
        status: authRes.status,
      });
    }
    const auth = parseJson(authRes.text, 'auth');
    const signKey = auth?.result?.key;
    const seq = Number(auth?.result?.seq);
    if (!Array.isArray(signKey) || signKey.length < 2 || !Number.isFinite(seq)) {
      throw new DecoError('auth: no signing key', { kind: ERROR_KINDS.NOT_DECO });
    }
    try {
      return {
        passwordKey: rsaKey(pwd[0], pwd[1]),
        signKey: rsaKey(signKey[0], signKey[1]),
        seq,
      };
    } catch {
      throw new DecoError('keys: invalid RSA key', { kind: ERROR_KINDS.NOT_DECO });
    }
  }

  /** Log in; resolves the session used by the requests. */
  async function login() {
    const { passwordKey, signKey, seq } = await readKeys();
    const session = {
      key: randomDigits(),
      iv: randomDigits(),
      signKey,
      seq,
      hash: md5Hex(`${USERNAME}${password}`),
      stok: null,
      cookie: null,
    };
    const body = encode(session, {
      params: { password: rsaEncrypt(passwordKey, password) },
      operation: 'login',
    });
    const res = await send('/cgi-bin/luci/;stok=/login?form=login', body);
    takeCookie(session, res);
    if (res.status === 403) {
      throw new DecoError('login refused (HTTP 403)', { kind: ERROR_KINDS.FORBIDDEN, status: 403 });
    }
    if (res.status !== 200) {
      throw new DecoError(`login: HTTP ${res.status}`, { status: res.status });
    }
    const data = decode(session, parseJson(res.text, 'login'), 'login');
    const code = data.error_code ?? data.errorcode;
    if (Number(code) === LOGIN_INVALID) {
      const left = Number(data?.result?.attemptsAllowed);
      throw new DecoError('password refused', {
        kind: ERROR_KINDS.AUTH,
        errorCode: LOGIN_INVALID,
        attemptsLeft: Number.isFinite(left) ? left : null,
      });
    }
    if (code !== 0 && code !== '0' && code !== undefined) {
      throw new DecoError(`login refused (error ${code})`, { errorCode: code });
    }
    const stok = data?.result?.stok;
    if (typeof stok !== 'string' || !stok || !session.cookie) {
      throw new DecoError('login: no session in the answer', { kind: ERROR_KINDS.NOT_DECO });
    }
    session.stok = stok;
    return session;
  }

  function takeCookie(session, res) {
    const raw = res.headers['set-cookie'];
    for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const match = /sysauth=([^;]+)/.exec(line);
      if (match) session.cookie = `sysauth=${match[1]}`;
    }
  }

  function encode(session, payload) {
    const data = aesEncrypt(session.key, session.iv, JSON.stringify(payload));
    const sign = rsaEncrypt(
      session.signKey,
      `k=${session.key}&i=${session.iv}&h=${session.hash}&s=${session.seq + data.length}`,
    );
    // The length is the one of the data before URL encoding.
    return `sign=${sign}&data=${encodeURIComponent(data)}`;
  }

  function decode(session, json, context) {
    if (json.data && typeof json.data === 'object') return json.data;
    if (typeof json.data !== 'string' || json.data === '') {
      // An empty answer is what an ended session gets.
      const code = json.error_code ?? json.errorcode;
      if (code !== undefined && code !== 0 && code !== '0' && json.data === undefined) {
        throw new DecoError(`${context}: error ${code}`, { errorCode: code });
      }
      throw new DecoError(`${context}: empty answer, the session ended`, {
        kind: ERROR_KINDS.SESSION,
      });
    }
    try {
      return JSON.parse(aesDecrypt(session.key, session.iv, json.data));
    } catch {
      throw new DecoError(`${context}: undecodable answer, the session ended`, {
        kind: ERROR_KINDS.SESSION,
      });
    }
  }

  /** One authenticated request; resolves `result`. */
  async function call(session, path, payload, context) {
    const res = await send(
      `/cgi-bin/luci/;stok=${session.stok}/${path}`,
      encode(session, payload),
      {
        ...JSON_HEADERS,
        Cookie: session.cookie,
      },
    );
    if (res.status === 401 || res.status === 403) {
      throw new DecoError(`${context}: HTTP ${res.status}, the session ended`, {
        kind: ERROR_KINDS.SESSION,
        status: res.status,
      });
    }
    if (res.status !== 200) {
      throw new DecoError(`${context}: HTTP ${res.status}`, { status: res.status });
    }
    const data = decode(session, parseJson(res.text, context), context);
    const code = data.error_code ?? data.errorcode;
    if (code === 'timeout') {
      throw new DecoError(`${context}: the Deco timed out`, { kind: ERROR_KINDS.NETWORK });
    }
    if (code !== undefined && code !== 0 && code !== '0' && code !== '') {
      throw new DecoError(`${context}: error ${code}`, { errorCode: code });
    }
    return data.result ?? {};
  }

  async function logout(session) {
    try {
      await call(session, 'admin/system?form=logout', { operation: 'logout' }, 'logout');
    } catch (err) {
      // The session ends anyway on the next login: nothing to do.
      debug(`logout: ${err.message}`);
    }
  }

  /**
   * Run `work` inside one session: login, work, logout — queued.
   * @template T
   * @param {(api: object) => Promise<T>} work
   * @returns {Promise<T>}
   */
  function withSession(work) {
    const run = queue.then(async () => {
      const session = await login();
      try {
        return await work({
          request: (path, payload, context) => call(session, path, payload, context),
        });
      } finally {
        await logout(session);
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  async function listDecos(api) {
    const result = await api.request(
      'admin/device?form=device_list',
      { operation: 'read' },
      'device list',
    );
    if (!Array.isArray(result.device_list)) {
      throw new DecoError('device list: unexpected answer', { kind: ERROR_KINDS.NOT_DECO });
    }
    return result.device_list.map(parseDeco).filter(Boolean);
  }

  async function listClients(api, deviceMac, decoMac) {
    const result = await api.request(
      'admin/client?form=client_list',
      { operation: 'read', params: { device_mac: deviceMac } },
      'client list',
    );
    if (!Array.isArray(result.client_list)) {
      throw new DecoError('client list: unexpected answer', { kind: ERROR_KINDS.NOT_DECO });
    }
    return result.client_list.map((raw) => parseClient(raw, decoMac)).filter(Boolean);
  }

  return {
    get baseUrl() {
      return base;
    },

    /** Log in and out: the connection test. */
    check: () => withSession(async (api) => (await listDecos(api)).length),

    /**
     * One read of the mesh.
     * @param {{ guestWifi?: boolean }} [options]
     * @returns {Promise<Omit<import('./model.js').Snapshot, 'at'>>}
     */
    snapshot: ({ guestWifi = false } = {}) =>
      withSession(async (api) => {
        const decos = await listDecos(api);
        const master = decos.find((deco) => deco.master) ?? decos[0];
        if (!master) {
          throw new DecoError('device list: no Deco', { kind: ERROR_KINDS.NOT_DECO });
        }
        // One list per Deco gives who is connected where; when one fails,
        // the global list still gives who is home.
        const clients = new Map();
        const counts = new Map();
        let incomplete = false;
        for (const deco of decos.filter((d) => d.online)) {
          try {
            const list = await listClients(api, deco.rawMac, deco.mac);
            counts.set(deco.mac, {
              total: list.length,
              guest: list.filter((c) => c.guest).length,
            });
            for (const client of list) clients.set(client.mac, client);
          } catch (err) {
            if (err.kind === ERROR_KINDS.SESSION) throw err;
            incomplete = true;
            debug(`client list of one Deco failed: ${err.message}`);
          }
        }
        if (incomplete) {
          for (const client of await listClients(api, 'default', null)) {
            if (!clients.has(client.mac)) clients.set(client.mac, client);
          }
        }
        let guest = { enabled: null };
        if (guestWifi) {
          try {
            guest = parseGuestWifi(
              await api.request('admin/wireless?form=wlan', { operation: 'read' }, 'wlan'),
            );
          } catch (err) {
            if (err.kind === ERROR_KINDS.SESSION) throw err;
            debug(`guest network read failed: ${err.message}`);
          }
        }
        return {
          meshId: master.mac,
          decos,
          clients: [...clients.values()],
          counts,
          guestWifi: guest.enabled,
        };
      }),

    /**
     * Turn the guest network on or off on every band that has one.
     * @param {boolean} enable
     * @returns {Promise<number>} bands changed
     */
    setGuestWifi: (enable) =>
      withSession(async (api) => {
        const { bands } = parseGuestWifi(
          await api.request('admin/wireless?form=wlan', { operation: 'read' }, 'wlan'),
        );
        for (const band of bands) {
          await api.request(
            'admin/wireless?form=wlan',
            { operation: 'write', params: { [band]: { guest: { enable } } } },
            'guest network',
          );
        }
        return bands.length;
      }),

    /**
     * Restart one Deco.
     * @param {string} mac 12 hex digits
     */
    reboot: (mac) =>
      withSession(async (api) => {
        const deco = (await listDecos(api)).find((d) => d.mac === normalizeMac(mac));
        if (!deco) {
          throw new DecoError('reboot: this Deco is not in the mesh', {
            kind: ERROR_KINDS.REFUSED,
          });
        }
        await api.request(
          'admin/device?form=system',
          { operation: 'reboot', params: { mac_list: [{ mac: deco.rawMac }] } },
          'reboot',
        );
        return deco;
      }),
  };
}
