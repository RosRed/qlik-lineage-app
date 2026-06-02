/**
 * Splits a script into chunks of at most maxChars characters,
 * breaking on line boundaries to preserve readability.
 */
function chunkScript(script, maxChars = 5000) {
  if (script.length <= maxChars) return [script];
  const chunks = [];
  let current = '';
  for (const line of script.split('\n')) {
    if (current.length + line.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/**
 * Deep-merges an array of analysis objects produced by analyzeChunk,
 * deduplicating facts/dims by name, other arrays by their natural key.
 */
function mergeAnalyses(analyses) {
  const base = analyses[0];
  const ensure = (key) => { base[key] = base[key] || []; };
  ['facts', 'dims', 'mappings', 'calcFields', 'synthKeys', 'sources', 'lineage', 'joinConditions', 'filters']
    .forEach(ensure);

  for (let i = 1; i < analyses.length; i++) {
    const a = analyses[i];
    ['facts', 'dims', 'mappings', 'calcFields', 'synthKeys', 'sources', 'lineage'].forEach(k => {
      a[k] = a[k] || [];
    });

    a.facts.forEach(f => {
      const found = base.facts.find(x => x.name === f.name);
      found
        ? (found.fields = [...new Set([...found.fields, ...f.fields])])
        : base.facts.push(f);
    });

    a.dims.forEach(d => {
      const found = base.dims.find(x => x.name === d.name);
      found
        ? (found.fields = [...new Set([...found.fields, ...d.fields])])
        : base.dims.push(d);
    });

    base.mappings   = [...new Map([...base.mappings,   ...a.mappings  ].map(x => [x.name, x])).values()];
    base.calcFields = [...new Map([...base.calcFields, ...a.calcFields].map(x => [x.field + '_' + x.table, x])).values()];
    base.synthKeys  = [...new Map([...base.synthKeys,  ...a.synthKeys ].map(x => [x.field, x])).values()];
    base.sources    = [...new Set([...base.sources, ...a.sources])];

    a.lineage.forEach(l => {
      const key = l.fieldQlik + '_' + l.tableQlik;
      if (!base.lineage.find(x => x.fieldQlik + '_' + x.tableQlik === key)) {
        base.lineage.push(l);
      }
    });
  }
  return base;
}

module.exports = { chunkScript, mergeAnalyses };
