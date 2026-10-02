'use strict';

/**
 * Décodage des planifications QRS (schemaevent) et projection sur une semaine.
 *
 * QRS ne livre pas un calendrier : il livre une règle de récurrence
 * (`incrementOption` + `incrementDescription` + `startDate` + filtre de jours).
 * Ce module la traduit en occurrences concrètes sur une semaine donnée, puis
 * propage ces occurrences aux tâches CHAÎNÉES — une tâche chaînée n'a pas de
 * planification propre : elle tourne quand sa racine tourne.
 *
 * Hypothèses sur l'encodage QRS (vérifiables dans l'UI, voir `uncertain`) :
 *   - `incrementOption` : 0 une fois · 1 horaire · 2 quotidien · 3 hebdo · 4 mensuel
 *   - `incrementDescription` : "minutes heures jours semaines"
 *   - `schemaFilterDescription` : "<jours du mois> <mois> - <jours de semaine> …",
 *     jours de semaine en énumération .NET DayOfWeek (0 = dimanche … 6 = samedi)
 * Quand le décodage contredit le `nextExecution` renvoyé par QRS, la tâche est
 * marquée `uncertain` plutôt que d'afficher une planification fausse.
 */

const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAY_SHORT = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

const INCREMENT_KIND = { 0: 'once', 1: 'hourly', 2: 'daily', 3: 'weekly', 4: 'monthly' };

const DAY_MS = 86400000;
const MAX_OCCURRENCES = 400;  // garde-fou : une tâche « toutes les 5 min » sur 7 j
const MAX_CHAIN_DEPTH = 20;   // garde-fou : graphes de chaînes pathologiques

/** Index semaine française : 0 = lundi … 6 = dimanche (Date.getDay() donne 0 = dimanche). */
const jsDayToIndex = (d) => (d.getDay() + 6) % 7;

/** Énumération .NET DayOfWeek (0 = dimanche) → index semaine française. */
const dotNetDayToIndex = (n) => (n + 6) % 7;

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Lundi 00:00 de la semaine contenant `ref`, et lundi suivant. */
function weekBounds(ref = new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  start.setDate(start.getDate() - jsDayToIndex(start));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

/** "0 0 1 0" → { minutes: 0, hours: 0, days: 1, weeks: 0 } */
function parseIncrement(desc) {
  const parts = String(desc || '').trim().split(/\s+/).map(n => parseInt(n, 10));
  return {
    minutes: Number.isFinite(parts[0]) ? parts[0] : 0,
    hours: Number.isFinite(parts[1]) ? parts[1] : 0,
    days: Number.isFinite(parts[2]) ? parts[2] : 0,
    weeks: Number.isFinite(parts[3]) ? parts[3] : 0
  };
}

/**
 * Filtre "* * - 0,2,4 1 * * *" → { days: [1, 3, 6], weekInterval: 1 }
 *
 * Le jeton après le tiret porte les jours de semaine (.NET DayOfWeek), le
 * suivant l'intervalle en semaines. `days` vaut null quand le filtre est absent
 * ou « tous les jours » (`*`) — l'appelant se rabat alors sur l'incrément.
 */
function parseSchemaFilter(filter) {
  const raw = Array.isArray(filter) ? filter[0] : filter;
  const empty = { days: null, weekInterval: 1 };
  if (!raw || typeof raw !== 'string') return empty;
  const afterDash = raw.split('-')[1];
  if (!afterDash) return empty;
  const tokens = afterDash.trim().split(/\s+/);

  const dayToken = tokens[0];
  let days = null;
  if (dayToken && dayToken !== '*') {
    const parsed = dayToken.split(',')
      .map(x => parseInt(x, 10))
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 6)
      .map(dotNetDayToIndex);
    if (parsed.length) days = [...new Set(parsed)].sort((a, b) => a - b);
  }

  const weekToken = parseInt(tokens[1], 10);
  const weekInterval = Number.isFinite(weekToken) && weekToken > 0 ? weekToken : 1;
  return { days, weekInterval };
}

/** Jours de semaine seuls — conservé pour la lisibilité des appels. */
function parseFilterDays(filter) {
  return parseSchemaFilter(filter).days;
}

/** Nombre de jours calendaires entiers entre deux dates (insensible à l'heure d'été). */
function dayDiff(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

/** Date du jour `index` de la semaine, à l'heure de `time`. */
function dayAt(weekStart, index, time) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + index);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

/**
 * Occurrences d'un déclencheur planifié sur la semaine [weekStart, weekEnd[.
 * Retourne [] si la règle ne tombe pas dans cette semaine (« toutes les 2
 * semaines » sur une semaine paire, période expirée, démarrage futur…).
 */
function occurrencesInWeek(trigger, weekStart, weekEnd) {
  const start = trigger.startDate ? new Date(trigger.startDate) : null;
  if (!start || isNaN(start.getTime())) return [];
  if (start >= weekEnd) return [];                                  // pas encore démarrée
  if (trigger.expiration) {
    const exp = new Date(trigger.expiration);
    if (!isNaN(exp.getTime()) && exp < weekStart) return [];        // déjà expirée
  }

  const inc = parseIncrement(trigger.incrementDescription);
  const kind = INCREMENT_KIND[trigger.incrementOption];
  const { days: filterDays, weekInterval } = parseSchemaFilter(trigger.schemaFilterDescription);
  const out = [];

  // Le filtre de jours prime sur `incrementOption`. Vérifié sur les 91
  // schemaevent du serveur : un événement nommé « Daily » avec
  // incrementOption=2 et le filtre "0,2,4" ne tourne QUE dimanche, mardi et
  // jeudi — et les mêmes jours se retrouvent avec incrementOption 0 et 3.
  // Autrement dit, dès qu'un filtre existe, la récurrence est hebdomadaire sur
  // ces jours-là, quel que soit l'incrementOption.
  if (filterDays) {
    const anchor = weekBounds(start).start;
    const weeksApart = Math.round(dayDiff(anchor, weekStart) / 7);
    if (weeksApart < 0 || weeksApart % weekInterval !== 0) return out;
    for (const i of filterDays) {
      const d = dayAt(weekStart, i, start);
      if (d >= start) out.push(d);
    }
    return out.sort((a, b) => a - b);
  }

  if (kind === 'once') {
    if (start >= weekStart && start < weekEnd) out.push(start);
    return out;
  }

  if (kind === 'hourly') {
    const stepMs = (inc.minutes * 60 + inc.hours * 3600) * 1000;
    if (stepMs <= 0) return [];
    const k0 = Math.max(0, Math.ceil((weekStart.getTime() - start.getTime()) / stepMs));
    for (let k = k0; out.length < MAX_OCCURRENCES; k++) {
      const t = new Date(start.getTime() + k * stepMs);
      if (t >= weekEnd) break;
      out.push(t);
    }
    return out;
  }

  if (kind === 'daily' || kind == null) {
    // `kind == null` : incrementOption inconnu → repli quotidien, que l'appelant
    // marque `uncertain`. Le pas se lit en jours ; 0 signifie « tous les jours ».
    const step = Math.max(1, inc.days || 1);
    for (let i = 0; i < 7; i++) {
      const d = dayAt(weekStart, i, start);
      const diff = dayDiff(start, d);
      if (diff >= 0 && diff % step === 0 && d >= start) out.push(d);
    }
    return out;
  }

  if (kind === 'weekly') {
    // Hebdomadaire sans filtre de jours (le cas avec filtre est traité plus
    // haut) : le jour retenu est celui du startDate.
    const stepWeeks = Math.max(1, inc.weeks || 1);
    const anchor = weekBounds(start).start;
    const weeksApart = Math.round(dayDiff(anchor, weekStart) / 7);
    if (weeksApart < 0 || weeksApart % stepWeeks !== 0) return [];
    const d = dayAt(weekStart, jsDayToIndex(start), start);
    if (d >= start) out.push(d);
    return out;
  }

  if (kind === 'monthly') {
    // Le jour du mois est porté par startDate ; le pas mensuel n'est pas exposé
    // de façon fiable par QRS → on suppose « tous les mois ».
    for (let i = 0; i < 7; i++) {
      const d = dayAt(weekStart, i, start);
      if (d.getDate() === start.getDate() && d >= start) out.push(d);
    }
    return out;
  }

  return out;
}

/** Libellé lisible d'un déclencheur : « Toutes les semaines · lun, jeu · 06:00 ». */
function describeTrigger(trigger) {
  const start = trigger.startDate ? new Date(trigger.startDate) : null;
  const valid = start && !isNaN(start.getTime());
  const kind = INCREMENT_KIND[trigger.incrementOption];
  const inc = parseIncrement(trigger.incrementDescription);
  const at = valid ? hhmm(start) : null;
  const { days: filterDays, weekInterval } = parseSchemaFilter(trigger.schemaFilterDescription);

  // Même priorité que occurrencesInWeek : le filtre de jours fait foi.
  if (filterDays) {
    const list = filterDays.map(d => DAY_SHORT[d]).join(', ');
    const cadence = filterDays.length === 7 ? 'Tous les jours' : list;
    const prefix = weekInterval > 1 ? `1 semaine sur ${weekInterval} · ` : '';
    return `${prefix}${cadence}${at ? ` · ${at}` : ''}`;
  }

  if (kind === 'once') return `Une seule fois${valid ? ` · ${ymd(start)} ${at}` : ''}`;
  if (kind === 'hourly') {
    const every = inc.hours && inc.minutes ? `${inc.hours} h ${inc.minutes} min`
      : inc.hours ? `${inc.hours} h`
      : inc.minutes ? `${inc.minutes} min` : '?';
    return `Toutes les ${every}`;
  }
  if (kind === 'daily') {
    const n = Math.max(1, inc.days || 1);
    return `${n === 1 ? 'Tous les jours' : `Tous les ${n} jours`}${at ? ` · ${at}` : ''}`;
  }
  if (kind === 'weekly') {
    const n = Math.max(1, inc.weeks || 1);
    const day = valid ? DAY_SHORT[jsDayToIndex(start)] : null;
    return `${n === 1 ? 'Toutes les semaines' : `Toutes les ${n} semaines`}${day ? ` · ${day}` : ''}${at ? ` · ${at}` : ''}`;
  }
  if (kind === 'monthly') {
    return `Le ${valid ? start.getDate() : '?'} de chaque mois${at ? ` · ${at}` : ''}`;
  }
  return `Récurrence non décodée${at ? ` · ${at}` : ''}`;
}

// ─── Projection d'une semaine complète ───────────────────────────────────────

/**
 * Construit le calendrier hebdomadaire des tâches.
 *
 * Une tâche apparaît dans la grille si :
 *   - elle porte un déclencheur planifié actif qui tombe cette semaine → `schedule`
 *   - ou elle est chaînée derrière une (ou plusieurs) tâche(s) planifiée(s) :
 *     elle hérite alors des jours de sa racine, avec l'heure de déclenchement
 *     D'ORIGINE — l'heure réelle dépend de la durée de l'amont, que QRS ne
 *     prédit pas → `chain`
 * Les autres (manuelles, déclencheurs désactivés, chaînes sans racine planifiée)
 * sont remontées à part dans `unscheduled` : ne pas les cacher est le seul moyen
 * de voir qu'une tâche censée tourner ne tournera jamais.
 *
 * @param tasks       tâches issues de fetchTasks()
 * @param upstreamOf  Map taskId -> [{ taskId, name, exists, triggerEnabled }] (buildTaskChains)
 */
function buildWeekPlanning(tasks, upstreamOf, refDate = new Date()) {
  const { start: weekStart, end: weekEnd } = weekBounds(refDate);
  const todayIso = ymd(new Date());
  const byId = new Map(tasks.map(t => [t.taskId, t]));
  const nameOf = (u) => byId.get(u.taskId)?.name || u.name;
  const ups = (id) => (upstreamOf.get(id) || []).filter(u => u.exists && u.triggerEnabled);

  // 1. Planification propre de chaque tâche (déclencheurs planifiés actifs).
  const own = new Map(); // taskId -> { slots: Map(dayIndex -> Set('HH:MM')), label, uncertain }
  for (const t of tasks) {
    const scheds = (t.triggers || []).filter(tr => tr.type === 'schedule' && tr.enabled);
    if (!scheds.length) continue;
    const slots = new Map();
    for (const tr of scheds) {
      for (const occ of occurrencesInWeek(tr, weekStart, weekEnd)) {
        const i = jsDayToIndex(occ);
        if (!slots.has(i)) slots.set(i, new Set());
        slots.get(i).add(hhmm(occ));
      }
    }
    // Contrôle de cohérence : le prochain lancement annoncé par QRS tombe-t-il
    // sur un jour que nous avons décodé ? Sinon le décodage est douteux.
    let uncertain = false;
    if (t.nextExecution) {
      const nx = new Date(t.nextExecution);
      if (!isNaN(nx.getTime()) && nx >= weekStart && nx < weekEnd && !slots.has(jsDayToIndex(nx))) {
        uncertain = true;
      }
    }
    own.set(t.taskId, { slots, label: scheds.map(describeTrigger).join(' + '), uncertain });
  }

  // 2. Racines planifiées d'une tâche chaînée : remontée BFS, arrêt à la
  //    première racine planifiée rencontrée sur chaque branche.
  const originCache = new Map();
  const originsOf = (taskId) => {
    if (originCache.has(taskId)) return originCache.get(taskId);
    const found = [];
    const seen = new Set([taskId]);
    let frontier = ups(taskId).map(u => ({ id: u.taskId, depth: 1, path: [nameOf(u)] }));
    let guard = 0;
    while (frontier.length && guard++ < MAX_CHAIN_DEPTH) {
      const next = [];
      for (const f of frontier) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        if (own.has(f.id)) { found.push(f); continue; }
        const parents = ups(f.id);
        if (!parents.length) found.push({ ...f, unscheduledRoot: true });
        for (const u of parents) {
          next.push({ id: u.taskId, depth: f.depth + 1, path: [...f.path, nameOf(u)] });
        }
      }
      frontier = next;
    }
    originCache.set(taskId, found);
    return found;
  };

  // 3. Remplissage de la grille — une entrée par (tâche, jour).
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return { index: i, label: DAY_LABELS[i], date: ymd(d), isToday: ymd(d) === todayIso, entries: [] };
  });

  const unscheduled = [];
  const base = (t) => ({
    taskId: t.taskId, name: t.name, appName: t.appName, qlikAppId: t.qlikAppId,
    localAppId: t.localAppId || null,
    stream: t.stream, enabled: t.enabled, lastStatus: t.lastStatus,
    lastStatusLabel: t.lastStatusLabel, durationMs: t.durationMs,
    nextExecution: t.nextExecution || null
  });

  for (const t of tasks) {
    const mine = own.get(t.taskId);

    if (mine && mine.slots.size > 0) {
      const weekDays = [...mine.slots.keys()].sort((a, b) => a - b);
      const weekSlots = weekDays.map(d => ({ day: d, times: [...mine.slots.get(d)].sort() }));
      for (const [dayIndex, times] of mine.slots) {
        days[dayIndex].entries.push({
          ...base(t),
          type: 'schedule',
          times: [...times].sort(),
          scheduleLabel: mine.label,
          uncertain: mine.uncertain,
          weekDays, weekSlots,
          origins: []
        });
      }
      continue;
    }

    const chained = (t.triggers || []).some(tr => tr.type === 'chain');
    if (chained) {
      const origins = originsOf(t.taskId).filter(o => own.has(o.id));
      if (origins.length === 0) {
        unscheduled.push({
          ...base(t),
          type: 'chain',
          reason: ups(t.taskId).length === 0 ? 'chaine_sans_amont' : 'chaine_sans_racine_planifiee'
        });
        continue;
      }
      // Jours hérités : union des occurrences de toutes les racines.
      const perDay = new Map(); // dayIndex -> { times: Set, origins: [] }
      for (const o of origins) {
        const root = byId.get(o.id);
        const rootPlan = own.get(o.id);
        for (const [dayIndex, times] of rootPlan.slots) {
          if (!perDay.has(dayIndex)) perDay.set(dayIndex, { times: new Set(), origins: [] });
          const slot = perDay.get(dayIndex);
          for (const tm of times) slot.times.add(tm);
          slot.origins.push({
            taskId: o.id,
            name: root?.name || '(tâche inconnue)',
            appName: root?.appName || null,
            stream: root?.stream || null,
            enabled: root?.enabled !== false,
            depth: o.depth,
            chainPath: [...o.path].reverse(), // de la racine vers la tâche courante
            scheduleLabel: rootPlan.label,
            uncertain: rootPlan.uncertain,
            times: [...times].sort()
          });
        }
      }
      const weekDays = [...perDay.keys()].sort((a, b) => a - b);
      const weekSlots = weekDays.map(d => ({ day: d, times: [...perDay.get(d).times].sort() }));
      for (const [dayIndex, slot] of perDay) {
        days[dayIndex].entries.push({
          ...base(t),
          type: 'chain',
          times: [...slot.times].sort(),
          scheduleLabel: null,
          uncertain: slot.origins.some(o => o.uncertain),
          weekDays, weekSlots,
          origins: slot.origins
        });
      }
      continue;
    }

    // Ni planification active cette semaine, ni chaînage exploitable.
    // `hors_semaine` : la règle existe mais ne tombe pas dans la semaine
    // affichée (« toutes les 2 semaines », démarrage futur, période expirée).
    unscheduled.push({
      ...base(t),
      type: t.triggerType || 'manual',
      reason: mine ? 'hors_semaine'
        : (t.triggers || []).length > 0 ? 'declencheurs_desactives'
        : 'manuelle'
    });
  }

  // Tri de chaque journée par heure de déclenchement puis par nom.
  for (const d of days) {
    d.entries.sort((a, b) =>
      (a.times[0] || '').localeCompare(b.times[0] || '') || a.name.localeCompare(b.name));
  }

  const flat = days.flatMap(d => d.entries);
  return {
    weekStart: ymd(weekStart),
    weekEnd: ymd(new Date(weekEnd.getTime() - DAY_MS)),
    dayLabels: DAY_LABELS,
    days,
    unscheduled: unscheduled.sort((a, b) => a.name.localeCompare(b.name)),
    stats: {
      scheduledTasks: own.size,
      chainedTasks: new Set(flat.filter(e => e.type === 'chain').map(e => e.taskId)).size,
      unscheduledTasks: unscheduled.length,
      uncertainTasks: new Set(flat.filter(e => e.uncertain).map(e => e.taskId)).size,
      totalRuns: flat.reduce((acc, e) => acc + e.times.length, 0)
    }
  };
}

module.exports = {
  DAY_LABELS, DAY_SHORT, MAX_CHAIN_DEPTH,
  weekBounds, occurrencesInWeek, describeTrigger, parseFilterDays, parseIncrement,
  buildWeekPlanning, jsDayToIndex, ymd, hhmm
};
