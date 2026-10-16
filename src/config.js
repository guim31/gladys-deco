// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults (they
// MUST match the manifest `default` values, test/manifest.test.js checks it)
// and normalizes the received object, so the rest of the code never deals with
// `undefined` nor with a number typed as a string.
// -----------------------------------------------------------------------------

import { normalizeBaseUrl } from './deco/http.js';

/** Languages of the feature names and of the texts the container produces. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Refresh intervals offered, in seconds (select values are strings). */
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  host: '',
  password: '',
  discover_clients: true,
  away_delay: 5,
  poll_interval: '60',
  allow_guest_wifi: false,
  allow_reboot: false,
  language: 'fr',
};

/** The config keys that hold a secret: never logged, never shown. */
export const SECRET_KEYS = ['password'];

const bool = (value, fallback) =>
  typeof value === 'boolean'
    ? value
    : value === 'true'
      ? true
      : value === 'false'
        ? false
        : fallback;

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG };
  config.host = typeof raw.host === 'string' ? raw.host.trim() : DEFAULT_CONFIG.host;
  // Kept as typed: a password may start or end with a space.
  config.password = typeof raw.password === 'string' ? raw.password : DEFAULT_CONFIG.password;
  config.poll_interval = POLL_INTERVALS.includes(String(raw.poll_interval))
    ? String(raw.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  config.language = LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language;
  for (const key of ['discover_clients', 'allow_guest_wifi', 'allow_reboot']) {
    config[key] = bool(raw[key], DEFAULT_CONFIG[key]);
  }
  const delay = Number(raw.away_delay ?? DEFAULT_CONFIG.away_delay);
  config.away_delay = Number.isFinite(delay)
    ? Math.min(120, Math.max(0, Math.round(delay)))
    : DEFAULT_CONFIG.away_delay;
  return config;
}

/** Whether the config holds what a connection needs. */
export function isConfigured(config) {
  return Boolean(normalizeBaseUrl(config.host) && config.password);
}

/** Milliseconds between two reads of the Deco. */
export function pollIntervalMs(config) {
  return Number(config.poll_interval) * 1000;
}

/** The config values to hide wherever text built from them could leak. */
export function secretValues(config) {
  return SECRET_KEYS.map((key) => config[key]).filter(
    (value) => typeof value === 'string' && value.length >= 4,
  );
}
