'use strict';

/**
 * Tests unitaires du parser local — node:test, zéro dépendance.
 * Lancer : node --test server/services/localParser.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { parseQlikScript } = require('./localParser');

test('LOAD simple depuis QVD', () => {
  const r = parseQlikScript(`
DIM_Client:
LOAD
    ClientID,
    Nom AS NomClient
FROM [lib://QVD/clients.qvd] (qvd);
`);
  assert.strictEqual(r.dims.length, 1);
  assert.strictEqual(r.dims[0].name, 'DIM_Client');
  assert.deepStrictEqual(r.dims[0].fields, ['ClientID', 'NomClient']);
  assert.strictEqual(r.dims[0].loadMethod, 'qvd');
  assert.ok(r.sources.includes('clients.qvd'));
  assert.strictEqual(r.metadata.coverage.score, 100);
});

test('LOAD * tracé dans le lineage', () => {
  const r = parseQlikScript(`
FACT_Ventes:
LOAD * FROM [lib://QVD/ventes.qvd] (qvd);
`);
  const star = r.lineage.find(l => l.fieldQlik === '*');
  assert.ok(star, 'LOAD * doit produire une ligne de lineage');
  assert.strictEqual(star.tableQlik, 'FACT_Ventes');
  assert.match(star.transformation, /LOAD \*/);
});

test('RESIDENT', () => {
  const r = parseQlikScript(`
TMP_Base:
LOAD A, B FROM [lib://QVD/base.qvd] (qvd);

DIM_Copie:
LOAD A, B RESIDENT TMP_Base;
`);
  const dim = r.dims.find(t => t.name === 'DIM_Copie');
  assert.ok(dim);
  assert.strictEqual(dim.loadMethod, 'resident');
  assert.strictEqual(dim.residentTable, 'TMP_Base');
});

test('JOIN avec RESIDENT dans le même bloc', () => {
  const r = parseQlikScript(`
FACT_Ventes:
LOAD VenteID, ClientID FROM [lib://QVD/ventes.qvd] (qvd);

LEFT JOIN (FACT_Ventes)
LOAD ClientID, Segment RESIDENT TMP_Clients;
`);
  const rows = r.lineage.filter(l => l.tableSource === 'TMP_Clients');
  assert.ok(rows.length >= 1, 'les champs joints doivent être tracés');
});

test('Mapping LOAD classé en mapping', () => {
  const r = parseQlikScript(`
MAP_Pays:
Mapping LOAD Code, Libelle FROM [lib://QVD/pays.qvd] (qvd);
`);
  assert.strictEqual(r.mappings.length, 1);
  assert.strictEqual(r.mappings[0].name, 'MAP_Pays');
});

test('CONCATENATE explicite rattaché à la table cible', () => {
  const r = parseQlikScript(`
FACT_Ventes:
LOAD VenteID, Montant FROM [lib://QVD/ventes_2024.qvd] (qvd);

CONCATENATE (FACT_Ventes)
LOAD VenteID, Montant, Devise FROM [lib://QVD/ventes_2025.qvd] (qvd);
`);
  const facts = r.facts.filter(t => t.name === 'FACT_Ventes');
  assert.strictEqual(facts.length, 1, 'une seule entrée FACT_Ventes après fusion');
  assert.ok(facts[0].fields.includes('Devise'), 'les champs concaténés sont fusionnés');
  assert.strictEqual(r.metadata.coverage.score, 100, 'le LOAD concaténé est couvert');
});

test('STORE détecté', () => {
  const r = parseQlikScript(`
FACT_Ventes:
LOAD VenteID FROM [lib://QVD/src.qvd] (qvd);
STORE FACT_Ventes INTO [lib://QVD/out/ventes.qvd] (qvd);
`);
  assert.strictEqual(r.stores.length, 1);
  assert.strictEqual(r.stores[0].outputName, 'ventes.qvd');
  const src = r.sourceMeta.find(s => s.name === 'src.qvd');
  assert.strictEqual(src.category, 'qvd_read');
});

test('Variables SET imbriquées résolues', () => {
  const r = parseQlikScript(`
SET vRoot = lib://QVD;
SET vPath = $(vRoot)/prod;

FACT_V:
LOAD X FROM [$(vPath)/ventes.qvd] (qvd);
`);
  assert.ok(r.sources.includes('ventes.qvd'), 'le chemin avec variables imbriquées doit être résolu');
  const src = r.sourceMeta.find(s => s.name === 'ventes.qvd');
  assert.strictEqual(src.environmentHint, 'prod');
});

test('Include listé sans être résolu', () => {
  const r = parseQlikScript(`
$(Must_Include=lib://Scripts/commun.qvs);

DIM_X:
LOAD A FROM [lib://QVD/x.qvd] (qvd);
`);
  assert.deepStrictEqual(r.includes, ['lib://Scripts/commun.qvs']);
  const inc = r.sourceMeta.find(s => s.type === 'include');
  assert.ok(inc, 'l\'include doit apparaître dans sourceMeta');
});

test('SQL embarqué', () => {
  const r = parseQlikScript(`
LIB CONNECT TO 'MaBase';

FACT_Cmd:
LOAD CommandeID, Montant;
SQL SELECT CommandeID, Montant FROM dbo.Commandes;
`);
  const fact = r.facts.find(t => t.name === 'FACT_Cmd');
  assert.ok(fact);
  assert.strictEqual(fact.loadMethod, 'sql');
  assert.strictEqual(fact.connection, 'MaBase');
});

test('Section Access détectée', () => {
  const r = parseQlikScript(`
Section Access;
LOAD * INLINE [ACCESS, USERID
ADMIN, DOMAIN\\admin];
Section Application;

DIM_X:
LOAD A FROM [lib://QVD/x.qvd] (qvd);
`);
  assert.strictEqual(r.metadata.hasSectionAccess, true);
});

test('DROP TABLE marque la table', () => {
  const r = parseQlikScript(`
TMP_Inter:
LOAD A FROM [lib://QVD/a.qvd] (qvd);

DIM_Finale:
LOAD A RESIDENT TMP_Inter;

DROP TABLE TMP_Inter;
`);
  assert.ok(r.droppedTables.includes('TMP_Inter'));
});

test('Coverage signale les LOAD hors bloc', () => {
  const r = parseQlikScript(`
DIM_A:
LOAD X FROM [lib://QVD/a.qvd] (qvd);

LOAD Y FROM [lib://QVD/b.qvd] (qvd);
`);
  assert.ok(r.metadata.coverage.score < 100, 'le LOAD anonyme doit faire baisser le score');
  assert.ok(r.metadata.coverage.unparsed.length >= 1);
});

test('Variables non résolues remontées dans coverage', () => {
  const r = parseQlikScript(`
DIM_A:
LOAD X FROM [$(vCheminInconnu)/a.qvd] (qvd);
`);
  assert.ok(r.metadata.coverage.unresolvedVariables.includes('vCheminInconnu'));
});

test('Clé synthétique détectée avec risque', () => {
  const r = parseQlikScript(`
FACT_V:
LOAD
    A & '|' & B & '|' & C AS CleComposite,
    Montant
FROM [lib://QVD/v.qvd] (qvd);
`);
  assert.strictEqual(r.synthKeys.length, 1);
  assert.strictEqual(r.synthKeys[0].risk, 'haut');
});

// ─── Tests v2 : cas difficiles que la v1 ratait ───────────────────────────────

test('v2: label et LOAD sur la même ligne', () => {
  const r = parseQlikScript(`DIM_Client: LOAD ClientID, Nom FROM [lib://QVD/c.qvd] (qvd);`);
  assert.strictEqual(r.dims.length, 1);
  assert.strictEqual(r.dims[0].name, 'DIM_Client');
  assert.strictEqual(r.metadata.coverage.score, 100);
});

test('v2: tout en minuscules', () => {
  const r = parseQlikScript(`ventes_dim:\nload id_vente, montant from [lib://qvd/v.qvd] (qvd);`);
  const t = [...r.dims, ...r.facts].find(x => x.name === 'ventes_dim');
  assert.ok(t, 'table en minuscules parsée');
  assert.deepStrictEqual(t.fields, ['id_vente', 'montant']);
});

test('v2: commentaires inline dans la liste de champs', () => {
  const r = parseQlikScript(`
DIM_A:
LOAD
    A,        // identifiant
    B AS Bb,  /* libellé */
    C
FROM [lib://QVD/a.qvd] (qvd);`);
  assert.deepStrictEqual(r.dims[0].fields, ['A', 'Bb', 'C']);
});

test('v2: NoConcatenate + WHERE + ORDER BY tolérés', () => {
  const r = parseQlikScript(`
TMP_X:
NoConcatenate LOAD A, B RESIDENT Src WHERE A > 0 ORDER BY A;`);
  const row = r.lineage.find(l => l.tableQlik === 'TMP_X');
  assert.ok(row);
  assert.strictEqual(row.tableSource, 'Src');
});

test('v2: INLINE — extraction des en-têtes', () => {
  const r = parseQlikScript(`
DIM_Statut:
LOAD * INLINE [
Code, Libelle
1, Ouvert
2, Fermé
];`);
  const t = r.dims.find(x => x.name === 'DIM_Statut');
  assert.deepStrictEqual(t.fields, ['Code', 'Libelle']);
});

test('v2: JOIN depuis un QVD rattaché à la cible avec sa vraie source', () => {
  const r = parseQlikScript(`
FACT_V:
LOAD VenteID, ClientID FROM [lib://QVD/v.qvd] (qvd);

LEFT JOIN (FACT_V)
LOAD ClientID, Segment FROM [lib://QVD/clients.qvd] (qvd);`);
  const f = r.facts.find(x => x.name === 'FACT_V');
  assert.ok(f.fields.includes('Segment'), 'champ joint fusionné dans la cible');
  const row = r.lineage.find(l => l.fieldQlik === 'Segment');
  assert.strictEqual(row.tableSource, 'clients.qvd', 'la source du join est le QVD, pas la table');
});

test('v2: CONCATENATE sans cible → dernière table chargée', () => {
  const r = parseQlikScript(`
FACT_V:
LOAD A FROM [lib://QVD/v1.qvd] (qvd);

Concatenate
LOAD A, B FROM [lib://QVD/v2.qvd] (qvd);`);
  const f = r.facts.find(x => x.name === 'FACT_V');
  assert.ok(f.fields.includes('B'), 'concaténation implicite rattachée à FACT_V');
  assert.strictEqual(r.metadata.coverage.score, 100);
});

test('v2: RENAME TABLE suivi', () => {
  const r = parseQlikScript(`
TmpVentes:
LOAD A FROM [lib://QVD/v.qvd] (qvd);
RENAME TABLE TmpVentes TO FACT_Ventes;`);
  assert.ok(r.facts.find(x => x.name === 'FACT_Ventes'), 'table renommée reclassée en FACT');
  assert.ok(r.lineage.every(l => l.tableQlik !== 'TmpVentes'), 'lineage mis à jour');
});

test('v2: plusieurs instructions sur une ligne', () => {
  const r = parseQlikScript(`T1: LOAD A FROM [a.qvd] (qvd); T2: LOAD B FROM [b.qvd] (qvd);`);
  const names = [...r.facts, ...r.dims].map(t => t.name).sort();
  assert.deepStrictEqual(names, ['T1', 'T2']);
});

test('v2: point-virgule dans une chaîne ne coupe pas l instruction', () => {
  const r = parseQlikScript(`
DIM_A:
LOAD A, 'x;y' AS Sep FROM [lib://QVD/a.qvd] (qvd);`);
  assert.ok(r.dims[0].fields.includes('Sep'));
});

test('v2: LOAD précédent + SQL SELECT avec connexion contextuelle', () => {
  const r = parseQlikScript(`
LIB CONNECT TO 'DWH_PROD';

FACT_Cmd:
LOAD CommandeID, Montant;
SQL SELECT CommandeID, Montant FROM dbo.Commandes;`);
  const f = r.facts.find(x => x.name === 'FACT_Cmd');
  assert.ok(f, 'appariement LOAD/SELECT');
  assert.strictEqual(f.connection, 'DWH_PROD');
  assert.strictEqual(f.loadMethod, 'sql');
  assert.strictEqual(r.metadata.coverage.score, 100);
});

test('v2: Excel — feuille extraite du format spec', () => {
  const r = parseQlikScript(`
DIM_Budget:
LOAD Annee, Montant FROM [lib://Fichiers/budget.xlsx] (ooxml, embedded labels, table is [Feuil2]);

DIM_Objectifs:
LOAD Annee, Objectif FROM [lib://Fichiers/budget.xlsx] (ooxml, embedded labels, table is Objectifs);
`);
  const s1 = r.sourceMeta.find(s => s.sheet === 'Feuil2');
  const s2 = r.sourceMeta.find(s => s.sheet === 'Objectifs');
  assert.ok(s1, 'feuille [Feuil2] extraite');
  assert.ok(s2, 'feuille sans crochets extraite');
  assert.strictEqual(s1.name, 'budget.xlsx');
  assert.strictEqual(r.sourceMeta.filter(s => s.name === 'budget.xlsx').length, 2, 'deux feuilles = deux sources');
  const row = r.lineage.find(l => l.tableQlik === 'DIM_Budget');
  assert.strictEqual(row.sheet, 'Feuil2', 'sheet propagée dans le lineage');
});
