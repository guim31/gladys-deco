// -----------------------------------------------------------------------------
// Errors of the Deco web API, sorted by what the user can do about them.
//
// Every message is in English and free of secrets and addresses: it may reach
// the logs and, translated by kind, the Configuration screen.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = {
  /** The password was refused (-5002): the Deco counts the attempts left. */
  AUTH: 'auth',
  /** The login was refused with HTTP 403 (another administrator session, a lockout). */
  FORBIDDEN: 'forbidden',
  /** No answer: wrong address, Deco off, timeout. */
  NETWORK: 'network',
  /** The address answers, but not like the main Deco of a mesh. */
  NOT_DECO: 'not_deco',
  /** The session ended during the read: someone logged in elsewhere. */
  SESSION: 'session',
  /** Any other refusal. */
  REFUSED: 'refused',
};

export class DecoError extends Error {
  /**
   * @param {string} message
   * @param {{ kind?: string, status?: number|null, errorCode?: number|string|null, attemptsLeft?: number|null }} [details]
   */
  constructor(
    message,
    { kind = ERROR_KINDS.REFUSED, status = null, errorCode = null, attemptsLeft = null } = {},
  ) {
    super(message);
    this.name = 'DecoError';
    this.kind = kind;
    this.status = status;
    this.errorCode = errorCode;
    this.attemptsLeft = attemptsLeft;
  }
}

/** Error code of a refused password (amosyuen/ha-tplink-deco). */
export const LOGIN_INVALID = -5002;
