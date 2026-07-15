# PROMPT — Refonte simplification Qlik Lineage App

> Prompt à donner à un agent IA (Claude Code / Cowork) travaillant dans le dossier `qlik-lineage-app`.
> Objectif général : **simplifier l'application, la rendre plus professionnelle et lisible**, sans ajouter de complexité. Priorité aux tableaux clairs plutôt qu'aux visualisations complexes.

---

## Contexte

Application locale de data lineage Qlik Sense : serveur Express + SQLite (`server/`), client React + Vite + Tailwind (`client/`). Deux modes d'analyse : parser local regex (`server/services/localParser.js`) et analyse Claude API. Import d'apps depuis un serveur Qlik (QRS + Engine API). Vue globale inter-apps (QVD produits/consommés).

**Philosophie de la refonte :** le parser LOCAL devient le mode principal et par défaut. Claude devient une option d'enrichissement. L'interface privilégie les tableaux filtrables et les listes groupées — pas de graphe obligatoire.

---

## P0 — Corrections de bugs (à faire en premier)

### P0.1 — Cache d'analyse qui bloque le mode Claude
Fichier : `server/services/analyzeService.js` (~L111-124).
Le cache est retourné dès que le hash du script correspond, **sans vérifier le mode**. Résultat : une app analysée en local ne peut plus jamais être analysée par Claude (hash identique → cache local renvoyé).
**Fix :** ajouter la condition `existing.analyze_mode === 'claude'` au cache hit quand le mode demandé est `claude`.

### P0.2 — Routage chat local trop agressif
Fichier : `server/services/chatService.js` (~L39-56).
`LOCAL_PATTERNS` intercepte toute question contenant « table », « source », etc. — même une question complexe destinée à Claude reçoit une liste brute.
**Fix :** ne router en local que si le message est court (< 80 caractères) OU correspond à une question simple type « liste les tables ». Sinon, fallback Claude. Ajouter un bouton/toggle côté client « forcer Claude » sur le chat.

### P0.3 — Job d'import bloqué en cas d'erreur
Fichier : `server/routes/qlik.js` (`runImportJob`).
Si le job crash hors du try interne, `importJob.running` reste `true` → 409 permanent.
**Fix :** envelopper la boucle dans `try/finally` avec remise à `false`.

---

## P1 — Simplification de l'interface (simple et pro)

### P1.1 — Sidebar : filtres de sélection d'app
Fichier : `client/src/components/AppSidebar.jsx`.
Ajouter en haut de la sidebar :
- **Champ de recherche** texte (filtre sur le nom, insensible à la casse/accents).
- **Filtre par stream** (select alimenté par les streams distincts des apps importées ; masqué si aucun stream).
- **Filtre par état** : `Analysée / Non analysée / Toutes` (nécessite d'exposer `analyzed` dans `GET /api/apps` — jointure simple avec `analyses`).
- Compteur « X apps affichées / Y au total ».
Design : compact, une ligne recherche + une ligne de 2 selects. Pas de dropdown custom — `<select>` natifs stylés Tailwind suffisent.

### P1.2 — Retirer la complexité visuelle du graphe
Fichiers : `client/src/components/LineageGraph.jsx`, `LineageTab.jsx`, `GlobalTab.jsx`.
- Le graphe ne doit **plus être l'affichage par défaut**. Par défaut : tableau.
- Dans `LineageTab` : tableau de lineage filtrable en premier, graphe accessible via un bouton discret « Vue graphe » (ou supprimé si non maintenu).
- Dans `GlobalTab` : remplacer le graphe par **3 tableaux simples** : QVD (nom, statut, producteurs, consommateurs, chemins), Apps (nom, rôle, QVD produits/consommés), Alertes (orphelins, externes, doublons d'extraction). Chaque tableau avec recherche + tri par colonne.
- Règle générale : **une information = un composant**. Ne jamais empiler stats + graphe + tableau + alertes dans le même écran sans onglets ou sections repliables.

### P1.3 — Nouvel onglet « Sources » dédié
Nouveau fichier : `client/src/components/SourcesTab.jsx`. L'ajouter aux `APP_TABS` dans `App.jsx`.
Aujourd'hui les sources sont mélangées dans la vue d'ensemble. Créer un onglet dédié qui présente `analysis.sourceMeta` **groupé par type**, dans cet ordre, chaque groupe étant une section repliable avec compteur :

1. **🗄️ Bases SQL** — regroupées par connexion (`LIB CONNECT TO`). Pour chaque connexion : liste des tables extraites, requête SQL (repliée, expandable), tables Qlik alimentées (`usedBy`), nombre de champs.
2. **📦 QVD** — séparer visuellement **QVD lus** (LOAD FROM) et **QVD écrits** (STORE INTO, depuis `analysis.stores`). Colonnes : nom, chemin complet, tables concernées, champs.
3. **📄 Fichiers plats** — Excel / CSV / TXT : nom, chemin, tables alimentées.
4. **🔧 Interne** — Resident / Inline / Autogenerate : table source → table cible.

Chaque ligne : badge de type coloré (une couleur par type, sobre), chemin en `monospace` tronqué avec tooltip du chemin complet, clic → détail des champs.
En haut de l'onglet : une barre de synthèse simple (« 3 connexions SQL · 12 QVD lus · 4 QVD écrits · 2 fichiers ») + champ de recherche filtrant toutes les sections.

### P1.4 — Vue d'ensemble allégée
Fichier : `client/src/components/OverviewTab.jsx`.
Retirer la liste des sources (déplacée dans l'onglet Sources). Garder uniquement : cartes de stats (tables, champs, sources, clés synthétiques), le résumé texte, et les alertes (clés synthétiques à risque, Section Access). Maximum un écran sans scroll pour une app moyenne.

### P1.5 — Mode local par défaut
Fichiers : `client/src/hooks/useAppData.js` (L10 : `useState('claude')` → `'local'`), `server/routes/analyze.js` (défaut `'local'`), `server/routes/qlik.js` (déjà `'local'` à l'import — conserver).
Le bouton d'analyse principal = « Analyser » (local, instantané, gratuit). Claude = bouton secondaire « Enrichir avec Claude » visible seulement si une clé API est configurée (`GET /api/health` peut exposer `hasApiKey: !!process.env.ANTHROPIC_API_KEY`).

---

## P2 — Amélioration du parser local (très important)

Fichier : `server/services/localParser.js`. Objectif : plus fiable et plus **transparent**, pas plus complexe.

### P2.1 — Refactorer en étapes nommées
Restructurer `parseQlikScript` en pipeline lisible : `resolveVariables → removeComments → extractBlocks → parseBlocks → buildLineage → buildReport`. Une fonction = une responsabilité. Pas de changement de format de sortie (le client en dépend), seulement de la clarté interne + ajouts ci-dessous.

### P2.2 — Indicateur de couverture (transparence)
Le parser doit dire **ce qu'il n'a pas compris** au lieu d'échouer en silence. Ajouter dans `metadata` :
```json
"coverage": {
  "loadStatements": 24,        // nb de LOAD détectés dans le script
  "parsedBlocks": 21,          // nb rattachés à une table nommée
  "unparsed": [                // LOAD non rattachés, avec n° de ligne et raison
    { "line": 132, "reason": "LOAD * (champs non listés)" },
    { "line": 210, "reason": "table sans nom (concaténation implicite)" }
  ],
  "unresolvedVariables": ["vPathQVD", "vAnnee"],  // $(var) restées non résolues
  "score": 87                  // parsedBlocks / loadStatements en %
}
```
Afficher le score dans la vue d'ensemble (badge : vert ≥ 90 %, orange ≥ 70 %, rouge en dessous) avec la liste des lignes non parsées au clic.

### P2.3 — Cas manquants à couvrir (par ordre de fréquence terrain)
1. **`LOAD *`** : détecter, créer une entrée lineage `fieldQlik: '*'` avec `transformation: 'Tous les champs de la source'` — et le signaler dans `coverage.unparsed` si la source est inconnue.
2. **CONCATENATE explicite** (`CONCATENATE (Table)` ou `CONCATENATE LOAD` après une table) : rattacher les champs à la table cible au lieu de les perdre.
3. **Includes** (`$(Include=...)` / `$(Must_Include=...)`) : ne pas tenter de les résoudre — les lister comme source de type `include` dans `sourceMeta` (chemin du fichier inclus), signaler dans coverage.
4. **DROP TABLE** : tracer les tables supprimées (utile pour distinguer tables temporaires vs finales — marquer `isDropped: true` sur les tables concernées ; le modèle final ne montre que les non-droppées, avec un toggle « inclure temporaires »).
5. **Préfixes de LOAD combinés** (`NoConcatenate`, `Mapping`, qualificateurs multiples) : le regex de bloc doit tolérer plusieurs mots-clés avant `LOAD`.

### P2.4 — Tests unitaires du parser
Nouveau fichier : `server/services/localParser.test.js` (node:test, zéro dépendance). Un cas de test par pattern : LOAD simple, LOAD *, resident, join resident, mapping, concatenate, store, variables imbriquées, include, SQL embarqué, section access. C'est la garantie anti-régression avant toute modif future du parser.

### P2.5 — Sources « intelligentes » côté serveur
Enrichir `sourceMeta` pour alimenter le nouvel onglet Sources sans logique côté client :
- `category`: `'sql' | 'qvd_read' | 'qvd_write' | 'file' | 'internal' | 'include'`
- Pour SQL : regrouper par `connection` (une entrée par connexion avec ses tables en enfants).
- Pour QVD : rapprocher lus/écrits par nom de fichier (même logique que `globalLineage.qvdKey`) → un QVD écrit puis relu dans le même script est marqué `selfConsumed: true`.
- Détection d'environnement simple : si le chemin contient `dev|test|qa|preprod|prod` (insensible casse), remplir `environmentHint`.

---

## P3 — Exploitation complète de l'API QRS (gouvernance serveur)

L'API QRS est déjà appelée (`/app/full`) mais on ne garde que 6 champs, et un seul endpoint est exploité. QRS expose l'inventaire complet du serveur — l'objectif est d'en faire un **module de gouvernance** : tout croiser avec le lineage local pour produire des diagnostics actionnables. Règle : un endpoint n'est appelé que s'il alimente un diagnostic concret — pas de collecte pour collecter.

### P3.1 — Enrichir l'import d'apps
Fichiers : `server/lib/qrsClient.js` + `proxyClient.js` (`listApps`), `server/database.js` (migrations), `server/routes/qlik.js` (`importOne`).
Extraire de `/app/full` et stocker sur chaque app locale :
- `file_size` (`fileSize`, octets) — repérer les apps obèses
- `created_date`, `modified_date`, `publish_time`
- `description`
- `tags` (noms joints par `|`)
- `custom_properties` (JSON `[{name, value}]`) — souvent utilisées pour marquer criticité/propriétaire métier
Migrations : colonnes ajoutées à `apps` via le tableau `migrations` existant (pattern déjà en place).

### P3.2 — Détection d'apps à nettoyer (côté serveur Qlik)
Nouvelle route `GET /api/qlik/apps/cleanup` (dans `routes/qlik.js`, service dans `services/appAudit.js`) qui croise `/app/full` avec le lineage local et retourne par app des drapeaux :
- `jamais_rechargee` : `lastReloadTime` vide
- `rechargement_ancien` : dernier reload > 90 jours (seuil paramétrable `?staleDays=90`)
- `non_publiee_ancienne` : app non publiée, non modifiée depuis > 90 jours (brouillons abandonnés dans les espaces perso)
- `sans_tache` : aucune reload task associée (croiser avec `/reloadtask/full` déjà récupéré)
- `volumineuse` : `fileSize` > seuil (500 Mo par défaut)
- `doublon_nom` : plusieurs apps de même nom (versions copiées : « Ventes (2) », « Copy of… » — normaliser le nom avant comparaison)
Affichage : tableau simple dans `GlobalTab` (section « Audit apps serveur »), tri par nombre de drapeaux, export CSV. Pas de graphe.

### P3.3 — Connexions de données (`/dataconnection/full`) — croisement le plus rentable
Nouveau service `server/services/connectionAudit.js` + route `GET /api/qlik/connections`.
QRS donne toutes les connexions : `name`, `connectionstring`, `type` (folder/OLEDB/ODBC/REST…), `owner`, dates. Le parser local connaît déjà les `LIB CONNECT TO 'x'` et les chemins `lib://x/...` utilisés par chaque script. Croiser les deux :
- **`inutilisee`** : connexion déclarée sur le serveur mais référencée par aucun script analysé → candidate à suppression (préciser la couverture : « sur N apps analysées »)
- **`doublon`** : plusieurs connexions dont la `connectionstring` normalisée pointe vers le même serveur/base/dossier (fréquent : chaque développeur crée la sienne) → à fusionner
- **`fantome`** : `lib://x` référencé dans un script mais connexion absente du serveur → le script plantera au prochain reload
- **`personnelle`** : connexion non publiée appartenant à un utilisateur, utilisée par des apps publiées → risque si l'utilisateur part
- Par connexion : liste des apps qui l'utilisent (le « lineage de connexion » — qui touche à quelle base)
UI : section « Connexions » dans GlobalTab — tableau avec badges, tri, export. C'est le croisement à la plus forte valeur d'audit après les QVD.

### P3.4 — Propriétaires et utilisateurs (`/user/full`)
QRS donne `inactive`, `removedExternally`, `blacklisted` par utilisateur. Croiser avec les owners d'apps, de tâches et de connexions :
- **`proprietaire_parti`** : app/tâche/connexion dont le owner est inactif ou supprimé de l'annuaire → objets zombies, personne ne les maintient
- **`concentration`** : un utilisateur possède > N % des objets (risque de dépendance à une personne)
Ajouter le drapeau `proprietaire_parti` aux audits P3.2 (apps), P3.3 (connexions) et P4 (tâches) — c'est un critère de nettoyage transverse.

### P3.5 — Objets d'apps (`/app/object/full`, filtré par type)
Appel par app importée (filtre `app.id eq {guid}`), stocké en base (table `app_objects` : app_id, object_type, name, owner, published, approved).
- Compter feuilles publiées / communautaires / privées par app → **`app_sans_feuille`** : app publiée sans aucune feuille = probablement une app batch (confirme le `role` du lineage global) ou une app abandonnée
- **`proliferation_communautaire`** : > N feuilles communautaires sur une app → gouvernance à reprendre
- Master measures/dimensions (`measure`, `dimension`) : les compter par app — première brique du futur lineage aval (quel champ est utilisé dans quelle master measure), sans analyser les expressions pour l'instant
À faire pendant l'import (importOne) pour ne pas multiplier les appels à la volée.

### P3.6 — Synthèse « Gouvernance serveur » (vue unique)
Nouvelle route `GET /api/qlik/governance` qui agrège les audits P3.2 à P3.5 + P4 en un seul JSON de synthèse, et un onglet/section UI correspondant :
- 6 cartes de compteurs : apps à nettoyer, tâches mortes, connexions inutilisées, connexions doublons, objets sans propriétaire, QVD orphelins
- Chaque carte cliquable → le tableau détaillé correspondant
- **Export Excel global** (un onglet par audit) : le rapport de mission complet en un clic
Cache : les appels QRS agrégés sont mis en cache serveur 10 min (Map en mémoire, clé = host) pour ne pas marteler le serveur Qlik à chaque navigation.

---

## P4 — Module nettoyage des tâches de reload (objectif prioritaire)

`services/taskService.js` détecte déjà : désactivée, jamais exécutée, en échec, sans déclencheur, inactive 30j, chaîne morte, production QVD dupliquée. Ce module l'étend en **outil de nettoyage** complet : reconstruire les chaînes, identifier les tâches mortes, produire un rapport actionnable.

### P4.1 — Reconstruction des chaînes de tâches (task paths)
Fichier : `server/services/taskService.js` — nouvelle fonction `buildTaskChains(tasks)`.
Les `compositeevents` donnent les liens « B démarre après A » (déjà récupérés dans `triggers[].after`, mais par **nom** — récupérer aussi l'**id** de la tâche amont depuis `compositeRules[].reloadTask.id` pour un graphe fiable, les noms n'étant pas uniques).
Construire :
- **Arêtes** : `after[] → task` (une tâche peut avoir plusieurs amonts : règles AND/OR — conserver `ruleType`).
- **Racines** : tâches déclenchées par un `schemaevent` (planification horaire).
- **Chaînes complètes** : parcours en profondeur depuis chaque racine → `chains: [{ rootTask, path: [taskId...], schedule, totalDurationMs }]` (durée = somme des `durationMs` connus).
- **Détections structurelles** :
  - `chaine_cassee` : un maillon amont est désactivé ou en échec → tout l'aval ne tournera jamais (lister l'aval impacté)
  - `cycle` : détection de circularité (A→B→A) — rare mais bloquant
  - `orpheline_de_chaine` : tâche avec déclencheur composite dont la tâche amont n'existe plus
  - `hors_chaine` : tâche active sans planification ET sans chaîne → ne tourne que manuellement

### P4.2 — Croisement chaînes × lineage QVD (l'ordre est-il correct ?)
La valeur unique de l'app : on connaît qui PRODUIT et qui CONSOMME chaque QVD (`buildGlobalLineage`). Croiser avec les chaînes :
- `ordre_incorrect` : l'app de la tâche X consomme un QVD produit par l'app de la tâche Y, mais X n'est **pas en aval** de Y dans une chaîne (ni planifiée après) → risque de données périmées à chaque reload
- `consommateur_sans_producteur_planifie` : X consomme un QVD dont le producteur n'a aucune tâche active → données figées
- `chaine_morte` (existant, à conserver) : tout ce que produit l'app est orphelin
Chaque détection : lister les QVD et apps concernés, pas seulement un booléen.

### P4.3 — Score de nettoyage et recommandations
Pour chaque tâche, calculer `cleanupScore` (0-100) et une `recommendation` :
- `supprimer` : désactivée + jamais exécutée, ou app supprimée, ou orpheline de chaîne
- `verifier` : en échec répété, inactive > 30j, chaîne cassée, ordre incorrect
- `conserver` : active, récente, dans une chaîne saine
Retourner aussi un résumé chiffré : « X tâches supprimables, Y à vérifier, gain estimé : Z reloads/jour en moins ».

### P4.4 — UI : refonte de TasksTab (simple, pas de graphe)
Fichier : `client/src/components/TasksTab.jsx`.
- **Vue « Chaînes »** : liste indentée (arbre texte), une racine par ligne avec son horaire, les maillons indentés dessous avec statut coloré (✓ succès / ✗ échec / – désactivée) et durée. Un maillon cassé colore toute la descendance en orange.
- **Vue « Nettoyage »** : tableau trié par `cleanupScore` décroissant — colonnes : tâche, app, recommandation (badge `supprimer`/`verifier`/`conserver`), problèmes (badges), dernier run, durée. Filtres : par recommandation, par stream, recherche texte.
- **Export CSV du rapport de nettoyage** (route `GET /api/qlik/tasks/export`) : le livrable qu'on remet au client en mission d'audit.
- Bascule entre les deux vues par 2 boutons segmentés en haut. Pas de graphe de dépendances visuel — l'arbre indenté suffit.

---

## P5 — Idées (optionnel, seulement si P0-P4 terminés)

1. **Export Excel de l'onglet Sources** (un onglet par catégorie) — plus utile en mission qu'un CSV brut.
2. **Comparaison de deux analyses** du même script (avant/après modif) : champs ajoutés/supprimés — simple diff des `lineage` par clé `fieldQlik|tableQlik`.
3. **Badge « fraîcheur »** sur chaque app : date du dernier script importé vs date du dernier reload serveur (`last_reload`) — signale les analyses obsolètes.
4. **Recherche globale** (champ unique en haut) : taper un nom de champ → toutes les apps où il apparaît (via les `lineage` stockés en base).
5. **Page « Impact »** : sélectionner une source (table SQL ou QVD) → liste des apps et champs impactés si elle change. C'est le cas d'usage n°1 en audit, et c'est un simple filtre inversé sur les données existantes.

---

## Contraintes générales

- **Ne pas ajouter de dépendance** npm sans nécessité absolue. Pas de librairie de graphe supplémentaire.
- **Ne pas casser le format JSON** des analyses existantes en base (compatibilité ascendante : nouveaux champs optionnels uniquement).
- Style : Tailwind existant (thème sombre gray-950), sobre, pas d'emojis dans les tableaux de données (garder les badges texte colorés), textes UI en français.
- Chaque priorité (P0 à P4) doit laisser l'app **fonctionnelle et committable** indépendamment.
- Les routes QRS doivent fonctionner dans les **deux modes d'auth** (certificats et proxy forms) — toujours passer par `clientFor(config)` / `qrsFor(config)`.
- Tout ce qui touche QRS doit dégrader proprement si aucun serveur n'est configuré (message clair, pas de crash).
- Après chaque priorité : vérifier `npm run dev` + tester manuellement l'analyse locale d'un script exemple.
