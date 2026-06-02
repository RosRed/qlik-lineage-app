function getAnalyzePrompt(appName, chunkIndex, totalChunks) {
  return `Tu es un expert Data Lineage Qlik.
Tu analyses le chunk ${chunkIndex + 1}/${totalChunks} des scripts de l'application "${appName}".

RÈGLES ABSOLUES :
- Analyse CHAQUE ligne du script, sans rien ignorer
- Pour CHAQUE champ dans chaque LOAD : crée une entrée lineage avec TOUTES les métadonnées
- Pour CHAQUE champ calculé (If, Date, Num, ApplyMap, &, *, /) : documente la formule exacte
- Pour CHAQUE clé synthétique (& entre champs) : signale le risque et fais une recommandation
- Identifie le type : FACT_/FCT_/F_ = fait, DIM_/D_/LK_ = dimension, MAP_/LKP_ = mapping
- Pour les SQL embarqués : capture la requête complète et liste chaque champ SELECT
- loadMethod : "qvd" | "sql" | "excel" | "csv" | "resident" | "inline" | "autogenerate"
- Ne tronque JAMAIS le JSON — produis un objet complet et valide

Réponds UNIQUEMENT avec ce JSON (aucun texte avant ou après) :
{
  "appName": "${appName}",
  "model": "etoile|flocon|mixte",
  "sources": ["LISTE EXHAUSTIVE QVD/SQL/Excel/connexions détectés"],
  "sourceMeta": [
    {
      "name": "nom_court.qvd",
      "path": "lib://QVD/chemin/complet.qvd",
      "type": "qvd|sql|excel|csv",
      "connection": "ConnectString ou null",
      "usedBy": ["TABLE1","TABLE2"],
      "fieldCount": 10
    }
  ],
  "facts": [{
    "name": "NOM",
    "fields": ["champ1","champ2"],
    "keys": ["CLE_PK"],
    "source": "nom_source",
    "sourcePath": "lib://QVD/... ou schema.table",
    "loadMethod": "qvd|sql|excel|csv|resident",
    "connection": "ConnectString ou null",
    "sqlQuery": "SELECT ... FROM ... WHERE ... (requête complète, sans troncature)",
    "rowCount": null,
    "fieldDetails": [
      {
        "alias": "NOM_CHAMP",
        "expression": "expression_originale",
        "isKey": false,
        "isCalc": false,
        "isSynth": false,
        "dataType": "string|numeric|date|boolean",
        "transformation": "Direct|Renommé|Formule|ApplyMap|..."
      }
    ]
  }],
  "dims": [{
    "name": "NOM",
    "fields": ["champ1"],
    "keys": ["CLE_PK"],
    "source": "nom_source",
    "sourcePath": "lib://QVD/... ou schema.table",
    "loadMethod": "qvd|sql|excel|csv|resident",
    "connection": null,
    "sqlQuery": null,
    "fieldDetails": []
  }],
  "mappings": [{ "name": "NOM", "from": "src", "to": "cible", "sourcePath": "lib://...", "applyMapUsage": "ApplyMap(...)" }],
  "calcFields": [{ "field": "NOM", "table": "TABLE", "formula": "formule exacte", "type": "arithmetique|date|string|condition|mapping|concatenation" }],
  "synthKeys":  [{ "field": "NOM", "formula": "A & B", "tables": ["T1","T2"], "risk": "haut|moyen|faible", "recommendation": "..." }],
  "lineage": [{
    "fieldQlik": "NOM",
    "tableQlik": "TABLE",
    "fieldSource": "src_field",
    "tableSource": "src_table",
    "sourcePath": "lib://QVD/... ou schema.table ou null",
    "loadMethod": "qvd|sql|excel|csv|resident",
    "connection": "ConnectString ou null",
    "transformation": "Direct|AS rename|Calculé: f|ApplyMap|Date()|If()|Clé synthétique",
    "isCalculated": false,
    "isSynth": false,
    "isKey": false,
    "dataType": "string|numeric|date|boolean"
  }],
  "joinConditions": [{ "leftTable": "A", "rightTable": "B", "joinField": "CLE", "joinType": "inner|left|outer" }],
  "filters": [{ "table": "T", "condition": "WHERE ...", "appliedAt": "sql|qlik" }],
  "summary": "Résumé détaillé : modèle, sources, méthodes de chargement, transformations clés, risques"
}`;
}

module.exports = { getAnalyzePrompt };
