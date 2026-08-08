# Graph Report - .  (2026-07-31)

## Corpus Check
- Corpus is ~39,691 words - fits in a single context window. You may not need a graph.

## Summary
- 406 nodes · 596 edges · 25 communities (22 shown, 3 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 40 edges (avg confidence: 0.53)
- Token cost: 51,921 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 23
- Community 24

## God Nodes (most connected - your core abstractions)
1. `parseQlikScript()` - 23 edges
2. `streamChat()` - 10 edges
3. `qrsRequest()` - 9 edges
4. `buildGlobalLineage()` - 9 edges
5. `runAnalysis()` - 8 edges
6. `auditConnections()` - 8 edges
7. `parseLoadStatement()` - 8 edges
8. `scripts` - 7 edges
9. `qrsRequest()` - 7 edges
10. `auditApps()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Refonte Simplification Qlik Lineage App` --references--> `Qlik Lineage App`  [EXTRACTED]
  PROMPT-REFONTE.md → README.md
- `Parser local comme mode par defaut` --conceptually_related_to--> `Flux d'analyse avec Claude`  [INFERRED]
  PROMPT-REFONTE.md → README.md
- `Page HTML racine Qlik Lineage App` --references--> `Qlik Lineage App`  [INFERRED]
  client/index.html → README.md
- `importOne()` --calls--> `runAnalysis()`  [EXTRACTED]
  server/routes/qlik.js → server/services/analyzeService.js
- `runLocalAnalysis()` --calls--> `parseQlikScript()`  [EXTRACTED]
  server/services/analyzeService.js → server/services/localParser.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Corrections de bugs prioritaires P0** — prompt_refonte_p0_cache_mode_bug, prompt_refonte_p0_chat_routing_bug, prompt_refonte_p0_import_job_bug [EXTRACTED 1.00]
- **Audits croises QRS x lineage local formant le module de gouvernance** — prompt_refonte_app_cleanup_audit, prompt_refonte_connection_audit, prompt_refonte_user_owner_audit, prompt_refonte_app_objects_audit, prompt_refonte_governance_synthesis [EXTRACTED 1.00]
- **Pipeline de nettoyage des taches de reload** — prompt_refonte_task_chains, prompt_refonte_chain_qvd_crossing, prompt_refonte_cleanup_score, prompt_refonte_taskstab_refonte [EXTRACTED 1.00]

## Communities (25 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (28): adminApi, globalApi, json(), post(), qlikApi, GlobalGraph(), layoutGraph(), QVD_COLORS (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (21): api, appsApi, json(), post(), put(), chatApi, App(), APP_TABS (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (30): Page HTML racine Qlik Lineage App, P3.2 - Detection d'apps a nettoyer, P3.1 - Enrichissement de l'import d'apps, P3.5 - Audit des objets d'apps, P4.2 - Croisement chaines de taches x lineage QVD, P4.3 - Score de nettoyage et recommandations, P3.3 - Audit des connexions de donnees, P2.2 - Indicateur de couverture du parser (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.14
Nodes (28): buildMask(), classifyTable(), cleanName(), CONTROL_LABELS, describeTransformation(), detectModel(), extractIncludes(), extractLabel() (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (24): certClient, clientFor(), db, express, importJob, importOne(), proxyClient, router (+16 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (21): repairJSON(), chunkScript(), mergeAnalyses(), getAnalyzePrompt(), express, router, { runAnalysis }, analyzeChunk() (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (21): Anthropic, client, getChatSystemPrompt(), db, express, router, { streamChat }, client (+13 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (23): autoprefixer, devDependencies, autoprefixer, postcss, tailwindcss, @types/react, @types/react-dom, vite (+15 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (20): @anthropic-ai/sdk, cors, dotenv, express, multer, dependencies, @anthropic-ai/sdk, cors (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (17): { DatabaseSync }, db, dbDir, fs, migrations, path, db, express (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (18): { buildGlobalLineage }, express, router, buildGlobalLineage(), db, escapeRe(), getAllAnalyses(), mergeWildcards() (+10 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (9): applyDagreLayout(), buildGraphData(), injectCSS(), LineageGraph(), LOAD_ICON, LOAD_LABELS, NODE_TYPES, LineageTab() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (15): dependencies, @dagrejs/dagre, highlight.js, lucide-react, react, react-dom, react-hot-toast, reactflow (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (13): concurrently, devDependencies, concurrently, name, private, scripts, build, dev (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.22
Nodes (12): connect(), getAppScript(), { loadCerts }, WebSocket, fs, https, listApps(), loadCerts() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.30
Nodes (13): extractSessionCookie(), formsLogin(), getAppScript(), getSession(), hostOf(), https, listApps(), makeXrfKey() (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.28
Nodes (3): categorize(), norm(), SourcesTab()

### Community 17 - "Community 17"
Cohesion: 0.50
Nodes (3): app, cors, express

## Knowledge Gaps
- **143 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parseQlikScript()` connect `Community 3` to `Community 10`, `Community 5`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 12` to `Community 7`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07084785133565621 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08048780487804878 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08275862068965517 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.13793103448275862 - nodes in this community are weakly interconnected._