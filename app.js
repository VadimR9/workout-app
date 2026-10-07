const STORAGE_KEY = 'my-workout-diary-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const emptyState = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  exercises: [],
  templates: [
    { id: 'day-1', name: 'День 1', exerciseIds: [] },
    { id: 'day-2', name: 'День 2', exerciseIds: [] }
  ],
  settings: { weeklyGoal: 2 },
  sessions: []
});

let state = loadState();
let currentScreen = 'home';
let historyFilter = 'all';
let selectedExerciseId = null;
let progressRange = 'all';
let insightType = 'strongest';
let recordsQuery = '';
let draftSession = null;
let toastTimer;
let chartModel = null;

const titles = {
  home: ['ТРЕНИРОВОЧНЫЙ ДНЕВНИК', 'Мой прогресс'],
  history: ['ВСЕ ЗАНЯТИЯ', 'История'],
  start: ['НОВАЯ ЗАПИСЬ', 'Тренировка'],
  progress: ['АНАЛИТИКА', 'Прогресс'],
  insights: ['АНАЛИЗ ДИНАМИКИ', 'Наблюдения'],
  records: ['ЛУЧШИЕ РЕЗУЛЬТАТЫ', 'Рекорды'],
  exercises: ['ОБЩИЙ СПРАВОЧНИК', 'Упражнения']
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return emptyState();
    const parsed = JSON.parse(saved);
    const normalized = normalizeState(parsed);
    if (Number(parsed.dataRevision) < WorkoutData.DATA_REVISION || !parsed.dataRevision) {
      try {
        localStorage.setItem(`${STORAGE_KEY}-before-revision-${WorkoutData.DATA_REVISION}`, saved);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch (error) { console.error('Не удалось сохранить исправленную копию; исходные данные сохранены.', error); }
    }
    return normalized;
  } catch (error) {
    console.error(error);
    return emptyState();
  }
}

function normalizeState(data) {
  if (!data || !Array.isArray(data.exercises) || !Array.isArray(data.sessions)) throw new Error('Неверный формат данных');
  const base = emptyState();
  return WorkoutData.migrate({
    ...base,
    ...data,
    version: 1,
    exercises: data.exercises.map((item) => ({ archived: false, ...item })),
    templates: Array.isArray(data.templates) ? data.templates : base.templates,
    settings: { ...base.settings, ...(data.settings || {}) },
    sessions: data.sessions
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function renderExerciseVisual(exerciseId, extraClass = '') {
  const src = ExerciseMedia.source(exerciseId);
  return `<span class="exercise-visual ${extraClass}" aria-hidden="true"><svg class="visual-placeholder" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="22" stroke="currentColor" opacity=".2"/><path d="M22 32h20M18 24v16M23 27v10M41 27v10M46 24v16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>${src ? `<img src="${esc(src)}" alt="" width="160" height="160" loading="lazy" decoding="async" data-exercise-image>` : ''}</span>`;
}

function bindExerciseImages(root = document) {
  $$('[data-exercise-image]', root).forEach((img) => {
    const loaded = () => img.parentElement.classList.add('has-photo');
    const failed = () => { img.hidden = true; img.parentElement.classList.remove('has-photo'); };
    img.addEventListener('load', loaded, { once: true });
    img.addEventListener('error', failed, { once: true });
    if (img.complete) img.naturalWidth ? loaded() : failed();
  });
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function localISODate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function formatDate(iso, options = {}) {
  if (!iso) return 'Без даты';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', ...options }).format(new Date(`${iso}T12:00:00`));
}

function shortDate(iso) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(`${iso}T12:00:00`));
}

function shortDateWithYear(iso) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(`${iso}T12:00:00`));
}

function bestResultLabel(count) {
  const lastHundred = Math.abs(count) % 100;
  const lastDigit = lastHundred % 10;
  const form = lastHundred >= 11 && lastHundred <= 14 ? 'лучших результатов' : lastDigit === 1 ? 'лучший результат' : lastDigit >= 2 && lastDigit <= 4 ? 'лучших результата' : 'лучших результатов';
  return `${count} ${form}`;
}


function exerciseById(id) {
  return state.exercises.find((item) => item.id === id);
}

function templateById(id) {
  return state.templates.find((item) => item.id === id);
}

function sortedSessions() {
  return [...state.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function resultsFor(exerciseId, excludeSessionId = null) {
  return WorkoutData.sessionResults(state, exerciseId).filter((row) => row.sessionId !== excludeSessionId);
}

function bestFor(exerciseId, excludeSessionId = null) {
  const rows = resultsFor(exerciseId, excludeSessionId);
  if (!rows.length) return null;
  return rows.reduce((best, row) => {
    if (Number(row.weight) > 0 || Number(best.weight) > 0) return Number(row.weight || 0) >= Number(best.weight || 0) ? row : best;
    return Number(row.reps || 0) >= Number(best.reps || 0) ? row : best;
  });
}

function progressInsights() {
  return WorkoutData.insights(state);
}

function attendanceWeeks(weekCount = 8) {
  const goal = Math.max(1, Number(state.settings?.weeklyGoal) || 2);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const currentMonday = new Date(today);
  const day = (currentMonday.getDay() + 6) % 7;
  currentMonday.setDate(currentMonday.getDate() - day);
  return Array.from({ length: weekCount }, (_, index) => {
    const start = new Date(currentMonday);
    start.setDate(start.getDate() - (weekCount - 1 - index) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startISO = localISODate(start);
    const endISO = localISODate(end);
    const count = state.sessions.filter((session) => session.date >= startISO && session.date <= endISO).length;
    return { startISO, count, goal };
  });
}

function previousFor(exerciseId, beforeDate = '9999-12-31') {
  return resultsFor(exerciseId).filter((row) => row.date < beforeDate).at(-1) || null;
}

function resultText(entry) {
  if (!entry) return '—';
  if (Number(entry.weight) > 0) return `${fmtNumber(entry.weight)}${esc(entry.weightSuffix || '')} кг × ${fmtNumber(entry.reps || 0)}${esc(entry.repsSuffix || '')}`;
  return `${fmtNumber(entry.reps || 0)}${esc(entry.repsSuffix || '')} повт.`;
}

function fmtNumber(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setScreen(screen, options = {}) {
  const previousScreen = currentScreen;
  currentScreen = screen;
  const [eyebrow, title] = titles[screen] || titles.home;
  $('#screenEyebrow').textContent = eyebrow;
  $('#screenTitle').textContent = title;
  $('#backButton').classList.toggle('hidden', screen === 'home');
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.screen === screen));
  if (screen !== 'start') draftSession = options.keepDraft ? draftSession : null;
  if (options.replaceHistory) {
    history.replaceState({ screen, root: screen === 'home' }, '', `#${screen}`);
  } else if (!options.fromHistory && screen !== previousScreen) {
    history.pushState({ screen, root: false }, '', `#${screen}`);
  }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  const renderers = { home: renderHome, history: renderHistory, start: renderStart, progress: renderProgress, insights: renderInsights, records: renderRecords, exercises: renderExercises };
  $('#mainContent').innerHTML = renderers[currentScreen]();
  bindScreenEvents();
  bindExerciseImages();
  if (currentScreen === 'progress') requestAnimationFrame(drawProgressChart);
}

function renderHome() {
  const sessions = sortedSessions();
  const latest = sessions[0];
  const latestTemplateSession = sessions.find((session) => state.templates.some((item) => item.id === session.templateId));
  const latestTemplateIndex = latestTemplateSession ? state.templates.findIndex((item) => item.id === latestTemplateSession.templateId) : -1;
  const nextTemplate = state.templates.length
    ? state.templates[latestTemplateIndex >= 0 ? (latestTemplateIndex + 1) % state.templates.length : 0]
    : null;
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const monthAgoISO = localISODate(monthAgo);
  const recentSessionCount = sessions.filter((session) => session.date >= monthAgoISO).length;
  const weeklyGoal = Math.max(1, Number(state.settings?.weeklyGoal) || 2);
  const expectedSessionCount = Math.round((30 / 7) * weeklyGoal);
  const missedSessionCount = Math.max(0, expectedSessionCount - recentSessionCount);
  const attendance = attendanceWeeks();
  const insights = progressInsights();
  const recentRecords = currentRecordEvents().slice(0, 4);

  return `
    <section class="hero-card">
      <p class="hero-kicker">СЛЕДУЮЩАЯ ТРЕНИРОВКА</p>
      <h2 class="hero-title">${esc(nextTemplate?.name || 'Свободная тренировка')}</h2>
      <p class="hero-sub">${latest ? `Последняя — ${formatDate(latest.date)}` : 'Начните вести историю прогресса'}</p>
      <button class="primary-button" data-action="quick-start" data-template-id="${esc(nextTemplate?.id || '')}">${latest ? 'Начать тренировку' : 'Записать первую'}</button>
    </section>

    <section class="section">
      <div class="stats-grid">
        <button class="stat-card" data-screen-link="history"><span class="stat-value">${sessions.length}</span><span class="stat-label">всего тренировок</span></button>
        <button class="stat-card" data-screen-link="history"><span class="stat-value">${recentSessionCount}</span><span class="stat-label">за 30 дней</span></button>
        <button class="stat-card" data-open-goal><span class="stat-value">${missedSessionCount}</span><span class="stat-label">пропусков за 30 дней</span></button>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Посещаемость</h2><button class="text-button" data-open-goal>План: ${weeklyGoal} в неделю</button></div>
      <div class="attendance-card">
        <div class="attendance-chart">${attendance.map((week) => {
          const percent = Math.min(100, (week.count / week.goal) * 100);
          return `<div class="attendance-week" title="${week.count} из ${week.goal}"><span class="attendance-count">${week.count}</span><span class="attendance-track"><i style="height:${percent}%" class="${week.count >= week.goal ? 'complete' : ''}"></i></span><span class="attendance-date">${shortDate(week.startISO)}</span></div>`;
        }).join('')}</div>
        <p class="attendance-note">Каждый столбик — неделя. Цель: ${weeklyGoal} ${weeklyGoal === 1 ? 'тренировка' : weeklyGoal < 5 ? 'тренировки' : 'тренировок'}.</p>
      </div>
    </section>

    ${(insights.strongest || insights.attention) ? `<section class="section">
      <div class="section-head"><h2>На что обратить внимание</h2></div>
      <div class="insight-grid">
        ${renderHomeInsight(insights.strongest, 'strongest')}
        ${renderHomeInsight(insights.attention, 'stalled')}
      </div>
    </section>` : ''}

    <section class="section home-records">
      <div class="section-head"><h2>Лучшие результаты</h2><button class="text-button" data-screen-link="records">Вся статистика</button></div>
      ${recentRecords.length ? `<div class="record-list">${recentRecords.map(renderRecordCard).join('')}</div>` : renderEmpty('Новых рекордов пока нет', 'Здесь появятся силовые результаты, которые превысили предыдущий лучший вес.')}
    </section>
  `;
}

function renderHistory() {
  const sessions = sortedSessions().filter((session) => historyFilter === 'all' || session.templateId === historyFilter);
  return `
    <div class="segmented">
      <button class="segment ${historyFilter === 'all' ? 'active' : ''}" data-history-filter="all">Все</button>
      ${state.templates.map((template) => `<button class="segment ${historyFilter === template.id ? 'active' : ''}" data-history-filter="${template.id}">${esc(template.name)}</button>`).join('')}
    </div>
    <section class="section">
      ${sessions.length ? `<div class="session-list">${sessions.map((session) => {
        const recordHits = recordEntriesInSession(session);
        const weights = session.entries.filter((entry) => Number(entry.weight) > 0);
        return `<button class="session-card" data-edit-session="${session.id}">
          <span class="session-top"><span class="session-heading"><span class="session-date">${formatDate(session.date, { year: 'numeric' })}</span><span class="session-name">${esc(session.templateName || templateById(session.templateId)?.name || 'Тренировка')}</span></span>${recordHits ? `<span class="session-badge">${bestResultLabel(recordHits)}</span>` : ''}</span>
          <span class="session-summary"><span>${session.entries.length} упражнений</span><span>${weights.length} с весом</span><span>Изменить ›</span></span>
        </button>`;
      }).join('')}</div>` : renderEmpty('Записей пока нет', 'Нажмите «Записать», чтобы добавить тренировку за любую дату.')}
    </section>
  `;
}

function renderInsights() {
  const insights = progressInsights();
  const list = insightType === 'stalled' ? insights.stalledList : insights.strongestList;
  return `
    <div class="segmented insight-tabs">
      <button class="segment ${insightType === 'strongest' ? 'active' : ''}" data-insight-tab="strongest">Лучше всего</button>
      <button class="segment ${insightType === 'stalled' ? 'active' : ''}" data-insight-tab="stalled">Застопорилось</button>
    </div>
    <p class="muted tiny section">${insightType === 'strongest'
      ? 'Последние четыре занятия с сентября 2026. Сначала сравниваем серию повышений подряд и число повышений из трёх, затем процентный темп роста с поправкой на его равномерность. Резкий разовый скачок получает меньший приоритет, чем ровный рост. У каждого упражнения отдельное место; при полностью равных показателях — по алфавиту.'
      : 'Три или больше последних занятий с одинаковыми весом и повторениями, только с сентября 2026. Изменение результата прерывает серию. Пресс и гиперэкстензия не участвуют; перерыв больше 45 дней начинает новую серию.'}</p>
    <div class="observation-list section">${list.length ? list.map((item, index) => {
      return `<button class="observation-card" data-progress-id="${item.exercise.id}">
        <span class="observation-avatar">${renderExerciseVisual(item.exercise.id)}<span class="observation-rank">${item.rank || index + 1}</span></span>
        <span class="observation-copy"><strong>${esc(item.exercise.name)}</strong><small>${insightSummary(item)}</small><span class="observation-series">${item.rows.map((row) => `${shortDateWithYear(row.date)}: ${resultText(row)}`).join('<br>')}</span></span>
        <span class="observation-value ${insightType === 'stalled' ? 'warning' : ''}">${insightType === 'strongest' ? `${item.increases} из 3 ↑` : 'На месте'}</span>
      </button>`;
    }).join('') : renderEmpty(insightType === 'stalled' ? 'Застоя не найдено' : 'Стабильного роста пока нет', insightType === 'stalled' ? 'Нет трёх одинаковых последних силовых результатов подряд.' : 'Нужны четыре занятия с сентября 2026, рост веса на последнем и отсутствие снижений в выборке.')}</div>
  `;
}

function insightSummary(item) {
  const dates = `${shortDateWithYear(item.first.date)} — ${shortDateWithYear(item.last.date)}`;
  if (item.stalled) return `${item.stalled} занятия подряд: ${resultText(item.last)}<br>${dates}`;
  return `${fmtNumber(item.first.weight)} → ${fmtNumber(item.last.weight)} кг · +${fmtNumber(item.gain)} кг<br>Повышений подряд: ${item.growthStreak}; всего ${item.increases} из 3<br>Прибавки между занятиями: ${item.stepRates.map((rate) => `+${fmtNumber(rate)}%`).join(' · ')}<br>Темп с учётом равномерности: ${fmtNumber(item.balancedRate)}% / занятие<br>Последние 4 занятия · ${dates}`;
}

function renderHomeInsight(item, kind) {
  const growing = kind === 'strongest';
  const name = item?.exercise.name || (growing ? 'Пока мало данных' : 'Застоя нет');
  const metric = item ? growing ? `${fmtNumber(item.first.weight)} → ${fmtNumber(item.last.weight)} кг` : `${fmtNumber(item.last.weight)} кг` : '';
  const note = item ? growing ? `+${fmtNumber(item.gain)} кг за 4 занятия` : `${item.stalled} занятия без изменений` : growing ? 'Нужно 4 занятия с ростом веса' : 'Нет трёх одинаковых результатов подряд';
  return `<button class="insight-card ${growing ? 'positive' : 'warning'}" data-open-insight="${kind}">${renderExerciseVisual(item?.exercise.id, 'insight-visual')}<span class="insight-copy"><span class="insight-kicker"><span aria-hidden="true">${growing ? '↗' : 'Ⅱ'}</span> ${growing ? 'Лучше всего' : 'Застопорилось'}</span><strong>${esc(name)}</strong>${metric ? `<span class="insight-metric">${metric}</span>` : ''}</span><span class="insight-footer"><span class="insight-note">${note}</span><span class="insight-action">Все упражнения <span aria-hidden="true">›</span></span></span></button>`;
}

function currentRecordEvents() {
  return WorkoutData.bestRecords(state);
}

function renderRecordCard({ exercise, best, firstAchieved, previousBeforeFirst }) {
  return `<div class="record-card" data-record-exercise="${esc(exercise.id)}" data-record-name="${esc(exercise.name)}">
    <button type="button" class="record-progress-target" data-progress-id="${esc(exercise.id)}" aria-label="Прогресс: ${esc(exercise.name)}"></button>
    ${renderExerciseVisual(exercise.id, 'record-visual')}
    <span class="record-copy"><h3>${esc(exercise.name)}</h3>
      <span class="record-result">${fmtNumber(best.weight)}${esc(best.weightSuffix || '')} <span class="record-unit">кг</span><small><span aria-hidden="true">♛</span> BEST ALL TIME</small></span>
      <p class="record-date">Рекорд · ${shortDateWithYear(firstAchieved.date)}</p>
      <p class="record-previous">${previousBeforeFirst ? `До него: ${fmtNumber(previousBeforeFirst.weight)}${esc(previousBeforeFirst.weightSuffix || '')} кг · ${shortDateWithYear(previousBeforeFirst.date)}` : 'Более раннего результата нет'}</p>
      <button type="button" class="record-gain record-session-link" data-edit-session="${esc(firstAchieved.sessionId)}">Открыть тренировку ›</button>
    </span>
  </div>`;
}

function renderRecords() {
  const events = currentRecordEvents();
  return `<label class="form-group"><span class="form-label">Поиск упражнения</span><input type="search" class="field" id="recordsSearch" value="${esc(recordsQuery)}" placeholder="Название упражнения" autocomplete="off"></label>
  <p class="muted tiny">Лучший вес, дата установления и рекорд до него. Карточка открывает прогресс упражнения, ссылка — тренировку, где этот максимум впервые выполнен.</p>
  ${events.length ? `<div class="record-list section">${events.map(renderRecordCard).join('')}</div><p class="muted tiny section" id="recordsSearchEmpty" hidden>Упражнений не найдено.</p>` : renderEmpty('Результатов пока нет', 'Здесь появятся лучшие веса силовых упражнений.')}`;
}

function recordEntriesInSession(session) {
  return WorkoutData.bestRecords(state).filter((event) => event.best.sessionId === session.id).length;
}

function renderStart() {
  if (!draftSession) {
    return `
      <p class="muted">Выберите шаблон или начните свободную тренировку. Состав упражнений можно изменить перед сохранением.</p>
      <div class="template-list section">
        ${state.templates.map((template, index) => `<button class="template-card" data-start-template="${template.id}">
          <span class="day-number">${index + 1}</span><span class="template-info"><h3>${esc(template.name)}</h3><p>${template.exerciseIds.length} упражнений</p></span><span class="chevron">›</span>
        </button>`).join('')}
        <button class="template-card" data-start-template="">
          <span class="day-number">＋</span><span class="template-info"><h3>Свободная тренировка</h3><p>Соберите состав самостоятельно</p></span><span class="chevron">›</span>
        </button>
      </div>`;
  }

  return renderSessionEditor(draftSession);
}

function makeDraft(templateId) {
  const template = templateId ? templateById(templateId) : null;
  return {
    id: uid('session'),
    templateId: template?.id || null,
    templateName: template?.name || 'Свободная тренировка',
    date: localISODate(),
    isNew: true,
    entries: (template?.exerciseIds || []).map((exerciseId) => {
      const exercise = exerciseById(exerciseId);
      const previous = resultsFor(exerciseId).at(-1);
      return {
        exerciseId,
        nameSnapshot: exercise?.name || 'Упражнение',
        weight: previous?.weight ?? '',
        reps: previous?.reps ?? 12
      };
    })
  };
}

function renderSessionEditor(session) {
  return `
    <div class="workout-meta">
      <label><span class="form-label">Дата</span><input class="field" id="sessionDate" type="date" value="${esc(session.date)}"></label>
      <label><span class="form-label">Название</span><input class="field" id="sessionName" value="${esc(session.templateName || 'Тренировка')}" maxlength="60"></label>
    </div>
    ${session.entries.length ? `<div class="entry-list">${session.entries.map((entry, index) => {
      const exercise = exerciseById(entry.exerciseId);
      const previous = resultsFor(entry.exerciseId, session.isNew ? null : session.id).filter((row) => row.date < session.date).at(-1);
      const earlier = resultsFor(entry.exerciseId, session.id).filter((row) => Number(row.weight) > 0);
      const bestScore = earlier.length ? Math.max(...earlier.map((row) => Number(row.weight))) : null;
      const currentBest = bestFor(entry.exerciseId);
      const winningIndex = session.entries.reduce((winner, candidate, candidateIndex) => candidate.exerciseId === entry.exerciseId && (winner < 0 || Number(candidate.weight || 0) >= Number(session.entries[winner].weight || 0)) ? candidateIndex : winner, -1);
      const isRecord = WorkoutData.isStrength(exercise) && index === winningIndex && Number(entry.weight) > 0 &&
        (bestScore === null || Number(entry.weight) > bestScore || (currentBest?.sessionId === session.id && Number(entry.weight) === Number(currentBest.weight)));
      return `<article class="entry-card" data-entry-index="${index}">
        <div class="entry-head"><span class="entry-avatar">${renderExerciseVisual(entry.exerciseId)}<span class="entry-index">${String(index + 1).padStart(2, '0')}</span></span><span class="entry-heading"><button type="button" class="entry-name" data-entry-progress="${esc(entry.exerciseId)}">${esc(exercise?.customName ? exercise.name : entry.sourceName || exercise?.name || entry.nameSnapshot)}</button><span class="entry-prev">было: ${resultText(previous)}</span></span><button class="entry-remove" data-remove-draft-entry="${index}" aria-label="Убрать упражнение">×</button></div>
        <div class="entry-fields">
          <label><span>Вес, кг</span><input inputmode="decimal" type="number" min="0" step="0.5" data-entry-field="weight" value="${esc(entry.weight)}" placeholder="—"></label>
          <label><span>Повторения</span><input inputmode="numeric" type="number" min="0" step="1" data-entry-field="reps" value="${esc(entry.reps)}"></label>
        </div>
        ${entry.dataQualityNote ? `<p class="entry-quality">${esc(entry.dataQualityNote)}<br>Исходная запись: ${esc(entry.raw)}</p>` : ''}
        ${isRecord ? '<div class="record-live">♛ ЛУЧШИЙ РЕЗУЛЬТАТ ЗА ВСЁ ВРЕМЯ</div>' : ''}
      </article>`;
    }).join('')}</div>` : renderEmpty('Упражнений пока нет', 'Добавьте нужные упражнения в эту тренировку.')}
    <button class="add-card session-add" data-add-draft-exercise>+ Добавить упражнение</button>
    <div class="form-actions">
      <button class="secondary-button" data-cancel-session>Отмена</button>
      <button class="primary-button" data-save-session ${session.entries.length ? '' : 'disabled'}>Сохранить</button>
    </div>
    ${session.isNew ? '' : '<button class="danger-button wide section" data-delete-session>Удалить эту тренировку</button>'}
  `;
}

function renderExercises() {
  return `
    <p class="muted tiny">Шаблоны помогают быстро начать тренировку, но не ограничивают её состав. Название упражнения общее и обновляется во всех шаблонах.</p>
    <section class="section">
      <div class="section-head"><h2>Шаблоны тренировок</h2><button class="text-button" data-add-template>+ Шаблон</button></div>
      ${state.templates.map((template) => `<div class="template-block">
        <div class="template-head"><h3>${esc(template.name)}</h3><span class="template-head-actions"><span class="muted tiny">${template.exerciseIds.length}</span><button class="mini-button" data-edit-template="${template.id}" aria-label="Переименовать шаблон">✎</button><button class="mini-button danger" data-delete-template="${template.id}" aria-label="Удалить шаблон">×</button></span></div>
        <div class="exercise-list">${template.exerciseIds.map((id, index) => {
          const exercise = exerciseById(id);
          if (!exercise) return '';
          const linked = state.templates.filter((item) => item.exerciseIds.includes(id));
          return `<div class="exercise-card"><div class="exercise-main">
            <span class="exercise-avatar">${renderExerciseVisual(id)}<span class="exercise-order">${index + 1}</span></span>
            <button type="button" class="exercise-title" data-progress-id="${esc(id)}">${esc(exercise.name)}<span class="exercise-tags">${linked.map((item) => `<span class="tag">${esc(item.name)}</span>`).join('')}</span></button>
            <span class="mini-actions">
              <button class="mini-button" data-move-exercise="up" data-template-id="${template.id}" data-exercise-id="${id}" aria-label="Выше">↑</button>
              <button class="mini-button" data-move-exercise="down" data-template-id="${template.id}" data-exercise-id="${id}" aria-label="Ниже">↓</button>
              <button class="mini-button" data-edit-exercise="${id}" aria-label="Изменить">✎</button>
              <button class="mini-button danger" data-remove-exercise="${id}" data-template-id="${template.id}" aria-label="Убрать">×</button>
            </span>
          </div></div>`;
        }).join('') || `<button class="add-card" data-add-exercise data-preselect-template="${template.id}">+ Добавить первое упражнение</button>`}</div>
      </div>`).join('') || renderEmpty('Шаблонов пока нет', 'Создайте шаблон или используйте свободную тренировку.')}
      <button class="add-card section" data-add-exercise>+ Новое упражнение</button>
    </section>
    ${renderProgrammeArchive()}
  `;
}

function renderProgrammeArchive() {
  const groups = WorkoutData.programmeHistory(state);
  if (!groups.length) return '';
  return `<section class="section programme-archive"><div class="section-head"><h2>Архив составов</h2></div><p class="muted tiny">Состав фактических тренировок, без весов. Новая версия появляется при изменении списка или порядка упражнений, а не при изменении веса.</p>
    ${groups.map((group) => `<details class="archive-group"><summary>${esc(templateById(group.id)?.name || group.name)}<span>${group.versions.length} версий</span></summary><div class="archive-versions">${[...group.versions].reverse().map((version) => `<button class="archive-version" data-archive-session="${esc(version.sessionId)}"><span>${formatDate(version.firstDate, { year: 'numeric' })}${version.lastDate !== version.firstDate ? `<small>По ${formatDate(version.lastDate, { year: 'numeric' })} · ${version.count} занятий</small>` : ''}</span><span>${version.entries.length} упражнений ›</span></button>`).join('')}</div></details>`).join('')}</section>`;
}

function openProgrammeSnapshot(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  openModal(`<div class="modal-head"><h2>${esc(session.templateName || 'Тренировка')}</h2><button class="close-button" data-close-modal aria-label="Закрыть">×</button></div><p class="muted">${formatDate(session.date, { year: 'numeric' })}</p><p class="muted tiny">Архив состава. Веса не отображаются; текущие шаблоны не изменяются.</p><ol class="archive-exercise-list">${session.entries.map((entry) => {
    const exercise = exerciseById(entry.exerciseId);
    return `<li>${esc(exercise?.customName ? exercise.name : entry.sourceName || entry.nameSnapshot || exercise?.name || 'Упражнение')}</li>`;
  }).join('')}</ol>`);
}

function renderExerciseMembership(exerciseId) {
  const current = state.templates.filter((template) => template.exerciseIds.includes(exerciseId));
  const currentIds = new Set(current.map((template) => template.id));
  const earlier = new Map();
  for (const session of sortedSessions()) {
    if (session.templateId && !currentIds.has(session.templateId) && !earlier.has(session.templateId) && session.entries.some((entry) => entry.exerciseId === exerciseId)) {
      earlier.set(session.templateId, templateById(session.templateId)?.name || session.templateName || 'Тренировка');
    }
  }
  return `<div class="exercise-membership"><p><span class="muted">Сейчас: </span>${current.length ? current.map((template) => `<span class="tag">${esc(template.name)}</span>`).join(' ') : 'не входит в текущие шаблоны'}</p>${earlier.size ? `<p><span class="muted">Раньше входило: </span>${[...earlier.values()].map((name) => `<span class="tag archive-tag">${esc(name)}</span>`).join(' ')}</p>` : ''}</div>`;
}

function renderProgress() {
  const available = state.exercises.filter((exercise) => resultsFor(exercise.id).length || exercise.id === selectedExerciseId).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (!available.length) return renderEmpty('Недостаточно данных', 'После первой сохранённой тренировки здесь появятся графики и статистика.');
  if (!selectedExerciseId || !available.some((item) => item.id === selectedExerciseId)) selectedExerciseId = available[0].id;
  const exercise = exerciseById(selectedExerciseId);
  const allRows = resultsFor(selectedExerciseId);
  const rows = filterRowsByRange(allRows, progressRange);
  const allTimeBest = bestFor(selectedExerciseId);
  const metric = (entry) => Number(allTimeBest.weight) > 0 ? Number(entry.weight || 0) : Number(entry.reps || 0);
  const periodBest = rows.length ? rows.reduce((best, row) => metric(row) > metric(best) ? row : best) : null;

  const rangeButtons = [
    ['1m', '1 мес.'],
    ['3m', '3 мес.'],
    ['6m', '6 мес.'],
    ['1y', '1 год'],
    ['all', 'Всё']
  ];

  return `
    <div class="progress-exercise-summary">${renderExerciseVisual(selectedExerciseId, 'progress-visual')}<span><span class="muted tiny">Динамика упражнения</span><strong>${esc(exercise.name)}</strong></span></div>
    <div class="progress-dropdown progress-picker" id="progressExerciseDropdown">
      <button class="progress-dropdown-trigger" id="progressExercisePicker" type="button" aria-expanded="false" aria-haspopup="listbox">
        <span>${esc(exercise.name)}</span><span class="dropdown-arrow" aria-hidden="true"></span>
      </button>
      <div class="progress-dropdown-menu hidden" id="progressExerciseMenu">
        <label class="progress-search"><span class="form-label">Поиск упражнения</span><input class="field" id="progressExerciseSearch" type="search" placeholder="Начните вводить название" autocomplete="off"></label>
        <div class="progress-options" role="listbox" aria-label="Упражнения по алфавиту">${available.map((item) => `<button class="progress-dropdown-option ${item.id === selectedExerciseId ? 'active' : ''}" type="button" role="option" aria-selected="${item.id === selectedExerciseId}" data-select-progress="${esc(item.id)}">${renderExerciseVisual(item.id, 'picker-visual')}<span>${esc(item.name)}</span></button>`).join('')}</div>
        <p class="muted tiny search-empty" id="progressSearchEmpty" hidden>Упражнений не найдено</p>
      </div>
    </div>
    ${renderExerciseMembership(selectedExerciseId)}
    <div class="range-picker" aria-label="Период графика">${rangeButtons.map(([value, label]) => `<button class="range-button ${progressRange === value ? 'active' : ''}" data-progress-range="${value}">${label}</button>`).join('')}</div>
    ${rows.length ? renderProgressDetails(rows, allTimeBest, periodBest) : renderEmpty('Нет тренировок за этот период', 'Выберите больший интервал, чтобы увидеть результаты.')}
  `;
}

function filterRowsByRange(rows, range) {
  if (range === 'all' || !rows.length) return rows;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  if (range === '1y') cutoff.setFullYear(cutoff.getFullYear() - 1);
  else cutoff.setMonth(cutoff.getMonth() - Number(range.replace('m', '')));
  const cutoffISO = localISODate(cutoff);
  return rows.filter((row) => row.date >= cutoffISO);
}

function renderProgressDetails(rows, allTimeBest, periodBest) {
  const first = rows[0];
  const last = rows.at(-1);
  const weighted = Number(allTimeBest.weight) > 0;
  const metric = (entry) => weighted ? Number(entry.weight || 0) : Number(entry.reps || 0);
  const isRecord = (row) => WorkoutData.isStrength(exerciseById(selectedExerciseId)) && weighted && row.sessionId === allTimeBest.sessionId;

  return `
    <div class="chart-card">
      <div class="chart-head"><div class="chart-value">${fmtNumber(metric(periodBest))}${esc(periodBest.weightSuffix || '')} <small>${weighted ? 'кг' : 'повт.'}</small></div><div class="delta">Лучший результат за выбранный период</div></div>
      <div class="chart-wrap"><canvas id="progressChart" aria-label="График прогресса. Коснитесь точки, затем подсказки, чтобы открыть тренировку."></canvas><button type="button" class="chart-tooltip" id="chartTooltip" aria-label="Открыть тренировку" hidden></button></div>
      <div class="chart-dates"><span>${shortDateWithYear(first.date)}</span><span>${shortDateWithYear(last.date)}</span></div>
    </div>
    <div class="metric-grid">
      <div class="metric-card"><span>ТРЕНИРОВОК</span><strong>${rows.length}</strong><small>за выбранный период</small></div>
      <div class="metric-card"><span>${weighted ? 'ЛУЧШИЙ ВЕС ЗА ВСЁ ВРЕМЯ' : 'БОЛЬШЕ ВСЕГО ПОВТОРЕНИЙ'}</span><strong>${resultText(allTimeBest)}</strong><small>${formatDate(allTimeBest.date, { year: 'numeric' })}</small></div>
      <div class="metric-card"><span>ПЕРВАЯ В ПЕРИОДЕ</span><strong>${shortDateWithYear(first.date)}</strong></div>
      <div class="metric-card"><span>ПОСЛЕДНЯЯ В ПЕРИОДЕ</span><strong>${shortDateWithYear(last.date)}</strong></div>
    </div>
    <section class="section"><div class="section-head"><h2>Результаты за период</h2></div><div class="result-table">${[...rows].reverse().map((row) => {
      const record = isRecord(row);
      return `<button class="result-row ${record ? 'result-best' : ''}" data-edit-session="${esc(row.sessionId)}"><span>${formatDate(row.date, { year: 'numeric' })}${record ? '<small class="result-best-label">Лучший результат за всё время</small>' : ''}</span><strong>${resultText(row)}</strong><span class="${record ? 'trophy' : 'muted'}" title="${record ? 'Текущий лучший результат' : 'Открыть тренировку'}">${record ? '♛' : '›'}</span></button>`;
    }).join('')}</div></section>
  `;
}

function drawProgressChart(selectedIndex = null) {
  const canvas = $('#progressChart');
  if (!canvas || !selectedExerciseId) return;
  const rows = filterRowsByRange(resultsFor(selectedExerciseId), progressRange);
  if (!rows.length) return;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const width = rect.width;
  const height = rect.height;
  const pad = { left: 42, right: 16, top: 25, bottom: 18 };
  const weighted = Number(bestFor(selectedExerciseId)?.weight) > 0;
  const values = rows.map((row) => weighted ? Number(row.weight || 0) : Number(row.reps || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rawRange = Math.max(max - min, 1);
  const roughStep = rawRange / 3;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const niceFactor = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10;
  const axisStep = niceFactor * magnitude;
  let displayMin = Math.max(0, Math.floor(min / axisStep) * axisStep);
  let displayMax = Math.ceil(max / axisStep) * axisStep;
  if (displayMax === displayMin) {
    displayMin = Math.max(0, displayMin - axisStep);
    displayMax += axisStep;
  }
  const range = displayMax - displayMin;
  const points = values.map((value, index) => ({
    x: rows.length === 1 ? (pad.left + width - pad.right) / 2 : pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right),
    y: height - pad.bottom - ((value - displayMin) / range) * (height - pad.top - pad.bottom)
  }));
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const tickCount = Math.round(range / axisStep);
  for (let index = 0; index <= tickCount; index += 1) {
    const value = displayMax - index * axisStep;
    const ratio = (displayMax - value) / range;
    const y = pad.top + ratio * (height - pad.top - pad.bottom);
    ctx.fillStyle = 'rgba(143,151,166,.9)';
    ctx.fillText(fmtNumber(value), 2, y);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; ctx.stroke();
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(200,255,71,.28)');
  gradient.addColorStop(1, 'rgba(200,255,71,0)');
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.lineTo(points.at(-1).x, height - pad.bottom); ctx.lineTo(points[0].x, height - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = '#c8ff47'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  points.forEach((point) => { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#0b0d12'; ctx.fill(); ctx.strokeStyle = '#c8ff47'; ctx.lineWidth = 2; ctx.stroke(); });
  if (points.length <= 8) {
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#f4f6ef';
    points.forEach((point, index) => ctx.fillText(fmtNumber(values[index]), point.x, Math.max(13, point.y - 9)));
  }
  if (selectedIndex !== null && points[selectedIndex]) {
    const point = points[selectedIndex];
    ctx.beginPath(); ctx.moveTo(point.x, pad.top); ctx.lineTo(point.x, height - pad.bottom); ctx.strokeStyle = 'rgba(200,255,71,.24)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(point.x, point.y, 7, 0, Math.PI * 2); ctx.fillStyle = '#c8ff47'; ctx.fill(); ctx.strokeStyle = '#0b0d12'; ctx.lineWidth = 3; ctx.stroke();
  }
  chartModel = { canvas, rows, points, selectedIndex };
  canvas.addEventListener('pointerdown', handleChartPointer);
}

function handleChartPointer(event) {
  if (!chartModel?.points.length) return;
  const rect = chartModel.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const index = chartModel.points.reduce((nearest, point, pointIndex) =>
    Math.abs(point.x - x) < Math.abs(chartModel.points[nearest].x - x) ? pointIndex : nearest, 0);
  if (chartModel.selectedIndex === index) {
    hideChartTooltip();
    return;
  }
  drawProgressChart(index);
  const point = chartModel.points[index];
  const row = chartModel.rows[index];
  const tooltip = $('#chartTooltip');
  const isRecord = WorkoutData.isStrength(exerciseById(selectedExerciseId)) && Number(row.weight) > 0 && bestFor(selectedExerciseId)?.sessionId === row.sessionId;
  tooltip.innerHTML = `<strong>${resultText(row)}</strong><span>${formatDate(row.date, { year: 'numeric' })}</span>${isRecord ? '<span class="trophy">♛ Текущий лучший результат</span>' : ''}<span class="tooltip-action">Открыть тренировку ›</span>`;
  tooltip.hidden = false;
  tooltip.dataset.sessionId = row.sessionId;
  tooltip.onclick = () => editSession(row.sessionId);
  const halfWidth = tooltip.getBoundingClientRect().width / 2 + 4;
  const tooltipX = Math.max(halfWidth, Math.min(point.x, chartModel.canvas.getBoundingClientRect().width - halfWidth));
  tooltip.style.left = `${tooltipX}px`;
  tooltip.style.top = `${Math.max(point.y, tooltip.getBoundingClientRect().height + 12)}px`;
  tooltip.classList.add('show');
}

function hideChartTooltip() {
  const tooltip = $('#chartTooltip');
  if (!tooltip?.classList.contains('show')) return;
  tooltip.classList.remove('show');
  tooltip.hidden = true;
  drawProgressChart(null);
}

function renderEmpty(title, copy) {
  return `<div class="empty-state"><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>`;
}

function bindScreenEvents() {
  $$('[data-screen-link]').forEach((button) => button.addEventListener('click', () => setScreen(button.dataset.screenLink)));
  $$('[data-progress-id]').forEach((button) => button.addEventListener('click', () => { selectedExerciseId = button.dataset.progressId; setScreen('progress'); }));
  $$('[data-open-insight]').forEach((button) => button.addEventListener('click', () => { insightType = button.dataset.openInsight; setScreen('insights'); }));
  $$('[data-insight-tab]').forEach((button) => button.addEventListener('click', () => { insightType = button.dataset.insightTab; render(); }));
  $('#recordsSearch')?.addEventListener('input', (event) => { recordsQuery = event.target.value; filterRecordCards(); });
  if (currentScreen === 'records') filterRecordCards();
  $$('[data-entry-progress]').forEach((button) => button.addEventListener('click', () => {
    syncDraftFromForm();
    selectedExerciseId = button.dataset.entryProgress;
    setScreen('progress', { keepDraft: true });
  }));
  $$('[data-history-filter]').forEach((button) => button.addEventListener('click', () => { historyFilter = button.dataset.historyFilter; render(); }));
  $$('[data-edit-session]').forEach((button) => button.addEventListener('click', () => editSession(button.dataset.editSession)));
  $$('[data-start-template]').forEach((button) => button.addEventListener('click', () => { draftSession = makeDraft(button.dataset.startTemplate); render(); }));
  $('[data-action="quick-start"]')?.addEventListener('click', (event) => { draftSession = makeDraft(event.currentTarget.dataset.templateId); setScreen('start', { keepDraft: true }); });
  $('#sessionDate')?.addEventListener('change', syncDraftFromForm);
  $('#sessionName')?.addEventListener('input', syncDraftFromForm);
  $$('[data-entry-field]').forEach((input) => {
    input.addEventListener('input', syncDraftFromForm);
    input.addEventListener('change', () => { syncDraftFromForm(); render(); });
  });
  $('[data-save-session]')?.addEventListener('click', saveDraftSession);
  $('[data-cancel-session]')?.addEventListener('click', () => { draftSession = null; setScreen('history'); });
  $('[data-delete-session]')?.addEventListener('click', deleteDraftSession);
  $('#progressExercisePicker')?.addEventListener('click', toggleProgressDropdown);
  $('#progressExerciseSearch')?.addEventListener('input', (event) => {
    const query = event.target.value.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
    const words = query.split(/\s+/).filter(Boolean);
    let matches = 0;
    $$('[data-select-progress]').forEach((button) => {
      const name = button.textContent.toLocaleLowerCase('ru').replace(/ё/g, 'е');
      button.hidden = !words.every((word) => name.includes(word));
      if (!button.hidden) matches += 1;
    });
    $('#progressSearchEmpty').hidden = matches > 0;
  });
  $$('[data-select-progress]').forEach((button) => button.addEventListener('click', () => {
    selectedExerciseId = button.dataset.selectProgress;
    render();
  }));
  $$('[data-progress-range]').forEach((button) => button.addEventListener('click', () => { progressRange = button.dataset.progressRange; render(); }));
  $('[data-add-draft-exercise]')?.addEventListener('click', openDraftExercisePicker);
  $$('[data-remove-draft-entry]').forEach((button) => button.addEventListener('click', () => removeDraftEntry(Number(button.dataset.removeDraftEntry))));
  $$('[data-add-exercise]').forEach((button) => button.addEventListener('click', () => openExerciseModal(null, button.dataset.preselectTemplate)));
  $$('[data-edit-exercise]').forEach((button) => button.addEventListener('click', () => openExerciseModal(button.dataset.editExercise)));
  $$('[data-remove-exercise]').forEach((button) => button.addEventListener('click', () => removeExerciseFromTemplate(button.dataset.exerciseId, button.dataset.templateId)));
  $$('[data-move-exercise]').forEach((button) => button.addEventListener('click', () => moveExercise(button.dataset.exerciseId, button.dataset.templateId, button.dataset.moveExercise)));
  $$('[data-add-template]').forEach((button) => button.addEventListener('click', () => openTemplateModal()));
  $$('[data-edit-template]').forEach((button) => button.addEventListener('click', () => openTemplateModal(button.dataset.editTemplate)));
  $$('[data-delete-template]').forEach((button) => button.addEventListener('click', () => deleteTemplate(button.dataset.deleteTemplate)));
  $$('[data-archive-session]').forEach((button) => button.addEventListener('click', () => openProgrammeSnapshot(button.dataset.archiveSession)));
  $$('[data-open-goal]').forEach((button) => button.addEventListener('click', openGoalModal));
}

function toggleProgressDropdown() {
  const menu = $('#progressExerciseMenu');
  const trigger = $('#progressExercisePicker');
  if (!menu || !trigger) return;
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willOpen);
  trigger.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) requestAnimationFrame(() => {
    const active = menu.querySelector('.progress-dropdown-option.active');
    if (!active) return;
    const searchHeight = menu.querySelector('.progress-search').offsetHeight;
    menu.scrollTop = Math.max(0, active.offsetTop - searchHeight - (menu.clientHeight - searchHeight - active.offsetHeight) / 2);
  });
}

function filterRecordCards() {
  const words = recordsQuery.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim().split(/\s+/).filter(Boolean);
  let count = 0;
  $$('[data-record-name]').forEach((card) => {
    const name = card.dataset.recordName.toLocaleLowerCase('ru').replace(/ё/g, 'е');
    card.hidden = !words.every((word) => name.includes(word));
    if (!card.hidden) count += 1;
  });
  const empty = $('#recordsSearchEmpty');
  if (empty) empty.hidden = count > 0;
}

function closeProgressDropdown() {
  $('#progressExerciseMenu')?.classList.add('hidden');
  $('#progressExercisePicker')?.setAttribute('aria-expanded', 'false');
}

function syncDraftFromForm() {
  if (!draftSession) return;
  draftSession.date = $('#sessionDate')?.value || draftSession.date;
  draftSession.templateName = $('#sessionName')?.value.trim() || draftSession.templateName;
  $$('.entry-card').forEach((card) => {
    const entry = draftSession.entries[Number(card.dataset.entryIndex)];
    const weight = $('[data-entry-field="weight"]', card).value;
    if (Number(weight) !== Number(entry.weight)) {
      delete entry.weightSuffix;
      if (Number(weight) > 0) delete entry.dataQualityNote;
    }
    entry.weight = weight;
    const reps = $('[data-entry-field="reps"]', card).value;
    if (Number(reps) !== Number(entry.reps)) delete entry.repsSuffix;
    entry.reps = reps;
  });
}

function openDraftExercisePicker() {
  syncDraftFromForm();
  const usedIds = new Set(draftSession.entries.map((entry) => entry.exerciseId));
  const available = state.exercises.filter((exercise) => !exercise.archived && !usedIds.has(exercise.id));
  openModal(`
    <div class="modal-head"><h2>Добавить упражнение</h2><button class="close-button" data-close-modal>×</button></div>
    ${available.length ? `<div class="picker-list">${available.map((exercise) => `<button class="picker-option" data-pick-draft="${exercise.id}">${renderExerciseVisual(exercise.id, 'picker-visual')}<span>${esc(exercise.name)}</span></button>`).join('')}</div>` : renderEmpty('Все упражнения добавлены', 'Можно создать новое упражнение.')}
    <button class="add-card section" id="newDraftExercise">+ Создать новое упражнение</button>
  `);
  $$('[data-pick-draft]').forEach((button) => button.addEventListener('click', () => addExerciseToDraft(button.dataset.pickDraft)));
  $('#newDraftExercise').addEventListener('click', openNewDraftExerciseModal);
}

function openNewDraftExerciseModal() {
  openModal(`
    <div class="modal-head"><h2>Новое упражнение</h2><button class="close-button" data-close-modal>×</button></div>
    <label class="form-group"><span class="form-label">Название</span><input class="field" id="draftExerciseName" placeholder="Например, жим ногами"></label>
    <button class="primary-button wide" id="saveDraftExercise">Создать и добавить</button>
  `);
  $('#draftExerciseName').focus();
  $('#saveDraftExercise').addEventListener('click', () => {
    const name = $('#draftExerciseName').value.trim();
    if (!name) return showToast('Введите название');
    const exercise = { id: uid('exercise'), name, archived: false };
    state.exercises.push(exercise);
    saveState();
    addExerciseToDraft(exercise.id);
  });
}

function addExerciseToDraft(exerciseId) {
  const exercise = exerciseById(exerciseId);
  if (!exercise || draftSession.entries.some((entry) => entry.exerciseId === exerciseId)) return;
  const previous = resultsFor(exerciseId).at(-1);
  draftSession.entries.push({ exerciseId, nameSnapshot: exercise.name, weight: previous?.weight ?? '', reps: previous?.reps ?? 12 });
  closeModal();
  render();
}

function removeDraftEntry(index) {
  syncDraftFromForm();
  const entry = draftSession.entries[index];
  const name = exerciseById(entry?.exerciseId)?.name || entry?.nameSnapshot || 'это упражнение';
  if (!confirm(`Вы точно уверены, что хотите убрать «${name}» из этой тренировки?`)) return;
  draftSession.entries.splice(index, 1);
  render();
}

function openTemplateModal(templateId = null) {
  const template = templateId ? templateById(templateId) : null;
  openModal(`
    <div class="modal-head"><h2>${template ? 'Изменить шаблон' : 'Новый шаблон'}</h2><button class="close-button" data-close-modal>×</button></div>
    <label class="form-group"><span class="form-label">Название</span><input class="field" id="templateName" value="${esc(template?.name || '')}" placeholder="Например, День 3"></label>
    <button class="primary-button wide" id="saveTemplate">Сохранить</button>
  `);
  $('#templateName').focus();
  $('#saveTemplate').addEventListener('click', () => {
    const name = $('#templateName').value.trim();
    if (!name) return showToast('Введите название');
    if (template) template.name = name;
    else state.templates.push({ id: uid('template'), name, exerciseIds: [] });
    saveState();
    closeModal();
    render();
    showToast(template ? 'Шаблон переименован' : 'Шаблон создан');
  });
}

function deleteTemplate(templateId) {
  const template = templateById(templateId);
  if (!template || !confirm(`Вы точно уверены, что хотите удалить шаблон «${template.name}»? Сохранённые тренировки останутся в истории.`)) return;
  state.templates = state.templates.filter((item) => item.id !== templateId);
  if (historyFilter === templateId) historyFilter = 'all';
  saveState();
  render();
  showToast('Шаблон удалён');
}

function saveDraftSession() {
  syncDraftFromForm();
  draftSession.entries = draftSession.entries
    .map((entry) => ({ ...entry, weight: entry.weight === '' ? null : Number(entry.weight), reps: entry.reps === '' ? null : Number(entry.reps) }))
    .filter((entry) => entry.exerciseId);
  if (!draftSession.date || !draftSession.entries.length) return showToast('Заполните хотя бы одно упражнение');
  const clean = { ...draftSession };
  delete clean.isNew;
  const index = state.sessions.findIndex((session) => session.id === clean.id);
  if (index >= 0) state.sessions[index] = clean; else state.sessions.push(clean);
  saveState();
  draftSession = null;
  showToast('Тренировка сохранена');
  setScreen('history');
}

function editSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  draftSession = JSON.parse(JSON.stringify({ ...session, isNew: false }));
  setScreen('start', { keepDraft: true });
}

function deleteDraftSession() {
  if (!draftSession || !confirm('Вы точно уверены, что хотите удалить эту тренировку? Это действие нельзя отменить без резервной копии.')) return;
  state.sessions = state.sessions.filter((session) => session.id !== draftSession.id);
  saveState();
  draftSession = null;
  showToast('Тренировка удалена');
  setScreen('history');
}

function moveExercise(exerciseId, templateId, direction) {
  const template = templateById(templateId);
  const index = template.exerciseIds.indexOf(exerciseId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= template.exerciseIds.length) return;
  [template.exerciseIds[index], template.exerciseIds[target]] = [template.exerciseIds[target], template.exerciseIds[index]];
  saveState(); render();
}

function removeExerciseFromTemplate(exerciseId, templateId) {
  const template = templateById(templateId);
  const exercise = exerciseById(exerciseId);
  if (!confirm(`Вы точно уверены, что хотите убрать «${exercise?.name}» из шаблона «${template?.name}»? История сохранится.`)) return;
  template.exerciseIds = template.exerciseIds.filter((id) => id !== exerciseId);
  saveState(); render();
}

function openModal(html) {
  $('#modalSheet').innerHTML = `<div class="modal-handle"></div>${html}`;
  bindExerciseImages($('#modalSheet'));
  $('#modalBackdrop').classList.remove('hidden');
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
}

function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
  $('#modalSheet').innerHTML = '';
}

function openExerciseModal(exerciseId = null, preselectTemplate = null) {
  const exercise = exerciseId ? exerciseById(exerciseId) : null;
  const selectedTemplates = exercise ? state.templates.filter((template) => template.exerciseIds.includes(exercise.id)).map((item) => item.id) : [preselectTemplate || state.templates[0]?.id];
  openModal(`
    <div class="modal-head"><h2>${exercise ? 'Изменить упражнение' : 'Новое упражнение'}</h2><button class="close-button" data-close-modal>×</button></div>
    <label class="form-group"><span class="form-label">Название</span><input class="field" id="exerciseName" value="${esc(exercise?.name || '')}" placeholder="Например, жим ногами"></label>
    <div class="form-group"><span class="form-label">Добавить в шаблоны</span><div class="check-list">${state.templates.map((template) => `<label class="check-item"><input type="checkbox" name="exerciseTemplate" value="${template.id}" ${selectedTemplates.includes(template.id) ? 'checked' : ''}><span>${esc(template.name)}</span></label>`).join('') || '<span class="muted tiny">Сначала создайте шаблон или сохраните упражнение только в общем списке.</span>'}</div></div>
    <button class="primary-button wide" id="saveExercise">Сохранить</button>
    ${exercise ? '<button class="danger-button wide section" id="archiveExercise">Удалить из всех шаблонов</button>' : ''}
  `);
  $('#exerciseName').focus();
  $('#saveExercise').addEventListener('click', () => saveExercise(exerciseId));
  $('#archiveExercise')?.addEventListener('click', () => archiveExercise(exerciseId));
}

function saveExercise(exerciseId) {
  const name = $('#exerciseName').value.trim();
  if (!name) return showToast('Введите название');
  const selected = $$('input[name="exerciseTemplate"]:checked').map((input) => input.value);
  let id = exerciseId;
  if (id) {
    exerciseById(id).name = name;
    exerciseById(id).customName = true;
  } else {
    id = uid('exercise');
    state.exercises.push({ id, name, archived: false });
  }
  state.templates.forEach((template) => {
    const has = template.exerciseIds.includes(id);
    const shouldHave = selected.includes(template.id);
    if (shouldHave && !has) template.exerciseIds.push(id);
    if (!shouldHave && has) template.exerciseIds = template.exerciseIds.filter((item) => item !== id);
  });
  saveState(); closeModal(); render(); showToast('Упражнение сохранено');
}

function archiveExercise(exerciseId) {
  const exercise = exerciseById(exerciseId);
  if (!confirm(`Вы точно уверены, что хотите удалить «${exercise?.name}» из всех шаблонов? История останется.`)) return;
  state.templates.forEach((template) => { template.exerciseIds = template.exerciseIds.filter((id) => id !== exerciseId); });
  exercise.archived = true;
  saveState(); closeModal(); render(); showToast('Упражнение убрано');
}

function openSettings() {
  openModal(`
    <div class="modal-head"><h2>Данные и установка</h2><button class="close-button" data-close-modal>×</button></div>
    <div class="settings-list">
      <button class="settings-button" id="weeklyGoalButton">План тренировок: ${Math.max(1, Number(state.settings?.weeklyGoal) || 2)} в неделю</button>
      <button class="settings-button" id="exportData">Скачать резервную копию</button>
      ${localStorage.getItem(`${STORAGE_KEY}-before-import`) ? '<button class="settings-button" id="exportBeforeImport">Скачать копию до последнего импорта</button>' : ''}
      <button class="settings-button" id="importData">Импортировать данные</button>
      <button class="settings-button" id="installHelp">Как установить на iPhone</button>
      <button class="settings-button danger" id="clearData">Очистить данные на этом устройстве</button>
    </div>
    <p class="muted tiny section">Все тренировки хранятся только в памяти браузера на этом устройстве. Создавайте резервную копию после важных изменений.</p>
  `);
  $('#weeklyGoalButton').addEventListener('click', openGoalModal);
  $('#exportData').addEventListener('click', exportData);
  $('#exportBeforeImport')?.addEventListener('click', () => downloadBackup(localStorage.getItem(`${STORAGE_KEY}-before-import`), 'before-import'));
  $('#importData').addEventListener('click', () => $('#importInput').click());
  $('#installHelp').addEventListener('click', showInstallHelp);
  $('#clearData').addEventListener('click', clearData);
}

function openGoalModal() {
  const currentGoal = Math.max(1, Number(state.settings?.weeklyGoal) || 2);
  openModal(`
    <div class="modal-head"><h2>План тренировок</h2><button class="close-button" data-close-modal>×</button></div>
    <p class="muted">Сколько тренировок вы планируете проводить каждую неделю?</p>
    <div class="goal-stepper"><button type="button" id="goalMinus" aria-label="Уменьшить">−</button><strong id="goalValue">${currentGoal}</strong><button type="button" id="goalPlus" aria-label="Увеличить">＋</button></div>
    <button class="primary-button wide section" id="saveGoal">Сохранить план</button>
  `);
  const changeGoal = (delta) => {
    const value = Math.max(1, Math.min(7, Number($('#goalValue').textContent) + delta));
    $('#goalValue').textContent = value;
  };
  $('#goalMinus').addEventListener('click', () => changeGoal(-1));
  $('#goalPlus').addEventListener('click', () => changeGoal(1));
  $('#saveGoal').addEventListener('click', () => {
    state.settings.weeklyGoal = Number($('#goalValue').textContent);
    saveState();
    closeModal();
    render();
    showToast('План тренировок сохранён');
  });
}

function showInstallHelp() {
  openModal(`
    <div class="modal-head"><h2>Установка на iPhone</h2><button class="close-button" data-close-modal>×</button></div>
    <p>1. Откройте адрес приложения в Safari.</p><p>2. Нажмите кнопку «Поделиться».</p><p>3. Выберите «На экран Домой».</p><p>4. Включите «Открывать как веб-приложение» и нажмите «Добавить».</p>
    <button class="primary-button wide section" data-close-modal>Понятно</button>
  `);
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
}

function exportData() {
  downloadBackup(JSON.stringify(state, null, 2));
  showToast('Резервная копия создана');
}

function downloadBackup(data, suffix = '') {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trenirovki-backup-${localISODate()}${suffix ? `-${suffix}` : ''}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(file) {
  try {
    const imported = normalizeState(JSON.parse(await file.text()));
    openModal(`<div class="modal-head"><h2>Импорт данных</h2><button class="close-button" data-close-modal>×</button></div>
      <p>В файле ${imported.sessions.length} тренировок.</p>
      <p class="muted tiny">Объединение обновит совпадающие записи из файла и сохранит другие тренировки на телефоне. Перед импортом приложение сохранит локальную резервную копию.</p>
      <button class="primary-button wide" id="mergeImport">Объединить с моими данными</button>
      <button class="secondary-button wide section" id="replaceImport">Заменить все данные</button>`);
    const applyImport = (replace) => {
      if (replace && !confirm('Вы точно уверены, что хотите заменить все данные на этом устройстве данными из файла?')) return;
      localStorage.setItem(`${STORAGE_KEY}-before-import`, JSON.stringify(state));
      state = replace ? imported : WorkoutData.merge(state, imported);
      saveState();
      closeModal();
      selectedExerciseId = null;
      showToast('Данные импортированы');
      setScreen('home');
    };
    $('#mergeImport').addEventListener('click', () => applyImport(false));
    $('#replaceImport').addEventListener('click', () => applyImport(true));
  } catch (error) {
    console.error(error);
    showToast('Не удалось прочитать файл');
  } finally {
    $('#importInput').value = '';
  }
}

function clearData() {
  if (!confirm('Вы точно уверены, что хотите удалить все тренировки и упражнения с этого устройства? Сначала рекомендуется скачать резервную копию.')) return;
  state = emptyState();
  saveState();
  closeModal();
  showToast('Локальные данные очищены');
  setScreen('home');
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => setScreen(button.dataset.screen)));
$('#moreButton').addEventListener('click', openSettings);
$('#backButton').addEventListener('click', () => {
  if (!history.state?.root && currentScreen !== 'home') history.back();
  else setScreen('home', { replaceHistory: true });
});
$('#modalBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal(); });
$('#importInput').addEventListener('change', (event) => { if (event.target.files[0]) importData(event.target.files[0]); });
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.progress-dropdown')) closeProgressDropdown();
  if (!event.target.closest('.chart-wrap')) hideChartTooltip();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeProgressDropdown();
    hideChartTooltip();
  }
});


const allowedScreens = new Set(['home', 'history', 'start', 'progress', 'insights', 'records', 'exercises']);
document.addEventListener('visibilitychange', () => document.body.classList.toggle('page-hidden', document.hidden));
document.body.classList.toggle('page-hidden', document.hidden);
const initialScreen = allowedScreens.has(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
history.replaceState({ screen: initialScreen, root: true }, '', `#${initialScreen}`);
window.addEventListener('popstate', (event) => setScreen(event.state?.screen || 'home', { fromHistory: true }));

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));

setScreen(initialScreen, { fromHistory: true });
