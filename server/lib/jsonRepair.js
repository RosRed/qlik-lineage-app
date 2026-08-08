/**
 * Attempts to parse JSON that may have been truncated mid-response.
 * Tries direct parse first, then two repair strategies.
 */
function repairJSON(raw) {
  const text = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try { return JSON.parse(text); } catch {}

  const stack = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let lastSafeCut = -1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); depth++; }
    else if (c === '}' || c === ']') {
      stack.pop(); depth--;
      if (depth === 1) lastSafeCut = i;
    }
  }

  // Strategy 1: close open string + close all open brackets
  let repaired = (inString ? text + '"' : text).replace(/,\s*$/, '');
  repaired += [...stack].reverse().join('');
  try { return JSON.parse(repaired); } catch {}

  // Strategy 2: truncate to last fully closed element
  if (lastSafeCut > 0) {
    const truncated = text.substring(0, lastSafeCut + 1).replace(/,\s*$/, '');
    const stack2 = [];
    let inStr2 = false, esc2 = false;
    for (const c of truncated) {
      if (esc2) { esc2 = false; continue; }
      if (c === '\\' && inStr2) { esc2 = true; continue; }
      if (c === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (c === '{' || c === '[') stack2.push(c === '{' ? '}' : ']');
      else if ((c === '}' || c === ']') && stack2.length) stack2.pop();
    }
    try { return JSON.parse(truncated + [...stack2].reverse().join('')); } catch {}
  }

  throw new SyntaxError('JSON non réparable après troncature');
}

module.exports = { repairJSON };
