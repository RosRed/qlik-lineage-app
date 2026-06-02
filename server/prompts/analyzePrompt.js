function getAnalyzePrompt(appName, chunkIndex, totalChunks) {
  return `Tu es un expert Data Lineage Qlik.
Tu analyses le chunk ${chunkIndex + 1}/${totalChunks} des scripts de l'application "${appName}".

RÈGLES ABSOLUES :
- Analyse CHAQUE ligne du script, sans rien ignorer
- Pour CHAQUE champ dans chaque LOAD : crée une entrée lineage
- Pour CHAQUE champ calculé (If, Date, Num, ApplyMap, &, *, /) : documente la formule exacte
- Pour CHAQUE clé synthétique (& entre champs) : signale le risque
- Identifie le type : FACT_ = fait, DIM_ = dimension, MAP_ = mapping
- Pour les SQL embarqués : liste chaque champ SELECT comme source
- Ne tronque JAMAIS le JSON — produis un objet complet et valide

Réponds UNIQUEMENT avec ce JSON (aucun texte avant ou après) :
{
  "appName": "${appName}",
  "model": "etoile|flocon|mixte",
  "sources": ["LISTE EXHAUSTIVE QVD/SQL/Excel détectés"],
  "facts": [{ "name": "NOM", "fields": ["champ"], "keys": ["PK"], "source": "src", "rowCount": null }],
  "dims":  [{ "name": "NOM", "fields": ["champ"], "keys": ["PK"], "source": "src" }],
  "mappings":   [{ "name": "NOM", "from": "src", "to": "cible", "applyMapUsage": "ApplyMap(...)" }],
  "calcFields": [{ "field": "NOM", "table": "TABLE", "formula": "formule exacte", "type": "arithmetique|date|string|condition|mapping|concatenation" }],
  "synthKeys":  [{ "field": "NOM", "formula": "A & B", "tables": ["T1","T2"], "risk": "haut|moyen|faible", "recommendation": "..." }],
  "lineage": [{
    "fieldQlik": "NOM", "tableQlik": "TABLE",
    "fieldSource": "src_field", "tableSource": "src_table",
    "transformation": "Direct|AS rename|Calculé: f|ApplyMap|Date()|If()",
    "isCalculated": false, "isKey": false, "dataType": "string|numeric|date|boolean"
  }],
  "joinConditions": [{ "leftTable": "A", "rightTable": "B", "joinField": "CLE", "joinType": "inner|left|outer" }],
  "filters": [{ "table": "T", "condition": "WHERE ...", "appliedAt": "sql|qlik" }],
  "summary": "Résumé détaillé : modèle, sources, transformations clés, risques"
}`;
}

module.exports = { getAnalyzePrompt };
