// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish says "usted" (maintainer's choice).
// Brands (Deco, TP-Link, Wi-Fi) are not translated.
//
// The feature names are frozen by Gladys when the user adds the device: they
// follow the `language` of the configuration at that moment.
// Placeholders are written {name} and filled by format().
// -----------------------------------------------------------------------------

/** Feature names, by language. */
export const NAMES = {
  en: {
    online: 'Online',
    internet: 'Internet',
    clients: 'Connected clients',
    guestClients: 'Guest clients',
    role: 'Role',
    linkRate: 'Link rate',
    firmware: 'Firmware version',
    guestWifi: 'Guest Wi-Fi',
    presence: 'Presence',
  },
  fr: {
    online: 'En ligne',
    internet: 'Internet',
    clients: 'Clients connectés',
    guestClients: 'Clients invités',
    role: 'Rôle',
    linkRate: 'Débit de la liaison',
    firmware: 'Version du firmware',
    guestWifi: 'Wi-Fi invité',
    presence: 'Présence',
  },
  de: {
    online: 'Online',
    internet: 'Internet',
    clients: 'Verbundene Clients',
    guestClients: 'Gast-Clients',
    role: 'Rolle',
    linkRate: 'Verbindungsrate',
    firmware: 'Firmware-Version',
    guestWifi: 'Gast-WLAN',
    presence: 'Anwesenheit',
  },
  es: {
    online: 'En línea',
    internet: 'Internet',
    clients: 'Clientes conectados',
    guestClients: 'Clientes invitados',
    role: 'Función',
    linkRate: 'Velocidad del enlace',
    firmware: 'Versión del firmware',
    guestWifi: 'Wi-Fi de invitados',
    presence: 'Presencia',
  },
};

/** The value of the "role" text feature. */
export const ROLES = {
  master: { en: 'Main Deco', fr: 'Deco principal', de: 'Haupt-Deco', es: 'Deco principal' },
  satellite: { en: 'Satellite', fr: 'Satellite', de: 'Satellit', es: 'Satélite' },
};

/** Messages: connection status, action results, errors. */
export const TEXT = {
  notConfigured: {
    en: 'Fill in the address of the main Deco and the password of the Deco app account.',
    fr: "Renseignez l'adresse du Deco principal et le mot de passe du compte de l'appli Deco.",
    de: 'Gib die Adresse des Haupt-Deco und das Passwort des Kontos der Deco-App ein.',
    es: 'Introduzca la dirección del Deco principal y la contraseña de la cuenta de la app Deco.',
  },
  unreachable: {
    en: 'Main Deco unreachable: {reason}',
    fr: 'Deco principal injoignable : {reason}',
    de: 'Haupt-Deco nicht erreichbar: {reason}',
    es: 'Deco principal inaccesible: {reason}',
  },
  authPaused: {
    en: 'Password refused: reads are paused so the Deco does not lock the account. Fix the password, or run the connection test.',
    fr: 'Mot de passe refusé : la lecture est suspendue pour que le Deco ne bloque pas le compte. Corrigez le mot de passe ou lancez le test de connexion.',
    de: 'Passwort abgelehnt: Das Auslesen pausiert, damit das Deco das Konto nicht sperrt. Korrigiere das Passwort oder starte den Verbindungstest.',
    es: 'Contraseña rechazada: la lectura está en pausa para que el Deco no bloquee la cuenta. Corrija la contraseña o ejecute la prueba de conexión.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, schau in die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  testOk: {
    en: 'Connected to {main}: {decos} Deco(s), {online} online, {clients} clients connected.',
    fr: 'Connecté à {main} : {decos} Deco, dont {online} en ligne, {clients} clients connectés.',
    de: 'Mit {main} verbunden: {decos} Deco(s), davon {online} online, {clients} Clients verbunden.',
    es: 'Conectado a {main}: {decos} Deco, {online} en línea, {clients} clientes conectados.',
  },
  notReady: {
    en: 'The Deco has not been read yet: try again in a minute.',
    fr: "Le Deco n'a pas encore été lu : réessayez dans une minute.",
    de: 'Das Deco wurde noch nicht ausgelesen: Versuch es in einer Minute noch mal.',
    es: 'El Deco aún no se ha leído: inténtelo de nuevo dentro de un minuto.',
  },
  notDeco: {
    en: 'Choose a Deco, not a network client.',
    fr: 'Choisissez un Deco, pas un client du réseau.',
    de: 'Wähle ein Deco, keinen Netzwerk-Client.',
    es: 'Elija un Deco, no un cliente de la red.',
  },
  unknownDevice: {
    en: 'This Deco is not in the mesh any more.',
    fr: 'Ce Deco ne fait plus partie du réseau maillé.',
    de: 'Dieses Deco gehört nicht mehr zum Mesh-Netzwerk.',
    es: 'Este Deco ya no forma parte de la red mallada.',
  },
  offline: {
    en: '{device} is offline: the main Deco cannot reach it.',
    fr: "{device} est hors ligne : le Deco principal ne peut pas l'atteindre.",
    de: '{device} ist offline: Das Haupt-Deco erreicht es nicht.',
    es: '{device} está fuera de línea: el Deco principal no puede alcanzarlo.',
  },
  rebootDisabled: {
    en: 'Restarting a Deco is off: turn on "Allow restarts" in the configuration.',
    fr: 'Le redémarrage est désactivé : activez « Autoriser les redémarrages » dans la configuration.',
    de: 'Neustarts sind aus: Aktiviere „Neustarts erlauben“ in der Konfiguration.',
    es: 'Los reinicios están desactivados: active «Permitir los reinicios» en la configuración.',
  },
  rebootDone: {
    en: '{device} is restarting: it is offline for a few minutes.',
    fr: '{device} redémarre : il sera hors ligne quelques minutes.',
    de: '{device} startet neu: Es ist ein paar Minuten offline.',
    es: '{device} se está reiniciando: estará fuera de línea unos minutos.',
  },
  guestDisabled: {
    en: 'Guest Wi-Fi control is off: turn on "Allow guest Wi-Fi control" in the configuration.',
    fr: 'Le pilotage du Wi-Fi invité est désactivé : activez « Autoriser le pilotage du Wi-Fi invité » dans la configuration.',
    de: 'Die Steuerung des Gast-WLANs ist aus: Aktiviere „Steuerung des Gast-WLANs erlauben“ in der Konfiguration.',
    es: 'El control del Wi-Fi de invitados está desactivado: active «Permitir el control del Wi-Fi de invitados» en la configuración.',
  },
  noGuestNetwork: {
    en: 'This Deco has no guest network: create it in the Deco app first.',
    fr: "Ce Deco n'a pas de réseau invité : créez-le d'abord dans l'appli Deco.",
    de: 'Dieses Deco hat kein Gastnetzwerk: Leg es zuerst in der Deco-App an.',
    es: 'Este Deco no tiene red de invitados: créela primero en la app Deco.',
  },
  guestOn: {
    en: 'Guest Wi-Fi turned on.',
    fr: 'Wi-Fi invité activé.',
    de: 'Gast-WLAN eingeschaltet.',
    es: 'Wi-Fi de invitados activado.',
  },
  guestOff: {
    en: 'Guest Wi-Fi turned off.',
    fr: 'Wi-Fi invité coupé.',
    de: 'Gast-WLAN ausgeschaltet.',
    es: 'Wi-Fi de invitados desactivado.',
  },
  commandFailed: {
    en: 'The Deco refused the command: {reason}',
    fr: 'Le Deco a refusé la commande : {reason}',
    de: 'Das Deco hat den Befehl abgelehnt: {reason}',
    es: 'El Deco ha rechazado el comando: {reason}',
  },
};

/** Why the Deco could not be read, by kind of failure (src/deco/errors.js). */
export const REASONS = {
  auth: {
    en: 'password refused ({detail} attempts left), check it in the configuration.',
    fr: 'mot de passe refusé ({detail} essais restants), vérifiez-le dans la configuration.',
    de: 'Passwort abgelehnt (noch {detail} Versuche), prüfe es in der Konfiguration.',
    es: 'contraseña rechazada (quedan {detail} intentos), compruébela en la configuración.',
  },
  forbidden: {
    en: 'login refused: the Deco may have locked the account after wrong passwords, wait and try again.',
    fr: 'connexion refusée : le Deco a peut-être bloqué le compte après des erreurs de mot de passe, patientez puis réessayez.',
    de: 'Anmeldung abgelehnt: Das Deco hat das Konto nach falschen Passwörtern vielleicht gesperrt, warte und versuch es erneut.',
    es: 'inicio de sesión rechazado: puede que el Deco haya bloqueado la cuenta tras contraseñas erróneas, espere y vuelva a intentarlo.',
  },
  network: {
    en: 'no answer, check the address of the main Deco.',
    fr: "pas de réponse, vérifiez l'adresse du Deco principal.",
    de: 'keine Antwort, prüfe die Adresse des Haupt-Deco.',
    es: 'sin respuesta, compruebe la dirección del Deco principal.',
  },
  not_deco: {
    en: 'this address does not answer like the main Deco of a mesh ({detail}).',
    fr: 'cette adresse ne répond pas comme le Deco principal d’un réseau maillé ({detail}).',
    de: 'diese Adresse antwortet nicht wie das Haupt-Deco eines Mesh-Netzwerks ({detail}).',
    es: 'esta dirección no responde como el Deco principal de una red mallada ({detail}).',
  },
  session: {
    en: 'the session was taken over by another login (the web page of the Deco); the next read logs in again.',
    fr: 'la session a été reprise par une autre connexion (la page web du Deco) ; la prochaine lecture se reconnecte.',
    de: 'die Sitzung wurde von einer anderen Anmeldung übernommen (der Webseite des Deco); das nächste Auslesen meldet sich neu an.',
    es: 'otra conexión ha tomado la sesión (la página web del Deco); la próxima lectura vuelve a conectarse.',
  },
  refused: {
    en: 'unexpected answer ({detail}).',
    fr: 'réponse inattendue ({detail}).',
    de: 'unerwartete Antwort ({detail}).',
    es: 'respuesta inesperada ({detail}).',
  },
};

/** Short texts of the dashboard widget. */
export const WIDGET_TEXT = {
  clients: { en: 'Clients', fr: 'Clients', de: 'Clients', es: 'Clientes' },
  guests: { en: 'Guests', fr: 'Invités', de: 'Gäste', es: 'Invitados' },
  decos: { en: 'Decos online', fr: 'Deco en ligne', de: 'Decos online', es: 'Deco en línea' },
  clientsOn: {
    en: '{count} clients',
    fr: '{count} clients',
    de: '{count} Clients',
    es: '{count} clientes',
  },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Fuera de línea' },
  noInternet: { en: 'No Internet', fr: "Pas d'Internet", de: 'Kein Internet', es: 'Sin Internet' },
  home: { en: 'Home', fr: 'Présent', de: 'Zu Hause', es: 'En casa' },
  away: { en: 'Away', fr: 'Absent', de: 'Abwesend', es: 'Ausente' },
  notConfigured: {
    en: 'Configure the integration first.',
    fr: "Configurez d'abord l'intégration.",
    de: 'Konfiguriere zuerst die Integration.',
    es: 'Configure primero la integración.',
  },
  waiting: {
    en: 'Waiting for the first reading of the Deco.',
    fr: 'En attente de la première lecture du Deco.',
    de: 'Warte auf das erste Auslesen des Deco.',
    es: 'Esperando la primera lectura del Deco.',
  },
  noTracked: {
    en: 'Add clients from the Discovery tab to follow who is home.',
    fr: "Ajoutez des clients depuis l'onglet Découverte pour suivre qui est là.",
    de: 'Füge Clients im Tab „Entdecken“ hinzu, um zu sehen, wer da ist.',
    es: 'Añada clientes desde la pestaña Descubrir para saber quién está en casa.',
  },
};

/**
 * Fill the {placeholders} of a text.
 * @param {string} template
 * @param {Record<string, string|number>} [vars]
 */
export function format(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] === undefined ? match : String(vars[key]),
  );
}

/**
 * One text of a table in one language (English when the language is unknown).
 * @param {Record<string, string>} entry
 * @param {string} language
 * @param {Record<string, string|number>} [vars]
 */
export function pick(entry, language, vars) {
  return format(entry[language] ?? entry.en, vars);
}

/**
 * A multi-language object from a table entry, placeholders filled.
 * @param {Record<string, string>} entry
 * @param {Record<string, string|number> | ((lang: string) => Record<string, string|number>)} [vars]
 */
export function localized(entry, vars = {}) {
  return Object.fromEntries(
    Object.entries(entry).map(([lang, template]) => [
      lang,
      format(template, typeof vars === 'function' ? vars(lang) : vars),
    ]),
  );
}

/**
 * The reason of a failure, as a multi-language object.
 * @param {Error & { kind?: string, attemptsLeft?: number|null }} err
 */
export function reasonOf(err) {
  const kind = err?.kind ?? 'refused';
  const entry = REASONS[kind] ?? REASONS.refused;
  const detail = kind === 'auth' ? (err?.attemptsLeft ?? '?') : (err?.message ?? '-').slice(0, 80);
  return localized(entry, { detail });
}

/**
 * A message with a {reason} placeholder, as a multi-language object.
 * @param {Record<string, string>} entry
 * @param {Error} err
 */
export function withReason(entry, err) {
  const reason = reasonOf(err);
  return localized(entry, (lang) => ({ reason: reason[lang] }));
}
