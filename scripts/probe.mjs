#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real main Deco, for the maintainers: does it answer
// like the integration expects?
//
//   node scripts/probe.mjs <address-of-the-main-Deco>
//   node scripts/probe.mjs 192.0.2.1
//   DECO_PASSWORD=... node scripts/probe.mjs 192.0.2.1
//
// It runs the real connection path and changes nothing on the Deco:
//   1. /login?form=keys (no login): the RSA key of the password;
//   2. /login?form=auth (no login): the signing key and its sequence;
//   3. a login with an INVENTED password, encrypted and signed like the real
//      one: the Deco must refuse it with error -5002 (this uses one attempt
//      of the Deco's wrong-password counter, which a good login resets);
//   4. only when DECO_PASSWORD is set: a real session that reads the Deco list
//      and the client lists, then logs out — the same reads as the
//      integration, no write.
// Nothing sensitive is printed: no password, no session token, no MAC, no
// name, no address — models, firmware versions and counts only.
// -----------------------------------------------------------------------------

import { createDecoClient } from '../src/deco/client.js';
import { ERROR_KINDS } from '../src/deco/errors.js';
import { normalizeBaseUrl, post } from '../src/deco/http.js';

const target = process.argv[2] ?? '';
const base = normalizeBaseUrl(target);
if (!base) {
  console.error('usage: [DECO_PASSWORD=...] node scripts/probe.mjs <address-of-the-main-Deco>');
  process.exit(2);
}

let failures = 0;
const report = (ok, label, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
};

async function step(label, run) {
  try {
    await run();
  } catch (err) {
    report(false, label, err.message);
  }
}

const keyBits = (hex) => (typeof hex === 'string' ? Math.round((hex.length * 4) / 64) * 64 : 0);

for (const form of ['keys', 'auth']) {
  await step(`unauthenticated read (form=${form})`, async () => {
    const res = await post({
      url: `${base}/cgi-bin/luci/;stok=/login?form=${form}`,
      body: '{"operation":"read"}',
      headers: { 'Content-Type': 'application/json' },
    });
    let json = null;
    try {
      json = JSON.parse(res.text);
    } catch {
      // reported below
    }
    const key = form === 'keys' ? json?.result?.password : json?.result?.key;
    const extra =
      form === 'auth'
        ? `, sequence ${Number.isFinite(json?.result?.seq) ? 'present' : 'missing'}`
        : '';
    report(
      res.status === 200 && Array.isArray(key),
      `unauthenticated read (form=${form})`,
      `HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ' (redirect: try https://)' : ''}` +
        `, RSA key ${Array.isArray(key) ? `${keyBits(key[0])} bits` : 'missing'}${extra}`,
    );
  });
}

await step('the Deco refuses an invented password', async () => {
  const client = createDecoClient({ host: base, password: 'gladys-probe-invented-password' });
  try {
    await client.check();
    report(false, 'the Deco refuses an invented password', 'it was accepted!');
  } catch (err) {
    report(
      err.kind === ERROR_KINDS.AUTH,
      'the Deco refuses an invented password',
      err.kind === ERROR_KINDS.AUTH
        ? `error -5002, ${err.attemptsLeft ?? '?'} attempts left`
        : `${err.kind}: ${err.message} (expected error -5002)`,
    );
  }
});

const password = process.env.DECO_PASSWORD;
if (password) {
  await step('read-only session with DECO_PASSWORD', async () => {
    const client = createDecoClient({ host: base, password });
    const snapshot = await client.snapshot({ guestWifi: true });
    const main = snapshot.decos.find((d) => d.mac === snapshot.meshId);
    report(true, 'read-only session with DECO_PASSWORD', 'logged in, read, logged out');
    console.log(
      `     main Deco: ${main?.model ?? '?'} hw ${main?.hardware ?? '?'}, firmware ${main?.firmware ?? '?'}`,
    );
    for (const deco of snapshot.decos.filter((d) => d !== main)) {
      console.log(
        `     satellite: ${deco.model ?? '?'}, ${deco.online ? 'online' : 'offline'}, ` +
          `firmware ${deco.firmware ?? '?'}, link ${deco.linkRate ?? '?'} Mbit/s` +
          `${deco.wiredBackhaul ? ' (wired)' : ''}`,
      );
    }
    const counted = [...snapshot.counts.values()].reduce((sum, c) => sum + c.total, 0);
    console.log(
      `     clients: ${snapshot.clients.length} online (${counted} in the per-Deco lists), ` +
        `${snapshot.clients.filter((c) => c.guest).length} on the guest network; ` +
        `guest Wi-Fi ${snapshot.guestWifi === null ? 'not read' : snapshot.guestWifi ? 'on' : 'off'}`,
    );
  });
} else {
  console.log('(set DECO_PASSWORD to also run a read-only session)');
}

process.exit(failures === 0 ? 0 : 1);
