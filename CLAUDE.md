# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/hub.test.js              # one file
node --test --test-name-pattern "parity"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        registers every SDK handler on the hub (index.js and tests share it)
src/hub.js                        the server record: reads on a timer, states, transports, events, commands
src/devices.js                    device types, feature blueprints, external ids, discovery payloads
src/alerts.js                     scene-trigger bookkeeping (disks, parity, containers, notifications)
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    the `unraid` dashboard widget (manifest `widgets`)
src/texts.js                      every text sent to Gladys, in en/fr/de/es
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/store.js, src/logs.js         /data persistence, de-duplicated log lines
src/unraid/http.js                the only network code (POST, no redirect followed)
src/unraid/client.js              GraphQL client: redirects, errors, capabilities, groups, commands
src/unraid/queries.js             the GraphQL documents, built from the server's capabilities
src/unraid/model.js               API answers → snapshot (units, sleeping disks, Gladys' containers)
gladys-assistant-integration.json manifest: name, config_schema, actions, triggers, widget...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake Unraid
test/helpers/fakeUnraid.js        graphql-js on the schema subset (test/fixtures/unraid/)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in four languages (English, French, German with
  "du", Spanish with "usted"): action messages, manifest texts, feature names,
  widget texts and `docs/{en,fr,de,es}.md`, kept in sync (`test/i18n.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Unraid (propre à ce dépôt)

- **API lue** : l'API GraphQL officielle (`unraid-api`, dépôt `unraid/api`), intégrée à Unraid
  **7.2+** (plugin Unraid Connect avant), `POST <serveur>/graphql`, en-tête `x-api-key`. Clé créée
  dans Settings → Management Access → API Keys ; rôle **Viewer** pour lire, droits **Docker** et
  **VMs** (`update:any`) pour les commandes. Mutations sur conteneur : `UPDATE_ANY` sur `DOCKER`.
- **« Use SSL/TLS »** : « No » répond en HTTP ; « Yes » redirige en HTTPS même hôte (certificat
  auto-signé : option « Accepter les certificats auto-signés ») ; « Strict » redirige vers
  `https://<ip-en-tirets>.<hash>.myunraid.net`, nom que **beaucoup de box bloquent** (protection
  DNS rebinding) → erreur `dns` dédiée. Le client ne suit que ces deux redirections (la clé part
  avec chaque requête), repart de l'adresse saisie après un échec réseau, et passe en HTTPS sur le
  400 « plain HTTP request was sent to HTTPS port » de nginx. Le hash `myunraid.net` n'est pas
  écrit dans les logs (`hostForLog`).
- **Introspection** : l'API refuse `__schema` (et l'opération `IntrospectionQuery`) hors de son
  bac à sable, mais **accepte `__type(name:)`** : les champs disponibles sont lus ainsi
  (`CAPABILITIES_QUERY`), toutes les 6 h, et à nouveau sur une erreur de validation ; en cas de
  refus, client « permissif » (champs de l'API actuelle). Une requête qui nomme un champ inconnu
  est refusée **entière** (HTTP 400, `GRAPHQL_VALIDATION_FAILED`, Apollo 4).
- **Un `Query.<champ>` non nul qui échoue annule toute la réponse** (`data: null`) : une requête
  par groupe (server, metrics, array, docker, vms, ups, notifications). Docker ou le gestionnaire
  de VM arrêtés ne cassent que leur groupe ; seul l'échec du groupe `array` rend le serveur
  illisible.
- **Ne jamais réveiller un disque** : `disks { temperature }` et `metrics.temperature` passent
  par `smartctl` (leçon de ha-unraid) ; seuls les emplacements de `array` sont lus (température
  lue par emhttp, `null` pendant la veille, `isSpinning`). `test/queries.test.js` le fige.
- **Pièges de l'API** : `parityCheckStatus.errors`, `running` et `paused` ne sont **pas remplis**
  (seuls `status`, `progress`, `duration`, `date`, `speed` le sont) : les erreurs viennent de
  `vars.sbSyncErrs`, l'opération de `vars.mdResyncAction` (`check P`, `recon D5`, `clear`).
  `capacity.kilobytes` est en **chaînes**. Les `id` sont préfixés `<serverId>:` en sortie et
  acceptés tels quels en entrée. `ArrayDisk.temp` vaut `null` pour un disque en veille.
  `metrics.memory.percentTotal` est déjà hors cache. Les conteneurs sont tous listés (arrêtés
  compris), avec `labels` ; le CPU et la mémoire par conteneur n'existent que par la
  souscription `dockerContainerStats` (non lue). Aucune info de mise à jour d'Unraid lui-même.
- **Identités** : emplacement de config (1) ; disque = **nom d'emplacement** (`disk3`, suit le slot
  comme Unraid) ; conteneur = **nom** (l'id change à chaque mise à jour) ; VM = UUID ; onduleur =
  id (haché s'il contient des espaces). Un appareil n'est jamais identifié par un id préfixé.
- **Fonctionnalités « collantes »** : une fonctionnalité `optional` n'existe qu'une fois valuée,
  puis reste (mémorisée dans `/data`, clé `seen`) : un groupe en échec ne change pas la structure
  (pas de « Mettre à jour » qui clignote).
- **Prudence des commandes** : conteneur start/stop/restart, VM start/stop (ACPI, jamais
  `forceStop`) ; rien sur la matrice, la parité, le serveur. Les conteneurs de Gladys (image
  `gladysassistant/gladys`, labels `io.gladysassistant.external-integration` /
  `io.gladysassistant.container`) sont en lecture seule. Un arrêt demandé par Gladys ne déclenche
  pas « Conteneur arrêté » (pas de boucle de scène). Stop et Restart du widget demandent
  confirmation (`confirm: true`, présent dès 5.1.0).
- **Non vérifié sur un vrai Unraid** (session sans matériel) : la réponse exacte à une clé
  refusée (HTTP 401 ou erreur GraphQL `UNAUTHENTICATED`, les deux sont gérés), à un droit manquant
  (`FORBIDDEN`), le format réel des `BigInt` (nombre ou chaîne, les deux sont lus), les champs
  d'un vrai onduleur, la redirection `myunraid.net` sur un vrai réseau.
- **Tests** : le faux Unraid exécute avec `graphql-js` (dépendance de dev) un **sous-ensemble du
  schéma officiel** (`test/fixtures/unraid/schema.graphql` : noms de types et de champs seulement,
  l'API est GPL-2.0) sur `tower.json`. Pour le régénérer depuis une version plus récente de
  `api/generated-schema.graphql`, garder les mêmes types et sans descriptions.

- **Relecture indépendante (13/10/2026)**, corrigé et figé par des tests : l'historique des
  notifications gardait les plus anciennes (des notifications non lues revenaient dans la liste
  et se redéclenchaient) ; un arrêt demandé par Gladys pouvait déclencher « Conteneur arrêté » avec
  un intervalle de 5 min (fenêtre portée à deux lectures + 1 min, et relecture fraîche après la
  commande) ; « Conteneur arrêté » exige deux lectures **et** une minute (une mise à jour à 15 s
  d'intervalle) ; les conteneurs de Gladys sont aussi reconnus par leur **nom** (`gladys`,
  `gladys-…`), l'image pouvant s'afficher en `sha256:` et `labels` manquer ; `vars` (erreurs de
  parité) a sa propre requête, et une parité finie sans compteur lisible attend deux lectures avant
  d'annoncer ; un enregistrement remplacé pendant l'envoi des événements ne publie plus rien.

## Vérifié en Docker (sans vrai Unraid)

Le 13/10/2026, image de l'intégration lancée avec les contraintes du bac à sable de Gladys
(`--cap-drop ALL --security-opt no-new-privileges --read-only --memory 256m --pids-limit 256`,
volume `/data`, réseau en pont `gladys-test-unraid`, aucun port publié), contre le faux Unraid du
dépôt (`test/helpers/fakeUnraid.js`, graphql-js sur le sous-schéma officiel) servi en HTTP réel
par un second conteneur verrouillé (script hors dépôt).

- **Sans Gladys** : reconnexion du SDK en backoff, pas de plantage, ni jeton ni clé dans les logs,
  ~20 Mo au repos, arrêt propre sur SIGTERM (code 0).
- **Client réel** : sept groupes lus, capacités lues par `__type` ; clé refusée (`auth`), hôte
  inconnu, port fermé, `https://` sur un port HTTP (`unreachable`), 502 (`api_down`), page HTML
  (`not_unraid`), Docker arrêté (seul le groupe `docker` en erreur), clé en lecture seule
  (`forbidden` sur une commande).
- **Intégration complète** (faux Gladys du SDK, noms en français) : 16 appareils, 67 états à
  l'ajout, textes d'état, badges, widget validé (`validateWidgetContent`), « Tester la
  connexion », « État du serveur Unraid », redémarrage de plex et démarrage d'une VM reçus par le
  serveur, arrêt du conteneur `gladys` refusé, texte « Démarrée · contrôle de parité 30 % »,
  notification et « Conteneur arrêté » émis. Puis, **dans un second processus** (état gardé dans
  `/data`, sans la clé) : le contrôle de parité terminé pendant l'arrêt est annoncé au démarrage
  (`errors`, 5 erreurs, 121 min).
- **Non vérifié** : un vrai Unraid (réponses exactes de l'API, `BigInt`, droits, onduleur réel),
  les redirections « Yes »/« Strict » sur un vrai réseau, une vraie instance Gladys (rendu du
  widget, éditeur de scènes).

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).
