/* Pure local data transformations. No network, workout seed data or storage. */
(function (root) {
  const ANALYSIS_START = '2026-09-01';
  const DATA_REVISION = 5;
  const nameKey = (name) => String(name || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const isStrength = (exercise) => exercise && !/пресс|гиперэкстенз|гравитрон/.test(nameKey(exercise.name));
  const compareResult = (a, b) => Number(a.weight || 0) - Number(b.weight || 0) || Number(a.reps || 0) - Number(b.reps || 0);

  function migrate(data) {
    const result = JSON.parse(JSON.stringify(data));
    if (Number(result.dataRevision) >= DATA_REVISION) return result;
    const byId = new Map(result.exercises.map((exercise) => [exercise.id, exercise]));
    const calfIds = new Set(result.exercises.filter((exercise) => nameKey(exercise.name).startsWith('голень')).map((exercise) => exercise.id));
    const shrugIds = new Set(result.exercises.filter((exercise) => /^шраги(?:\s+с\s+гантелями)?$/.test(nameKey(exercise.name).trim())).map((exercise) => exercise.id));
    const lungeIds = new Set(result.exercises.filter((exercise) => ['dumbbell-lunges', 'reverse-dumbbell-lunge'].includes(exercise.id) || /^(?:выпад назад с гантелями|выпады с гантел(?:ей|ью))$/.test(nameKey(exercise.name).trim())).map((exercise) => exercise.id));
    const yellowIds = new Set(['yellow-press', 'yellow-press-chest', 'yellow-press-shoulders']);
    const ensure = (id, name) => {
      if (!byId.has(id)) {
        const exercise = { id, name, archived: false };
        result.exercises.push(exercise);
        byId.set(id, exercise);
      }
      return id;
    };
    if (calfIds.size) ensure('calf', 'Голень');
    if (shrugIds.size) ensure('shrugs', 'Шраги');
    if (lungeIds.size) ensure('reverse-dumbbell-lunge', 'Выпад назад с гантелями');
    if (result.exercises.some((exercise) => yellowIds.has(exercise.id))) {
      ensure('yellow-press-chest', 'Жим в жёлтом тренажёре — грудь');
      ensure('yellow-press-shoulders', 'Жим в жёлтом тренажёре — плечи');
    }
    for (const session of result.sessions) {
      for (const entry of session.entries) {
        const oldId = entry.exerciseId;
        if (calfIds.has(oldId)) {
          entry.variant = entry.variant || entry.nameSnapshot || byId.get(oldId)?.name;
          entry.exerciseId = 'calf';
        }
        if (shrugIds.has(oldId)) entry.exerciseId = 'shrugs';
        if (lungeIds.has(oldId)) {
          entry.exerciseId = 'reverse-dumbbell-lunge';
          entry.sourceName = 'Выпад назад с гантелями';
        }
        // Explicitly named chest presses remain chest when programmes change.
        if (yellowIds.has(oldId) && session.date >= ANALYSIS_START && oldId !== 'yellow-press-chest') {
          if (session.templateId === 'day-1') entry.exerciseId = 'yellow-press-chest';
          if (session.templateId === 'day-2') entry.exerciseId = 'yellow-press-shoulders';
        }
        if (entry.exerciseId !== oldId) entry.nameSnapshot = byId.get(entry.exerciseId)?.name || entry.nameSnapshot;
      }
    }
    for (const template of result.templates || []) {
      template.exerciseIds = [...new Set(template.exerciseIds.map((id) => {
        if (calfIds.has(id)) return 'calf';
        if (shrugIds.has(id)) return 'shrugs';
        if (lungeIds.has(id)) return 'reverse-dumbbell-lunge';
        if (template.id === 'day-1' && yellowIds.has(id)) return 'yellow-press-chest';
        if (template.id === 'day-2' && yellowIds.has(id)) return 'yellow-press-shoulders';
        return id;
      }))];
    }
    result.exercises = result.exercises.filter((exercise) => (!calfIds.has(exercise.id) || exercise.id === 'calf') && (!shrugIds.has(exercise.id) || exercise.id === 'shrugs') && (!lungeIds.has(exercise.id) || exercise.id === 'reverse-dumbbell-lunge'));
    if (calfIds.size) result.exercises.find((exercise) => exercise.id === 'calf').name = 'Голень';
    if (shrugIds.size) result.exercises.find((exercise) => exercise.id === 'shrugs').name = 'Шраги';
    if (lungeIds.size) result.exercises.find((exercise) => exercise.id === 'reverse-dumbbell-lunge').name = 'Выпад назад с гантелями';
    const removeRepeatedPreposition = (name) => typeof name === 'string' ? name.replace(/(^|\s)в\s+в(?=\s)/gi, '$1в') : name;
    for (const exercise of result.exercises) exercise.name = removeRepeatedPreposition(exercise.name);
    for (const session of result.sessions) for (const entry of session.entries) {
      if (entry.sourceName) entry.sourceName = removeRepeatedPreposition(entry.sourceName);
      if (entry.nameSnapshot) entry.nameSnapshot = removeRepeatedPreposition(entry.nameSnapshot);
    }
    result.dataRevision = DATA_REVISION;
    return result;
  }

  function sessionResults(data, exerciseId, weightedOnly = false) {
    return data.sessions.flatMap((session) => {
      const entries = session.entries.filter((entry) => entry.exerciseId === exerciseId &&
        (weightedOnly ? Number(entry.weight) > 0 : Number(entry.weight) > 0 || Number(entry.reps) > 0));
      if (!entries.length) return [];
      const best = entries.reduce((a, b) => compareResult(b, a) > 0 ? b : a);
      return [{ ...best, date: session.date, sessionId: session.id }];
    }).sort((a, b) => a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId));
  }

  function recentRows(data, exerciseId) {
    const rows = sessionResults(data, exerciseId, true).filter((row) => row.date >= ANALYSIS_START);
    // A long break starts a new series, even within the current programme.
    let start = 0;
    for (let i = 1; i < rows.length; i += 1) {
      if ((Date.parse(rows[i].date) - Date.parse(rows[i - 1].date)) / 86400000 > 45) start = i;
    }
    return rows.slice(start);
  }

  function insights(data) {
    const strongestList = [];
    const stalledList = [];
    for (const exercise of data.exercises.filter(isStrength)) {
      const rows = recentRows(data, exercise.id);
      const window = rows.slice(-4);
      if (window.length === 4) {
        const first = window[0];
        const last = window.at(-1);
        const gain = Number(last.weight) - Number(first.weight);
        const changes = window.slice(1).map((row, i) => Number(row.weight) - Number(window[i].weight));
        let growthStreak = 0;
        for (let i = changes.length - 1; i >= 0 && changes[i] > 0; i -= 1) growthStreak += 1;
        const increases = changes.filter((change) => change > 0).length;
        // A stalled latest weight or any decrease excludes the exercise.
        if (growthStreak > 0 && changes.every((change) => change >= 0)) {
          const logRates = window.slice(1).map((row, i) => Math.log(Number(row.weight) / Number(window[i].weight)));
          const meanLog = logRates.reduce((sum, value) => sum + value, 0) / 3;
          const spread = Math.sqrt(logRates.reduce((sum, value) => sum + (value - meanLog) ** 2, 0) / 3);
          const balancedRate = Math.expm1(meanLog - 0.5 * spread) * 100;
          const stepRates = logRates.map((value) => Math.expm1(value) * 100);
          strongestList.push({ exercise, rows: window, first, last, gain, growthStreak, increases,
            stepRates, balancedRate, meanRate: Math.expm1(meanLog) * 100 });
        }
      }
      let stalled = rows.length ? 1 : 0;
      for (let i = rows.length - 1; i > 0; i -= 1) {
        if (compareResult(rows[i], rows[i - 1]) === 0) stalled += 1;
        else break;
      }
      if (stalled >= 3) stalledList.push({ exercise, rows: rows.slice(-stalled), first: rows.at(-stalled), last: rows.at(-1), stalled });
    }
    strongestList.sort((a, b) => b.growthStreak - a.growthStreak || b.increases - a.increases ||
      b.balancedRate - a.balancedRate || b.meanRate - a.meanRate ||
      Math.min(...b.stepRates) - Math.min(...a.stepRates) || b.stepRates[2] - a.stepRates[2] ||
      a.exercise.name.localeCompare(b.exercise.name, 'ru') || a.exercise.id.localeCompare(b.exercise.id));
    strongestList.forEach((item, index) => { item.rank = index + 1; });
    stalledList.sort((a, b) => b.stalled - a.stalled || a.exercise.name.localeCompare(b.exercise.name, 'ru'));
    return { strongestList, stalledList, strongest: strongestList[0] || null, attention: stalledList[0] || null };
  }

  function recordEvents(data, exerciseId = null) {
    const events = [];
    for (const exercise of data.exercises.filter((item) => isStrength(item) && (!exerciseId || item.id === exerciseId))) {
      let best = null;
      for (const row of sessionResults(data, exercise.id, true)) {
        if (!best) { best = row; continue; }
        // Weight records are strict: repeating a record is not a new record.
        if (Number(row.weight) > Number(best.weight)) {
          events.push({ exercise, best: row, previous: best, gain: Number(row.weight) - Number(best.weight) });
          best = row;
        }
      }
    }
    return events.sort((a, b) => b.best.date.localeCompare(a.best.date) || a.exercise.name.localeCompare(b.exercise.name, 'ru'));
  }

  function bestRecords(data) {
    return data.exercises.filter(isStrength).flatMap((exercise) => {
      const rows = sessionResults(data, exercise.id, true);
      if (!rows.length) return [];
      const maxWeight = Math.max(...rows.map((row) => Number(row.weight)));
      const atMax = rows.filter((row) => Number(row.weight) === maxWeight);
      const best = atMax.at(-1);
      const earlier = rows.slice(0, rows.indexOf(best)).filter((row) => Number(row.weight) < maxWeight);
      const previousWeight = earlier.length ? Math.max(...earlier.map((row) => Number(row.weight))) : null;
      const previous = previousWeight === null ? null : earlier.filter((row) => Number(row.weight) === previousWeight).at(-1);
      const previousAtMax = atMax.length > 1 ? atMax.at(-2) : null;
      const beforeFirst = rows.slice(0, rows.indexOf(atMax[0]));
      const earlierMax = beforeFirst.length ? Math.max(...beforeFirst.map((row) => Number(row.weight))) : null;
      const previousBeforeFirst = earlierMax === null ? null : beforeFirst.filter((row) => Number(row.weight) === earlierMax).at(-1);
      return [{ exercise, best, previous, previousAtMax, firstAchieved: atMax[0], previousBeforeFirst, gain: previous ? maxWeight - previousWeight : null }];
    }).sort((a, b) => b.firstAchieved.date.localeCompare(a.firstAchieved.date) || a.exercise.name.localeCompare(b.exercise.name, 'ru'));
  }

  function merge(existing, incoming) {
    const current = migrate(existing);
    const imported = migrate(incoming);
    const mergeById = (a, b) => [...new Map([...a, ...b].map((item) => [item.id, item])).values()];
    const sessions = [...current.sessions];
    for (const session of imported.sessions) {
      let index = sessions.findIndex((item) => item.id === session.id);
      // The supplied update must not duplicate an already logged workout.
      if (index < 0) {
        const sameDay = sessions.map((item, i) => ({ item, i })).filter(({ item }) => item.date === session.date && item.templateId === session.templateId);
        if (sameDay.length === 1) {
          const existingSignature = sameDay[0].item.entries.map((entry) => `${entry.exerciseId}:${entry.weight}:${entry.reps}`).sort().join('|');
          const incomingSignature = session.entries.map((entry) => `${entry.exerciseId}:${entry.weight}:${entry.reps}`).sort().join('|');
          if (existingSignature === incomingSignature) index = sameDay[0].i;
        }
      }
      if (index >= 0) sessions[index] = session;
      else sessions.push(session);
    }
    const combined = { ...current, ...imported, settings: current.settings,
      exercises: mergeById(current.exercises, imported.exercises),
      templates: mergeById(imported.templates || [], current.templates || []),
      sessions };
    const aliases = { ...(current.exerciseAliases || {}), ...(imported.exerciseAliases || {}) };
    const canonical = (id) => {
      const seen = new Set();
      while (aliases[id] && !seen.has(id)) { seen.add(id); id = aliases[id]; }
      return id;
    };
    combined.exerciseAliases = aliases;
    for (const session of combined.sessions) {
      for (const entry of session.entries) entry.exerciseId = canonical(entry.exerciseId);
    }
    for (const template of combined.templates) template.exerciseIds = [...new Set(template.exerciseIds.map(canonical))];
    combined.exercises = combined.exercises.filter((exercise) => canonical(exercise.id) === exercise.id);
    return combined;
  }

  function programmeHistory(data) {
    const groups = new Map();
    for (const session of [...data.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
      if (!session.templateId) continue;
      if (!groups.has(session.templateId)) groups.set(session.templateId, { id: session.templateId, name: session.templateName || 'Тренировка', versions: [] });
      const group = groups.get(session.templateId);
      const signature = JSON.stringify(session.entries.map((entry) => entry.exerciseId));
      const previous = group.versions.at(-1);
      if (previous?.signature === signature) {
        previous.lastDate = session.date;
        previous.count += 1;
      } else group.versions.push({ signature, sessionId: session.id, firstDate: session.date, lastDate: session.date, count: 1, entries: session.entries });
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  const api = { ANALYSIS_START, DATA_REVISION, isStrength, compareResult, migrate, sessionResults, recentRows, insights, recordEvents, bestRecords, programmeHistory, merge };
  root.WorkoutData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
