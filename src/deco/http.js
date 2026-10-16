// -----------------------------------------------------------------------------
// The HTTP transport to the Deco: node:http / node:https, no dependency.
//
// - The Deco serves a self-signed certificate on https: it is accepted, the
//   Deco is reached on the local network only, and the password never travels
//   in clear anyway (RSA, then AES).
// - Some firmwares redirect http:// to https:// on the same host (307): the
//   client switches its base address once instead of following a redirect
//   that would drop the session cookie (see amosyuen/ha-tplink-deco).
// - Answers are capped at 4 MB, every request has a timeout.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { DecoError, ERROR_KINDS } from './errors.js';

const MAX_BODY = 4 * 1024 * 1024;

/**
 * "192.0.2.1", "http://192.0.2.1/", "https://deco.lan:443" -> origin without slash.
 * @param {string} input
 * @returns {string} empty when not usable
 */
export function normalizeBaseUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * One POST request.
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.body
 * @param {Record<string, string>} [options.headers]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, text: string }>}
 */
export function post({ url, body, headers = {}, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            req.destroy(new DecoError('answer too large', { kind: ERROR_KINDS.NOT_DECO }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', (err) => reject(transportError(err)));
      },
    );
    req.on('timeout', () => req.destroy(new DecoError('no answer (timeout)')));
    req.on('error', (err) => reject(transportError(err)));
    req.end(body);
  });
}

function transportError(err) {
  if (err instanceof DecoError && err.kind !== ERROR_KINDS.REFUSED) return err;
  // Only the error code reaches the message: never the address.
  const code = err?.code ? ` (${err.code})` : '';
  const reason = err instanceof DecoError ? err.message : `connection failed${code}`;
  return new DecoError(reason, { kind: ERROR_KINDS.NETWORK });
}
