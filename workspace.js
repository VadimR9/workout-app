/* Local workspaces. Student data never shares the personal diary storage key. */
const COACH_KEY = 'my-workout-coach-v1';
const MODE_KEY = 'my-workout-mode-v1';
let workspaceMode = localStorage.getItem(MODE_KEY) === 'coach' ? 'coach' : 'personal';
let coachWorkspace = readCoachWorkspace();
upgradeDemoAvatars();
if (!coachWorkspace.students.some(student => student.id === coachWorkspace.selectedId && !student.archived)) coachWorkspace.selectedId = coachWorkspace.students.find(student => !student.archived)?.id || null;
let workoutSaveFailed = false;
let restoringWorkoutPosition = false;
const personalNavigation = document.querySelector('.bottom-nav').innerHTML;

function readCoachWorkspace() {
  try {
    const data = JSON.parse(localStorage.getItem(COACH_KEY) || 'null');
    if (data && Array.isArray(data.students)) return data;
  } catch (error) { console.error(error); }
  return { type: 'workout-coach', version: 1, selectedId: null, students: [] };
}

function upgradeDemoAvatars() {
  if (coachWorkspace.demoAvatarVersion || !coachWorkspace.students.length) return;
  const avatars = { 'Анна Смирнова': 'image/avatar-anna.png', 'Михаил Волков': 'image/avatar-mikhail.png' };
  let changed = false;
  coachWorkspace.students.forEach(student => {
    if (student.demo && !student.avatar && avatars[student.name]) { student.avatar = avatars[student.name]; changed = true; }
  });
  coachWorkspace.demoAvatarVersion = 1;
  if (changed) localStorage.setItem(COACH_KEY, JSON.stringify(coachWorkspace));
}

function isCoach() { return workspaceMode === 'coach'; }
function currentStudent() { return coachWorkspace.students.find(student => student.id === coachWorkspace.selectedId && !student.archived); }
function activeStudents() { return coachWorkspace.students.filter(student => !student.archived); }
function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
function avatarColor(student) { return Number.isInteger(student.color) && student.color >= 0 && student.color <= 5 ? student.color : 0; }

function coachProgramme() {
  const exercises = Object.entries(ExerciseMedia.files).map(([id, file]) => ({ id, name: file.replace(/\.png$/, ''), archived: false }));
  return {
    version: 1, coachProgrammeVariantsVersion: 1, dataRevision: WorkoutData.DATA_REVISION, createdAt: new Date().toISOString(), exercises,
    templates: [
      { id: 'day-1', name: 'День A · Всё тело', exerciseIds: ['seated-leg-press', 'yellow-press-chest', 'horizontal-row-brown', 'barbell-curl', 'ball-abs'] },
      { id: 'day-2', name: 'День B · Всё тело', exerciseIds: ['seated-leg-curl', 'vertical-pull-blue-reverse', 'yellow-press-shoulders', 'triceps-machine', 'hyperextension'] }
    ], settings: { weeklyGoal: 2 }, sessions: []
  };
}

function prepareCoachState(data) {
  const prepared = normalizeState(data);
  // Add the missing second variant once for older one-day coach programmes.
  // A later deliberate deletion must not recreate it on every reload.
  if (!prepared.coachProgrammeVariantsVersion) {
    if (prepared.templates.length === 1) {
      const base = coachProgramme();
      const firstIds = new Set(prepared.templates[0].exerciseIds);
      const variant = base.templates.find(template => template.exerciseIds.some(id => !firstIds.has(id))) || base.templates[1];
      for (const exercise of base.exercises) if (!prepared.exercises.some(item => item.id === exercise.id)) prepared.exercises.push(exercise);
      prepared.templates.push({ ...variant, id: uid('template'), name: 'Тренировка B', exerciseIds: [...variant.exerciseIds] });
    }
    prepared.coachProgrammeVariantsVersion = 1;
  }
  return prepared;
}

function createDemoStudents() {
  const names = ['Анна Смирнова', 'Михаил Волков', 'Мария Соколова', 'Алексей Морозов', 'Дарья Кузнецова', 'Иван Попов', 'Елена Орлова', 'Дмитрий Лебедев', 'Полина Новикова', 'Артём Козлов', 'Софья Павлова', 'Никита Васильев'];
  return names.map((name, index) => {
    const data = coachProgramme();
    for (let visit = 0; visit < 4; visit += 1) {
      const template = data.templates[visit % 2];
      const date = new Date();
      date.setDate(date.getDate() - (4 - visit) * 3 - index % 3);
      data.sessions.push({ id: `demo-${index}-${visit}`, date: localISODate(date), templateId: template.id, templateName: template.name,
        entries: template.exerciseIds.map((id, exerciseIndex) => ({ exerciseId: id, nameSnapshot: data.exercises.find(exercise => exercise.id === id).name, weight: ['ball-abs', 'hyperextension'].includes(id) ? 0 : 10 + index * 2 + exerciseIndex * 5 + visit, reps: 12, done: true })) });
    }
    return { id: uid('student'), name, demo: true, color: index % 6, note: '', avatar: index === 0 ? 'image/avatar-anna.png' : index === 1 ? 'image/avatar-mikhail.png' : '', data };
  });
}

function persistCoachWorkspace() {
  localStorage.setItem(COACH_KEY, JSON.stringify(coachWorkspace));
}

function rememberWorkoutPosition() {
  if (!draftSession || currentScreen !== 'start' || document.querySelector('[data-workout-session]')?.dataset.sessionId !== draftSession.id || restoringWorkoutPosition) return;
  draftSession.scrollY = window.scrollY;
  persistWorkout();
}

function persistWorkout() {
  if (!draftSession) return true;
  if (draftSession.isNew) state.workoutDraft = JSON.parse(JSON.stringify(draftSession));
  else {
    const index = state.sessions.findIndex(session => session.id === draftSession.id);
    if (index >= 0) {
      const clean = { ...draftSession };
      delete clean.isNew;
      state.sessions[index] = clean;
    }
  }
  const saved = saveState();
  if (saved) updateStudentProgress();
  return saved;
}

function updateWorkoutStatus() {
  const status = document.querySelector('#workoutSaveStatus');
  if (status) {
    status.textContent = workoutSaveFailed ? 'Не удалось сохранить. Скачайте резервную копию.' : '';
    status.hidden = !workoutSaveFailed;
    status.classList.toggle('save-error', workoutSaveFailed);
  }
}

function beginDraft(templateId) {
  if (state.workoutDraft) {
    draftSession = JSON.parse(JSON.stringify(state.workoutDraft));
    showToast('Возвращаемся к сохранённому занятию');
  } else {
    draftSession = makeDraft(templateId);
    persistWorkout();
  }
  setScreen('start', { keepDraft: true, restoreWorkout: true });
}

function startWorkout() {
  if (!draftSession?.isNew || draftSession.startedAt) return;
  syncDraftFromForm();
  draftSession.startedAt = new Date().toISOString();
  if (isCoach() && currentStudent()) {
    const order = [...document.querySelectorAll('[data-student-id]')].map(button => button.dataset.studentId);
    const id = currentStudent().id;
    coachWorkspace.studentOrder = [id, ...order.filter(studentId => studentId !== id)];
  }
  if (!persistWorkout()) return;
  const top = window.scrollY;
  render();
  window.scrollTo({ top, behavior: 'instant' });
}

function updateWorkoutMarkers() {
  if (!draftSession) return;
  document.querySelectorAll('.entry-card[data-entry-index]').forEach(card => {
    const entry = draftSession.entries[Number(card.dataset.entryIndex)];
    const last = entry.entryId === draftSession.lastEntryId;
    card.classList.toggle('entry-last-edited', last);
    card.classList.toggle('entry-done', !!entry.done);
    card.querySelector('.entry-position-label').textContent = last ? 'Остановились здесь' : '';
    const button = card.querySelector('[data-entry-done]');
    if (button) {
      button.setAttribute('aria-pressed', String(!!entry.done));
      button.innerHTML = `<span aria-hidden="true">${entry.done ? '✓' : '○'}</span> ${entry.done ? 'Выполнено' : 'Готово'}`;
    }
  });
  updateHeaderProgress();
}

async function discardWorkout() {
  if (!draftSession) return;
  if (!await confirmAction('Черновик и введённые результаты этого занятия будут удалены. Завершённые тренировки останутся.', draftSession.startedAt ? 'Отменить занятие?' : 'Убрать черновик?', 'Удалить черновик')) return;
  delete state.workoutDraft;
  draftSession = null;
  saveState();
  setScreen(isCoach() ? 'start' : 'home', { restoreWorkout: true });
}

function chooseWorkoutProgramme() {
  syncDraftFromForm();
  openModal(`<div class="modal-head"><h2>Выбрать тренировку</h2><button class="close-button" data-close-modal>×</button></div><p class="muted tiny">${state.templates.map(template => esc(template.name)).join(' → ')} → сначала. Дни недели задавать не нужно.</p><div class="template-list">${state.templates.map(template => `<button class="template-card ${draftSession?.templateId === template.id ? 'programme-selected' : ''}" data-replace-programme="${esc(template.id)}"><span><strong>${esc(template.name)}</strong><small class="programme-option-meta">${template.exerciseIds.length} упражнений${template.id === nextTemplateId() ? ' · следующая по порядку' : ''}</small></span><span class="chevron">${draftSession?.templateId === template.id ? '✓' : '›'}</span></button>`).join('')}<button class="template-card" data-replace-programme="">Свободное занятие</button></div>`);
  document.querySelectorAll('[data-replace-programme]').forEach(button => button.addEventListener('click', () => useWorkoutProgramme(button.dataset.replaceProgramme)));
}

async function useWorkoutProgramme(templateId) {
    syncDraftFromForm();
    if (!draftSession?.isNew) draftSession = state.workoutDraft ? structuredClone(state.workoutDraft) : makeDraft(templateId);
    if (draftSession.templateId === (templateId || null)) { closeModal(); setScreen('start'); return; }
    if ((draftSession.startedAt || draftSession.hasEdits) && draftSession.templateId !== templateId && !await confirmAction('Упражнения, которых нет в выбранной программе, будут убраны из этого занятия. Значения остальных сохранятся.', 'Сменить программу?', 'Сменить')) return;
    const replacement = makeDraft(templateId);
    replacement.entries = replacement.entries.map(entry => draftSession.entries.find(old => old.exerciseId === entry.exerciseId) || entry);
    draftSession = { ...draftSession, templateId: replacement.templateId, templateName: replacement.templateName, programmeName: replacement.programmeName, programmeFingerprint: replacement.programmeFingerprint, entries: replacement.entries, scrollY: 0 };
    persistWorkout();
    closeModal();
    setScreen('start');
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function nextTemplateId() {
  const last = sortedSessions().find(session => state.templates.some(template => template.id === session.templateId));
  const index = last ? state.templates.findIndex(template => template.id === last.templateId) : -1;
  return state.templates.length ? state.templates[(index + 1) % state.templates.length].id : '';
}

function navigateWorkspaceScreen(screen) {
  if (screen === 'start' && !draftSession?.isNew) draftSession = state.workoutDraft ? structuredClone(state.workoutDraft) : null;
  setScreen(screen);
}

function openStudentWorkout() {
  draftSession = state.workoutDraft ? JSON.parse(JSON.stringify(state.workoutDraft)) : makeDraft(nextTemplateId());
  persistWorkout();
}

function refreshPreparedProgramme() {
  if (!draftSession?.isNew || draftSession.startedAt || !draftSession.programmeFingerprint) return;
  const template = templateById(draftSession.templateId);
  if (!template) return;
  const fingerprint = JSON.stringify([template.name, template.exerciseIds]);
  if (fingerprint === draftSession.programmeFingerprint) return;
  const updated = makeDraft(template.id);
  draftSession.entries = updated.entries.map(entry => draftSession.entries.find(old => old.exerciseId === entry.exerciseId) || entry);
  if (draftSession.templateName === draftSession.programmeName) draftSession.templateName = template.name;
  draftSession.programmeName = template.name;
  draftSession.programmeFingerprint = fingerprint;
  persistWorkout();
}

function restoreWorkoutPosition() {
  if (currentScreen !== 'start' || !draftSession) return;
  const sessionId = draftSession.id;
  const top = draftSession.scrollY || 0;
  restoringWorkoutPosition = true;
  const restore = () => {
    if (currentScreen === 'start' && draftSession?.id === sessionId) window.scrollTo({ top, behavior: 'instant' });
  };
  requestAnimationFrame(() => requestAnimationFrame(restore));
  setTimeout(() => { restore(); restoringWorkoutPosition = false; }, 140);
}

function selectStudent(id) {
  if (!coachWorkspace.students.some(student => student.id === id && !student.archived)) return;
  cancelExerciseDrag?.();
  syncDraftFromForm();
  rememberWorkoutPosition();
  closeModal();
  coachWorkspace.selectedId = id;
  state = prepareCoachState(currentStudent().data);
  currentStudent().data = state;
  selectedExerciseId = null;
  historyFilter = 'all';
  recordsQuery = '';
  openStudentWorkout();
  setScreen('start', { replaceHistory: true, restoreWorkout: true });
}

function switchWorkspace(mode) {
  cancelExerciseDrag?.();
  syncDraftFromForm();
  rememberWorkoutPosition();
  if (!saveState()) return;
  workspaceMode = mode;
  if (isCoach() && !coachWorkspace.students.length) {
    coachWorkspace.students = createDemoStudents();
    coachWorkspace.demoAvatarVersion = 1;
    coachWorkspace.selectedId = coachWorkspace.students[0].id;
  }
  if (isCoach() && !currentStudent()) coachWorkspace.selectedId = activeStudents()[0]?.id || null;
  persistCoachWorkspace();
  localStorage.setItem(MODE_KEY, mode);
  state = loadState();
  draftSession = state.workoutDraft ? JSON.parse(JSON.stringify(state.workoutDraft)) : null;
  selectedExerciseId = null;
  historyFilter = 'all';
  closeModal();
  if (isCoach() && currentStudent()) openStudentWorkout();
  setScreen(isCoach() ? 'start' : 'home', { replaceHistory: true, restoreWorkout: true });
}

function renderWorkspaceShell() {
  document.body.classList.toggle('coach-mode', isCoach());
  let studentsButton = document.querySelector('#manageStudents');
  if (isCoach() && !studentsButton) {
    studentsButton = document.createElement('button');
    studentsButton.id = 'manageStudents';
    studentsButton.type = 'button';
    studentsButton.className = 'students-button';
    studentsButton.setAttribute('aria-label', 'Все ученики');
    studentsButton.setAttribute('title', 'Все ученики');
    studentsButton.setAttribute('aria-haspopup', 'dialog');
    studentsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/></svg>';
    studentsButton.addEventListener('click', () => openStudentsModal());
    document.querySelector('.topbar-leading').prepend(studentsButton);
  }
  if (!isCoach()) studentsButton?.remove();
  const nav = document.querySelector('.bottom-nav');
  const mode = isCoach() ? 'coach' : 'personal';
  if (nav.dataset.workspace !== mode) {
    if (isCoach()) {
      nav.innerHTML = [['start', 'Занятие', 'M8 3h8v4H8zM8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 14l3 3 5-6'], ['exercises', 'Программа', 'M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm10 0h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM5 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Zm10 0h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z'], ['history', 'История', 'M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9ZM12 7v5l3 2'], ['summary', 'Обзор', 'M3 3v18h18M8 16v-5m5 5V8m5 8V4']].map(([screen, label, path]) => `<button class="nav-item ${currentScreen === screen ? 'active' : ''}" data-screen="${screen}"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg><span>${label}</span></button>`).join('');
    }
    else if (nav.dataset.workspace) nav.innerHTML = personalNavigation;
    if (isCoach() || nav.dataset.workspace) nav.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => navigateWorkspaceScreen(button.dataset.screen)));
    nav.dataset.workspace = mode;
  }
  nav.querySelectorAll('[data-screen]').forEach(button => button.classList.toggle('active', button.dataset.screen === currentScreen));
  let shell = document.querySelector('#coachShell');
  if (!shell) {
    shell = document.createElement('aside');
    shell.id = 'coachShell';
    document.querySelector('#app').prepend(shell);
  }
  shell.hidden = !isCoach();
  if (!isCoach()) return;
  const students = activeStudents();
  if (!Array.isArray(coachWorkspace.studentOrder)) {
    coachWorkspace.studentOrder = [...students].sort((a, b) => {
    const aStarted = a.data.workoutDraft?.startedAt;
    const bStarted = b.data.workoutDraft?.startedAt;
    if (!!aStarted !== !!bStarted) return aStarted ? -1 : 1;
    return aStarted && bStarted ? String(bStarted).localeCompare(String(aStarted)) : 0;
    }).map(student => student.id);
    persistCoachWorkspace();
  }
  const ranks = new Map(coachWorkspace.studentOrder.map((id, index) => [id, index]));
  students.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  const oldChips = [...shell.querySelectorAll('[data-student-id]')];
  const oldPositions = new Map(oldChips.map(button => [button.dataset.studentId, button.getBoundingClientRect()]));
  const orderChanged = oldChips.length === students.length && oldChips.some((button, index) => button.dataset.studentId !== students[index].id);
  const wasMoving = oldChips.some(button => button.getAnimations().some(animation => animation.playState === 'running'));
  const railScroll = shell.querySelector('.student-rail')?.scrollLeft || 0;
  const railTop = shell.querySelector('.student-rail')?.scrollTop || 0;
  shell.innerHTML = `<nav class="student-rail" aria-label="Переключение учеников">${students.map(student => `<button type="button" class="student-chip ${student.id === coachWorkspace.selectedId ? 'selected' : ''}" data-student-id="${esc(student.id)}" aria-label="${esc(student.name)}${student.data.workoutDraft?.startedAt ? ', занятие идёт' : ''}" ${student.id === coachWorkspace.selectedId ? 'aria-current="true"' : ''}>${renderStudentAvatar(student)}<span class="student-chip-name">${esc(student.name.split(' ')[0])}</span><span class="student-chip-surname">${esc(student.name.split(' ').slice(1).join(' '))}</span></button>`).join('')}</nav>`;
  shell.querySelector('.student-rail').scrollLeft = railScroll;
  shell.querySelector('.student-rail').scrollTop = railTop;
  shell.querySelectorAll('[data-student-id]').forEach(button => button.addEventListener('click', () => selectStudent(button.dataset.studentId)));
  updateStudentProgress();
  const selected = shell.querySelector('.selected');
  const rail = shell.querySelector('.student-rail');
  if (selected && (selected.offsetLeft < rail.scrollLeft || selected.offsetLeft + selected.offsetWidth > rail.scrollLeft + rail.clientWidth)) rail.scrollLeft = selected.offsetLeft - rail.clientWidth / 2 + selected.offsetWidth / 2;
  if (selected && window.innerWidth >= 1100 && (selected.offsetTop < rail.scrollTop || selected.offsetTop + selected.offsetHeight > rail.scrollTop + rail.clientHeight)) rail.scrollTop = selected.offsetTop - rail.clientHeight / 2;
  if ((orderChanged || wasMoving) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const railBounds = rail.getBoundingClientRect();
    shell.querySelectorAll('[data-student-id]').forEach(button => {
      const before = oldPositions.get(button.dataset.studentId);
      if (!before) return;
      const after = button.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
      const visible = box => box.right > railBounds.left && box.left < railBounds.right && box.bottom > railBounds.top && box.top < railBounds.bottom;
      if (!visible(before) && !visible(after)) return;
      button.animate([
        { transform: `translate(${dx}px, ${dy}px)`, zIndex: button === selected ? 2 : 1 },
        { transform: 'translate(0, 0)', zIndex: button === selected ? 2 : 1 }
      ], { duration: 440, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    });
  }
}

function renderCoachSummary() {
  return renderCoachOverview();
}

function openStudentsModal(showArchived = false, search = '', replace = false) {
  showArchived = showArchived === true;
  const students = coachWorkspace.students.filter(student => showArchived ? student.archived : !student.archived);
  const activeCount = activeStudents().length;
  const archivedCount = coachWorkspace.students.length - activeCount;
  openModal(`<section class="students-manager">
    <div class="modal-head"><h2>Ученики</h2><button class="close-button" data-close-modal aria-label="Закрыть">×</button></div>
    <div class="student-directory-tools">
      <div class="student-directory-tabs" role="group" aria-label="Список учеников">
        <button type="button" data-student-tab="active" aria-pressed="${!showArchived}">Активные <span>${activeCount}</span></button>
        <button type="button" data-student-tab="archive" aria-pressed="${showArchived}">Архив <span>${archivedCount}</span></button>
      </div>
      <label class="student-search"><span class="form-label">Поиск по имени или фамилии</span><input class="field" id="studentSearch" type="search" value="${esc(search)}" placeholder="Например, Анна" autocomplete="off"></label>
      <button class="primary-button wide" id="addStudent">＋ Добавить ученика</button>
    </div>
    <p class="student-directory-caption">${showArchived ? 'Здесь ученики, убранные из рабочего списка. Их тренировки сохранены.' : 'Нажмите на ученика, чтобы открыть его тренировку.'}</p>
    <div class="student-directory">${students.map(student => `<div class="student-directory-row ${!showArchived && student.id === coachWorkspace.selectedId ? 'is-current' : ''}" data-student-search="${esc(student.name)}">
      ${showArchived ? '<div' : '<button type="button"'} class="student-directory-select" ${showArchived ? '' : `data-open-student="${esc(student.id)}"`}>
        ${renderStudentAvatar(student)}<span><strong>${esc(student.name)}</strong><small>${showArchived ? 'В архиве · данные сохранены' : student.id === coachWorkspace.selectedId ? 'Сейчас открыт' : student.data.workoutDraft?.startedAt ? 'Тренировка идёт' : 'Открыть тренировку'}</small></span>
      ${showArchived ? '</div>' : '</button>'}
      ${showArchived ? `<button class="student-restore-button" data-restore-student="${esc(student.id)}">Вернуть</button>` : `<button class="student-card-button" data-edit-student="${esc(student.id)}" aria-label="Карточка ученика ${esc(student.name)}">Карточка</button>`}
    </div>`).join('')}</div>
    <div class="student-directory-empty" id="studentSearchEmpty" hidden><strong id="studentEmptyTitle"></strong><p id="studentEmptyHint"></p><button type="button" class="text-button" id="studentSearchOther" hidden></button></div>
    ${coachWorkspace.students.some(student => student.demo && !student.archived) ? '<details class="student-directory-extra"><summary>Ученики-примеры</summary><p class="muted tiny">Можно убрать примеры из рабочего списка. Все данные останутся в архиве.</p><button class="settings-button" id="archiveDemos">Убрать примеры в архив</button></details>' : ''}
  </section>`, { replace });
  document.querySelectorAll('[data-open-student]').forEach(button => button.addEventListener('click', () => selectStudent(button.dataset.openStudent)));
  document.querySelectorAll('[data-edit-student]').forEach(button => button.addEventListener('click', () => openStudentEditor(button.dataset.editStudent)));
  document.querySelectorAll('[data-restore-student]').forEach(button => button.addEventListener('click', () => {
    const student = coachWorkspace.students.find(item => item.id === button.dataset.restoreStudent);
    student.archived = false;
    persistCoachWorkspace();
    renderWorkspaceShell();
    openStudentsModal(false, student.name, true);
    showToast('Ученик возвращён в активные');
  }));
  document.querySelector('#addStudent').addEventListener('click', () => openStudentEditor());
  const searchInput = document.querySelector('#studentSearch');
  document.querySelectorAll('[data-student-tab]').forEach(button => button.addEventListener('click', () => {
    if ((button.dataset.studentTab === 'archive') !== showArchived) openStudentsModal(!showArchived, searchInput.value, true);
  }));
  document.querySelector('#studentSearchOther').addEventListener('click', () => openStudentsModal(!showArchived, searchInput.value, true));
  const normalize = value => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim().split(/\s+/).filter(Boolean);
  const updateSearch = () => {
    const words = normalize(searchInput.value);
    const matches = name => words.every(word => normalize(name).join(' ').includes(word));
    const rows = [...document.querySelectorAll('[data-student-search]')];
    rows.forEach(row => row.hidden = !matches(row.dataset.studentSearch));
    const empty = !rows.some(row => !row.hidden);
    document.querySelector('#studentSearchEmpty').hidden = !empty;
    document.querySelector('#studentEmptyTitle').textContent = words.length ? 'Никого не найдено' : showArchived ? 'Архив пока пуст' : 'Добавьте первого ученика';
    document.querySelector('#studentEmptyHint').textContent = words.length ? 'Проверьте имя или попробуйте часть фамилии.' : showArchived ? 'Сюда попадают ученики, которых вы убрали из активных.' : 'Создайте карточку — затем можно настроить программу и начать тренировку.';
    const other = document.querySelector('#studentSearchOther');
    const otherMatches = coachWorkspace.students.filter(student => Boolean(student.archived) !== showArchived && matches(student.name)).length;
    other.hidden = !empty || !words.length || !otherMatches;
    other.textContent = showArchived ? `Найдены в активных: ${otherMatches} →` : `Найдены в архиве: ${otherMatches} →`;
  };
  searchInput.addEventListener('input', updateSearch);
  updateSearch();
  document.querySelector('#archiveDemos')?.addEventListener('click', async () => {
    if (!await confirmAction('Ученики-примеры уйдут в архив. Их можно будет вернуть; добавленные вами ученики останутся.', 'Убрать учеников-примеры?', 'В архив')) return;
    rememberWorkoutPosition();
    coachWorkspace.students.filter(student => student.demo).forEach(student => student.archived = true);
    coachWorkspace.selectedId = activeStudents()[0]?.id || null;
    persistCoachWorkspace();
    if (currentStudent()) selectStudent(currentStudent().id);
    else { state = coachProgramme(); draftSession = null; closeModal(); setScreen('start', { replaceHistory: true }); }
  });
}

function openStudentEditor(id = null) {
  const student = coachWorkspace.students.find(item => item.id === id);
  openModal(`<div class="modal-head"><h2>${student ? 'Карточка ученика' : 'Новый ученик'}</h2><button class="close-button" data-close-modal>×</button></div><div class="student-avatar-editor"><div id="studentAvatarPreview">${renderStudentAvatar(student || { name: '?', color: 0 })}</div><div><button type="button" class="secondary-button" id="chooseStudentAvatar">Выбрать фото</button><button type="button" class="text-button" id="removeStudentAvatar">Инициалы</button></div><input type="file" id="studentAvatarFile" accept="image/*" hidden></div><label class="form-group"><span class="form-label">Имя и фамилия</span><input class="field" id="studentName" value="${esc(student?.name || '')}" maxlength="80" placeholder="Например, Анна Смирнова"></label><label class="form-group"><span class="form-label">Заметка тренера</span><textarea class="textarea-field" id="studentNote" maxlength="600" placeholder="Цель, пожелания, особенности программы">${esc(student?.note || '')}</textarea></label>${!student ? `<label class="form-group"><span class="form-label">Начальная программа</span><select class="select-field" id="studentProgramme"><option value="default">Два базовых дня · можно изменить</option><option value="empty">Пустая программа</option>${currentStudent() ? `<option value="copy">Скопировать программу: ${esc(currentStudent().name)}</option>` : ''}</select></label>` : ''}<button class="primary-button wide" id="saveStudent">${student ? 'Сохранить карточку' : 'Создать ученика'}</button>${student ? `<button class="secondary-button wide section" id="archiveStudent">${student.archived ? 'Вернуть из архива' : 'Убрать ученика в архив'}</button>` : ''}`);
  const avatarEditor = bindStudentAvatarEditor(student);
  document.querySelector('#saveStudent').addEventListener('click', () => {
    const name = document.querySelector('#studentName').value.trim();
    if (!name) return showToast('Введите имя ученика');
    const note = document.querySelector('#studentNote').value.trim();
    if (student) { student.name = name; student.note = note; student.avatar = avatarEditor.value; persistCoachWorkspace(); closeModal(); render(); }
    else {
      const programme = document.querySelector('#studentProgramme').value;
      const data = coachProgramme();
      if (programme === 'empty') data.templates = [];
      if (programme === 'copy') { data.templates = structuredClone(state.templates); data.exercises = structuredClone(state.exercises); }
      const created = { id: uid('student'), name, note, avatar: avatarEditor.value, color: coachWorkspace.students.length % 6, data };
      coachWorkspace.students.push(created);
      persistCoachWorkspace();
      selectStudent(created.id);
    }
  });
  document.querySelector('#archiveStudent')?.addEventListener('click', async () => {
    if (!student.archived && !await confirmAction('История и незавершённое занятие сохранятся. Ученика можно вернуть из архива.', `Убрать ${student.name} в архив?`, 'В архив')) return;
    rememberWorkoutPosition();
    student.archived = !student.archived;
    const selected = currentStudent();
    coachWorkspace.selectedId = selected?.id || activeStudents()[0]?.id || null;
    persistCoachWorkspace();
    if (currentStudent()) selectStudent(currentStudent().id);
    else { state = coachProgramme(); draftSession = null; closeModal(); setScreen('start', { replaceHistory: true }); }
  });
}

function reviewCoachImport(data) {
  if (!Array.isArray(data.students) || data.students.some(student => !student.id || typeof student.name !== 'string' || !student.name.trim())) throw new Error('Неверный формат списка учеников');
  if (new Set(data.students.map(student => student.id)).size !== data.students.length) throw new Error('Повторяющиеся идентификаторы учеников');
  const imported = { type: 'workout-coach', version: 1, selectedId: data.selectedId, students: data.students.map(student => ({ ...student, data: normalizeState(student.data) })) };
  openModal(`<div class="modal-head"><h2>Копия кабинета тренера</h2><button class="close-button" data-close-modal>×</button></div><p>В файле ${imported.students.length} учеников, их программы, занятия и черновики.</p><p class="muted tiny">Личный дневник останется отдельным. Перед импортом сохранится локальная копия кабинета тренера.</p><button class="primary-button wide" id="mergeCoachImport">Объединить учеников</button><button class="secondary-button wide section" id="replaceCoachImport">Заменить кабинет тренера</button>`);
  const apply = async replace => {
    if (replace && !await confirmAction('Список учеников и их данные будут заменены из файла. Личный дневник сохранится.', 'Заменить кабинет тренера?', 'Заменить')) return;
    syncDraftFromForm();
    rememberWorkoutPosition();
    if (!saveState()) return;
    localStorage.setItem(`${COACH_KEY}-before-import`, JSON.stringify(coachWorkspace));
    if (replace) coachWorkspace = imported;
    else {
      const students = new Map(coachWorkspace.students.map(student => [student.id, student]));
      imported.students.forEach(student => students.set(student.id, student));
      coachWorkspace.students = [...students.values()];
    }
    workspaceMode = 'coach';
    localStorage.setItem(MODE_KEY, 'coach');
    coachWorkspace.selectedId = activeStudents().find(student => student.id === imported.selectedId)?.id || activeStudents()[0]?.id || null;
    persistCoachWorkspace();
    draftSession = null;
    state = loadState();
    if (currentStudent()) selectStudent(currentStudent().id);
    else { closeModal(); setScreen('start', { replaceHistory: true }); }
    showToast('Данные учеников восстановлены');
  };
  document.querySelector('#mergeCoachImport').addEventListener('click', () => apply(false));
  document.querySelector('#replaceCoachImport').addEventListener('click', () => apply(true));
}

let positionSaveTimer;
window.addEventListener('scroll', () => {
  if (restoringWorkoutPosition) return;
  clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(rememberWorkoutPosition, 180);
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) rememberWorkoutPosition(); });
window.addEventListener('pagehide', rememberWorkoutPosition);
