// -----------------------------------------------------------------------------
// The clients already seen on each mesh (keyed on the MAC of its main Deco), kept in /data across restarts: the
// "new unknown client" trigger fires for a MAC address never seen before.
//
// The first read of a mesh only learns (an install must not fire one event per
// client of the house), and so does a read that brings an unlikely number of
// new clients at once (a Deco reset, another mesh configured).
// Only MAC addresses are stored: no name, no address.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** More new clients than this in one read: learnt silently. */
export const MAX_NEW_AT_ONCE = 20;

/**
 * @param {object} options
 * @param {string} options.dataDir the writable volume (/data)
 * @param {{ fail: Function, ok: Function }} options.issues
 */
export function createKnownClients({ dataDir, issues }) {
  const file = path.join(dataDir, 'known-clients.json');
  /** @type {Record<string, Set<string>> | null} */
  let meshes = null;

  async function load() {
    if (meshes) {
      return meshes;
    }
    meshes = {};
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      for (const [mesh, macs] of Object.entries(raw?.meshes ?? {})) {
        if (Array.isArray(macs)) {
          meshes[mesh] = new Set(macs.filter((mac) => /^[0-9a-f]{12}$/.test(mac)));
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        issues.fail('known-clients-read', `known clients: cannot read ${file} (${err.message})`);
      }
    }
    return meshes;
  }

  async function save() {
    const body = {
      version: 1,
      meshes: Object.fromEntries(
        Object.entries(meshes).map(([mesh, set]) => [mesh, [...set].sort()]),
      ),
    };
    try {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(body)}\n`, 'utf8');
      await rename(tmp, file);
      issues.ok('known-clients-write', 'known clients: saved again');
    } catch (err) {
      // Kept in memory: the trigger works until the next restart.
      issues.fail('known-clients-write', `known clients: cannot write ${file} (${err.message})`);
    }
  }

  return {
    /**
     * Record the clients of a read; resolve the ones never seen before.
     * @param {string} meshId MAC of the main Deco
     * @param {string[]} macs
     * @returns {Promise<{ fresh: string[], learnt: number }>}
     */
    async observe(meshId, macs) {
      const all = await load();
      const known = all[meshId];
      if (!known) {
        all[meshId] = new Set(macs);
        await save();
        return { fresh: [], learnt: macs.length };
      }
      const fresh = [...new Set(macs)].filter((mac) => !known.has(mac));
      if (fresh.length === 0) {
        return { fresh: [], learnt: 0 };
      }
      for (const mac of fresh) {
        known.add(mac);
      }
      await save();
      return fresh.length > MAX_NEW_AT_ONCE
        ? { fresh: [], learnt: fresh.length }
        : { fresh, learnt: 0 };
    },
  };
}
