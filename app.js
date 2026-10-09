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
let draftSession = state.workoutDraft ? JSON.parse(JSON.stringify(state.workoutDraft)) : null;
let toastTimer;
let chartDrawFrame = null;
let cancelExerciseDrag = null;
let pendingConfirmation = null;
let modalTrail = [];
let coachScreenTrail = [];

const titles = {
  home: ['ТРЕНИРОВОЧНЫЙ ДНЕВНИК', 'Мой прогресс'],
  history: ['ВСЕ ЗАНЯТИЯ', 'История'],
  start: ['НОВАЯ ЗАПИСЬ', 'Тренировка'],
  progress: ['АНАЛИТИКА', 'Прогресс'],
  insights: ['АНАЛИЗ ДИНАМИКИ', 'Наблюдения'],
  records: ['ЛУЧШИЕ РЕЗУЛЬТАТЫ', 'Рекорды'],
  exercises: ['ОБЩИЙ СПРАВОЧНИК', 'Упражнения'],
  summary: ['СТАТИСТИКА УЧЕНИКА', 'Обзор']
};

function loadState() {
  try {
    if (isCoach()) return currentStudent() ? prepareCoachState(currentStudent().data) : coachProgramme();
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
  try {
    if (isCoach()) {
      if (currentStudent()) currentStudent().data = state;
      persistCoachWorkspace();
    } else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    workoutSaveFailed = false;
    updateWorkoutStatus();
    return true;
  } catch (error) {
    console.error(error);
    workoutSaveFailed = true;
    updateWorkoutStatus();
    showToast('Память недоступна. Скачайте резервную копию в настройках.');
    return false;
  }
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
  cancelExerciseDrag?.();
  rememberWorkoutPosition();
  if (isCoach() && ['home', 'records', 'insights'].includes(screen)) screen = 'start';
  if (!isCoach() && screen === 'summary') screen = 'home';
  const previousScreen = currentScreen;
  if (isCoach() && screen !== previousScreen) {
    if (options.replaceHistory) coachScreenTrail = [];
    else if (!options.fromHistory) coachScreenTrail.push(previousScreen);
  }
  if (screen === 'start' && !draftSession && state.workoutDraft) draftSession = JSON.parse(JSON.stringify(state.workoutDraft));
  if (isCoach() && screen === 'start' && !draftSession && currentStudent()) openStudentWorkout();
  if (screen === 'start') refreshPreparedProgramme();
  currentScreen = screen;
  const [eyebrow, title] = titles[screen] || titles.home;
  $('#screenEyebrow').textContent = eyebrow;
  $('#screenTitle').textContent = title;
  $('#backButton').classList.toggle('hidden', screen === 'home');
  $$('.nav-item').forEach((item) => {
    const active = item.dataset.screen === screen;
    item.classList.toggle('active', active);
    item.classList.toggle('nav-burst', active && screen !== previousScreen);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  if (options.replaceHistory) {
    history.replaceState({ screen, root: screen === 'home' }, '', `#${screen}`);
  } else if (!options.fromHistory && screen !== previousScreen) {
    history.pushState({ screen, root: false }, '', `#${screen}`);
  }
  render();
  if (screen === 'start' && (options.restoreWorkout || previousScreen !== 'start')) restoreWorkoutPosition();
  else window.scrollTo({ top: 0, behavior: 'instant' });
}

function render() {
  $('#screenEyebrow').hidden = false;
  cancelExerciseDrag?.();
  releaseProgressChart();
  renderWorkspaceShell();
  const renderers = { home: renderHome, history: renderHistory, start: renderStart, progress: renderProgress, insights: renderInsights, records: renderRecords, exercises: renderExercises, summary: renderCoachSummary };
  if (currentScreen === 'start') $('#screenEyebrow').textContent = draftSession && !draftSession.isNew ? 'СОХРАНЁННАЯ ТРЕНИРОВКА' : 'НОВАЯ ЗАПИСЬ';
  $('#mainContent').innerHTML = renderers[currentScreen]();
  if (!isCoach() && currentScreen === 'home' && state.workoutDraft) {
    $('#mainContent').insertAdjacentHTML('afterbegin', `<button class="resume-workout" id="resumeWorkout"><span><small>${state.workoutDraft.startedAt ? 'Занятие не завершено' : 'Сохранённый черновик'}</small><strong>${esc(state.workoutDraft.templateName)}</strong></span><span>Продолжить ›</span></button>`);
  }
  if (isCoach()) {
    const coachStatus = currentScreen === 'start' ? (draftSession && !draftSession.isNew ? 'ЗАВЕРШЁННОЕ ЗАНЯТИЕ' : draftSession?.startedAt ? 'ЗАНЯТИЕ ИДЁТ' : '') : (titles[currentScreen]?.[1] || 'Тренировка');
    $('#screenEyebrow').textContent = coachStatus;
    $('#screenEyebrow').hidden = !coachStatus;
    $('#screenTitle').textContent = currentStudent()?.name || 'Ваши ученики';
    $('#backButton').classList.add('hidden');
  } else if (currentScreen === 'start' && draftSession?.startedAt) {
    $('#screenEyebrow').hidden = false;
    $('#screenEyebrow').textContent = draftSession.isNew ? 'ЗАНЯТИЕ ИДЁТ' : 'СОХРАНЁННАЯ ТРЕНИРОВКА';
  }
  updateWorkoutStatus();
  updateHeaderProgress();
  bindScreenEvents();
  bindExerciseImages();
  if (currentScreen === 'progress') chartDrawFrame = requestAnimationFrame(() => {
    chartDrawFrame = null;
    drawProgressChart();
  });
}

function releaseProgressChart() {
  if (chartDrawFrame !== null) cancelAnimationFrame(chartDrawFrame);
  chartDrawFrame = null;
  const canvas = $('#progressChart');
  if (canvas) {
    // Release the drawing buffer before replacing the old screen.
    canvas.width = 0;
    canvas.height = 0;
  }
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
          return `<div class="attendance-week" title="${week.count} из ${week.goal}" aria-label="Неделя ${shortDate(week.startISO)}: ${week.count} из ${week.goal} тренировок"><span class="attendance-track"><i style="height:${percent}%" class="${week.count >= week.goal ? 'complete' : ''}"></i></span><span class="attendance-date">${shortDate(week.startISO)}</span></div>`;
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
      ${recentRecords.length ? `<div class="record-list">${recentRecords.map(record => renderRecordCard(record, true)).join('')}</div>` : renderEmpty('Новых рекордов пока нет', 'Здесь появятся силовые результаты, которые превысили предыдущий лучший вес.')}
    </section>
  `;
}

function renderHistory() {
  const sessions = sortedSessions().filter((session) => historyFilter === 'all' || session.templateId === historyFilter);
  return `
    <div class="segmented history-segments">
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
      if (insightType === 'stalled') return `<button class="observation-card stalled-card" data-progress-id="${esc(item.exercise.id)}">
        <span class="stalled-heading">${renderExerciseVisual(item.exercise.id)}<strong>${esc(item.exercise.name)}</strong><span class="stalled-chevron" aria-hidden="true">›</span></span>
        <span class="stalled-metrics"><span><small>Вес без изменений</small><strong>${fmtNumber(item.last.weight)} <span>кг</span></strong></span><span><small>Занятий подряд</small><strong>${item.stalled}</strong></span></span>
        <span class="stalled-sessions">${item.rows.map(row => `<span class="stalled-session"><span>${shortDateWithYear(row.date)}</span><strong>${fmtNumber(row.weight)}${esc(row.weightSuffix || '')} кг</strong><small>${fmtNumber(row.reps)} повт.</small></span>`).join('')}</span>
      </button>`;
      return `<button class="observation-card" data-progress-id="${item.exercise.id}">
        <span class="observation-avatar">${renderExerciseVisual(item.exercise.id)}<span class="observation-rank">${item.rank || index + 1}</span></span>
        <span class="observation-copy"><strong>${esc(item.exercise.name)}</strong><small>${insightSummary(item)}</small><span class="observation-series">${item.rows.map((row) => `${shortDateWithYear(row.date)}: ${resultText(row)}`).join('<br>')}</span></span>
        <span class="observation-value ${insightType === 'stalled' ? 'warning' : ''}">${insightType === 'strongest' ? `${item.increases} из 3 ↑` : 'На месте'}</span>
      </button>`;
    }).join('') : renderEmpty(insightType === 'stalled' ? 'Застоя не найдено' : 'Стабильного роста пока нет', insightType === 'stalled' ? 'Нет трёх одинаковых последних силовых результатов подряд.' : 'Нужны четыре занятия с сентября 2026, рост веса на последнем и отсутствие снижений в выборке.')}</div>
  `;
}

function insightSummary(item) {
  if (item.stalled) return `${item.stalled} занятия подряд: ${resultText(item.last)}`;
  return `${fmtNumber(item.first.weight)} → ${fmtNumber(item.last.weight)} кг · +${fmtNumber(item.gain)} кг<br>Повышений подряд: ${item.growthStreak}; всего ${item.increases} из 3<br>Прибавки между занятиями: ${item.stepRates.map((rate) => `+${fmtNumber(rate)}%`).join(' · ')}<br>Темп с учётом равномерности: ${fmtNumber(item.balancedRate)}% / занятие`;
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

function renderRecordCard({ exercise, best, firstAchieved, previousBeforeFirst }, home = false) {
  return `<div class="record-card" data-record-exercise="${esc(exercise.id)}" data-record-name="${esc(exercise.name)}">
    <button type="button" class="record-progress-target" data-progress-id="${esc(exercise.id)}" aria-label="Прогресс: ${esc(exercise.name)}"></button>
    ${renderExerciseVisual(exercise.id, 'record-visual')}
    <span class="record-copy"><h3>${esc(exercise.name)}</h3>
      <span class="record-result">${fmtNumber(best.weight)}${esc(best.weightSuffix || '')} <span class="record-unit">кг</span><small><span aria-hidden="true">♛</span> BEST ALL TIME</small></span>
      <p class="record-date">Рекорд · ${shortDateWithYear(firstAchieved.date)}</p>
      <p class="record-previous">${previousBeforeFirst ? `До него: ${fmtNumber(previousBeforeFirst.weight)}${esc(previousBeforeFirst.weightSuffix || '')} кг · ${shortDateWithYear(previousBeforeFirst.date)}` : 'Более раннего результата нет'}</p>
    </span>
    <button type="button" class="record-session-link" ${home ? `data-progress-id="${esc(exercise.id)}" aria-label="Открыть прогресс: ${esc(exercise.name)}"` : `data-edit-session="${esc(firstAchieved.sessionId)}" aria-label="Открыть тренировку: ${esc(exercise.name)}, ${shortDateWithYear(firstAchieved.date)}"`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>
  </div>`;
}

function renderRecords() {
  const events = currentRecordEvents();
  return `<label class="form-group"><span class="form-label">Поиск упражнения</span><input type="search" class="field" id="recordsSearch" value="${esc(recordsQuery)}" placeholder="Название упражнения" autocomplete="off"></label>
  <p class="muted tiny">Лучший вес, дата установления и рекорд до него. Карточка открывает прогресс упражнения, стрелка справа — тренировку, где этот максимум впервые выполнен.</p>
  ${events.length ? `<div class="record-list section">${events.map(record => renderRecordCard(record)).join('')}</div><p class="muted tiny section" id="recordsSearchEmpty" hidden>Упражнений не найдено.</p>` : renderEmpty('Результатов пока нет', 'Здесь появятся лучшие веса силовых упражнений.')}`;
}

function recordEntriesInSession(session) {
  return WorkoutData.bestRecords(state).filter((event) => event.best.sessionId === session.id).length;
}

function renderStart() {
  if (isCoach() && !currentStudent()) return `<div class="coach-empty"><h2>Кого тренируем сегодня?</h2><p class="muted">Добавьте первого ученика. Его программа и занятия будут храниться отдельно.</p><button class="primary-button wide" id="firstStudent">Добавить ученика</button></div>`;
  if (!draftSession) {
    return `
      <p class="muted">Выберите программу. Занятие начнётся только после нажатия «Начать занятие».</p>
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
    programmeName: template?.name || '',
    programmeFingerprint: template ? JSON.stringify([template.name, template.exerciseIds]) : null,
    date: localISODate(),
    isNew: true,
    entries: (template?.exerciseIds || []).map((exerciseId) => {
      const exercise = exerciseById(exerciseId);
      const previous = resultsFor(exerciseId).at(-1);
      return {
        entryId: uid('entry'),
        exerciseId,
        nameSnapshot: exercise?.name || 'Упражнение',
        weight: previous?.weight ?? '',
        reps: previous?.reps ?? 12
      };
    })
  };
}

function renderSessionEditor(session) {
  session.entries.forEach(entry => { if (!entry.entryId) entry.entryId = uid('entry'); });
  const started = !!session.startedAt;
  const editing = !session.isNew;
  return `
    <section class="workout-toolbar" data-workout-session data-session-id="${esc(session.id)}">
      <button class="programme-switch" data-choose-programme ${editing ? 'hidden' : ''} aria-label="Сменить программу занятия"><span class="programme-switch-copy"><small>Программа</small><strong>${esc(session.templateName)}</strong></span><span class="programme-switch-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></button>
      <button class="workout-share-button" data-share-workout aria-label="Поделиться тренировкой картинкой" title="Поделиться картинкой"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M6 11H4v10h16V11h-2"/></svg></button>
      ${editing ? '<span class="workout-completed-status">✓ Завершена</span>' : started ? '<button class="primary-button" data-save-session>Завершить</button>' : '<button class="primary-button" data-begin-session>Начать занятие</button>'}
    </section>
    <p id="workoutSaveStatus" role="alert" hidden></p>
    ${isCoach() && currentStudent()?.note ? `<p class="coach-student-note">${esc(currentStudent().note)}</p>` : ''}
    ${!started && !editing ? '<p class="workout-explanation">Программы чередуются по порядку. Можно выбрать другую перед началом.</p>' : ''}
    ${editing ? `<details class="workout-meta-details"><summary>Дата и название занятия</summary><div class="workout-meta">
      <label><span class="form-label">Дата</span><input class="field" id="sessionDate" type="date" value="${esc(session.date)}"></label>
      <label><span class="form-label">Название в истории</span><input class="field" id="sessionName" value="${esc(session.templateName || 'Тренировка')}" maxlength="60"></label>
    </div><p>Изменения обновят эту запись и не создадут новую тренировку.</p></details>` : ''}
    ${session.entries.length ? `<div class="entry-list" data-reorder-draft>${session.entries.map((entry, index) => {
      const exercise = exerciseById(entry.exerciseId);
      const previous = resultsFor(entry.exerciseId, session.isNew ? null : session.id).filter((row) => row.date < session.date).at(-1);
      const earlier = resultsFor(entry.exerciseId, session.id).filter((row) => Number(row.weight) > 0);
      const bestScore = earlier.length ? Math.max(...earlier.map((row) => Number(row.weight))) : null;
      const currentBest = bestFor(entry.exerciseId);
      const winningIndex = session.entries.reduce((winner, candidate, candidateIndex) => candidate.exerciseId === entry.exerciseId && (winner < 0 || Number(candidate.weight || 0) >= Number(session.entries[winner].weight || 0)) ? candidateIndex : winner, -1);
      const isRecord = WorkoutData.isStrength(exercise) && index === winningIndex && Number(entry.weight) > 0 &&
        (bestScore === null || Number(entry.weight) > bestScore || (currentBest?.sessionId === session.id && Number(entry.weight) === Number(currentBest.weight)));
      return `<article class="entry-card ${session.lastEntryId === entry.entryId ? 'entry-last-edited' : ''} ${entry.done ? 'entry-done' : ''}" data-entry-index="${index}" data-entry-id="${esc(entry.entryId)}">
        <div class="entry-head"><span class="entry-avatar">${renderExerciseVisual(entry.exerciseId)}<span class="entry-index">${String(index + 1).padStart(2, '0')}</span></span><span class="entry-heading"><button type="button" class="entry-name" data-entry-progress="${esc(entry.exerciseId)}">${esc(exercise?.customName ? exercise.name : entry.sourceName || exercise?.name || entry.nameSnapshot)}</button><span class="entry-prev">было: ${resultText(previous)}</span></span><span class="entry-actions"><button type="button" class="mini-button reorder-handle" data-reorder-handle aria-label="Удерживайте, чтобы переместить упражнение" title="Удерживайте и перетащите"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></button><button class="entry-remove" data-remove-draft-entry="${index}" aria-label="Убрать упражнение">×</button></span></div>
        <div class="entry-fields">
          <label><span>Вес, кг</span><input inputmode="decimal" type="number" min="0" step="0.5" data-entry-field="weight" value="${esc(entry.weight)}" placeholder="—"></label>
          <label><span>Повторения</span><input inputmode="numeric" type="number" min="0" step="1" data-entry-field="reps" value="${esc(entry.reps)}"></label>
        </div>
        <div class="entry-footer"><span class="entry-position-label">${session.lastEntryId === entry.entryId ? 'Остановились здесь' : ''}</span>${started || editing ? `<button type="button" class="entry-done-button" data-entry-done="${index}" aria-pressed="${!!entry.done}"><span aria-hidden="true">${entry.done ? '✓' : '○'}</span> ${entry.done ? 'Выполнено' : 'Готово'}</button>` : ''}</div>
        ${entry.dataQualityNote ? `<p class="entry-quality">${esc(entry.dataQualityNote)}<br>Исходная запись: ${esc(entry.raw)}</p>` : ''}
        ${isRecord && !isCoach() ? '<div class="record-live">♛ ЛУЧШИЙ РЕЗУЛЬТАТ ЗА ВСЁ ВРЕМЯ</div>' : ''}
      </article>`;
    }).join('')}</div>` : renderEmpty('Упражнений пока нет', 'Добавьте нужные упражнения в эту тренировку.')}
    <button class="add-card session-add" data-add-draft-exercise>+ Добавить упражнение</button>
    <div class="form-actions workout-end-actions">
      ${editing ? '<button class="secondary-button wide" data-close-editor>К истории занятий</button><button class="primary-button wide" data-next-workout>Следующая тренировка</button>' : `<button class="${started ? 'primary-button' : 'secondary-button'}" ${started ? 'data-finish-session' : 'data-discard-draft'}>${started ? 'Завершить' : 'Убрать черновик'}</button>`}
    </div>
    ${started && !editing ? '<button class="text-button discard-workout" data-discard-draft>Отменить занятие</button>' : ''}
    ${session.isNew ? '' : '<button class="danger-button wide section" data-delete-session>Удалить эту тренировку</button>'}
  `;
}

function renderExercises() {
  return `
    <p class="muted tiny">${isCoach() ? 'Программа выбранного ученика. Изменения применяются к следующим занятиям.' : 'Шаблоны помогают быстро начать тренировку. Название упражнения общее для всех шаблонов.'} Для перестановки удерживайте ручку с точками.</p>
    <section class="section">
      <div class="section-head"><h2>${isCoach() ? 'Тренировки по порядку' : 'Шаблоны тренировок'}</h2><button class="text-button" data-add-template>+ Тренировка</button></div>
      ${isCoach() ? '<p class="muted tiny">После завершения выбирается следующая тренировка. После последней — снова первая.</p>' : ''}
      ${state.templates.map((template, templateIndex) => `${isCoach() ? `<details class="template-block programme-fold"><summary><span class="programme-order">${templateIndex + 1}</span><span><strong>${esc(template.name)}</strong><small>${template.exerciseIds.length} упражнений${template.id === nextTemplateId() ? ' · следующая' : ''}</small></span><span class="programme-chevron" aria-hidden="true">⌄</span></summary><div class="programme-fold-content"><button class="secondary-button wide" data-use-template="${esc(template.id)}">Выбрать для занятия</button>` : '<div class="template-block">'}
        <div class="template-head"><h3>${esc(template.name)}</h3><span class="template-head-actions"><span class="muted tiny">${template.exerciseIds.length}</span><button class="mini-button" data-edit-template="${template.id}" aria-label="Переименовать шаблон">✎</button><button class="mini-button danger" data-delete-template="${template.id}" aria-label="Удалить шаблон">×</button></span></div>
        <div class="exercise-list" data-reorder-template="${esc(template.id)}">${template.exerciseIds.map((id, index) => {
          const exercise = exerciseById(id);
          if (!exercise) return '';
          const linked = state.templates.filter((item) => item.exerciseIds.includes(id));
          return `<div class="exercise-card" data-reorder-exercise="${esc(id)}"><div class="exercise-main">
            <span class="exercise-avatar">${renderExerciseVisual(id)}<span class="exercise-order">${index + 1}</span></span>
            <button type="button" class="exercise-title" data-progress-id="${esc(id)}">${esc(exercise.name)}<span class="exercise-tags">${linked.map((item) => `<span class="tag">${esc(item.name)}</span>`).join('')}</span></button>
            <span class="mini-actions">
              <button type="button" class="mini-button reorder-handle" data-reorder-handle aria-label="Удерживайте, чтобы переместить ${esc(exercise.name)}" title="Удерживайте и перетащите. С клавиатуры: стрелки, Home, End."><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></button>
              <button class="mini-button" data-edit-exercise="${id}" aria-label="Изменить">✎</button>
              <button class="mini-button danger" data-remove-exercise="${id}" data-template-id="${template.id}" aria-label="Убрать">×</button>
            </span>
          </div></div>`;
        }).join('')}</div>
        <button class="add-card section" data-add-exercise data-preselect-template="${esc(template.id)}">+ Добавить упражнение</button>
      ${isCoach() ? '</div></details>' : '</div>'}`).join('') || renderEmpty('Шаблонов пока нет', 'Создайте шаблон или используйте свободную тренировку.')}
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
  const periodLabel = { '1m': 'за месяц', '3m': 'за 3 месяца', '6m': 'за 6 месяцев', '1y': 'за год', all: 'за всё время' }[progressRange] || 'за всё время';
  const middle = rows[Math.floor((rows.length - 1) / 2)];
  const chartDates = rows.length === 1
    ? `<span class="chart-date-only">${shortDateWithYear(first.date)}</span>`
    : `<span class="chart-date-first">${shortDateWithYear(first.date)}</span>${rows.length > 2 ? `<span class="chart-date-middle">${shortDateWithYear(middle.date)}</span>` : ''}<span class="chart-date-last">${shortDateWithYear(last.date)}</span>`;

  return `
    <section class="period-highlight" aria-label="Лучший результат за выбранный период">
      <span class="period-emblem" aria-hidden="true">${isRecord(periodBest) ? '<svg viewBox="0 0 24 24"><path d="m3 7 5 4 4-7 4 7 5-4-2 12H5L3 7ZM6 22h12"/></svg>' : '<svg viewBox="0 0 24 24"><path d="m5 16 5-5 4 3 5-9M14 5h5v5"/></svg>'}</span>
      <div class="period-copy"><p>Лучший результат за выбранный период</p><div class="period-value">${fmtNumber(metric(periodBest))}${esc(periodBest.weightSuffix || '')} <span>${weighted ? 'кг' : 'повт.'}</span></div><span class="period-date">${formatDate(periodBest.date, { year: 'numeric' })}</span></div>
    </section>
    <div class="chart-card">
      <div class="chart-wrap"><canvas id="progressChart" aria-label="График прогресса со значениями результатов"></canvas></div>
      <div class="chart-dates">${chartDates}</div>
    </div>
    <div class="metric-grid">
      <div class="metric-card metric-count"><div><span>Тренировок</span><small>${periodLabel}</small></div><strong>${rows.length}</strong></div>
      <div class="metric-card metric-date"><span>Первое занятие</span><strong>${shortDateWithYear(first.date)}</strong></div>
      <div class="metric-card metric-date"><span>Последнее занятие</span><strong>${shortDateWithYear(last.date)}</strong></div>
    </div>
    <section class="section"><div class="section-head"><h2>Результаты за период</h2></div><div class="result-table">${[...rows].reverse().map((row) => {
      const record = isRecord(row);
      return `<button class="result-row ${record ? 'result-best' : ''}" data-edit-session="${esc(row.sessionId)}"><span>${formatDate(row.date, { year: 'numeric' })}${record ? '<small class="result-best-label">Лучший результат за всё время</small>' : ''}</span><strong>${resultText(row)}</strong><span class="${record ? 'trophy' : 'muted'}" title="${record ? 'Текущий лучший результат' : 'Открыть тренировку'}">${record ? '♛' : '›'}</span></button>`;
    }).join('')}</div></section>
  `;
}

function drawProgressChart() {
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
  ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
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
  const labelCount = Math.min(4, points.length);
  const labelIndexes = [...new Set(Array.from({ length: labelCount }, (_, index) =>
    labelCount === 1 ? 0 : Math.round(index * (points.length - 1) / (labelCount - 1))
  ))];
  const visiblePoints = points.length <= 12 ? points.map((_, index) => index) : labelIndexes;
  visiblePoints.forEach((index) => {
    const point = points[index];
    ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#0b0d12'; ctx.fill(); ctx.strokeStyle = '#c8ff47'; ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.font = '700 12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#f4f6ef';
  labelIndexes.forEach((index) => {
    const point = points[index];
    ctx.fillText(fmtNumber(values[index]), point.x, Math.max(13, point.y - 9));
  });
}

function renderEmpty(title, copy) {
  return `<div class="empty-state"><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>`;
}

function bindScreenEvents() {
  bindAttendanceCalendar();
  $('#resumeWorkout')?.addEventListener('click', () => { draftSession = structuredClone(state.workoutDraft); setScreen('start', { restoreWorkout: true }); });
  $$('[data-screen-link]').forEach((button) => button.addEventListener('click', () => navigateWorkspaceScreen(button.dataset.screenLink)));
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
  $$('[data-start-template]').forEach((button) => button.addEventListener('click', () => beginDraft(button.dataset.startTemplate)));
  $('[data-action="quick-start"]')?.addEventListener('click', (event) => beginDraft(event.currentTarget.dataset.templateId));
  $('#firstStudent')?.addEventListener('click', () => openStudentEditor());
  $('[data-begin-session]')?.addEventListener('click', startWorkout);
  $('[data-choose-programme]')?.addEventListener('click', chooseWorkoutProgramme);
  $('[data-discard-draft]')?.addEventListener('click', discardWorkout);
  $$('[data-close-editor]').forEach(button => button.addEventListener('click', () => { syncDraftFromForm(); draftSession = null; setScreen('history'); }));
  $('#sessionDate')?.addEventListener('change', syncDraftFromForm);
  $('#sessionName')?.addEventListener('input', syncDraftFromForm);
  $$('[data-entry-field]').forEach((input) => {
    input.addEventListener('focus', event => {
      draftSession.lastEntryId = event.target.closest('.entry-card').dataset.entryId;
      persistWorkout();
      updateWorkoutMarkers();
    });
    input.addEventListener('input', event => {
      draftSession.lastEntryId = event.target.closest('.entry-card').dataset.entryId;
      draftSession.hasEdits = true;
      syncDraftFromForm();
      updateWorkoutMarkers();
    });
  });
  $$('[data-entry-done]').forEach(button => button.addEventListener('click', () => {
    syncDraftFromForm();
    const entry = draftSession.entries[Number(button.dataset.entryDone)];
    entry.done = !entry.done;
    const next = entry.done ? draftSession.entries.slice(Number(button.dataset.entryDone) + 1).find(item => !item.done) || draftSession.entries.find(item => !item.done) : null;
    draftSession.lastEntryId = next?.entryId || entry.entryId;
    if (!persistWorkout()) return;
    updateWorkoutMarkers();
    if (entry.done && draftSession.isNew && draftSession.startedAt && draftSession.entries.length && draftSession.entries.every(item => item.done)) {
      saveDraftSession({ automatic: true });
      return;
    }
    if (next) revealExercise(next.entryId);
  }));
  $('[data-next-workout]')?.addEventListener('click', () => { syncDraftFromForm(); draftSession = null; beginDraft(nextTemplateId()); window.scrollTo({ top: 0, behavior: 'instant' }); });
  $('[data-share-workout]')?.addEventListener('click', openWorkoutShare);
  $$('[data-use-template]').forEach(button => button.addEventListener('click', () => useWorkoutProgramme(button.dataset.useTemplate)));
  $('[data-save-session]')?.addEventListener('click', saveDraftSession);
  $('[data-finish-session]')?.addEventListener('click', saveDraftSession);
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
  bindExerciseReordering();
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
  if (!draftSession || document.querySelector('[data-workout-session]')?.dataset.sessionId !== draftSession.id) return;
  draftSession.date = $('#sessionDate')?.value || draftSession.date;
  draftSession.templateName = $('#sessionName')?.value.trim() || draftSession.templateName;
  $$('.entry-card', $('#mainContent')).forEach((card) => {
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
  persistWorkout();
}

function openDraftExercisePicker() {
  syncDraftFromForm();
  const usedIds = new Set(draftSession.entries.map((entry) => entry.exerciseId));
  const available = state.exercises.filter((exercise) => !exercise.archived && !usedIds.has(exercise.id));
  openModal(`
    <div class="modal-head"><h2>Добавить упражнение</h2><button class="close-button" data-close-modal>×</button></div>
    <button class="add-card exercise-create-first" id="newDraftExercise">＋ Создать своё упражнение</button>
    <label class="form-group"><span class="form-label">Поиск среди существующих</span><input class="field" id="draftExerciseSearch" type="search" placeholder="Название упражнения" autocomplete="off"></label>
    ${available.length ? `<div class="picker-list">${available.map((exercise) => `<button class="picker-option" data-pick-draft="${esc(exercise.id)}" data-exercise-search="${esc(exercise.name)}">${renderExerciseVisual(exercise.id, 'picker-visual')}<span>${esc(exercise.name)}</span></button>`).join('')}</div><p class="muted tiny" id="draftExerciseSearchEmpty" hidden>Ничего не найдено. Измените запрос или создайте своё упражнение выше.</p>` : renderEmpty('Все упражнения добавлены', 'Можно создать своё упражнение — кнопка выше.')}
  `);
  $$('[data-pick-draft]').forEach((button) => button.addEventListener('click', () => addExerciseToDraft(button.dataset.pickDraft)));
  $('#newDraftExercise').addEventListener('click', openNewDraftExerciseModal);
  $('#draftExerciseSearch').addEventListener('input', event => {
    const normalize = value => value.toLocaleLowerCase('ru').replace(/ё/g, 'е');
    const words = normalize(event.target.value).trim().split(/\s+/).filter(Boolean);
    const buttons = $$('[data-pick-draft]');
    buttons.forEach(button => { button.hidden = !words.every(word => normalize(button.dataset.exerciseSearch).includes(word)); });
    const empty = $('#draftExerciseSearchEmpty');
    if (empty) empty.hidden = buttons.some(button => !button.hidden);
  });
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
  draftSession.entries.push({ entryId: uid('entry'), exerciseId, nameSnapshot: exercise.name, weight: previous?.weight ?? '', reps: previous?.reps ?? 12 });
  persistWorkout();
  closeModal();
  render();
}

async function removeDraftEntry(index) {
  syncDraftFromForm();
  const entry = draftSession.entries[index];
  const name = exerciseById(entry?.exerciseId)?.name || entry?.nameSnapshot || 'это упражнение';
  if (!await confirmAction(`Убрать «${name}» из этой тренировки? Остальные упражнения и введённые результаты останутся.`, 'Убрать упражнение?', 'Убрать')) return;
  draftSession.entries.splice(index, 1);
  persistWorkout();
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

async function deleteTemplate(templateId) {
  const template = templateById(templateId);
  if (!template || !await confirmAction(`Удалить шаблон «${template.name}»? Сохранённые тренировки останутся в истории.`, 'Удалить шаблон?')) return;
  state.templates = state.templates.filter((item) => item.id !== templateId);
  if (historyFilter === templateId) historyFilter = 'all';
  saveState();
  render();
  showToast('Шаблон удалён');
}

let finishingWorkout = false;
async function saveDraftSession({ automatic = false } = {}) {
  if (finishingWorkout) return;
  if (!draftSession || (draftSession.isNew && !draftSession.startedAt)) return;
  finishingWorkout = true;
  const finishingState = state;
  const finishingId = draftSession.id;
  try {
  syncDraftFromForm();
  draftSession.entries = draftSession.entries
    .map((entry) => ({ ...entry, weight: entry.weight === '' ? null : Number(entry.weight), reps: entry.reps === '' ? null : Number(entry.reps) }))
    .filter((entry) => entry.exerciseId);
  if (!draftSession.date || !draftSession.entries.length) return showToast('Заполните хотя бы одно упражнение');
  const sameDateSessions = state.sessions.filter(session => session.id !== draftSession.id && session.date === draftSession.date);
  let sameDateAction = null;
  if (draftSession.isNew && sameDateSessions.length) {
    sameDateAction = await chooseSameDateAction(draftSession.date, sameDateSessions);
    if (!sameDateAction) return;
    if (state !== finishingState || draftSession?.id !== finishingId) return;
  }
  const top = window.scrollY;
  const clean = { ...draftSession };
  delete clean.isNew;
  delete clean.scrollY;
  clean.completedAt = clean.completedAt || new Date().toISOString();
  const previousSessions = [...state.sessions];
  const previousDraft = state.workoutDraft;
  if (sameDateAction?.action === 'replace') state.sessions = state.sessions.filter(session => session.id !== sameDateAction.targetId);
  const index = state.sessions.findIndex((session) => session.id === clean.id);
  if (index >= 0) state.sessions[index] = clean; else state.sessions.push(clean);
  if (state.workoutDraft?.id === clean.id) delete state.workoutDraft;
  if (!saveState()) { state.sessions = previousSessions; state.workoutDraft = previousDraft; return; }
  if (automatic) {
    draftSession = { ...clean, isNew: false };
    setScreen('start', { keepDraft: true });
    window.scrollTo({ top, behavior: 'instant' });
    celebrateWorkout();
  } else {
    draftSession = null;
    showToast('Занятие завершено');
    setScreen(isCoach() ? 'start' : 'history', { restoreWorkout: true });
  }
  } finally { finishingWorkout = false; }
}

function chooseSameDateAction(date, sessions) {
  return new Promise(resolve => {
    openModal(`<div class="modal-head"><h2>За этот день уже есть тренировка</h2><button class="close-button" data-close-modal aria-label="Закрыть">×</button></div>
      <p class="muted">${esc(formatDate(date))}: ${sessions.length === 1 ? esc(sessions[0].templateName || 'Тренировка') : `сохранено занятий — ${sessions.length}`}.</p>
      <p>Заменить запись новыми результатами или сохранить отдельное занятие за эту же дату?</p>
      ${sessions.length > 1 ? `<label class="form-group"><span class="form-label">Какую запись заменить</span><select class="select-field" id="sameDateTarget">${sessions.map(session => `<option value="${esc(session.id)}">${esc(session.templateName || 'Тренировка')}</option>`).join('')}</select></label>` : ''}
      <div class="same-date-actions"><button class="primary-button wide" id="replaceSameDate">Заменить тренировку</button><button class="secondary-button wide" id="saveAnotherSameDate">Сохранить ещё одну</button><button class="text-button" data-close-modal>Продолжить тренировку</button></div>`);
    pendingConfirmation = value => {
      pendingConfirmation = null;
      closeModal();
      resolve(value || null);
    };
    $('#replaceSameDate').addEventListener('click', () => pendingConfirmation?.({ action: 'replace', targetId: $('#sameDateTarget')?.value || sessions[0].id }));
    $('#saveAnotherSameDate').addEventListener('click', () => pendingConfirmation?.({ action: 'another' }));
  });
}

function celebrateWorkout() {
  showToast('Тренировка завершена ✓');
  if (localStorage.getItem('workout-celebrations') === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelector('.workout-celebration')?.remove();
  const layer = document.createElement('div');
  layer.className = 'workout-celebration';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<b class="celebration-glow"></b><b class="celebration-ring"></b>';
  for (let index = 0; index < 42; index++) {
    const particle = document.createElement('i');
    const burst = index % 2;
    const angle = (index / 21) * Math.PI * 2 + burst * .18;
    const distance = 78 + Math.random() * Math.min(innerWidth * .32, 145);
    particle.className = index % 5 === 0 ? 'celebration-star' : index % 3 === 0 ? 'celebration-dot' : 'celebration-ribbon';
    particle.style.setProperty('--origin-x', burst ? '68%' : '32%');
    particle.style.setProperty('--origin-y', burst ? '56%' : '61%');
    particle.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    particle.style.setProperty('--y', `${Math.sin(angle) * distance - 34}px`);
    particle.style.setProperty('--turn', `${Math.round(Math.random() * 420 - 210)}deg`);
    particle.style.setProperty('--delay', `${burst * 90 + index % 3 * 22}ms`);
    layer.append(particle);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1600);
}

function editSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  draftSession = JSON.parse(JSON.stringify({ ...session, isNew: false }));
  setScreen('start', { keepDraft: true });
}

async function deleteDraftSession() {
  if (!draftSession || !await confirmAction('Тренировка будет удалена из истории. Восстановить её можно только из резервной копии.', 'Удалить тренировку?')) return;
  state.sessions = state.sessions.filter((session) => session.id !== draftSession.id);
  saveState();
  draftSession = null;
  showToast('Тренировка удалена');
  setScreen('history');
}

function numberExerciseCards(list) {
  reorderCards(list).forEach((card, index) => {
    $(list.hasAttribute('data-reorder-draft') ? '.entry-index' : '.exercise-order', card).textContent = list.hasAttribute('data-reorder-draft') ? String(index + 1).padStart(2, '0') : index + 1;
  });
}

function reorderCards(list) {
  return $$(list.hasAttribute('data-reorder-draft') ? '.entry-card' : '[data-reorder-exercise]', list);
}

function bindExerciseReordering() {
  $$('[data-reorder-handle]').forEach((handle) => {
    handle.addEventListener('pointerdown', prepareExerciseDrag);
    handle.addEventListener('contextmenu', (event) => event.preventDefault());
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const list = handle.closest('[data-reorder-template], [data-reorder-draft]');
      const card = handle.closest('[data-reorder-exercise], .entry-card');
      const cards = reorderCards(list);
      const index = cards.indexOf(card);
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
      if (index === target) return;
      list.insertBefore(card, target < index ? cards[target] : cards[target].nextSibling);
      commitExerciseOrder(list);
      numberExerciseCards(list);
    });
  });
}

function prepareExerciseDrag(event) {
  if (event.isPrimary === false || event.button !== 0) return;
  cancelExerciseDrag?.();
  const handle = event.currentTarget;
  if (event.pointerType === 'mouse') {
    beginExerciseDrag(event, handle);
    return;
  }
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let timer = window.setTimeout(() => {
    timer = null;
    controller.abort();
    if (cancelExerciseDrag === cancel) cancelExerciseDrag = null;
    beginExerciseDrag(event, handle);
  }, 450);
  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    controller.abort();
    if (cancelExerciseDrag === cancel) cancelExerciseDrag = null;
  };
  cancelExerciseDrag = cancel;
  document.addEventListener('pointermove', (move) => {
    if (move.pointerId !== pointerId) return;
    if (Math.hypot(move.clientX - startX, move.clientY - startY) > 9) cancel();
  }, options);
  document.addEventListener('pointerup', (up) => { if (up.pointerId === pointerId) cancel(); }, options);
  document.addEventListener('pointercancel', (cancelled) => { if (cancelled.pointerId === pointerId) cancel(); }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, options);
}

function commitExerciseOrder(list) {
  if (list.hasAttribute('data-reorder-draft')) {
    syncDraftFromForm();
    draftSession.entries = reorderCards(list).map(card => draftSession.entries[Number(card.dataset.entryIndex)]);
    reorderCards(list).forEach((card, index) => {
      card.dataset.entryIndex = index;
      $('[data-remove-draft-entry]', card).dataset.removeDraftEntry = index;
    });
    persistWorkout();
    return;
  }
  const template = templateById(list.dataset.reorderTemplate);
  if (!template) return;
  const order = $$('[data-reorder-exercise]', list).map(card => card.dataset.reorderExercise);
  const visible = new Set(order);
  let index = 0;
  // Keep any unknown/imported IDs that do not currently have a visible card.
  template.exerciseIds = template.exerciseIds.map(id => visible.has(id) ? order[index++] : id);
  saveState();
}

function beginExerciseDrag(event, handle = event.currentTarget) {
  if (event.isPrimary === false || event.button !== 0) return;
  event.preventDefault();
  cancelExerciseDrag?.();
  const card = handle.closest('[data-reorder-exercise], .entry-card');
  const list = card.closest('[data-reorder-template], [data-reorder-draft]');
  if (list.hasAttribute('data-reorder-draft')) syncDraftFromForm();
  const before = [...list.children];
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('exercise-drag-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
  document.body.appendChild(ghost);
  card.classList.add('exercise-drag-source');
  document.body.classList.add('exercise-reordering');
  handle.setPointerCapture(event.pointerId);
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let y = event.clientY;
  let frame;
  let done = false;
  const place = () => {
    const others = reorderCards(list).filter(item => item !== card);
    const next = others.find(item => { const box = item.getBoundingClientRect(); return y < box.top + box.height / 2; });
    if (card.nextElementSibling !== (next || null)) {
      list.insertBefore(card, next || null);
      handle.setPointerCapture(event.pointerId);
      numberExerciseCards(list);
    }
    ghost.style.transform = `translateY(${y - event.clientY}px)`;
  };
  const tick = () => {
    if (done) return;
    const bottom = window.innerHeight - ($('.bottom-nav')?.offsetHeight || 80) - 35;
    const speed = y < 85 ? -Math.min(14, (85 - y) / 4) : y > bottom ? Math.min(14, (y - bottom) / 4) : 0;
    if (speed) window.scrollBy(0, speed);
    place();
    frame = requestAnimationFrame(tick);
  };
  const finish = (cancelled) => {
    if (done) return;
    done = true;
    controller.abort();
    cancelAnimationFrame(frame);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (cancelled) before.forEach(item => list.appendChild(item));
    else commitExerciseOrder(list);
    numberExerciseCards(list);
    ghost.remove();
    card.classList.remove('exercise-drag-source');
    document.body.classList.remove('exercise-reordering');
    cancelExerciseDrag = null;
  };
  cancelExerciseDrag = () => finish(true);
  document.addEventListener('pointermove', (move) => {
    if (move.pointerId !== event.pointerId) return;
    move.preventDefault();
    y = move.clientY;
    place();
  }, { ...options, passive: false });
  document.addEventListener('touchmove', (move) => move.preventDefault(), { ...options, passive: false });
  document.addEventListener('pointerup', (up) => { if (up.pointerId === event.pointerId) finish(false); }, options);
  document.addEventListener('pointercancel', (cancel) => { if (cancel.pointerId === event.pointerId) finish(true); }, options);
  document.addEventListener('keydown', (key) => { if (key.key === 'Escape') finish(true); }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(true); }, options);
  frame = requestAnimationFrame(tick);
}

async function removeExerciseFromTemplate(exerciseId, templateId) {
  const template = templateById(templateId);
  const exercise = exerciseById(exerciseId);
  if (!await confirmAction(`Убрать «${exercise?.name}» из шаблона «${template?.name}»? История сохранится.`, 'Убрать упражнение?', 'Убрать')) return;
  template.exerciseIds = template.exerciseIds.filter((id) => id !== exerciseId);
  saveState(); render();
}

function confirmAction(message, title = 'Подтвердить удаление?', action = 'Удалить') {
  if (pendingConfirmation) pendingConfirmation(false);
  const sheet = $('#modalSheet');
  const backdrop = $('#modalBackdrop');
  const previousOpen = !backdrop.classList.contains('hidden');
  const previousNodes = [...sheet.childNodes];
  const previousFocus = document.activeElement;
  return new Promise((resolve) => {
    openModal(`<div class="confirm-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg></div><h2 id="confirmTitle">${esc(title)}</h2><p class="confirm-description" id="confirmDescription">${esc(message)}</p><div class="confirm-actions"><button type="button" class="secondary-button" data-close-modal>Отмена</button><button type="button" class="confirm-accept" id="confirmAccept">${esc(action)}</button></div>`);
    backdrop.classList.add('confirm-backdrop');
    sheet.setAttribute('role', 'alertdialog');
    sheet.setAttribute('aria-labelledby', 'confirmTitle');
    sheet.setAttribute('aria-describedby', 'confirmDescription');
    pendingConfirmation = (accepted) => {
      pendingConfirmation = null;
      backdrop.classList.remove('confirm-backdrop');
      sheet.setAttribute('role', 'dialog');
      sheet.removeAttribute('aria-labelledby');
      sheet.removeAttribute('aria-describedby');
      if (!accepted && previousOpen) sheet.replaceChildren(...previousNodes);
      else { backdrop.classList.add('hidden'); sheet.replaceChildren(); }
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(accepted);
    };
    $('#confirmAccept').addEventListener('click', () => pendingConfirmation?.(true));
    $('[data-close-modal]', sheet).focus({ preventScroll: true });
  });
}

function openModal(html, { replace = false } = {}) {
  if (pendingConfirmation) pendingConfirmation(false);
  if (!replace && !html.includes('id="confirmTitle"') && !$('#modalBackdrop').classList.contains('hidden')) modalTrail.push([...$('#modalSheet').childNodes]);
  $('#modalSheet').innerHTML = `<div class="modal-handle"></div>${html}`;
  const head = $('.modal-head', $('#modalSheet'));
  if (head && !head.querySelector('.back-button')) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back-button modal-back';
    back.setAttribute('aria-label', 'Назад');
    back.textContent = '‹';
    back.addEventListener('click', () => {
      const previous = modalTrail.pop();
      if (previous) $('#modalSheet').replaceChildren(...previous);
      else closeModal();
    });
    head.prepend(back);
  }
  bindExerciseImages($('#modalSheet'));
  $('#modalBackdrop').classList.remove('hidden');
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
}

function closeModal() {
  if (pendingConfirmation) return pendingConfirmation(false);
  modalTrail = [];
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

async function archiveExercise(exerciseId) {
  const exercise = exerciseById(exerciseId);
  if (!await confirmAction(`Убрать «${exercise?.name}» из всех шаблонов? История останется.`, 'Убрать из шаблонов?', 'Убрать')) return;
  state.templates.forEach((template) => { template.exerciseIds = template.exerciseIds.filter((id) => id !== exerciseId); });
  exercise.archived = true;
  saveState(); closeModal(); render(); showToast('Упражнение убрано');
}

function openSettings() {
  syncDraftFromForm();
  openModal(`
    <div class="modal-head"><h2>Настройки</h2><button class="close-button" data-close-modal>×</button></div>
    <div class="mode-picker" aria-label="Режим приложения"><button type="button" data-workspace-mode="personal" class="${!isCoach() ? 'selected' : ''}">Мой дневник<small>Личные тренировки</small></button><button type="button" data-workspace-mode="coach" class="${isCoach() ? 'selected' : ''}">Тренер<small>Ученики и занятия</small></button></div>
    <p class="muted tiny">${isCoach() ? 'Данные учеников хранятся отдельно от вашего личного дневника.' : 'В режиме тренера при первом входе появятся 12 учеников-примеров. Ваш дневник останется отдельным.'}</p>
    <div class="settings-list">
      <label class="settings-button celebration-setting"><span>Эффект завершения тренировки<small>Короткое конфетти, без звука</small></span><input type="checkbox" id="workoutCelebrations" ${localStorage.getItem('workout-celebrations') !== 'off' ? 'checked' : ''} role="switch"></label>
      <button class="settings-button" id="weeklyGoalButton">План тренировок: ${Math.max(1, Number(state.settings?.weeklyGoal) || 2)} в неделю</button>
      <button class="settings-button" id="exportData">${isCoach() ? 'Скачать копию всех учеников' : 'Скачать резервную копию'}</button>
      ${localStorage.getItem(`${isCoach() ? COACH_KEY : STORAGE_KEY}-before-import`) ? '<button class="settings-button" id="exportBeforeImport">Скачать копию до последнего импорта</button>' : ''}
      <button class="settings-button" id="importData">Импортировать данные</button>
      <button class="settings-button" id="installHelp">Как установить на iPhone</button>
      <button class="settings-button danger" id="clearData">${isCoach() ? `Очистить занятия и программу: ${esc(currentStudent()?.name || 'ученик не выбран')}` : 'Очистить данные моего дневника'}</button>
    </div>
    <p class="muted tiny section">Все тренировки хранятся только в памяти браузера на этом устройстве. Создавайте резервную копию после важных изменений.</p>
  `);
  $$('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => switchWorkspace(button.dataset.workspaceMode)));
  $('#weeklyGoalButton').addEventListener('click', openGoalModal);
  $('#workoutCelebrations').addEventListener('change', event => { localStorage.setItem('workout-celebrations', event.target.checked ? 'on' : 'off'); if (!event.target.checked) document.querySelector('.workout-celebration')?.remove(); });
  $('#exportData').addEventListener('click', exportData);
  $('#exportBeforeImport')?.addEventListener('click', () => downloadBackup(localStorage.getItem(`${isCoach() ? COACH_KEY : STORAGE_KEY}-before-import`), 'before-import'));
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
  syncDraftFromForm();
  rememberWorkoutPosition();
  downloadBackup(JSON.stringify(isCoach() ? coachWorkspace : state, null, 2), isCoach() ? 'all-students' : '');
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
    const parsed = JSON.parse(await file.text());
    if (parsed.type === 'workout-coach') return reviewCoachImport(parsed);
    if (isCoach() && !currentStudent()) throw new Error('Сначала выберите ученика');
    const imported = normalizeState(parsed);
    openModal(`<div class="modal-head"><h2>Импорт данных</h2><button class="close-button" data-close-modal>×</button></div>
      <p>В файле ${imported.sessions.length} тренировок.${isCoach() ? ` Импорт для ученика: ${esc(currentStudent().name)}.` : ''}</p>
      <p class="muted tiny">Объединение обновит совпадающие записи из файла и сохранит другие тренировки на телефоне. Перед импортом приложение сохранит локальную резервную копию.</p>
      <button class="primary-button wide" id="mergeImport">Объединить с моими данными</button>
      <button class="secondary-button wide section" id="replaceImport">Заменить все данные</button>`);
    const applyImport = async (replace) => {
      if (replace && !await confirmAction('Текущие данные будут заменены данными из файла. Перед заменой сохранится локальная резервная копия.', 'Заменить все данные?', 'Заменить')) return;
      localStorage.setItem(`${isCoach() ? COACH_KEY : STORAGE_KEY}-before-import`, JSON.stringify(isCoach() ? coachWorkspace : state));
      state = replace ? imported : WorkoutData.merge(state, imported);
      draftSession = state.workoutDraft ? structuredClone(state.workoutDraft) : null;
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

async function clearData() {
  if (isCoach() && !currentStudent()) return;
  if (!await confirmAction(isCoach() ? `Будут удалены программа, черновик и занятия ученика «${currentStudent().name}». Данные других учеников сохранятся. Сначала скачайте резервную копию.` : 'Все тренировки и упражнения личного дневника будут удалены с этого устройства. Сначала скачайте резервную копию.', 'Удалить данные?')) return;
  state = emptyState();
  draftSession = null;
  saveState();
  closeModal();
  showToast('Локальные данные очищены');
  setScreen('home');
}

// Two identical stroke layers: a neutral outline and a colour wave over it.
$$('.nav-icon').forEach((icon) => {
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.classList.add('nav-color-layer');
  [...icon.children].forEach((shape) => layer.appendChild(shape.cloneNode(true)));
  icon.appendChild(layer);
  const sparks = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  sparks.classList.add('nav-sparks');
  [7, 12, 17].forEach((x) => {
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    spark.setAttribute('cx', x);
    spark.setAttribute('cy', '3');
    spark.setAttribute('r', '1.1');
    sparks.appendChild(spark);
  });
  icon.appendChild(sparks);
});
$$('.nav-item').forEach((button) => button.addEventListener('click', () => navigateWorkspaceScreen(button.dataset.screen)));
$('#moreButton').addEventListener('click', openSettings);
$('#backButton').addEventListener('click', () => {
  if (isCoach()) {
    if (currentScreen === 'start' && draftSession?.isNew) return openStudentsModal();
    if (currentScreen === 'start') { draftSession = null; return setScreen('history'); }
    const target = coachScreenTrail.pop() || 'start';
    if (target === 'start' && !draftSession?.isNew) draftSession = state.workoutDraft ? structuredClone(state.workoutDraft) : null;
    return setScreen(target, { fromHistory: true });
  }
  if (!history.state?.root && currentScreen !== 'home') history.back();
  else setScreen('home', { replaceHistory: true });
});
$('#modalBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal(); });
$('#importInput').addEventListener('change', (event) => { if (event.target.files[0]) importData(event.target.files[0]); });
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.progress-dropdown')) closeProgressDropdown();
});
document.addEventListener('keydown', (event) => {
  if (pendingConfirmation) {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const buttons = $$('button', $('#modalSheet'));
      const index = buttons.indexOf(document.activeElement);
      event.preventDefault();
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
    return;
  }
  if (event.key === 'Escape') {
    closeProgressDropdown();
  }
});


const allowedScreens = new Set(['home', 'history', 'start', 'progress', 'insights', 'records', 'exercises', 'summary']);
document.addEventListener('visibilitychange', () => document.body.classList.toggle('page-hidden', document.hidden));
document.body.classList.toggle('page-hidden', document.hidden);
const initialScreen = isCoach() ? 'start' : allowedScreens.has(location.hash.slice(1)) ? location.hash.slice(1) : state.workoutDraft?.startedAt ? 'start' : 'home';
history.replaceState({ screen: initialScreen, root: true }, '', `#${initialScreen}`);
window.addEventListener('popstate', (event) => setScreen(event.state?.screen || 'home', { fromHistory: true }));

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));

setScreen(initialScreen, { fromHistory: true });
// Reveal after the first rendered frame, without an artificial loading delay.
requestAnimationFrame(() => requestAnimationFrame(() => {
  const boot = $('#bootScreen');
  boot?.classList.add('ready');
  setTimeout(() => boot?.remove(), 300);
}));
