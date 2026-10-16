// -----------------------------------------------------------------------------
// The encryption of the Deco web API, with node:crypto only.
//
// Protocol as implemented by amosyuen/ha-tplink-deco (MIT), api.py:
//   - the password is RSA-encrypted (PKCS #1 v1.5) with the "password" key of
//     /login?form=keys;
//   - every request body after that is AES-128-CBC (PKCS #7) with a key and an
//     IV the client draws itself: 16-digit decimal numbers, used as their
//     UTF-8 digits;
//   - each body is signed: "k=<key>&i=<iv>&h=<md5(username+password)>&s=<seq +
//     length of the data>" RSA-encrypted with the "auth" key and its sequence
//     number from /login?form=auth. The firmware splits the RSA plaintext in
//     blocks of (modulus bytes - 11) and concatenates the hex of each block.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';

/** PKCS #1 v1.5 padding takes 11 bytes of each RSA block. */
const PKCS1_OVERHEAD = 11;

/**
 * An RSA public key from the hex modulus and exponent the Deco sends.
 * @param {string} nHex
 * @param {string} eHex
 */
export function rsaKey(nHex, eHex) {
  const clean = (hex) => {
    const value = String(hex ?? '').trim();
    if (!/^[0-9a-fA-F]+$/.test(value)) {
      throw new TypeError('RSA key is not hexadecimal');
    }
    return Buffer.from(value.length % 2 ? `0${value}` : value, 'hex');
  };
  const n = clean(nHex);
  const e = clean(eHex);
  const key = crypto.createPublicKey({
    key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') },
    format: 'jwk',
  });
  // Bytes of the modulus, leading zero bytes excluded.
  const size = n[0] === 0 ? n.length - 1 : n.length;
  return { key, size };
}

/**
 * RSA-encrypt like the Deco web UI: blocks of (size - 11) bytes, hex joined.
 * @param {{ key: crypto.KeyObject, size: number }} rsa
 * @param {string} text
 */
export function rsaEncrypt(rsa, text) {
  const plain = Buffer.from(text, 'utf8');
  const step = rsa.size - PKCS1_OVERHEAD;
  let out = '';
  for (let index = 0; index < plain.length; index += step) {
    out += crypto
      .publicEncrypt(
        { key: rsa.key, padding: crypto.constants.RSA_PKCS1_PADDING },
        plain.subarray(index, index + step),
      )
      .toString('hex');
  }
  return out;
}

/** A 16-digit decimal number without a leading zero, as the Deco expects. */
export function randomDigits() {
  // 10^15 <= value < 10^16
  const value = 10n ** 15n + (crypto.randomBytes(8).readBigUInt64BE() % (9n * 10n ** 15n));
  return value.toString();
}

/**
 * @param {string} key 16 digits
 * @param {string} iv 16 digits
 * @param {string} text
 * @returns {string} base64
 */
export function aesEncrypt(key, iv, text) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

/**
 * @param {string} key
 * @param {string} iv
 * @param {string} data base64
 * @returns {string}
 */
export function aesDecrypt(key, iv, data) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** @param {string} text */
export const md5Hex = (text) => crypto.createHash('md5').update(text, 'utf8').digest('hex');
