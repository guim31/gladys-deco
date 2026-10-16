# TP-Link Deco

Amène votre Wi-Fi maillé **TP-Link Deco** dans Gladys : qui est à la maison (les téléphones sur le
Wi-Fi), l'état de chaque Deco du réseau, et deux commandes pour vos scènes : le Wi-Fi invité et le
redémarrage d'un Deco. Tout reste sur votre réseau local : l'intégration parle directement au Deco
principal, jamais au cloud TP-Link.

Sans lien avec TP-Link. **Développée sans le matériel : vos retours sont les bienvenus** —
l'intégration est testée contre un faux Deco qui parle le vrai protocole chiffré, construit à partir de
réponses publiées de vrais Deco, pas encore contre un vrai.

## Présentation

- **Présence** : chaque téléphone, ordinateur ou appareil connecté au réseau peut devenir un capteur
  de présence, avec un délai de départ pour qu'un téléphone en veille ne « parte » pas toutes les
  quelques minutes.
- **Un appareil par Deco** : en ligne, Internet, clients connectés, clients invités, rôle (Deco
  principal ou satellite), version du firmware et, pour un satellite, le débit de sa liaison au réseau.
- **Déclencheurs de scène** : un appareil inconnu se connecte au réseau, un Deco passe hors ligne.
- **Commandes** (désactivées par défaut) : allumer ou couper le Wi-Fi invité, redémarrer un Deco.
- **Widget de tableau de bord** : clients, invités, l'état de chaque Deco et qui est à la maison.

Modèles : la gamme Deco gérée par l'appli Deco et dotée d'une page web locale (X20, X50, X55, X60,
X68, M4, M5, M9 Plus, BE65, BE85…). Gladys 5.1 ou plus.

## Prérequis

- Un réseau Deco installé avec l'**appli Deco**, et l'**adresse IP du Deco principal** — celui branché
  à votre box Internet. L'appli Deco l'affiche : **Réseau → le Deco principal → Adresse IP** (souvent
  `192.168.68.1` en mode routeur). En mode point d'accès, c'est l'adresse que votre box lui a donnée.
- Le **mot de passe de l'identifiant TP-Link propriétaire du réseau** dans l'appli Deco : l'API web
  locale du Deco n'accepte que le compte **propriétaire**, avec l'utilisateur `admin`, pas un compte
  gestionnaire.
- Le Deco n'accepte **qu'une seule session d'administration à la fois**. L'intégration se connecte à
  chaque lecture et se déconnecte aussitôt, mais pendant qu'elle lit, une connexion ailleurs met fin à
  l'une des deux sessions. TP-Link conseille un second identifiant TP-Link, ajouté comme
  **gestionnaire** dans l'appli Deco, pour votre propre usage de l'appli.

## Configuration

Dans Gladys, **Intégrations → Installer depuis GitHub** avec l'adresse de ce dépôt, puis
**Intégrations → TP-Link Deco → Configuration** :

| Champ                                             | Quoi saisir                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Adresse du Deco principal                         | Son adresse IP, par ex. `192.168.68.1`. Ajoutez `https://` seulement si http ne répond pas.  |
| Mot de passe de l'appli Deco                      | Le mot de passe de l'identifiant TP-Link propriétaire. Jamais affiché, jamais journalisé.    |
| Proposer les clients du réseau dans la Découverte | Activé par défaut : les clients en ligne apparaissent dans l'onglet Découverte.              |
| Délai de départ (minutes)                         | 5 par défaut : durée d'absence avant qu'un client soit déclaré parti (0 à 120).              |
| Intervalle de rafraîchissement                    | 1 minute par défaut ; 30 secondes, 2 ou 5 minutes. Chaque lecture est une connexion au Deco. |
| Autoriser le pilotage du Wi-Fi invité             | Désactivé par défaut. Ajoute l'interrupteur du Wi-Fi invité au Deco principal.               |
| Autoriser les redémarrages                        | Désactivé par défaut. Autorise l'action et l'action de scène « Redémarrer un Deco ».         |
| Langue des noms de fonctionnalités                | Français par défaut ; anglais, allemand ou espagnol. Noms fixés à l'ajout d'un appareil.     |

Lancez ensuite **Tester la connexion** (écran Configuration) : elle se connecte, compte les Deco et les
clients, et se déconnecte. Le Deco compte les mots de passe faux et bloque la connexion après plusieurs
d'entre eux : un mot de passe refusé suspend la lecture jusqu'à sa correction, pour que l'intégration
ne bloque jamais votre compte.

À quel rythme le Deco est lu : à l'intervalle choisi, par l'intégration elle-même (Gladys 5.2 n'interroge
pas les appareils externes de façon fiable). Une lecture est une session : les clés, la connexion, la
liste des Deco, une liste de clients par Deco, le réseau invité quand son pilotage est autorisé, et la
déconnexion — une dizaine de petites requêtes. Le Deco n'a pas de quota publié ; une fois par minute
est le rythme de l'intégration Home Assistant (30 secondes chez elle). Ouvrir un tableau de bord ne lit
jamais le Deco.

## Appareils

Allez dans **Intégrations → TP-Link Deco → Découverte** et ajoutez ce que vous voulez suivre.

**Un Deco** (un appareil par Deco du réseau) :

| Fonctionnalité      | Valeur                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| En ligne            | 1 quand le Deco fait partie du réseau, 0 quand il a décroché.                                          |
| Internet            | 1 quand le Deco atteint Internet.                                                                      |
| Clients connectés   | Les clients connectés par ce Deco (Wi-Fi et filaire).                                                  |
| Clients invités     | Ceux d'entre eux sur le réseau invité.                                                                 |
| Rôle                | Deco principal ou Satellite.                                                                           |
| Version du firmware | Telle que le Deco l'indique, par ex. `1.8.0 Build 25102213 Rel. 43970`.                                |
| Débit de la liaison | Satellites seulement : le débit de la liaison au réseau, en Mbit/s (Wi-Fi ou Ethernet).                |
| Wi-Fi invité        | Deco principal seulement, une fois « Autoriser le pilotage du Wi-Fi invité » activé : un interrupteur. |

**Un client du réseau** (un téléphone, un ordinateur…) : une fonctionnalité **Présence**, à 1 quand le
client est connecté au réseau (ou parti depuis moins que le délai de départ), à 0 sinon. Un client
ajouté à Gladys reste dans la liste de Découverte quand il est absent.

Après avoir activé « Autoriser le pilotage du Wi-Fi invité », ouvrez l'onglet Découverte et cliquez sur
**Mettre à jour** sur le Deco principal : l'interrupteur lui est ajouté.

## Widget

Ajoutez le widget **Réseau Deco** à un tableau de bord. Il montre trois tuiles (clients connectés,
invités, Deco en ligne), les clients que vous avez ajoutés à Gladys avec **Présent** ou **Absent**, et
l'état de chaque Deco : son nombre de clients, **Pas d'Internet** ou **Hors ligne**. Il est construit
d'après la dernière lecture du Deco et ne lui coûte rien.

## Déclencheurs de scène

| Déclencheur               | Quand                                                                                  | Variables                                                        |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Appareil inconnu connecté | Un appareil jamais vu sur le réseau le rejoint. Filtres : connexion, réseau invité.    | nom, adresse MAC, adresse IP, connexion, bande Wi-Fi, connecté à |
| Deco hors ligne           | Un Deco décroche du réseau : débranché, hors de portée, en redémarrage. Filtre : Deco. | nom du Deco, modèle                                              |

La première lecture ne fait qu'apprendre les appareils déjà là : installer l'intégration ou la
redémarrer ne déclenche rien. Les appareils vus sont gardés dans `/data` (adresses MAC seulement).

## Commandes

Les deux sont **désactivées par défaut** : activez d'abord leur option dans la configuration.

- **Wi-Fi invité** : l'interrupteur du Deco principal allume ou coupe le réseau invité sur chaque bande
  qui en a un. Le réseau invité doit exister (créez-le dans l'appli Deco). Utilisez-le dans une scène
  comme n'importe quel interrupteur.
- **Redémarrer un Deco** : une action de l'écran Configuration et une action de scène, jamais un
  interrupteur. La zone de ce Deco perd le Wi-Fi quelques minutes ; redémarrer le Deco principal coupe
  tout le réseau, Gladys compris s'il passe par lui.

## Exemples de scènes

- **Bienvenue** : quand la « Présence » d'un téléphone passe à 1 après 18 h, allumer la lumière de
  l'entrée.
- **Intrus sur le réseau** : sur « Appareil inconnu connecté » avec réseau invité « Non », envoyer un
  message avec le nom et l'adresse MAC de l'appareil.
- **Invités** : chaque samedi à 14 h allumer le Wi-Fi invité, à 23 h le couper.
- **Redémarrage hebdomadaire** : chaque lundi à 4 h, « Redémarrer un Deco » sur un satellite qui a
  tendance à ralentir.

## Dépannage

- **« Mot de passe refusé »** : vérifiez le mot de passe de l'identifiant TP-Link **propriétaire** (pas
  un gestionnaire). La lecture est suspendue : corrigez le mot de passe, ou lancez « Tester la
  connexion ».
- **« Connexion refusée »** : le Deco bloque la connexion un moment après des mots de passe faux.
  Patientez quelques minutes.
- **« La session a été reprise par une autre connexion »** : quelqu'un s'est connecté à la page web du
  Deco pendant une lecture. La lecture suivante se reconnecte ; fermez la page web quand vous avez
  fini.
- **L'appli Deco vous déconnecte** : le compte propriétaire de l'appli et l'intégration partagent le
  même administrateur. Utilisez un compte gestionnaire dans l'appli, comme le conseille TP-Link.
- **« Pas de réponse »** : vérifiez l'adresse IP du Deco principal (appli Deco) et que Gladys
  l'atteint. Certains firmwares ne répondent qu'en `https://` : l'intégration suit cette redirection
  d'elle-même.
- **« Ne répond pas comme le Deco principal »** : l'adresse n'est pas celle du Deco principal, ou le
  firmware utilise une ancienne connexion (Deco S7, de vieux firmwares) que l'intégration ne prend pas
  en charge.
- Journaux : **Intégrations → TP-Link Deco → Journaux** ; `LOG_LEVEL=debug` montre chaque lecture.

## Limites

- **Développée sans le matériel** : le protocole suit l'intégration Home Assistant `tplink_deco` ;
  signalez toute différence avec votre modèle.
- Le Deco n'accepte **qu'une session d'administration** : l'intégration et la page web du Deco
  s'interrompent l'une l'autre pendant que l'une d'elles lit.
- Les firmwares à l'ancienne connexion chiffrée (HTTP 401 sur les clés, Deco S7) ne sont pas pris en
  charge.
- La perte du Deco principal lui-même apparaît comme « Deco principal injoignable » sur l'intégration,
  pas comme un déclencheur « Deco hors ligne » : les satellites ne sont vus qu'à travers lui.
- La présence dépend du téléphone qui reste sur le Wi-Fi : les téléphones qui changent d'adresse MAC
  demandent une adresse fixe (adresse privée désactivée) pour ce réseau.
- Pas de cloud : le Deco doit être joignable sur le réseau local ; le cloud TP-Link n'est jamais utilisé.
