function getAnalyzePrompt(appName) {
  return `Tu es un agent expert en Data Lineage Qlik. Analyse les scripts fournis pour l'application "${appName}".
Réponds UNIQUEMENT en JSON valide avec cette structure exacte, sans markdown, sans texte avant ou après :
{
  "appName": "string",
  "model": "etoile|flocon|mixte",
  "sources": ["liste QVD/SQL/Excel"],
  "facts": [{"name":"TABLE","fields":["f1","f2"],"keys":["PK"]}],
  "dims": [{"name":"DIM","fields":["f1","f2"],"keys":["PK"]}],
  "mappings": [{"name":"MAP","from":"source","to":"cible"}],
  "calcFields": [{"field":"NOM","table":"TABLE","formula":"formule"}],
  "synthKeys": [{"field":"CLE","formula":"concat","risk":"haut|moyen|faible"}],
  "lineage": [
    {
      "fieldQlik":"CHAMP",
      "tableQlik":"TABLE",
      "fieldSource":"champ_src",
      "tableSource":"source",
      "transformation":"description"
    }
  ],
  "summary": "Résumé en 2 phrases"
}`;
}

module.exports = { getAnalyzePrompt };
